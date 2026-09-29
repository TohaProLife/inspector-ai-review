"""Locate a real Cyrillic font for synthetic PDF fixtures on each host."""

from functools import lru_cache
import importlib.util
import os
from pathlib import Path
import unittest

import fitz


@lru_cache(maxsize=1)
def cyrillic_font() -> str:
    override = os.environ.get("INSPECTOR_TEST_CYRILLIC_FONT")
    candidates = [Path(override)] if override else [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts/arial.ttf",
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    ]
    matplotlib = importlib.util.find_spec("matplotlib") if not override else None
    if matplotlib is not None and matplotlib.origin:
        candidates.insert(2, Path(matplotlib.origin).parent / "mpl-data/fonts/ttf/DejaVuSans.ttf")
    for path in candidates:
        if not path.is_file():
            continue
        font = fitz.Font(fontfile=str(path))
        if not all(font.has_glyph(ord(character)) for character in "АБВЯабвяёЁм³"):
            continue
        # Some font charmaps decode ordinary spaces as NBSP in PDF extraction.
        # These fixtures need the original words and separators to round-trip.
        sample = "Корпус К1 (предварительно) м³"
        with fitz.open() as document:
            page = document.new_page()
            page.insert_font(fontname="fixture", fontfile=str(path))
            page.insert_text((40, 100), sample, fontname="fixture")
            if page.get_text().strip() == sample:
                return str(path)
    message = (
        "Synthetic Cyrillic PDF fixtures require a font with Russian glyphs; "
        "set INSPECTOR_TEST_CYRILLIC_FONT. Searched: "
        + ", ".join(str(path) for path in candidates)
    )
    if override:
        raise ValueError(message)
    raise unittest.SkipTest(message)
