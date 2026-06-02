from __future__ import annotations

import json
import struct
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import trimesh
from PIL import Image


_MATERIAL_COLORS = np.array(
    [
        [20, 55, 100, 255],     # water / deep seafloor
        [185, 164, 114, 255],   # wet sand
        [226, 207, 142, 255],   # sand
        [74, 145, 76, 255],     # grass
        [37, 104, 56, 255],     # forest
        [120, 118, 108, 255],   # rock
        [150, 142, 126, 255],   # gravel
        [128, 92, 56, 255],     # dirt/path
    ],
    dtype=np.uint8,
)


_DETAIL_RESOLUTIONS = {
    "preview_low": 129,
    "preview_medium": 257,
    "preview_high": 513,
    "web_export_high": 1025,
    "game_export_low": 65,
    "game_export_medium": 129,
    "game_export_high": 257,
    "game_low": 65,
    "game_medium": 129,
    "game_high": 257,
}


def detail_profile_resolution(profile: str | None, fallback: int = 512) -> int:
    key = str(profile or "").strip().lower().replace(" ", "_").replace("-", "_")
    return int(_DETAIL_RESOLUTIONS.get(key, fallback))


def _downsample(height: np.ndarray, max_resolution: int) -> np.ndarray:
    h, w = height.shape
    max_resolution = int(max(8, max_resolution))
    scale = min(1.0, max_resolution / max(h, w))
    if scale >= 1.0:
        return height
    image = Image.fromarray(height.astype(np.float32), mode="F")
    image = image.resize((max(8, int(w * scale)), max(8, int(h * scale))), Image.Resampling.BILINEAR)
    return np.asarray(image, dtype=np.float32)


def _target_shape(shape: Tuple[int, int], max_resolution: int) -> Tuple[int, int]:
    rows, cols = shape
    max_resolution = int(max(8, max_resolution))
    scale = min(1.0, max_resolution / max(rows, cols))
    if scale >= 1.0:
        return rows, cols
    return max(2, int(round(rows * scale))), max(2, int(round(cols * scale)))


def _resize_float(array: np.ndarray, shape_hw: Tuple[int, int]) -> np.ndarray:
    arr = np.asarray(array, dtype=np.float32)
    if arr.shape == shape_hw:
        return arr
    img = Image.fromarray(arr, mode="F")
    return np.asarray(img.resize((shape_hw[1], shape_hw[0]), Image.Resampling.BILINEAR), dtype=np.float32)


def _resize_mask(mask: np.ndarray, shape_hw: Tuple[int, int]) -> np.ndarray:
    arr = np.asarray(mask, dtype=np.uint8) * 255
    if arr.shape == shape_hw:
        return arr.astype(bool)
    img = Image.fromarray(arr, mode="L")
    return np.asarray(img.resize((shape_hw[1], shape_hw[0]), Image.Resampling.NEAREST), dtype=np.uint8) > 127


def _resize_u8(array: np.ndarray, shape_hw: Tuple[int, int]) -> np.ndarray:
    arr = np.asarray(array, dtype=np.uint8)
    if arr.shape == shape_hw:
        return arr
    img = Image.fromarray(arr, mode="L")
    return np.asarray(img.resize((shape_hw[1], shape_hw[0]), Image.Resampling.NEAREST), dtype=np.uint8)


def _mesh_resolution(options: Dict[str, Any], default: int = 512) -> int:
    if "meshResolution" in options:
        return int(options.get("meshResolution") or default)
    if "detailProfile" in options:
        return detail_profile_resolution(str(options.get("detailProfile")), fallback=default)
    return default


def _world_axes(rows: int, cols: int, options: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray, float]:
    width_m = float(options.get("widthM", options.get("worldWidthM", 1480.0)) or 1480.0)
    depth_m = float(options.get("depthM", options.get("worldDepthM", width_m * rows / max(1, cols))) or width_m)
    vertical_scale = float(options.get("verticalScale", options.get("verticalExaggeration", 1.0)) or 1.0)
    xs = np.linspace(-width_m / 2.0, width_m / 2.0, cols, dtype=np.float32)
    zs = np.linspace(-depth_m / 2.0, depth_m / 2.0, rows, dtype=np.float32)
    return xs, zs, vertical_scale


