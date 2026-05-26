from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import trimesh
from PIL import Image


def _downsample(height: np.ndarray, max_resolution: int) -> np.ndarray:
    h, w = height.shape
    max_resolution = int(max(8, max_resolution))
    scale = min(1.0, max_resolution / max(h, w))
    if scale >= 1.0:
        return height
    image = Image.fromarray(height.astype(np.float32), mode="F")
    image = image.resize((max(8, int(w * scale)), max(8, int(h * scale))), Image.Resampling.BILINEAR)
    return np.asarray(image, dtype=np.float32)


def height_to_mesh(
    height_m: np.ndarray,
    options: Dict[str, Any] | None = None,
    texture: Optional[Image.Image] = None,
) -> trimesh.Trimesh:
    """Create a terrain mesh from a meter heightmap.

    Coordinate system: X/Z are horizontal, Y is elevation.
    """
    options = options or {}
    max_resolution = int(options.get("meshResolution", 512))
    height = _downsample(height_m, max_resolution)
    rows, cols = height.shape
    width_m = float(options.get("widthM", 1480.0))
    depth_m = float(options.get("depthM", width_m * rows / max(1, cols)))
    vertical_scale = float(options.get("verticalScale", 1.0))
    waterline = float(options.get("waterlineM", 0.0))
    trim_water = bool(options.get("trimBelowWater", False))
    add_skirt = bool(options.get("addSkirt", True))
    skirt_depth = float(options.get("skirtDepthM", 60.0))

    xs = np.linspace(-width_m / 2.0, width_m / 2.0, cols, dtype=np.float32)
    zs = np.linspace(-depth_m / 2.0, depth_m / 2.0, rows, dtype=np.float32)
    xx, zz = np.meshgrid(xs, zs)
    yy = height.astype(np.float32) * vertical_scale
    vertices = np.column_stack([xx.ravel(), yy.ravel(), zz.ravel()])

    # Two triangles per cell. Optionally skip fully-below-water cells for island-only mesh.
    faces = []
    for r in range(rows - 1):
        base = r * cols
        nb = (r + 1) * cols
        for c in range(cols - 1):
            ids = [base + c, base + c + 1, nb + c, nb + c + 1]
            if trim_water and np.max(height[[r, r, r + 1, r + 1], [c, c + 1, c, c + 1]]) <= waterline:
                continue
            faces.append([ids[0], ids[2], ids[1]])
            faces.append([ids[1], ids[2], ids[3]])
    faces = np.asarray(faces, dtype=np.int64)

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)

    # Add a simple skirt/base around the rectangular boundary so OBJ/STL prints/viewers look solid.
    if add_skirt and not trim_water:
        mesh = _add_rectangular_skirt(mesh, rows, cols, skirt_depth)

    if texture is not None:
        tex = texture.convert("RGB")
        uv = np.zeros((len(mesh.vertices), 2), dtype=np.float32)
        uv[:, 0] = np.clip((mesh.vertices[:, 0] + width_m / 2.0) / max(1e-6, width_m), 0.0, 1.0)
        uv[:, 1] = np.clip(1.0 - (mesh.vertices[:, 2] + depth_m / 2.0) / max(1e-6, depth_m), 0.0, 1.0)
        material = trimesh.visual.material.PBRMaterial(name="terrain_texture", baseColorTexture=tex)
        mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv, image=tex, material=material)
    else:
        # Height-based vertex colors for GLB/PLY fallback. Use the final mesh
        # vertex count because the optional skirt/base adds extra vertices.
        y = mesh.vertices[:, 1].astype(np.float32)
        y_min = float(np.min(y))
        y_max = float(np.max(y))
        t = np.clip((y - y_min) / max(1e-6, y_max - y_min), 0, 1)
        colors = np.zeros((len(mesh.vertices), 4), dtype=np.uint8)
        colors[:, 0] = (76 + 104 * t).astype(np.uint8)
        colors[:, 1] = (105 + 125 * (1 - np.abs(t - 0.45))).astype(np.uint8)
        colors[:, 2] = (68 + 52 * (1 - t)).astype(np.uint8)
        colors[:, 3] = 255
        mesh.visual.vertex_colors = colors
    return mesh


def _add_rectangular_skirt(mesh: trimesh.Trimesh, rows: int, cols: int, skirt_depth: float) -> trimesh.Trimesh:
    verts = mesh.vertices.copy()
    min_y = float(np.min(verts[:, 1]) - skirt_depth)
    boundary = []
    boundary.extend(range(cols))
    boundary.extend([r * cols + (cols - 1) for r in range(1, rows)])
    boundary.extend(range((rows - 1) * cols + cols - 2, (rows - 1) * cols - 1, -1))
    boundary.extend([r * cols for r in range(rows - 2, 0, -1)])
    boundary = list(dict.fromkeys(boundary))
    base_verts = verts[boundary].copy()
    base_verts[:, 1] = min_y
    offset = len(verts)
    all_verts = np.vstack([verts, base_verts])
    faces = mesh.faces.tolist()
    n = len(boundary)
    for i in range(n):
        a = boundary[i]
        b = boundary[(i + 1) % n]
        c = offset + i
        d = offset + ((i + 1) % n)
        faces.append([a, b, c])
        faces.append([b, d, c])
    # bottom cap fan from center
    center = np.array([[0.0, min_y, 0.0]])
    center_idx = len(all_verts)
    all_verts = np.vstack([all_verts, center])
    for i in range(n):
        c = offset + i
        d = offset + ((i + 1) % n)
        faces.append([center_idx, c, d])
    new_mesh = trimesh.Trimesh(vertices=all_verts, faces=np.asarray(faces), process=False)
    return new_mesh


def export_mesh_bytes(mesh: trimesh.Trimesh, fmt: str) -> Tuple[bytes, str, str]:
    fmt = fmt.lower().strip().lstrip(".")
    if fmt == "obj":
        data = mesh.export(file_type="obj")
        if isinstance(data, str):
            data = data.encode("utf-8")
        return data, "model/obj", "island_terrain.obj"
    if fmt == "stl":
        data = mesh.export(file_type="stl")
        return data, "model/stl", "island_terrain.stl"
    if fmt in {"glb", "gltf"}:
        data = mesh.export(file_type="glb")
        return data, "model/gltf-binary", "island_terrain.glb"
    if fmt == "ply":
        data = mesh.export(file_type="ply")
        return data, "application/octet-stream", "island_terrain.ply"
    raise ValueError(f"Unsupported mesh format: {fmt}")
