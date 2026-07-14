/**
 * GLB binaries live outside React state to avoid multi‑MB re-renders and autosave stalls.
 */

const packBlobs = new Map();

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, encoded] = String(dataUrl).split(',');
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'model/gltf-binary';
  const binary = atob(encoded);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function revokePackGlb(packId) {
  const entry = packBlobs.get(packId);
  if (!entry) return;
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  packBlobs.delete(packId);
}

export async function storePackGlbFile(packId, file) {
  revokePackGlb(packId);
  const objectUrl = URL.createObjectURL(file);
  packBlobs.set(packId, {
    blob: file,
    fileName: file.name || `${packId}.glb`,
    objectUrl,
    dataUrl: null,
  });
  return objectUrl;
}

export function hydratePackGlbFromDataUrl(packId, dataUrl, fileName = '') {
  if (!dataUrl) return null;
  revokePackGlb(packId);
  const blob = dataUrlToBlob(dataUrl);
  const objectUrl = URL.createObjectURL(blob);
  packBlobs.set(packId, {
    blob,
    fileName: fileName || `${packId}.glb`,
    objectUrl,
    dataUrl,
  });
  return objectUrl;
}

export function getPackGlbObjectUrl(packId) {
  return packBlobs.get(packId)?.objectUrl || null;
}

export function getPackGlbFileName(packId) {
  return packBlobs.get(packId)?.fileName || '';
}

export function packHasGlbBlob(packId) {
  return packBlobs.has(packId);
}

export async function getPackGlbDataUrl(packId) {
  const entry = packBlobs.get(packId);
  if (!entry) return '';
  if (entry.dataUrl) return entry.dataUrl;
  if (entry.blob instanceof File) {
    entry.dataUrl = await readFileAsDataUrl(entry.blob);
    return entry.dataUrl;
  }
  entry.dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(entry.blob);
  });
  return entry.dataUrl;
}

export async function getPackGlbBlob(packId) {
  return packBlobs.get(packId)?.blob || null;
}

/** Strip heavy glb payloads before putting packs in React state. */
export function stripPackBlobsForState(packs = []) {
  return packs.map((pack) => {
    const { glbDataUrl, glbUrl, ...rest } = pack;
    return {
      ...rest,
      hasGlb: !!(rest.hasGlb || glbDataUrl || glbUrl || packHasGlbBlob(rest.id)),
    };
  });
}

/** Merge blob store into settings for profile save / export. */
export async function enrichDetailSettingsWithPackBlobs(detailSettings = {}) {
  const packs = detailSettings.modelPacks || [];
  const enriched = await Promise.all(packs.map(async (pack) => {
    if (!pack.hasGlb && !packHasGlbBlob(pack.id)) {
      const { glbDataUrl, glbUrl, ...rest } = pack;
      return rest;
    }
    const glbDataUrl = pack.glbDataUrl || await getPackGlbDataUrl(pack.id);
    return {
      ...pack,
      glbDataUrl: glbDataUrl || '',
      glbFileName: pack.glbFileName || getPackGlbFileName(pack.id),
      hasGlb: true,
    };
  }));
  return { ...detailSettings, modelPacks: enriched };
}

export function hydrateAllPackBlobsFromSettings(detailSettings = {}) {
  for (const pack of detailSettings.modelPacks || []) {
    const url = pack.glbDataUrl || pack.glbUrl;
    if (url && !packHasGlbBlob(pack.id)) {
      hydratePackGlbFromDataUrl(pack.id, url, pack.glbFileName);
    }
  }
}

export function detailSettingsPlacementFingerprint(detailSettings = {}) {
  const packs = (detailSettings.modelPacks || []).map((p) => ({
    id: p.id,
    enabled: p.enabled,
    placement: p.placement,
    hasGlb: !!(p.hasGlb || packHasGlbBlob(p.id)),
  }));
  const { modelPacks, ...rest } = detailSettings;
  return JSON.stringify({ ...rest, modelPacks: packs });
}
