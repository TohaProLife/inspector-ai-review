"""Declare unavailable recorded evidence without hiding validation failures."""

from pathlib import Path
import unittest


def require_recorded_artifacts(*paths: Path) -> None:
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise unittest.SkipTest("Recorded audit artifacts unavailable: " + "; ".join(missing))
