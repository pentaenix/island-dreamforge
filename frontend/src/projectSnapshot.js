import { dataUrlToBlob } from './api.js';

export const PROFILE_SCHEMA_VERSION = 1;
export const LEGACY_AUTOSAVE_KEY = 'island-dreamforge-autosave-v7';

export function fileFromDataUrl(dataUrl, name = 'restored-image.png') {
  if (!dataUrl) return null;
  const blob = dataUrlToBlob(dataUrl);
  return new File([blob], name, { type: blob.type || 'image/png' });
}

/** Flat app state → portable profile document (assets keyed for JSON export). */
export function buildProfileDocument(snapshot, { profileId, name }) {
  const assets = {};
  const link = (key, dataUrl, fileName) => {
    if (!dataUrl) return null;
    assets[key] = { fileName: fileName || `${key}.png`, dataUrl };
    return key;
  };

  const mapAssetKey = link('map', snapshot.mapUrl, snapshot.mapFileName);
  const height16Key = link('heightmap16', snapshot.heightmap16, 'heightmap_16bit.png');
  const heightPreviewKey = link('heightPreview', snapshot.heightPreview, 'heightmap_preview.png');
  const baked16Key = link('bakedHeightmap16', snapshot.bakedHeightmap16, 'baked_heightmap_16bit.png');
  const bakedPreviewKey = link('bakedPreview', snapshot.bakedPreview, 'baked_heightmap_preview.png');
  const waterMaskKey = link('waterMask', snapshot.waterMask, 'water_mask.png');
  const cleanedKey = link('cleanedPreview', snapshot.cleanedPreview, 'cleaned_map_preview.png');

  const layers = (snapshot.layers || []).map((layer) => {
    const { file, url, ...rest } = layer;
    const assetKey = url ? link(`layer_${rest.id}`, url, `${rest.kind || 'layer'}_${rest.name || 'overlay'}.png`) : null;
    return { ...rest, assetKey };
  });

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileId,
    name,
    savedAt: new Date().toISOString(),
    state: {
      stage: snapshot.stage,
      mapAssetKey,
      mapFileName: snapshot.mapFileName,
      samples: snapshot.samples,
      picked: snapshot.picked,
      newHeight: snapshot.newHeight,
      dominant: snapshot.dominant,
      heightGenFingerprint: snapshot.heightGenFingerprint,
      height16AssetKey: height16Key,
      heightPreviewAssetKey: heightPreviewKey,
      baked16AssetKey: baked16Key,
      bakedPreviewAssetKey: bakedPreviewKey,
      waterMaskAssetKey: waterMaskKey,
      cleanedPreviewAssetKey: cleanedKey,
      layers,
      activeLayerId: snapshot.activeLayerId,
      options: snapshot.options,
      waterSettings: snapshot.waterSettings,
      textureSettings: snapshot.textureSettings,
      exportSettings: snapshot.exportSettings,
      detailSettings: snapshot.detailSettings,
      derivedMaps: snapshot.derivedMaps,
      worldSettings: snapshot.worldSettings,
      mapSizePx: snapshot.mapSizePx,
      tool: snapshot.tool,
      selectedMaterial: snapshot.selectedMaterial,
      brush: snapshot.brush,
      similarRadius: snapshot.similarRadius,
      analyzeCount: snapshot.analyzeCount,
      advancedOpen: snapshot.advancedOpen,
    },
    assets,
  };
}

function assetUrl(assets, key) {
  if (!key || !assets?.[key]) return '';
  return assets[key].dataUrl || '';
}

function assetFile(assets, key, fallbackName) {
  const url = assetUrl(assets, key);
  if (!url) return null;
  const fileName = assets[key]?.fileName || fallbackName;
  return fileFromDataUrl(url, fileName);
}

