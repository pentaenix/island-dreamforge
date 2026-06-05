/**
 * Paint sand / wet sand bands around inland river & lake masks on the terrain texture.
 */

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function dilateMask(data, width, height, radiusPx) {
  if (radiusPx <= 0) return data;
  const out = new Uint8Array(data.length);
  const r = Math.ceil(radiusPx);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxV = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          maxV = Math.max(maxV, data[ny * width + nx]);
        }
      }
      out[y * width + x] = maxV;
    }
  }
  return out;
}

function samplePattern(entry, u, v) {
  const img = entry?.img || entry;
  if (!img?.width) return [200, 180, 130];
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const w = img.width;
  const h = img.height;
  const sx = ((u % 1) + 1) % 1 * w;
  const sy = ((v % 1) + 1) % 1 * h;
  ctx.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
  const p = ctx.getImageData(0, 0, 1, 1).data;
  return [p[0], p[1], p[2]];
}

/**
 * Blend sand into color ImageData near river mask edges.
 */
export function applyRiverSandBanksToImageData(imgData, maskData, width, height, {
  strength = 0.82,
  bankRadiusPx = 8,
  sampleSand = null,
  wetInnerPx = 2,
} = {}) {
  if (!imgData?.data || !maskData?.length) return imgData;
  const dilated = dilateMask(maskData, width, height, bankRadiusPx);
  const inner = dilateMask(maskData, width, height, wetInnerPx);
  const data = imgData.data;
  const s = clamp(Number(strength) || 0.82, 0, 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const edge = dilated[idx] > 0 && maskData[idx] === 0;
      const innerWet = inner[idx] > 0 && maskData[idx] > 0;
      if (!edge && !innerWet) continue;
      const p = idx * 4;
      if (data[p + 3] < 8) continue;
      const u = x / Math.max(1, width);
      const v = y / Math.max(1, height);
      const sandRgb = sampleSand
        ? sampleSand(innerWet ? 'wet_sand' : 'sand', u, v)
        : (innerWet ? [186, 169, 128] : [226, 207, 146]);
      const t = (edge ? s * 0.92 : s * 0.55) * (dilated[idx] / 255);
      data[p] = Math.round(data[p] * (1 - t) + sandRgb[0] * t);
      data[p + 1] = Math.round(data[p + 1] * (1 - t) + sandRgb[1] * t);
      data[p + 2] = Math.round(data[p + 2] * (1 - t) + sandRgb[2] * t);
    }
  }
  return imgData;
}

export async function loadRiverMaskGrid(maskUrl, targetWidth, targetHeight) {
  if (!maskUrl) return null;
  const img = await loadImage(maskUrl);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  const raw = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
  const grid = new Uint8Array(targetWidth * targetHeight);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = raw[i * 4] > 32 ? 255 : 0;
  }
  return grid;
}

export { samplePattern };