def _empty_mesh(name: str) -> trimesh.Trimesh:
    mesh = trimesh.Trimesh(vertices=np.zeros((0, 3), dtype=np.float32), faces=np.zeros((0, 3), dtype=np.int64), process=False)
    mesh.metadata["name"] = name
    return mesh


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


def _prepare_grids(
    height_m: np.ndarray,
    mask: np.ndarray,
    options: Dict[str, Any] | None,
    material_ids: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray], Dict[str, Any]]:
    opts = options or {}
    height = np.asarray(height_m, dtype=np.float32)
    land = np.asarray(mask, dtype=bool)
    if height.shape != land.shape:
        raise ValueError("height and mask shapes must match")

    target = _target_shape(height.shape, _mesh_resolution(opts, default=max(height.shape)))
    height = _resize_float(height, target)
    land = _resize_mask(land, target)
    mats = _resize_u8(material_ids, target) if material_ids is not None else None
    return height, land, mats, opts


def land_mesh_from_mask(
    height_m: np.ndarray,
    island_mask: np.ndarray,
    options: Dict[str, Any] | None = None,
    material_ids: Optional[np.ndarray] = None,
) -> trimesh.Trimesh:
    """Build land-only terrain mesh.

    A grid cell emits triangles only when all four corners are land. Coastline-crossing
    cells are intentionally omitted so no long triangles stretch across water.
    """
    height, land, mats, opts = _prepare_grids(height_m, island_mask, options, material_ids)
    rows, cols = height.shape
    xs, zs, vertical_scale = _world_axes(rows, cols, opts)

    vertex_index: Dict[Tuple[int, int], int] = {}
    vertices: List[Tuple[float, float, float]] = []
    vertex_materials: List[int] = []
    faces: List[Tuple[int, int, int]] = []

    def add_vertex(r: int, c: int) -> int:
        key = (r, c)
        found = vertex_index.get(key)
        if found is not None:
            return found
        idx = len(vertices)
        vertex_index[key] = idx
        vertices.append((float(xs[c]), float(height[r, c] * vertical_scale), float(zs[r])))
        vertex_materials.append(int(mats[r, c]) if mats is not None else 3)
        return idx

    for r in range(rows - 1):
        for c in range(cols - 1):
            if not (land[r, c] and land[r, c + 1] and land[r + 1, c] and land[r + 1, c + 1]):
                continue
            v00 = add_vertex(r, c)
            v10 = add_vertex(r, c + 1)
            v01 = add_vertex(r + 1, c)
            v11 = add_vertex(r + 1, c + 1)
            faces.append((v00, v01, v10))
            faces.append((v10, v01, v11))

    if not faces:
        return _empty_mesh("land_mesh")

    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float32),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    mesh.metadata["name"] = "land_mesh"
    mesh.visual.vertex_colors = _MATERIAL_COLORS[np.clip(np.asarray(vertex_materials, dtype=np.uint8), 0, len(_MATERIAL_COLORS) - 1)]
    return mesh


