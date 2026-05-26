export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const [meta, encoded] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'application/octet-stream';
  const binary = atob(encoded);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function postForm(path, form, asBlob = false) {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return asBlob ? await res.blob() : await res.json();
}
