/**
 * Load / encode height fields for heightmap-level tools (inland water, paths later).
 */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (url && !String(url).startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Normalized [0,1] heights from an 8-bit preview PNG. */
export async function loadHeightFieldFromPreview(previewUrl) {
  if (!previewUrl) return null;
  const img = await loadImage(previewUrl);
  const cols = img.width;
  const rows = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const heightsNorm = new Float32Array(rows * cols);
  for (let i = 0; i < heightsNorm.length; i++) heightsNorm[i] = data[i * 4] / 255;
  return { heightsNorm, rows, cols };
}

/** 8-bit grayscale preview data URL from normalized heights. */
export function heightFieldToPreviewUrl(heightsNorm, rows, cols) {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < heightsNorm.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, heightsNorm[i] ?? 0)) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function imageDataToPreviewUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
