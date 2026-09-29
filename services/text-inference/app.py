from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import math
import os
from threading import Lock
from typing import Literal

from fastapi import FastAPI, HTTPException
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator


RUNTIME_KIND = os.getenv("TEXT_RUNTIME_KIND", "embedding")
MODEL_PATH = os.getenv("TEXT_RUNTIME_MODEL_PATH", "")
MODEL_ALIAS = os.getenv("TEXT_RUNTIME_MODEL_ALIAS", "")
DEVICE = os.getenv("TEXT_RUNTIME_DEVICE", "cpu")
BATCH_SIZE = int(os.getenv("TEXT_RUNTIME_BATCH_SIZE", "8"))
OUTPUT_DIMENSIONS = int(os.getenv("TEXT_RUNTIME_OUTPUT_DIMENSIONS", "1024"))
MAX_INPUT_TOKENS = int(os.getenv("TEXT_RUNTIME_MAX_INPUT_TOKENS", "4096"))
MAX_ITEMS = int(os.getenv("TEXT_RUNTIME_MAX_ITEMS", "32"))
MAX_TEXT_CHARS = int(os.getenv("TEXT_RUNTIME_MAX_TEXT_CHARS", "100000"))
GPU_MEMORY_FRACTION = float(os.getenv("TEXT_RUNTIME_GPU_MEMORY_FRACTION", "1"))

if RUNTIME_KIND not in {"embedding", "reranker"}:
    raise RuntimeError("TEXT_RUNTIME_KIND must be embedding or reranker")
if not MODEL_PATH or not MODEL_ALIAS:
    raise RuntimeError("TEXT_RUNTIME_MODEL_PATH and TEXT_RUNTIME_MODEL_ALIAS are required")
if BATCH_SIZE < 1 or MAX_ITEMS < 1 or OUTPUT_DIMENSIONS < 1 or MAX_INPUT_TOKENS < 1 or MAX_TEXT_CHARS < 1:
    raise RuntimeError("text runtime numeric limits must be positive")
if not 0 < GPU_MEMORY_FRACTION <= 1:
    raise RuntimeError("TEXT_RUNTIME_GPU_MEMORY_FRACTION must be within (0, 1]")


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str | list[str]
    model: str | None = None
    dimensions: int | None = Field(default=None, ge=1)
    encoding_format: Literal["float"] = "float"

    @field_validator("input")
    @classmethod
    def validate_input(cls, value: str | list[str]) -> str | list[str]:
        values = [value] if isinstance(value, str) else value
        if not values or len(values) > MAX_ITEMS:
            raise ValueError(f"input must contain 1..{MAX_ITEMS} texts")
        if any(not isinstance(item, str) or not item or len(item) > MAX_TEXT_CHARS for item in values):
            raise ValueError("input contains empty or oversized text")
        return value


class RerankRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1)
    documents: list[str] = Field(min_length=1)
    model: str | None = None
    top_n: int | None = Field(default=None, ge=1)
    return_documents: bool = False

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        if len(value) > MAX_TEXT_CHARS:
            raise ValueError("query is oversized")
        return value

    @field_validator("documents")
    @classmethod
    def validate_documents(cls, value: list[str]) -> list[str]:
        if len(value) > MAX_ITEMS:
            raise ValueError(f"documents must contain at most {MAX_ITEMS} texts")
        if any(not item or len(item) > MAX_TEXT_CHARS for item in value):
            raise ValueError("documents contain empty or oversized text")
        return value


