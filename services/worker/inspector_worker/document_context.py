"""Source context from PDF metadata, outline, and every page's text/stamp.

Signals describe document topics, never element identity or a violation.
"""
from __future__ import annotations
import hashlib
import re
import fitz

METHOD = "metadata-outline-page-signals-v2"
PATTERNS = {
    "HEATING": re.compile(r"\bотоплени[еяию]\b", re.I),
    "VENTILATION": re.compile(r"\bвентиляци[яиюе]\b", re.I),
    "WATER_SUPPLY": re.compile(r"\bводоснабжени[еяию]\b", re.I),
    "DRAINAGE": re.compile(r"\b(?:водоотведени[еяию]|канализаци[яиюе])\b", re.I),
    "ELECTRICAL": re.compile(r"\b(?:электроснабжени[еяию]|электроосвещени[еяию])\b", re.I),
}


def document_context(document: fitz.Document) -> dict:
    signals = []
    pages = []
    domains = set()

    def inspect(text: str, kind: str, page: int | None):
        for domain, pattern in PATTERNS.items():
            match = pattern.search(text)
            if match:
                domains.add(domain)
                start = max(0, match.start() - 120)
                snippet = text[start:match.end() + 120]
                signals.append({"kind": kind, "pageNumber": page, "domain": domain,
                                "snippet": snippet, "textSha256": hashlib.sha256(text.encode()).hexdigest()})

    metadata = "\n".join(str((document.metadata or {}).get(key) or "")
                         for key in ("title", "subject", "keywords"))
    inspect(metadata, "METADATA", None)
    for _, title, page in document.get_toc():
        inspect(title, "OUTLINE", page if 1 <= page <= len(document) else None)
    for index in range(len(document)):
        text = document.load_page(index).get_text("text")
        pages.append({"pageNumber": index + 1, "textSha256": hashlib.sha256(text.encode()).hexdigest(),
                      "textAvailable": bool(text.strip())})
        inspect(text, "PAGE_TEXT", index + 1)
    return {"schemaVersion": "document-context-v2", "methodId": METHOD,
            "status": "MIXED" if len(domains) > 1 else next(iter(domains), "UNKNOWN"),
            "reasonCode": "MULTIPLE_SYSTEMS" if len(domains) > 1 else "TOPIC_SIGNALS" if domains else "NO_TOPIC_SIGNALS",
            "domains": sorted(domains), "ambiguity": len(domains) > 1,
            "inspectedPages": pages, "signals": signals,
            "unreadablePageCount": sum(not page["textAvailable"] for page in pages)}
