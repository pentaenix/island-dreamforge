/**
 * Gentle lake-bed flattening from water overlay masks (heightmap grid).
 */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Minimum connected area (mesh cells) to treat as a lake vs a river. */
export function minLakeAreaCells(largeWaterAreaPx, overlayW, overlayH, cols, rows) {
  const overlayArea = Math.max(1, overlayW * overlayH);
  const meshArea = Math.max(1, cols * rows);
  return Math.max(12, Math.round((Number(largeWaterAreaPx) || 2500) * meshArea / overlayArea));
}

/** Flood-fill connected components; only return blobs at or above minArea. */
export function findLakeComponents(mask, rows, cols, minArea) {
  const seen = new Uint8Array(rows * cols);
  const lakes = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (mask[start] < 32 || seen[start]) continue;

      const stack = [start];
      const component = [];
      seen[start] = 1;

      while (stack.length) {
        const idx = stack.pop();
        component.push(idx);
        const rr = (idx / cols) | 0;
        const cc = idx % cols;
        if (rr > 0) {
          const n = idx - cols;
          if (mask[n] >= 32 && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
        if (rr < rows - 1) {
          const n = idx + cols;
          if (mask[n] >= 32 && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
        if (cc > 0) {
          const n = idx - 1;
          if (mask[n] >= 32 && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
        if (cc < cols - 1) {
          const n = idx + 1;
          if (mask[n] >= 32 && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }

      if (component.length >= minArea) lakes.push(component);
    }
  }
  return lakes;
}

/**
 * Lower large water blobs toward a flat shelf (median bed minus lakeDepthM).
 * Rivers (small blobs) are left unchanged.
 */
export function applyLakeFlattenToHeights(
  heightsSource,
  heightsOut,
  rows,
  cols,
  waterMask,
  {
    largeWaterAreaPx = 2500,
    overlayW = cols,
    overlayH = rows,
    lakeDepthM = 0.75,
    flattenStrength = 0.55,
    depthNorm = 0.0015,
  } = {},
) {
  if (!heightsSource?.length || !heightsOut?.length || !waterMask?.length) return heightsOut;
  heightsOut.set(heightsSource);

  const minArea = minLakeAreaCells(largeWaterAreaPx, overlayW, overlayH, cols, rows);
  const lakes = findLakeComponents(waterMask, rows, cols, minArea);
  if (!lakes.length) return heightsOut;

  const strength = clamp(Number(flattenStrength) || 0, 0, 1);
  const depth = Math.max(0, Number(depthNorm) || 0);

  for (const component of lakes) {
    const vals = component.map((i) => heightsSource[i]).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)] ?? 0;
    const target = Math.max(0, median - depth);

    for (const idx of component) {
      const h = heightsSource[idx];
      if (h <= target) continue;
      const lowered = Math.min(h, target);
      heightsOut[idx] = h * (1 - strength) + lowered * strength;
    }
  }
  return heightsOut;
}
