from __future__ import annotations

import io
import json
import struct
import zipfile
from typing import Any, Dict, Optional

import numpy as np
import trimesh
from PIL import Image

from .image_utils import array_to_16bit_png, image_to_data_url
from .bathymetry import crop_bathymetry_to_footprint
from .island_maps import (
    compute_shoreline_mask,
    derive_island_mask,
    refine_island_mask_for_ocean,
    generate_material_maps,
    generate_ocean_bathymetry,
)
from .mesh_export import (
    build_island_scene_meshes,
    coastline_skirt_mesh,
    write_chunked_game_mesh,
)


MATERIAL_PALETTE = np.array(
    [
        [16, 58, 112],     # water / seafloor
        [176, 153, 105],   # wet sand
        [229, 209, 144],   # sand
        [74, 150, 78],     # grass
        [38, 104, 57],     # forest
        [122, 121, 113],   # rock
        [152, 144, 128],   # gravel
        [132, 94, 58],     # dirt/path
    ],
    dtype=np.uint8,
)


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _mask_png(mask: np.ndarray) -> Image.Image:
    return Image.fromarray((np.asarray(mask, dtype=bool).astype(np.uint8) * 255), mode="L")


def _u8_png(norm: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(np.asarray(norm, dtype=np.float32) * 255.0, 0, 255).round().astype(np.uint8), mode="L")


def _u16_distance_png(distance_m: np.ndarray, max_distance_m: float) -> Image.Image:
    max_distance = max(1e-6, float(max_distance_m))
    arr = np.clip(np.asarray(distance_m, dtype=np.float32) / max_distance, 0.0, 1.0)
    return Image.fromarray((arr * 65535.0).round().astype(np.uint16), mode="I;16")


def _material_preview_png(material_ids: np.ndarray) -> Image.Image:
    ids = np.clip(np.asarray(material_ids, dtype=np.uint8), 0, len(MATERIAL_PALETTE) - 1)
    return Image.fromarray(MATERIAL_PALETTE[ids], mode="RGB")


def _rgba_png(rgba: np.ndarray) -> Image.Image:
    return Image.fromarray(np.asarray(rgba, dtype=np.uint8), mode="RGBA")


def _rgb_png(rgb: np.ndarray) -> Image.Image:
    return Image.fromarray(np.asarray(rgb, dtype=np.uint8), mode="RGB")