def coastline_skirt_mesh(
    height_m: np.ndarray,
    island_mask: np.ndarray,
    seafloor_height: Optional[np.ndarray] = None,
    options: Dict[str, Any] | None = None,
    material_ids: Optional[np.ndarray] = None,
) -> trimesh.Trimesh:
    """Create vertical quads along land/water mask edges to hide coastline gaps."""
    opts = options or {}
    height, land, mats, _ = _prepare_grids(height_m, island_mask, opts, material_ids)
    seafloor = _resize_float(seafloor_height, height.shape) if seafloor_height is not None else None
    rows, cols = height.shape
    xs, zs, vertical_scale = _world_axes(rows, cols, opts)
    sea = float(opts.get("seaLevelM", opts.get("waterlineM", 0.0)) or 0.0)
    skirt_depth = float(opts.get("coastlineSkirtDepthM", opts.get("skirtDepthM", 40.0)) or 40.0)

    vertices: List[Tuple[float, float, float]] = []
    colors: List[np.ndarray] = []
    faces: List[Tuple[int, int, int]] = []

    def cell_height(r: int, c: int) -> float:
        rr = int(np.clip(r, 0, rows - 1))
        cc = int(np.clip(c, 0, cols - 1))
        return max(float(height[rr, cc]), sea) * vertical_scale

    def bottom_height(r: int, c: int) -> float:
        rr = int(np.clip(r, 0, rows - 1))
        cc = int(np.clip(c, 0, cols - 1))
        if seafloor is not None:
            return min(float(seafloor[rr, cc]), sea - skirt_depth) * vertical_scale
        return (sea - skirt_depth) * vertical_scale

    def material_color(r: int, c: int) -> np.ndarray:
        mid = int(mats[r, c]) if mats is not None else 6
        return _MATERIAL_COLORS[int(np.clip(mid, 0, len(_MATERIAL_COLORS) - 1))]

    def add_quad(p0: Tuple[float, float, float], p1: Tuple[float, float, float], p2: Tuple[float, float, float], p3: Tuple[float, float, float], color: np.ndarray) -> None:
        base = len(vertices)
        vertices.extend([p0, p1, p2, p3])
        colors.extend([color, color, color, color])
        faces.append((base, base + 2, base + 1))
        faces.append((base + 1, base + 2, base + 3))

    for r in range(rows):
        for c in range(cols):
            if not land[r, c]:
                continue
            color = material_color(r, c)
            x = float(xs[c])
            z = float(zs[r])
            dx = float((xs[min(c + 1, cols - 1)] - xs[max(c - 1, 0)]) * 0.5) if cols > 1 else 0.5
            dz = float((zs[min(r + 1, rows - 1)] - zs[max(r - 1, 0)]) * 0.5) if rows > 1 else 0.5
            west_x, east_x = x - abs(dx) * 0.5, x + abs(dx) * 0.5
            north_z, south_z = z - abs(dz) * 0.5, z + abs(dz) * 0.5
            top = cell_height(r, c)

            neighbors = {
                "north": (r - 1, c),
                "south": (r + 1, c),
                "west": (r, c - 1),
                "east": (r, c + 1),
            }
            for side, (nr, nc) in neighbors.items():
                is_water = nr < 0 or nc < 0 or nr >= rows or nc >= cols or not land[nr, nc]
                if not is_water:
                    continue
                bottom = bottom_height(nr, nc)
                if side == "north":
                    add_quad((west_x, top, north_z), (east_x, top, north_z), (west_x, bottom, north_z), (east_x, bottom, north_z), color)
                elif side == "south":
                    add_quad((east_x, top, south_z), (west_x, top, south_z), (east_x, bottom, south_z), (west_x, bottom, south_z), color)
                elif side == "west":
                    add_quad((west_x, top, south_z), (west_x, top, north_z), (west_x, bottom, south_z), (west_x, bottom, north_z), color)
                elif side == "east":
                    add_quad((east_x, top, north_z), (east_x, top, south_z), (east_x, bottom, north_z), (east_x, bottom, south_z), color)

    if not faces:
        return _empty_mesh("coastline_skirt_mesh")

    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float32),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    mesh.metadata["name"] = "coastline_skirt_mesh"
    mesh.visual.vertex_colors = np.asarray(colors, dtype=np.uint8)
    return mesh


