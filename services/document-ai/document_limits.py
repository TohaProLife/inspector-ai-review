from __future__ import annotations

import math


def validate_pixel_dimensions(
    width: float,
    height: float,
    *,
    max_pixels: int,
    max_side: int,
) -> tuple[int, int]:
    if not math.isfinite(width) or not math.isfinite(height) or width <= 0 or height <= 0:
        raise ValueError("image dimensions must be finite and positive")
    pixel_width = math.ceil(width)
    pixel_height = math.ceil(height)
    if pixel_width > max_side or pixel_height > max_side:
        raise ValueError(f"image side exceeds {max_side} pixels")
    if pixel_width * pixel_height > max_pixels:
        raise ValueError(f"image exceeds {max_pixels} pixels")
    return pixel_width, pixel_height