def _deep_merge(*parts: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for part in parts:
        for key, value in (part or {}).items():
            if isinstance(value, dict) and isinstance(out.get(key), dict):
                out[key] = _deep_merge(out[key], value)
            else:
                out[key] = value
    return out


def normalized_export_options(options: Dict[str, Any] | None = None) -> Dict[str, Any]:
    opts = options or {}
    world = opts.get("world", {}) if isinstance(opts.get("world"), dict) else {}
    ocean = opts.get("ocean", {}) if isinstance(opts.get("ocean"), dict) else {}
    material = opts.get("material", {}) if isinstance(opts.get("material"), dict) else {}
    detail = opts.get("detail", {}) if isinstance(opts.get("detail"), dict) else {}

    flat = {
        "widthM": opts.get("widthM", opts.get("worldWidthM", world.get("widthM", world.get("worldWidthM", 9000)))),
        "depthM": opts.get("depthM", opts.get("worldDepthM", world.get("depthM", world.get("worldDepthM", 9000)))),
        "maxHeightM": opts.get("maxHeightM", world.get("maxHeightM", 1200)),
        "verticalScale": opts.get("verticalScale", opts.get("verticalExaggeration", world.get("verticalExaggeration", 0.65))),
        "seaLevelM": opts.get("seaLevelM", world.get("seaLevelM", 0)),
        "oceanRadiusM": opts.get("oceanRadiusM", ocean.get("radiusM", ocean.get("oceanRadiusM", 6500))),
        "maxOceanDepthM": opts.get("maxOceanDepthM", ocean.get("maxDepthM", ocean.get("maxOceanDepthM", 220))),
        "shoreShelfWidthM": opts.get("shoreShelfWidthM", ocean.get("shoreShelfWidthM", 24)),
        "shallowShelfM": opts.get("shallowShelfM", opts.get("shoreShelfWidthM", ocean.get("shallowShelfM", ocean.get("shoreShelfWidthM", 24)))),
        "midShelfM": opts.get("midShelfM", opts.get("midWaterDistanceM", ocean.get("midShelfM", ocean.get("midWaterDistanceM", 70)))),
        "deepWaterDistanceM": opts.get("deepWaterDistanceM", ocean.get("deepWaterDistanceM", 150)),
        "deepStartM": opts.get("deepStartM", opts.get("deepWaterDistanceM", ocean.get("deepStartM", ocean.get("deepWaterDistanceM", 150)))),
        "depthCurveExponent": opts.get("depthCurveExponent", ocean.get("depthCurveExponent", 1.25)),
        "bathymetrySmoothPx": opts.get("bathymetrySmoothPx", ocean.get("bathymetrySmoothPx", 1)),
        "bathymetryRelaxPasses": opts.get("bathymetryRelaxPasses", ocean.get("bathymetryRelaxPasses", 0)),
        "coastalVariationStrength": opts.get("coastalVariationStrength", ocean.get("coastalVariationStrength", 0.18)),
        "reefNoiseStrength": opts.get("reefNoiseStrength", ocean.get("reefNoiseStrength", 0.05)),
        "foamWidthM": opts.get("foamWidthM", ocean.get("foamWidthM", 10)),
        "foamStrength": opts.get("foamStrength", ocean.get("foamStrength", 0.22)),
        "waterBandStepM": opts.get("waterBandStepM", ocean.get("waterBandStepM", 12)),
        "waterBandStepIncreaseM": opts.get("waterBandStepIncreaseM", ocean.get("waterBandStepIncreaseM", 16)),
        "waterBandStepGrowthPower": opts.get("waterBandStepGrowthPower", ocean.get("waterBandStepGrowthPower", 2)),
        "waterBandUseLegacyBands": opts.get("waterBandUseLegacyBands", ocean.get("waterBandUseLegacyBands", False)),
        "oceanFoamRimFadeM": opts.get("oceanFoamRimFadeM", ocean.get("oceanFoamRimFadeM", 48)),
        "waterColorSteps": opts.get("waterColorSteps", ocean.get("waterColorSteps", 6)),
        "seafloorNoiseM": opts.get("seafloorNoiseM", ocean.get("seafloorNoiseM", 6)),
        "seafloorNoiseScaleM": opts.get("seafloorNoiseScaleM", ocean.get("seafloorNoiseScaleM", 500)),
        "circularFalloffSoftnessM": opts.get("circularFalloffSoftnessM", ocean.get("circularFalloffSoftnessM", 200)),
        "beachWidthM": opts.get("beachWidthM", ocean.get("beachWidthM", material.get("beachWidthM", 80))),
        "coastlineSkirtDepthM": opts.get("coastlineSkirtDepthM", ocean.get("coastlineSkirtDepthM", 40)),
        "materialSeed": opts.get("materialSeed", material.get("materialSeed", opts.get("seed", 1337))),
        "forestDensity": opts.get("forestDensity", material.get("forestDensity", 0.26)),
        "previewDetail": detail.get("preview", opts.get("previewDetail", "preview_high")),
        "webDetail": detail.get("web", opts.get("webDetail", "web_export_high")),
        "gameDetail": detail.get("game", opts.get("gameDetail", "game_export_medium")),
        "chunkSize": opts.get("chunkSize", detail.get("chunkSize", 16)),
    }
    return _deep_merge(opts, flat)


def derive_island_data(height_m: np.ndarray, options: Dict[str, Any] | None = None) -> Dict[str, Any]:
    opts = normalized_export_options(options)
    footprint_w = float(opts.get("widthM"))
    footprint_d = float(opts.get("depthM"))
    opts["_bandsFootprintWidthM"] = footprint_w
    opts["_bandsFootprintDepthM"] = footprint_d
    island_mask = refine_island_mask_for_ocean(height_m, derive_island_mask(height_m, opts), opts)
    shoreline_mask = compute_shoreline_mask(island_mask)
    bathy = generate_ocean_bathymetry(height_m, island_mask, opts)
    bathy_footprint = crop_bathymetry_to_footprint(bathy, height_m.shape[0], height_m.shape[1])
    material = generate_material_maps(height_m, island_mask, bathy_footprint["shore_distance_m"], opts)
    return {
        "options": opts,
        "island_mask": island_mask,
        "shoreline_mask": shoreline_mask,
        "bathymetry": bathy,
        "materials": material,
    }


def derived_maps_payload(height_m: np.ndarray, options: Dict[str, Any] | None = None) -> Dict[str, Any]:
    data = derive_island_data(height_m, options)
    opts = data["options"]
    bathy = data["bathymetry"]
    material = data["materials"]
    max_dist = max(float(opts.get("deepWaterDistanceM", 1800)), float(opts.get("oceanRadiusM", 6500)))
    meta = _metadata(data)
    bands = meta.get("bandsMap", {})

    return {
        "width": int(bathy["water_color_rgb"].shape[1]),
        "height": int(bathy["water_color_rgb"].shape[0]),
        "bandsPlaneWidthM": float(bands.get("planeWidthM", opts.get("widthM", 0))),
        "bandsPlaneDepthM": float(bands.get("planeDepthM", opts.get("depthM", 0))),
        "oceanRadiusM": float(opts.get("oceanRadiusM", 0)),
        "metadata": meta,
        "islandMask": image_to_data_url(_mask_png(data["island_mask"])),
        "shorelineMask": image_to_data_url(_mask_png(data["shoreline_mask"])),
        "oceanDiscMask": image_to_data_url(_mask_png(bathy["ocean_disc_mask"])),
        "shoreDistance": image_to_data_url(_u16_distance_png(bathy["shore_distance_m"], max_dist)),
        "shoreDistancePreview": image_to_data_url(_u8_png(np.clip(bathy["shore_distance_m"] / max(1.0, max_dist), 0, 1))),
        "bathymetry": image_to_data_url(_u8_png(bathy["bathymetry01"])),
        "waterDepth": image_to_data_url(_u8_png(bathy["water_depth_norm"])),
        "waterColor": image_to_data_url(_rgb_png(bathy["water_color_rgb"])),
        "waterMask": image_to_data_url(_mask_png(bathy["water_mask"])),
        "foamMask": image_to_data_url(_u8_png(bathy["foam_mask"])),
        "waveNoise": image_to_data_url(_u8_png(bathy["wave_noise"])),
        "materialIds": image_to_data_url(_material_preview_png(material["material_ids_u8"])),
        "materialSplat": image_to_data_url(_rgba_png(material["material_splat_rgba"])),
    }


def _metadata(data: Dict[str, Any]) -> Dict[str, Any]:
    opts = data["options"]
    bathy = data["bathymetry"]
    island = data["island_mask"]
    fh, fw = island.shape
    bh, bw = bathy["water_color_rgb"].shape[:2]
    footprint_w = float(opts.get("_bandsFootprintWidthM", opts.get("widthM")))
    footprint_d = float(opts.get("_bandsFootprintDepthM", opts.get("depthM")))
    band_plane_w = footprint_w * (bw - 1) / max(1, fw - 1)
    band_plane_d = footprint_d * (bh - 1) / max(1, fh - 1)
    return {
        "units": "meters",
        "world": {
            "widthM": footprint_w,
            "depthM": footprint_d,
            "maxHeightM": float(opts.get("maxHeightM")),
            "verticalExaggeration": float(opts.get("verticalScale")),
            "seaLevelM": float(opts.get("seaLevelM")),
        },
        "bandsMap": {
            "widthPx": int(bw),
            "heightPx": int(bh),
            "planeWidthM": round(band_plane_w, 2),
            "planeDepthM": round(band_plane_d, 2),
        },
        "ocean": {
            "radiusM": float(opts.get("oceanRadiusM")),
            "maxDepthM": float(opts.get("maxOceanDepthM")),
            "shoreShelfWidthM": float(opts.get("shoreShelfWidthM")),
            "shallowShelfM": float(opts.get("shallowShelfM")),
            "midShelfM": float(opts.get("midShelfM")),
            "deepWaterDistanceM": float(opts.get("deepWaterDistanceM")),
            "deepStartM": float(opts.get("deepStartM")),
            "depthCurveExponent": float(opts.get("depthCurveExponent")),
            "coastlineSkirtDepthM": float(opts.get("coastlineSkirtDepthM")),
            "bathymetrySmoothPx": int(opts.get("bathymetrySmoothPx")),
            "bathymetryRelaxPasses": int(opts.get("bathymetryRelaxPasses")),
            "coastalVariationStrength": float(opts.get("coastalVariationStrength")),
            "reefNoiseStrength": float(opts.get("reefNoiseStrength")),
            "foamWidthM": float(opts.get("foamWidthM")),
            "foamStrength": float(opts.get("foamStrength")),
        },
        "stats": {
            "landPixels": int(np.count_nonzero(island)),
            "oceanPixels": int(np.count_nonzero(bathy["ocean_disc_mask"] & ~island)),
            "maxWaterDepthM": round(float(np.max(bathy["water_depth_m"])) if bathy["water_depth_m"].size else 0.0, 4),
        },
    }


def _detail_metadata(opts: Dict[str, Any], profile: str) -> Dict[str, Any]:
    return {
        "preview": str(opts.get("previewDetail", "preview_high")),
        "web": str(opts.get("webDetail", "web_export_high")),
        "game": str(opts.get("gameDetail", "game_export_medium")),
        "chunkSize": int(opts.get("chunkSize", 16) or 16),
        "activeProfile": profile,
    }


def _manifest(
    profile: str,
    data: Dict[str, Any],
    files: Dict[str, str],
    *,
    package_name: str,
    extra: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    opts = data["options"]
    meta = _metadata(data)
    manifest = {
        "format": "island-dreamforge-export",
        "schemaVersion": 1,
        "version": 1,
        "profile": profile,
        "package": package_name,
        "createdBy": "Island Dreamforge",
        "units": "meters",
        "coordinateSystem": {
            "horizontalAxes": ["x", "z"],
            "verticalAxis": "y",
            "origin": "world_center",
        },
        "world": meta["world"],
        "ocean": meta["ocean"],
        "detail": _detail_metadata(opts, profile),
        "materials": {
            "ids": _material_names(),
            "splatChannels": {
                "r": "sand_wet_sand",
                "g": "grass_forest",
                "b": "rock_gravel",
                "a": "water_seafloor",
            },
        },
        "stats": meta["stats"],
        "files": files,
    }
    if extra:
        manifest.update(extra)
    return manifest


def _assert_manifest_files(zf: zipfile.ZipFile, manifest: Dict[str, Any]) -> None:
    names = set(zf.namelist())
    missing = sorted(path for path in manifest.get("files", {}).values() if path not in names)
    if missing:
        raise ValueError(f"Manifest references missing files: {', '.join(missing)}")


def _scene_glb(meshes: Dict[str, trimesh.Trimesh]) -> bytes:
    scene = trimesh.Scene()
    for name, mesh in meshes.items():
        if len(mesh.vertices) and len(mesh.faces):
            scene.add_geometry(mesh, node_name=name, geom_name=name)
    exported = scene.export(file_type="glb")
    if isinstance(exported, str):
        return exported.encode("utf-8")
    return bytes(exported)


def _simple_mesh_binary(mesh: trimesh.Trimesh, magic: bytes = b"IDFSKRT1") -> bytes:
    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.faces, dtype=np.uint32)
    header = struct.pack("<8sII", magic[:8].ljust(8, b"\0"), len(vertices), faces.size)
    return header + vertices.tobytes(order="C") + faces.reshape(-1).tobytes(order="C")


def build_web_island_export(height_m: np.ndarray, options: Dict[str, Any] | None = None) -> bytes:
    data = derive_island_data(height_m, options)
    opts = {**data["options"], "detailProfile": data["options"].get("webDetail", "web_export_high")}
    bathy = data["bathymetry"]
    mats = data["materials"]
    meshes = build_island_scene_meshes(
        height_m,
        data["island_mask"],
        bathy["seafloor_height"],
        bathy["ocean_disc_mask"],
        opts,
        material_ids=mats["material_ids_u8"],
        water_depth_norm=bathy["water_depth_norm"],
    )
    files = {
        "scene": "scene/island_web.glb",
        "materialSplat": "textures/material_splat.png",
        "waterDepth": "textures/water_depth.png",
        "bathymetry": "textures/bathymetry.png",
        "waterColor": "textures/water_color.png",
        "foamMask": "textures/foam_mask.png",
        "waveNoise": "textures/wave_noise.png",
        "islandMask": "masks/island_mask.png",
        "shorelineMask": "masks/shoreline_mask.png",
        "oceanDiscMask": "masks/ocean_disc_mask.png",
        "shoreDistance": "masks/shore_distance.png",
        "world": "data/world.json",
        "materials": "data/materials.json",
        "structures": "data/structures.json",
        "markers": "data/markers.json",
    }
    manifest = _manifest("web", data, files, package_name="web_export")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, sort_keys=True))
        zf.writestr(files["scene"], _scene_glb(meshes))
        zf.writestr(files["materialSplat"], _png_bytes(_rgba_png(mats["material_splat_rgba"])))
        zf.writestr(files["waterDepth"], _png_bytes(_u8_png(bathy["water_depth_norm"])))
        zf.writestr(files["bathymetry"], _png_bytes(_u8_png(bathy["bathymetry01"])))
        zf.writestr(files["waterColor"], _png_bytes(_rgb_png(bathy["water_color_rgb"])))
        zf.writestr(files["foamMask"], _png_bytes(_u8_png(bathy["foam_mask"])))
        zf.writestr(files["waveNoise"], _png_bytes(_u8_png(bathy["wave_noise"])))
        zf.writestr(files["islandMask"], _png_bytes(_mask_png(data["island_mask"])))
        zf.writestr(files["shorelineMask"], _png_bytes(_mask_png(data["shoreline_mask"])))
        zf.writestr(files["oceanDiscMask"], _png_bytes(_mask_png(bathy["ocean_disc_mask"])))
        zf.writestr(files["shoreDistance"], _png_bytes(_u16_distance_png(bathy["shore_distance_m"], max(opts["deepWaterDistanceM"], opts["oceanRadiusM"]))))
        zf.writestr(files["world"], json.dumps(manifest["world"] | {"ocean": manifest["ocean"], "detail": manifest["detail"]}, indent=2, sort_keys=True))
        zf.writestr(files["materials"], json.dumps(manifest["materials"], indent=2, sort_keys=True))
        zf.writestr(files["structures"], json.dumps({"version": 1, "instances": []}, indent=2))
        zf.writestr(files["markers"], json.dumps({"version": 1, "instances": []}, indent=2))
        _assert_manifest_files(zf, manifest)
    return buffer.getvalue()