def seafloor_mesh_from_maps(
    seafloor_height: np.ndarray,
    ocean_disc_mask: np.ndarray,
    options: Dict[str, Any] | None = None,
    water_depth_norm: Optional[np.ndarray] = None,
) -> trimesh.Trimesh:
    """Build circular seafloor mesh from a seafloor height field and disc mask."""
    opts = options or {}
    height, ocean, _, _ = _prepare_grids(seafloor_height, ocean_disc_mask, opts, None)
    depth_norm = _resize_float(water_depth_norm, height.shape) if water_depth_norm is not None else None
    rows, cols = height.shape
    xs, zs, vertical_scale = _world_axes(rows, cols, opts)

    vertex_index: Dict[Tuple[int, int], int] = {}
    vertices: List[Tuple[float, float, float]] = []
    colors: List[Tuple[int, int, int, int]] = []
    faces: List[Tuple[int, int, int]] = []

    def add_vertex(r: int, c: int) -> int:
        key = (r, c)
        found = vertex_index.get(key)
        if found is not None:
            return found
        idx = len(vertices)
        vertex_index[key] = idx
        vertices.append((float(xs[c]), float(height[r, c] * vertical_scale), float(zs[r])))
        t = float(np.clip(depth_norm[r, c], 0.0, 1.0)) if depth_norm is not None else float(np.clip(abs(height[r, c]) / max(1e-6, abs(float(np.min(height))) or 1.0), 0.0, 1.0))
        colors.append((int(25 + 5 * (1 - t)), int(85 + 55 * (1 - t)), int(150 + 70 * t), 255))
        return idx

    for r in range(rows - 1):
        for c in range(cols - 1):
            if not (ocean[r, c] and ocean[r, c + 1] and ocean[r + 1, c] and ocean[r + 1, c + 1]):
                continue
            v00 = add_vertex(r, c)
            v10 = add_vertex(r, c + 1)
            v01 = add_vertex(r + 1, c)
            v11 = add_vertex(r + 1, c + 1)
            faces.append((v00, v01, v10))
            faces.append((v10, v01, v11))

    if not faces:
        return _empty_mesh("seafloor_mesh")

    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float32),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    mesh.metadata["name"] = "seafloor_mesh"
    mesh.visual.vertex_colors = np.asarray(colors, dtype=np.uint8)
    return mesh


def build_island_scene_meshes(
    height_m: np.ndarray,
    island_mask: np.ndarray,
    seafloor_height: np.ndarray,
    ocean_disc_mask: np.ndarray,
    options: Dict[str, Any] | None = None,
    material_ids: Optional[np.ndarray] = None,
    water_depth_norm: Optional[np.ndarray] = None,
) -> Dict[str, trimesh.Trimesh]:
    """Build the production island geometry pieces as separate meshes."""
    opts = options or {}
    return {
        "land_mesh": land_mesh_from_mask(height_m, island_mask, opts, material_ids),
        "coastline_skirt_mesh": coastline_skirt_mesh(height_m, island_mask, seafloor_height, opts, material_ids),
        "seafloor_mesh": seafloor_mesh_from_maps(seafloor_height, ocean_disc_mask, opts, water_depth_norm),
    }