/** Profile document → flat snapshot for React state. */
export function profileDocumentToSnapshot(doc) {
  if (!doc) return null;
  const assets = doc.assets || {};
  const s = doc.state || doc;

  if (doc.version >= 6 && !doc.state) {
    return legacyAutosaveToSnapshot(doc);
  }

  const layers = (s.layers || []).map((layer) => {
    const { assetKey, ...rest } = layer;
    const url = assetUrl(assets, assetKey);
    return {
      ...rest,
      url,
      file: assetFile(assets, assetKey, `${rest.kind || 'layer'}_overlay.png`),
      analysis: rest.analysis ?? null,
    };
  });

  return {
    stage: s.stage,
    mapUrl: assetUrl(assets, s.mapAssetKey) || s.mapUrl || '',
    mapFileName: s.mapFileName || assets[s.mapAssetKey]?.fileName || 'map.png',
    samples: s.samples,
    picked: s.picked,
    newHeight: s.newHeight,
    dominant: s.dominant || [],
    cleanedPreview: assetUrl(assets, s.cleanedPreviewAssetKey) || s.cleanedPreview || '',
    heightmap16: assetUrl(assets, s.height16AssetKey) || s.heightmap16 || '',
    heightPreview: assetUrl(assets, s.heightPreviewAssetKey) || s.heightPreview || '',
    heightGenFingerprint: s.heightGenFingerprint || '',
    bakedHeightmap16: assetUrl(assets, s.baked16AssetKey) || s.bakedHeightmap16 || '',
    bakedPreview: assetUrl(assets, s.bakedPreviewAssetKey) || s.bakedPreview || '',
    waterMask: assetUrl(assets, s.waterMaskAssetKey) || s.waterMask || '',
    layers,
    activeLayerId: s.activeLayerId,
    options: s.options,
    waterSettings: s.waterSettings,
    textureSettings: s.textureSettings,
    exportSettings: s.exportSettings,
    detailSettings: s.detailSettings,
    derivedMaps: s.derivedMaps,
    worldSettings: s.worldSettings,
    mapSizePx: s.mapSizePx,
    tool: s.tool,
    selectedMaterial: s.selectedMaterial,
    brush: s.brush,
    similarRadius: s.similarRadius,
    analyzeCount: s.analyzeCount,
    advancedOpen: s.advancedOpen,
  };
}

export function legacyAutosaveToSnapshot(saved) {
  const layers = (saved.layers || []).map((l) => ({
    ...l,
    url: l.url || '',
    file: l.url ? fileFromDataUrl(l.url, `${l.kind || 'layer'}_overlay.png`) : null,
  }));
  return {
    stage: saved.stage,
    mapUrl: saved.mapUrl || '',
    mapFileName: saved.mapFileName || 'map.png',
    samples: saved.samples,
    picked: saved.picked,
    newHeight: saved.newHeight,
    dominant: saved.dominant || [],
    cleanedPreview: saved.cleanedPreview || '',
    heightmap16: saved.heightmap16 || '',
    heightPreview: saved.heightPreview || '',
    heightGenFingerprint: saved.heightGenFingerprint || '',
    bakedHeightmap16: saved.bakedHeightmap16 || '',
    bakedPreview: saved.bakedPreview || '',
    waterMask: saved.waterMask || '',
    layers,
    activeLayerId: saved.activeLayerId,
    options: saved.options,
    waterSettings: saved.waterSettings,
    textureSettings: saved.textureSettings,
    exportSettings: saved.exportSettings,
    detailSettings: saved.detailSettings,
    derivedMaps: saved.derivedMaps,
    worldSettings: saved.worldSettings,
    mapSizePx: saved.mapSizePx,
    tool: saved.tool,
    selectedMaterial: saved.selectedMaterial,
    brush: saved.brush,
    similarRadius: saved.similarRadius,
    analyzeCount: saved.analyzeCount,
    advancedOpen: saved.advancedOpen,
  };
}

export function snapshotFromAppState(app) {
  const cleanLayers = (app.layers || []).map(({ file, ...l }) => l);
  return {
    stage: app.stage,
    mapUrl: app.mapUrl,
    mapFileName: app.mapFile?.name || 'map.png',
    samples: app.samples,
    picked: app.picked,
    newHeight: app.newHeight,
    dominant: app.dominant,
    cleanedPreview: app.cleanedPreview,
    heightmap16: app.heightmap16,
    heightPreview: app.heightPreview,
    heightGenFingerprint: app.heightGenFingerprint,
    bakedHeightmap16: app.bakedHeightmap16,
    bakedPreview: app.bakedPreview,
    waterMask: app.waterMask,
    layers: cleanLayers,
    activeLayerId: app.activeLayerId,
    options: app.options,
    waterSettings: app.waterSettings,
    textureSettings: app.textureSettings,
    exportSettings: app.exportSettings,
    detailSettings: app.detailSettings,
    derivedMaps: app.derivedMaps,
    worldSettings: app.worldSettings,
    mapSizePx: app.mapSizePx,
    tool: app.tool,
    selectedMaterial: app.selectedMaterial,
    brush: app.brush,
    similarRadius: app.similarRadius,
    analyzeCount: app.analyzeCount,
    advancedOpen: app.advancedOpen,
  };
}
