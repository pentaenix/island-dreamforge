from __future__ import annotations

import base64
import io
from typing import Iterable, Tuple

import numpy as np
from PIL import Image


def read_upload_image(upload_bytes: bytes, mode: str = "RGBA") -> Image.Image:
    """Read raw upload bytes into a PIL image.

    For heightmaps, pass mode="I;16" to preserve the source bit depth instead of
    forcing a lossy conversion. image_to_height_m handles 8-bit and 16-bit inputs.
    """
    img = Image.open(io.BytesIO(upload_bytes))
    if mode in {"I;16", "I;16B", "I;16L", "F", "original"}:
        return img
    return img.convert(mode)


def pil_to_rgb_array(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.float32)


def pil_to_alpha_array(image: Image.Image) -> np.ndarray:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    return rgba[..., 3]


def hex_to_rgb(value: str) -> Tuple[int, int, int]:
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) != 6:
        raise ValueError(f"Invalid hex color: {value}")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb: Iterable[int]) -> str:
    r, g, b = [int(max(0, min(255, x))) for x in rgb]
    return f"#{r:02x}{g:02x}{b:02x}"


def image_to_data_url(image: Image.Image, fmt: str = "PNG") -> str:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    mime = "image/png" if fmt.upper() == "PNG" else f"image/{fmt.lower()}"
    return f"data:{mime};base64,{encoded}"


def array_to_16bit_png(height_m: np.ndarray, max_height_m: float) -> Image.Image:
    max_height_m = float(max(1e-6, max_height_m))
    normalized = np.clip(height_m / max_height_m, 0.0, 1.0)
    arr16 = (normalized * 65535.0).round().astype(np.uint16)
    return Image.fromarray(arr16, mode="I;16")


def array_to_preview_png(height_m: np.ndarray, max_height_m: float) -> Image.Image:
    max_height_m = float(max(1e-6, max_height_m))
    normalized = np.clip(height_m / max_height_m, 0.0, 1.0)
    arr8 = (normalized * 255.0).round().astype(np.uint8)
    return Image.fromarray(arr8, mode="L")


def image_to_height_m(image: Image.Image, max_height_m: float) -> np.ndarray:
    """Convert 8/16-bit grayscale-ish image to meter heights."""
    if image.mode in {"I;16", "I;16B", "I;16L"}:
        arr = np.asarray(image, dtype=np.uint16).astype(np.float32) / 65535.0
    else:
        gray = image.convert("L")
        arr = np.asarray(gray, dtype=np.float32) / 255.0
    return arr * float(max_height_m)


def mask_from_colored_layer(image: Image.Image, threshold: int = 10) -> np.ndarray:
    """Detect non-black / non-transparent painted layer pixels."""
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3] > threshold
    lum = np.max(rgba[..., :3], axis=-1) > threshold
    return (alpha & lum).astype(bool)


def resize_to_match(image: Image.Image, shape_hw: tuple[int, int], resample=Image.Resampling.BILINEAR) -> Image.Image:
    h, w = shape_hw
    if image.size == (w, h):
        return image
    return image.resize((w, h), resample=resample)