def write_chunked_game_mesh(
    height_m: np.ndarray,
    island_mask: np.ndarray,
    material_ids: np.ndarray,
    options: Dict[str, Any] | None = None,
) -> bytes:
    """Write a deterministic chunked terrain mesh binary for low-cost game loading.

    Format:
      header: 8s magic, u16 version, u16 profile, u32 chunk_count, 16 bytes reserved
      records: i16 chunk_x, i16 chunk_z, u16 vertex_count, u16 index_count,
               i16 min/max bounds (x,y,z), u32 vertex_offset, u32 index_offset, u32 material_offset
      blobs: vertices (x,z,y,u,v int16/uint16 + material/flags u8), indices u16, material ids u8
    """
    opts = options or {}
    height, land, mats, _ = _prepare_grids(height_m, island_mask, opts, material_ids)
    if mats is None:
        mats = np.zeros(height.shape, dtype=np.uint8)
    rows, cols = height.shape
    xs, zs, vertical_scale = _world_axes(rows, cols, opts)
    chunk_quads = int(max(1, opts.get("chunkSize", opts.get("chunkQuads", 16)) or 16))
    profile = int(opts.get("gameProfileId", 1) or 1)

    vertex_blob = bytearray()
    index_blob = bytearray()
    material_blob = bytearray()
    records = []

    def q_i16(value: float, scale: float) -> int:
        return int(np.clip(round(value * scale), -32768, 32767))

    for r0 in range(0, rows - 1, chunk_quads):
        for c0 in range(0, cols - 1, chunk_quads):
            r1 = min(rows - 1, r0 + chunk_quads)
            c1 = min(cols - 1, c0 + chunk_quads)
            vertex_index: Dict[Tuple[int, int], int] = {}
            vertices: List[Tuple[int, int, int, int, int, int, int]] = []
            indices: List[int] = []
            mat_values: List[int] = []

            def add_vertex(r: int, c: int) -> int:
                key = (r, c)
                found = vertex_index.get(key)
                if found is not None:
                    return found
                idx = len(vertices)
                vertex_index[key] = idx
                x = q_i16(float(xs[c]), 4.0)
                z = q_i16(float(zs[r]), 4.0)
                y = q_i16(float(height[r, c] * vertical_scale), 8.0)
                u = int(np.clip(round((c / max(1, cols - 1)) * 65535.0), 0, 65535))
                v = int(np.clip(round((r / max(1, rows - 1)) * 65535.0), 0, 65535))
                mat = int(mats[r, c])
                vertices.append((x, z, y, u, v, mat, 0))
                mat_values.append(mat)
                return idx

            for r in range(r0, r1):
                for c in range(c0, c1):
                    if not (land[r, c] and land[r, c + 1] and land[r + 1, c] and land[r + 1, c + 1]):
                        continue
                    v00 = add_vertex(r, c)
                    v10 = add_vertex(r, c + 1)
                    v01 = add_vertex(r + 1, c)
                    v11 = add_vertex(r + 1, c + 1)
                    indices.extend([v00, v01, v10, v10, v01, v11])

            if not indices:
                continue
            if len(vertices) > 65535:
                raise ValueError("chunk produced more than 65535 vertices; lower chunkSize")

            vo = len(vertex_blob)
            io = len(index_blob)
            mo = len(material_blob)
            for x, z, y, u, v, mat, flags in vertices:
                vertex_blob.extend(struct.pack("<hhhHHBB", x, z, y, u, v, mat, flags))
            for idx in indices:
                index_blob.extend(struct.pack("<H", idx))
            material_blob.extend(bytes(np.asarray(mat_values, dtype=np.uint8).tolist()))

            coords = np.asarray([(v[0], v[2], v[1]) for v in vertices], dtype=np.int16)
            mn = coords.min(axis=0)
            mx = coords.max(axis=0)
            records.append(
                (
                    int(c0 // chunk_quads),
                    int(r0 // chunk_quads),
                    len(vertices),
                    len(indices),
                    int(mn[0]), int(mn[1]), int(mn[2]),
                    int(mx[0]), int(mx[1]), int(mx[2]),
                    vo, io, mo,
                )
            )

    header = struct.pack("<8sHHI16s", b"IDFMAP01", 1, profile, len(records), b"\0" * 16)
    record_blob = bytearray()
    for rec in records:
        record_blob.extend(struct.pack("<hhHHhhhhhhIII", *rec))
    manifest = {
        "format": "IDFMAP01",
        "version": 1,
        "profile": profile,
        "chunkCount": len(records),
        "vertexStrideBytes": 12,
        "indexType": "uint16",
        "quantization": {"xScale": 4.0, "zScale": 4.0, "yScale": 8.0},
    }
    manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return header + bytes(record_blob) + bytes(vertex_blob) + bytes(index_blob) + bytes(material_blob) + b"\nJSON\n" + manifest_bytes


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
