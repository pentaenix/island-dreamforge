/**
 * Soft blur for water overlay masks — reduces pixelated rivers before height carve / texture paint.
 */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Separable box blur on a byte mask; returns smoothed Uint8Array (same length). */
export function smoothMaskGrid(mask, rows, cols, radius = 2) {
  if (!mask?.length || radius < 1) return mask;
  const r = Math.round(radius);
  const diam = r * 2 + 1;
  const tmp = new Float32Array(rows * cols);
  const out = new Float32Array(rows * cols);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let dx = -r; dx <= r; dx++) {
        sum += mask[y * cols + clamp(x + dx, 0, cols - 1)] || 0;
      }
      tmp[y * cols + x] = sum / diam;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        sum += tmp[clamp(y + dy, 0, rows - 1) * cols + x];
      }
      out[y * cols + x] = sum / diam;
    }
  }

  const result = new Uint8Array(rows * cols);
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.round(clamp(out[i], 0, 255));
  }
  return result;
}

/** Optional second pass for wider, softer river beds. */
export function smoothMaskGridMulti(mask, rows, cols, radius = 2, passes = 1) {
  let cur = mask;
  const n = Math.max(1, Math.round(passes));
  for (let i = 0; i < n; i++) {
    cur = smoothMaskGrid(cur, rows, cols, radius);
  }
  return cur;
}

/** Morphological erode — narrows rivers / water mask (use after smooth). */
export function erodeMaskGrid(mask, rows, cols, radius = 1, threshold = 32) {
  if (!mask?.length || radius < 1) return mask;
  const r = Math.round(radius);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (mask[i] < threshold) continue;
      let keep = true;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r && keep; dx++) {
          const ny = clamp(y + dy, 0, rows - 1);
          const nx = clamp(x + dx, 0, cols - 1);
          if (mask[ny * cols + nx] < threshold) keep = false;
        }
      }
      out[i] = keep ? mask[i] : 0;
    }
  }
  return out;
}

export function erodeMaskGridMulti(mask, rows, cols, radius = 1, passes = 1) {
  let cur = mask;
  const n = Math.max(1, Math.round(passes));
  for (let i = 0; i < n; i++) {
    cur = erodeMaskGrid(cur, rows, cols, Math.max(1, Math.round(radius)));
  }
  return cur;
}
