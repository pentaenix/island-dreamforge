from __future__ import annotations

import math
from collections import deque
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image, ImageDraw

from .image_utils import image_to_height_m, mask_from_colored_layer, resize_to_match


def _downscale_for_analysis(image: Image.Image, max_side: int = 1200) -> tuple[Image.Image, float]:
    scale = min(1.0, max_side / max(image.size))
    if scale >= 1.0:
        return image, 1.0
    size = (max(1, int(round(image.width * scale))), max(1, int(round(image.height * scale))))
    return image.resize(size, Image.Resampling.NEAREST), scale


def connected_components(mask: np.ndarray, max_components: int = 1000, min_area: int = 3) -> List[Dict[str, Any]]:
    """Return simple 8-connected components for painted overlay masks.

    This intentionally stays dependency-free. Large masks are usually simple layers
    with few connected painted regions; max_components prevents accidental millions
    of speckles from locking the app.
    """
    mask = mask.astype(bool)
    h, w = mask.shape
    visited = np.zeros(mask.shape, dtype=bool)
    comps: List[Dict[str, Any]] = []
    ys, xs = np.nonzero(mask)
    coords = list(zip(ys.tolist(), xs.tolist()))
    for sy, sx in coords:
        if visited[sy, sx] or not mask[sy, sx]:
            continue
        q: deque[Tuple[int, int]] = deque([(sy, sx)])
        visited[sy, sx] = True
        pix_y: List[int] = []
        pix_x: List[int] = []
        while q:
            y, x = q.popleft()
            pix_y.append(y); pix_x.append(x)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        q.append((ny, nx))
        area = len(pix_x)
        if area < min_area:
            continue
        x_arr = np.asarray(pix_x, dtype=np.float32)
        y_arr = np.asarray(pix_y, dtype=np.float32)
        min_x, max_x = int(x_arr.min()), int(x_arr.max())
        min_y, max_y = int(y_arr.min()), int(y_arr.max())
        cx, cy = float(x_arr.mean()), float(y_arr.mean())
        width_px = max(1, max_x - min_x + 1)
        height_px = max(1, max_y - min_y + 1)
        angle = 0.0
        if area >= 3:
            centered = np.column_stack([x_arr - cx, y_arr - cy])
            cov = np.cov(centered, rowvar=False)
            try:
                vals, vecs = np.linalg.eigh(cov)
                major = vecs[:, int(np.argmax(vals))]
                angle = math.degrees(math.atan2(float(major[1]), float(major[0])))
            except Exception:
                angle = 0.0
        comps.append({
            "areaPx": int(area),
            "bboxPx": [min_x, min_y, max_x, max_y],
            "centroidPx": [cx, cy],
            "widthPx": int(width_px),
            "heightPx": int(height_px),
            "orientationDeg": round(angle, 2),
            "aspect": round(float(max(width_px, height_px) / max(1, min(width_px, height_px))), 3),
            "pixelSamples": [pix_x, pix_y],
        })
        if len(comps) >= max_components:
            break
    comps.sort(key=lambda c: c["areaPx"], reverse=True)
    return comps


def _height_stats_for_component(comp: Dict[str, Any], height: np.ndarray | None, img_w: int, img_h: int) -> Dict[str, float]:
    if height is None:
        return {"terrainHeightM": 0.0, "minHeightM": 0.0, "maxHeightM": 0.0, "heightDropM": 0.0, "grade": 0.0}
    hx = np.asarray(comp["pixelSamples"][0], dtype=np.float32)
    hy = np.asarray(comp["pixelSamples"][1], dtype=np.float32)
    rows, cols = height.shape
    ix = np.clip(np.round(hx / max(1, img_w - 1) * (cols - 1)).astype(np.int32), 0, cols - 1)
    iy = np.clip(np.round(hy / max(1, img_h - 1) * (rows - 1)).astype(np.int32), 0, rows - 1)
    vals = height[iy, ix].astype(np.float32)
    if vals.size == 0:
        return {"terrainHeightM": 0.0, "minHeightM": 0.0, "maxHeightM": 0.0, "heightDropM": 0.0, "grade": 0.0}
    drop = float(vals.max() - vals.min())
    length = float(max(comp.get("widthPx", 1), comp.get("heightPx", 1), 1))
    return {
        "terrainHeightM": round(float(vals.mean()), 3),
        "minHeightM": round(float(vals.min()), 3),
        "maxHeightM": round(float(vals.max()), 3),
        "heightDropM": round(drop, 3),
        "grade": round(drop / max(1.0, length), 4),
    }


def _classify_water(comp: Dict[str, Any], stats: Dict[str, float], options: Dict[str, Any]) -> str:
    area = comp["areaPx"]
    aspect = comp.get("aspect", 1.0)
    drop = stats.get("heightDropM", 0.0)
    grade = stats.get("grade", 0.0)
    waterfall_drop = float(options.get("waterfallDropM", 18.0) or 18.0)
    fast_grade = float(options.get("fastRiverGrade", 0.25) or 0.25)
    lake_drop = float(options.get("lakeMaxDropM", 2.0) or 2.0)
    if drop >= waterfall_drop and grade >= fast_grade:
        return "waterfall"
    if aspect >= 3.0 and grade >= fast_grade * 0.45:
        return "fast-river"
    if area > int(options.get("largeWaterAreaPx", 2500) or 2500) and drop <= lake_drop:
        return "lake-or-ocean"
    if aspect >= 2.2:
        return "river-or-stream"
    return "pond"