class TextRuntime:
    def __init__(self) -> None:
        self._model = None
        self._load_lock = Lock()

    def load(self):
        with self._load_lock:
            if self._model is not None:
                return self._model
            if DEVICE.startswith("cuda"):
                import torch

                torch.cuda.set_per_process_memory_fraction(GPU_MEMORY_FRACTION, device=DEVICE)
            if RUNTIME_KIND == "embedding":
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(MODEL_PATH, device=DEVICE)
                self._model.max_seq_length = MAX_INPUT_TOKENS
            else:
                from sentence_transformers import CrossEncoder

                self._model = CrossEncoder(MODEL_PATH, device=DEVICE, max_length=MAX_INPUT_TOKENS)
            return self._model

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self.load()
        values = np.asarray(
            model.encode(
                texts,
                batch_size=BATCH_SIZE,
                normalize_embeddings=False,
                convert_to_numpy=True,
                show_progress_bar=False,
            ),
            dtype=np.float32,
        )
        if values.ndim != 2 or values.shape[1] < OUTPUT_DIMENSIONS:
            raise RuntimeError(
                f"model output dimension {values.shape if values.ndim else 0} is below {OUTPUT_DIMENSIONS}"
            )
        values = values[:, :OUTPUT_DIMENSIONS]
        norms = np.linalg.norm(values, axis=1, keepdims=True)
        if np.any(norms == 0):
            raise RuntimeError("embedding model returned a zero vector")
        return (values / norms).tolist()

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        model = self.load()
        logits = np.asarray(
            model.predict(
                [(query, document) for document in documents],
                batch_size=BATCH_SIZE,
                convert_to_numpy=True,
                show_progress_bar=False,
            ),
            dtype=np.float64,
        ).reshape(-1)
        return [stable_sigmoid(float(value)) for value in logits]


def stable_sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


runtime = TextRuntime()
inference_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("TEXT_RUNTIME_PRELOAD", "1") == "1":
        await asyncio.to_thread(runtime.load)
    yield


app = FastAPI(title="Inspector AI Text Inference", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "kind": RUNTIME_KIND,
        "model": MODEL_ALIAS,
        "device": DEVICE,
        "loaded": runtime.loaded,
        "maxInputTokens": MAX_INPUT_TOKENS,
        "gpuMemoryFraction": GPU_MEMORY_FRACTION if DEVICE.startswith("cuda") else None,
        "dimensions": OUTPUT_DIMENSIONS if RUNTIME_KIND == "embedding" else None,
    }


@app.post("/v1/embeddings")
async def embeddings(request: EmbeddingRequest) -> dict[str, object]:
    if RUNTIME_KIND != "embedding":
        raise HTTPException(status_code=404, detail="embedding endpoint is disabled")
    if request.model not in {None, MODEL_ALIAS}:
        raise HTTPException(status_code=422, detail="unknown model alias")
    if request.dimensions not in {None, OUTPUT_DIMENSIONS}:
        raise HTTPException(status_code=422, detail=f"dimensions must equal {OUTPUT_DIMENSIONS}")
    texts = [request.input] if isinstance(request.input, str) else request.input
    try:
        async with inference_lock:
            vectors = await asyncio.to_thread(runtime.embed, texts)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"embedding failed: {type(error).__name__}") from error
    return {
        "object": "list",
        "model": MODEL_ALIAS,
        "data": [
            {"object": "embedding", "index": index, "embedding": vector}
            for index, vector in enumerate(vectors)
        ],
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }


@app.post("/v1/rerank")
async def rerank(request: RerankRequest) -> dict[str, object]:
    if RUNTIME_KIND != "reranker":
        raise HTTPException(status_code=404, detail="rerank endpoint is disabled")
    if request.model not in {None, MODEL_ALIAS}:
        raise HTTPException(status_code=422, detail="unknown model alias")
    try:
        async with inference_lock:
            scores = await asyncio.to_thread(runtime.rerank, request.query, request.documents)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"rerank failed: {type(error).__name__}") from error
    ranked = sorted(enumerate(scores), key=lambda item: (-item[1], item[0]))
    limit = min(request.top_n or len(ranked), len(ranked))
    return {
        "model": MODEL_ALIAS,
        "results": [
            {
                "index": index,
                "relevance_score": score,
                **({"document": {"text": request.documents[index]}} if request.return_documents else {}),
            }
            for index, score in ranked[:limit]
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("TEXT_RUNTIME_HOST", "0.0.0.0"),
        port=int(os.getenv("TEXT_RUNTIME_PORT", "8080")),
        access_log=False,
    )
