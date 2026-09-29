from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from collections import OrderedDict
import gc
from io import BytesIO
import os
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
import numpy as np
from PIL import Image
import pypdfium2 as pdfium

from document_profile import DocumentProfile, load_profile, pipeline_options
from document_limits import validate_pixel_dimensions


PROFILE_PATH = Path(os.getenv("DOCUMENT_AI_PROFILE", "/opt/document-ai/profiles/laptop.json"))
MAX_UPLOAD_BYTES = int(os.getenv("DOCUMENT_AI_MAX_UPLOAD_BYTES", "67108864"))
MAX_RENDER_PIXELS = int(os.getenv("DOCUMENT_AI_MAX_RENDER_PIXELS", "40000000"))
MAX_IMAGE_SIDE = int(os.getenv("DOCUMENT_AI_MAX_IMAGE_SIDE", "20000"))
MAX_LOADED_PIPELINES = int(os.getenv("DOCUMENT_AI_MAX_LOADED_PIPELINES", "1"))
OMITTED_RASTER_RESULT_KEYS = frozenset({"input_img", "rot_img", "output_img", "imgs_in_doc"})
if MAX_LOADED_PIPELINES < 1 or MAX_RENDER_PIXELS < 1 or MAX_IMAGE_SIDE < 1:
    raise RuntimeError("document runtime limits must be positive")


def jsonable(value: Any) -> Any:
    # PaddleX attaches a lazy font descriptor to OCR results. Reading its
    # ``path`` property can download a font; only its stable name belongs in
    # the response, especially when the provider has no network access.
    if type(value).__module__ == "paddlex.utils.fonts" and type(value).__name__ == "Font":
        return getattr(value, "_font_name", None) or Path(getattr(value, "_local_path", "")).name
    if type(value).__module__ == "paddlex.inference.pipelines.layout_parsing.layout_objects" and type(value).__name__ == "LayoutBlock":
        return {
            "label": str(value.label),
            "bbox": jsonable(value.bbox),
            "content": str(value.content),
            "groupId": jsonable(value.group_id),
            "index": jsonable(value.index),
            "orderIndex": jsonable(value.order_index),
        }
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {
            str(key): jsonable(item)
            for key, item in value.items()
            if str(key) not in OMITTED_RASTER_RESULT_KEYS
        }
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    candidate = getattr(value, "json", value)
    if candidate is not value:
        return jsonable(candidate() if callable(candidate) else candidate)
    return value


class DocumentRuntime:
    def __init__(self, profile: DocumentProfile):
        self.profile = profile
        self._pipelines: OrderedDict[str, Any] = OrderedDict()
        self._load_lock = Lock()

    def pipeline(self, script: str) -> Any:
        if script not in self.profile.scripts:
            raise ValueError(f"unsupported script: {script}")
        with self._load_lock:
            existing = self._pipelines.get(script)
            if existing is not None:
                self._pipelines.move_to_end(script)
                return existing
            while len(self._pipelines) >= MAX_LOADED_PIPELINES:
                _, evicted = self._pipelines.popitem(last=False)
                del evicted
                gc.collect()
                if self.profile.device.startswith("gpu"):
                    try:
                        import paddle

                        paddle.device.cuda.empty_cache()
                    except Exception:
                        pass
            from paddleocr import PPStructureV3

            loaded = PPStructureV3(**pipeline_options(self.profile, script))
            self._pipelines[script] = loaded
            return loaded

    def preload(self) -> None:
        for script in self.profile.scripts[:MAX_LOADED_PIPELINES]:
            self.pipeline(script)

    @property
    def loaded_scripts(self) -> list[str]:
        return sorted(self._pipelines)


profile = load_profile(PROFILE_PATH)
runtime = DocumentRuntime(profile)
inference_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("DOCUMENT_AI_PRELOAD", "1") == "1":
        await asyncio.to_thread(runtime.preload)
    yield


app = FastAPI(title="Inspector AI Document Provider", version="1.0.0", lifespan=lifespan)


async def bounded_read(upload: UploadFile) -> bytes:
    payload = await upload.read(MAX_UPLOAD_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="upload exceeds configured limit")
    return payload


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "profileId": profile.profile_id,
        "device": profile.device,
        "loadedScripts": runtime.loaded_scripts,
    }


@app.post("/v1/render")
async def render_pdf(
    file: UploadFile = File(...),
    page: int = Form(..., ge=1),
    dpi: int = Form(300, ge=72, le=600),
) -> Response:
    payload = await bounded_read(file)

    def render() -> tuple[bytes, int, int, int]:
        document = pdfium.PdfDocument(payload)
        try:
            if page > len(document):
                raise HTTPException(status_code=422, detail="page exceeds PDF page count")
            source_page = document[page - 1]
            width_points, height_points = source_page.get_size()
            scale = dpi / 72.0
            try:
                validate_pixel_dimensions(
                    width_points * scale,
                    height_points * scale,
                    max_pixels=MAX_RENDER_PIXELS,
                    max_side=MAX_IMAGE_SIDE,
                )
            except ValueError as error:
                raise HTTPException(
                    status_code=422,
                    detail=f"RESOURCE_LIMIT: {error}",
                ) from error
            bitmap = source_page.render(scale=scale, rev_byteorder=True)
            image = bitmap.to_pil().convert("RGB")
            output = BytesIO()
            image.save(output, format="PNG", optimize=False)
            return output.getvalue(), image.width, image.height, len(document)
        finally:
            document.close()

    try:
        png, width, height, page_count = await asyncio.to_thread(render)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"PDF render failed: {type(error).__name__}") from error
    return Response(
        png,
        media_type="image/png",
        headers={
            "X-Source-Page": str(page),
            "X-Source-Page-Count": str(page_count),
            "X-Render-Dpi": str(dpi),
            "X-Render-Width": str(width),
            "X-Render-Height": str(height),
            "X-Renderer-Profile": "renderer-pdfium-5.12.1-linux-x86_64-v1",
        },
    )


@app.post("/v1/ocr")
async def recognize_image(
    file: UploadFile = File(...),
    script: str = Form("eslav"),
) -> JSONResponse:
    if script not in profile.scripts:
        raise HTTPException(status_code=422, detail=f"unsupported script: {script}")
    payload = await bounded_read(file)
    try:
        with Image.open(BytesIO(payload)) as source_image:
            validate_pixel_dimensions(
                source_image.width,
                source_image.height,
                max_pixels=MAX_RENDER_PIXELS,
                max_side=MAX_IMAGE_SIDE,
            )
            source_image.load()
            image = np.asarray(source_image.convert("RGB"))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"RESOURCE_LIMIT: {error}") from error
    except Exception as error:
        raise HTTPException(status_code=422, detail="invalid raster image") from error

    def infer() -> list[Any]:
        return list(runtime.pipeline(script).predict(image, **profile.prediction_options))

    try:
        async with inference_lock:
            results = await asyncio.to_thread(infer)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"OCR inference failed: {type(error).__name__}") from error
    return JSONResponse(
        {
            "schemaVersion": "document-ai-ocr-response-v1",
            "profileId": profile.profile_id,
            "script": script,
            "results": jsonable(results),
        }
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("DOCUMENT_AI_HOST", "0.0.0.0"),
        port=int(os.getenv("DOCUMENT_AI_PORT", "8080")),
        access_log=False,
    )