def analyze_overlay_layer(
    layer_image: Image.Image,
    kind: str,
    options: Dict[str, Any] | None = None,
    height_image: Image.Image | None = None,
) -> Dict[str, Any]:
    options = options or {}
    kind = str(kind or "marker").lower()
    max_height_m = float(options.get("maxHeightM", 500.0) or 500.0)

    working, scale = _downscale_for_analysis(layer_image.convert("RGBA"), int(options.get("analysisMaxSide", 1200) or 1200))
    mask = mask_from_colored_layer(working, threshold=int(options.get("maskThreshold", 8) or 8))
    height = None
    if height_image is not None:
        h_img = resize_to_match(height_image, mask.shape, Image.Resampling.BILINEAR)
        height = image_to_height_m(h_img, max_height_m)

    comps = connected_components(
        mask,
        max_components=int(options.get("maxFeatures", 1000) or 1000),
        min_area=int(options.get("minAreaPx", 3) or 3),
    )
    features: List[Dict[str, Any]] = []
    h, w = mask.shape
    terrain_width_m = float(options.get("terrainWidthM", 1480.0) or 1480.0)
    terrain_depth_m = float(options.get("terrainDepthM", terrain_width_m * h / max(1, w)) or terrain_width_m * h / max(1, w))

    for idx, comp in enumerate(comps, start=1):
        stats = _height_stats_for_component(comp, height, w, h)
        cx, cy = comp["centroidPx"]
        world_x = (cx / max(1, w - 1) - 0.5) * terrain_width_m
        world_z = (cy / max(1, h - 1) - 0.5) * terrain_depth_m
        base = {
            "id": f"{kind}_{idx:03d}",
            "kind": kind,
            "xNorm": round(cx / max(1, w - 1), 6),
            "yNorm": round(cy / max(1, h - 1), 6),
            "world": [round(world_x, 3), round(stats["terrainHeightM"], 3), round(world_z, 3)],
            "bboxNorm": [
                round(comp["bboxPx"][0] / max(1, w - 1), 6),
                round(comp["bboxPx"][1] / max(1, h - 1), 6),
                round(comp["bboxPx"][2] / max(1, w - 1), 6),
                round(comp["bboxPx"][3] / max(1, h - 1), 6),
            ],
            "areaPx": comp["areaPx"],
            "widthM": round(comp["widthPx"] / max(1, w) * terrain_width_m, 3),
            "depthM": round(comp["heightPx"] / max(1, h) * terrain_depth_m, 3),
            "orientationDeg": comp["orientationDeg"],
            **stats,
        }
        if kind == "water":
            base["waterFeature"] = _classify_water(comp, stats, options)
            base["suggestedEffect"] = {
                "waterfall": "place waterfall/foam emitter",
                "fast-river": "use fast stream material and whitewater",
                "river-or-stream": "carve shallow river bed",
                "lake-or-ocean": "flatten surface and add shoreline foam",
                "pond": "small calm water body",
            }.get(base["waterFeature"], "water")
        elif kind == "structure":
            base["shape"] = str(options.get("shape", "box"))
            base["objectHeightM"] = float(options.get("objectHeightM", 8.0) or 8.0)
            base["snapToGround"] = bool(options.get("snapToGround", True))
            base["flattenGround"] = bool(options.get("flattenGround", True))
        elif kind == "marker":
            base["markerType"] = str(options.get("markerType", "poi"))
            base["name"] = str(options.get("namePrefix", "Point")) + f" {idx}"
            base["radiusM"] = float(options.get("radiusM", 4.0) or 4.0)
        elif kind == "texture":
            base["material"] = str(options.get("material", "forest"))
            base["noise"] = float(options.get("noise", 0.35) or 0.35)
            base["edgeSoftness"] = float(options.get("edgeSoftness", 0.6) or 0.6)
        features.append(base)

    preview = Image.new("RGBA", working.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(preview)
    color = {
        "water": (44, 183, 217, 170),
        "structure": (255, 92, 92, 180),
        "marker": (255, 220, 80, 200),
        "texture": (100, 240, 140, 130),
    }.get(kind, (255, 255, 255, 160))
    yy, xx = np.nonzero(mask)
    # Fast enough for preview-size masks, avoids needing cv2.
    arr = np.asarray(preview, dtype=np.uint8).copy()
    arr[yy, xx] = color
    preview = Image.fromarray(arr, mode="RGBA")
    draw = ImageDraw.Draw(preview)
    for f in features[:200]:
        x0, y0, x1, y1 = [int(round(v)) for v in [
            f["bboxNorm"][0] * (w - 1), f["bboxNorm"][1] * (h - 1), f["bboxNorm"][2] * (w - 1), f["bboxNorm"][3] * (h - 1)
        ]]
        draw.rectangle([x0, y0, x1, y1], outline=(255, 255, 255, 210), width=1)

    return {
        "kind": kind,
        "width": int(w),
        "height": int(h),
        "scale": scale,
        "featureCount": len(features),
        "features": features,
        "preview": preview,
        "summary": {
            "waterfalls": sum(1 for f in features if f.get("waterFeature") == "waterfall"),
            "fastRivers": sum(1 for f in features if f.get("waterFeature") == "fast-river"),
            "structures": sum(1 for f in features if f.get("kind") == "structure"),
            "markers": sum(1 for f in features if f.get("kind") == "marker"),
        },
    }
