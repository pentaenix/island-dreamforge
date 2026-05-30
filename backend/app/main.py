from __future__ import annotations

import io
import json
import zipfile
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from PIL import Image

from .image_utils import (
    array_to_16bit_png,
    array_to_preview_png,
    image_to_data_url,
    image_to_height_m,
    mask_from_colored_layer,
    read_upload_image,
    resize_to_match,
)
from .mesh_export import export_mesh_bytes, height_to_mesh
from .layers import analyze_overlay_layer
from .terrain import bake_water_layer, generate_heightmap_from_colors, parse_samples, preprocess_map_for_height, quantize_dominant_colors

app = FastAPI(title="Island Dreamforge API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _json_field(raw: str | None, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON field: {exc}") from exc


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "name": "Island Dreamforge API"}


@app.post("/api/analyze-colors")
async def analyze_colors(
    map_image: UploadFile = File(...),
    count: int = Form(12),
) -> Dict[str, Any]:
    try:
        image = read_upload_image(await map_image.read(), "RGB")
        colors = quantize_dominant_colors(image, count=count)
        return {"colors": colors, "width": image.width, "height": image.height}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc




@app.post("/api/preprocess-map")
async def preprocess_map(
    map_image: UploadFile = File(...),
    samples: str = Form("[]"),
    options: str = Form("{}"),
) -> Dict[str, Any]:
    """Preview the cleanup pass: color averaging, line ignoring, palette reduction, paper-noise smoothing."""
    opts = _json_field(options, {})
    try:
        image = read_upload_image(await map_image.read(), "RGBA")
        sample_list = parse_samples(_json_field(samples, []))
        cleaned = preprocess_map_for_height(image, sample_list, opts)
        return {
            "cleanedPreview": image_to_data_url(cleaned),
            "width": cleaned.width,
            "height": cleaned.height,
            "options": opts,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/heightmap", response_model=None)
async def create_heightmap(
    map_image: UploadFile = File(...),
    samples: str = Form(...),
    options: str = Form("{}"),
    response_format: str = Form("json"),
) -> Response | Dict[str, Any]:
    opts = _json_field(options, {})
    sample_list = parse_samples(_json_field(samples, []))
    max_height_m = float(opts.get("maxHeightM", 500.0))
    try:
        image = read_upload_image(await map_image.read(), "RGBA")
        height = generate_heightmap_from_colors(image, sample_list, max_height_m, opts)
        height16 = array_to_16bit_png(height, max_height_m)
        preview = array_to_preview_png(height, max_height_m)
        recipe = {
            "type": "heightmap-color-recipe",
            "maxHeightM": max_height_m,
            "samples": [s.__dict__ for s in sample_list],
            "options": opts,
            "sourceSize": [image.width, image.height],
        }

        if response_format == "zip":
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                height_buf = io.BytesIO(); height16.save(height_buf, format="PNG")
                prev_buf = io.BytesIO(); preview.save(prev_buf, format="PNG")
                zf.writestr("heightmap_16bit.png", height_buf.getvalue())
                zf.writestr("heightmap_preview_8bit.png", prev_buf.getvalue())
                zf.writestr("height_recipe.json", json.dumps(recipe, indent=2))
            buffer.seek(0)
            return StreamingResponse(
                buffer,
                media_type="application/zip",
                headers={"Content-Disposition": "attachment; filename=island_heightmap_stage1.zip"},
            )

        h_min = float(height.min()) if height.size else 0.0
        h_max = float(height.max()) if height.size else 0.0
        warning = None
        if (h_max - h_min) < max(1.0, max_height_m * 0.004):
            warning = "The generated height map is almost flat. Add more height colors or use Suggest colors + fill levels before generating."
        return {
            "maxHeightM": max_height_m,
            "heightmap16": image_to_data_url(height16),
            "preview8": image_to_data_url(preview),
            "heightStats": {"minM": round(h_min, 4), "maxM": round(h_max, 4), "rangeM": round(h_max - h_min, 4)},
            "warning": warning,
            "recipe": recipe,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/bake-water", response_model=None)
async def bake_water(
    heightmap: UploadFile = File(...),
    water_map: UploadFile = File(...),
    options: str = Form("{}"),
    response_format: str = Form("json"),
) -> Response | Dict[str, Any]:
    opts = _json_field(options, {})
    max_height_m = float(opts.get("maxHeightM", 500.0))
    try:
        h_img = read_upload_image(await heightmap.read(), "I;16")
        height = image_to_height_m(h_img, max_height_m)
        w_img = read_upload_image(await water_map.read(), "RGBA")
        w_img = resize_to_match(w_img, height.shape, Image.Resampling.NEAREST)
        water_mask = mask_from_colored_layer(w_img, threshold=int(opts.get("maskThreshold", 8)))
        baked, metadata = bake_water_layer(height, water_mask, max_height_m, opts)

        baked16 = array_to_16bit_png(baked, max_height_m)
        preview = array_to_preview_png(baked, max_height_m)
        mask_png = Image.fromarray((water_mask.astype("uint8") * 255), mode="L")
        metadata["maxHeightM"] = max_height_m
        metadata["waterMaskSize"] = [int(water_mask.shape[1]), int(water_mask.shape[0])]

        if response_format == "zip":
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                baked_buf = io.BytesIO(); baked16.save(baked_buf, format="PNG")
                prev_buf = io.BytesIO(); preview.save(prev_buf, format="PNG")
                mask_buf = io.BytesIO(); mask_png.save(mask_buf, format="PNG")
                zf.writestr("heightmap_water_baked_16bit.png", baked_buf.getvalue())
                zf.writestr("heightmap_water_baked_preview_8bit.png", prev_buf.getvalue())
                zf.writestr("water_mask.png", mask_buf.getvalue())
                zf.writestr("water_bake_recipe.json", json.dumps(metadata, indent=2))
            buffer.seek(0)
            return StreamingResponse(
                buffer,
                media_type="application/zip",
                headers={"Content-Disposition": "attachment; filename=island_water_stage2.zip"},
            )

        return {
            "maxHeightM": max_height_m,
            "heightmap16": image_to_data_url(baked16),
            "preview8": image_to_data_url(preview),
            "waterMask": image_to_data_url(mask_png),
            "metadata": metadata,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/analyze-layer")
async def analyze_layer(
    layer_image: UploadFile = File(...),
    heightmap: Optional[UploadFile] = File(None),
    kind: str = Form("marker"),
    options: str = Form("{}"),
) -> Dict[str, Any]:
    """Analyze a user-painted overlay layer into water/structure/marker/texture features.

    The output is intentionally game-pipeline friendly: normalized 2D map position,
    world-space X/Y/Z, footprint, orientation, and per-kind metadata.
    """
    opts = _json_field(options, {})
    try:
        layer_img = read_upload_image(await layer_image.read(), "RGBA")
        height_img = None
        if heightmap is not None:
            height_img = read_upload_image(await heightmap.read(), "I;16")
        result = analyze_overlay_layer(layer_img, kind, opts, height_img)
        preview_img = result.pop("preview")
        return {**result, "preview": image_to_data_url(preview_img)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/export-mesh")
async def export_mesh(
    heightmap: UploadFile = File(...),
    texture: Optional[UploadFile] = File(None),
    options: str = Form("{}"),
    fmt: str = Form("glb"),
) -> StreamingResponse:
    opts = _json_field(options, {})
    max_height_m = float(opts.get("maxHeightM", 500.0))
    try:
        h_img = read_upload_image(await heightmap.read(), "I;16")
        height = image_to_height_m(h_img, max_height_m)
        tex_img = None
        if texture is not None:
            tex_img = read_upload_image(await texture.read(), "RGB")
        mesh = height_to_mesh(height, opts, texture=tex_img)
        data, media_type, filename = export_mesh_bytes(mesh, fmt)
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/export-project")
async def export_project(
    heightmap: UploadFile = File(...),
    texture: Optional[UploadFile] = File(None),
    normal_map: Optional[UploadFile] = File(None),
    water_mask: Optional[UploadFile] = File(None),
    recipe: str = Form("{}"),
    options: str = Form("{}"),
) -> StreamingResponse:
    """Bundle all stage outputs into one portable project archive."""
    opts = _json_field(options, {})
    max_height_m = float(opts.get("maxHeightM", 500.0))
    try:
        height_bytes = await heightmap.read()
        tex_bytes = await texture.read() if texture else None
        normal_bytes = await normal_map.read() if normal_map else None
        water_bytes = await water_mask.read() if water_mask else None
        h_img = read_upload_image(height_bytes, "I;16")
        height = image_to_height_m(h_img, max_height_m)
        tex_img = read_upload_image(tex_bytes, "RGB") if tex_bytes else None
        mesh = height_to_mesh(height, opts, texture=tex_img)
        glb, _, _ = export_mesh_bytes(mesh, "glb")
        obj, _, _ = export_mesh_bytes(mesh, "obj")
        stl, _, _ = export_mesh_bytes(mesh, "stl")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("maps/final_heightmap_16bit.png", height_bytes)
            if tex_bytes:
                zf.writestr("maps/painted_texture.png", tex_bytes)
            if normal_bytes:
                zf.writestr("maps/normal_map.png", normal_bytes)
            if water_bytes:
                zf.writestr("maps/water_mask.png", water_bytes)
            zf.writestr("models/island_terrain.glb", glb)
            zf.writestr("models/island_terrain.obj", obj)
            zf.writestr("models/island_terrain.stl", stl)
            zf.writestr("project_recipe.json", json.dumps(_json_field(recipe, {}), indent=2))
            zf.writestr("export_options.json", json.dumps(opts, indent=2))
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=island_dreamforge_project.zip"},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