def _detail_options(opts: Dict[str, Any], profile: str, profile_id: int, resolution: int) -> Dict[str, Any]:
    next_opts = dict(opts)
    next_opts["detailProfile"] = profile
    next_opts["meshResolution"] = resolution
    next_opts["gameProfileId"] = profile_id
    return next_opts


def build_game_island_export(height_m: np.ndarray, options: Dict[str, Any] | None = None) -> bytes:
    data = derive_island_data(height_m, options)
    opts = data["options"]
    bathy = data["bathymetry"]
    mats = data["materials"]
    max_height = float(opts["maxHeightM"])
    max_dist = max(float(opts["deepWaterDistanceM"]), float(opts["oceanRadiusM"]))

    lods = [
        ("lod0", "game_export_high", 3, 257),
        ("lod1", "game_export_medium", 2, 129),
        ("lod2", "game_export_low", 1, 65),
    ]
    preview_meshes = build_island_scene_meshes(
        height_m,
        data["island_mask"],
        bathy["seafloor_height"],
        bathy["ocean_disc_mask"],
        {**opts, "detailProfile": "preview_medium"},
        material_ids=mats["material_ids_u8"],
        water_depth_norm=bathy["water_depth_norm"],
    )
    skirt = coastline_skirt_mesh(height_m, data["island_mask"], bathy["seafloor_height"], opts, mats["material_ids_u8"])
    files = {
        "world": "game/world.json",
        "height": "game/height_u16.png",
        "collisionHeight": "game/collision_height_u16.png",
        "materialIds": "game/material_ids_u8.png",
        "waterDepth": "game/water_depth_u8.png",
        "bathymetry": "game/bathymetry_u8.png",
        "seafloorHeight": "game/seafloor_height_u16.png",
        "waterMask": "game/water_mask_u8.png",
        "foamMask": "game/foam_mask_u8.png",
        "islandMask": "game/island_mask_u8.png",
        "shoreDistance": "game/shore_distance_u16.png",
        "terrainLod0": "game/terrain_lod0.bin",
        "terrainLod1": "game/terrain_lod1.bin",
        "terrainLod2": "game/terrain_lod2.bin",
        "seafloorLod0": "game/seafloor_lod0.bin",
        "seafloorLod1": "game/seafloor_lod1.bin",
        "coastlineSkirt": "game/coastline_skirt.bin",
        "structures": "game/structure_instances.json",
        "markers": "game/marker_instances.json",
        "previewScene": "preview/island_game_preview.glb",
    }
    manifest = _manifest(
        "game",
        data,
        files,
        package_name="game_export",
        extra={
            "binaryFormats": {
                "terrain": "IDFMAP01 chunked little-endian mesh",
                "coastlineSkirt": "IDFSKRT1 float32 vertices + uint32 indices",
            }
        },
    )

    collision = np.where(data["island_mask"], height_m, float(opts["seaLevelM"])).astype(np.float32)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, sort_keys=True))
        zf.writestr(files["world"], json.dumps(manifest["world"] | {"ocean": manifest["ocean"], "detail": manifest["detail"]}, indent=2, sort_keys=True))
        zf.writestr(files["height"], _png_bytes(array_to_16bit_png(height_m, max_height)))
        zf.writestr(files["collisionHeight"], _png_bytes(array_to_16bit_png(collision, max_height)))
        zf.writestr(files["materialIds"], _png_bytes(Image.fromarray(mats["material_ids_u8"], mode="L")))
        zf.writestr(files["waterDepth"], _png_bytes(_u8_png(bathy["water_depth_norm"])))
        zf.writestr(files["bathymetry"], _png_bytes(_u8_png(bathy["bathymetry01"])))
        zf.writestr(files["seafloorHeight"], _png_bytes(array_to_16bit_png(np.maximum(0.0, -bathy["seafloor_height"]), max(float(opts["maxOceanDepthM"]), 1.0))))
        zf.writestr(files["waterMask"], _png_bytes(_mask_png(bathy["water_mask"])))
        zf.writestr(files["foamMask"], _png_bytes(_u8_png(bathy["foam_mask"])))
        zf.writestr(files["islandMask"], _png_bytes(_mask_png(data["island_mask"])))
        zf.writestr(files["shoreDistance"], _png_bytes(_u16_distance_png(bathy["shore_distance_m"], max_dist)))
        for name, profile, profile_id, resolution in lods:
            lod_opts = _detail_options(opts, profile, profile_id, resolution)
            zf.writestr(f"game/terrain_{name}.bin", write_chunked_game_mesh(height_m, data["island_mask"], mats["material_ids_u8"], lod_opts))
        zf.writestr(files["seafloorLod0"], write_chunked_game_mesh(bathy["seafloor_height"], bathy["ocean_disc_mask"], np.zeros_like(mats["material_ids_u8"]), _detail_options(opts, "game_export_medium", 2, 129)))
        zf.writestr(files["seafloorLod1"], write_chunked_game_mesh(bathy["seafloor_height"], bathy["ocean_disc_mask"], np.zeros_like(mats["material_ids_u8"]), _detail_options(opts, "game_export_low", 1, 65)))
        zf.writestr(files["coastlineSkirt"], _simple_mesh_binary(skirt))
        zf.writestr(files["structures"], json.dumps({"version": 1, "instances": []}, indent=2))
        zf.writestr(files["markers"], json.dumps({"version": 1, "instances": []}, indent=2))
        zf.writestr(files["previewScene"], _scene_glb(preview_meshes))
        _assert_manifest_files(zf, manifest)
    return buffer.getvalue()


def _material_names() -> Dict[str, str]:
    return {
        "0": "water_deep_seafloor",
        "1": "wet_sand",
        "2": "sand",
        "3": "grass",
        "4": "forest",
        "5": "rock",
        "6": "gravel",
        "7": "dirt_path",
    }
