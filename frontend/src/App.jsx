import React, { useCallback, useMemo, useRef, useState } from 'react';
import TerrainViewport, { MATERIALS } from './TerrainViewport.jsx';
import HeightsStudio from './HeightsStudio.jsx';
import { SceneLayerCard } from './layerUi.jsx';
import TexturesStudio from './TexturesStudio.jsx';
import { DEFAULT_TEXTURE_SETTINGS, normalizeTextureSettings } from './textureSettings.js';
import ExportProfilePanel from './ExportProfilePanel.jsx';
import WaterSettingsPanel from './WaterSettingsPanel.jsx';
import OceanLayerHeightControls from './OceanLayerHeightControls.jsx';
import WaterDiscPreview from './WaterDiscPreview.jsx';
import InlandWaterHeightPanel from './InlandWaterHeightPanel.jsx';
import { runInlandWaterPipeline, inlandWaterAutoApplyKey } from './inlandWaterPipeline.js';
import { buildWaterDiscPreview } from './waterDiscPreviewClient.js';
import {
  buildWaterLayerApiOptions,
  createBlankWaterOverlayDataUrl,
  getScaledWaterLayerDefaults,
} from './waterOverlaySettings.js';
import { Slider, CollapsibleSection } from './studioUi.jsx';
import { API_URL, dataUrlToBlob, downloadBlob, postForm } from './api.js';
import {
  DEFAULT_WORLD_SETTINGS,
  buildMeshExportOptions,
  getDerivedDepthM,
  getIslandHorizonScale,
  getMetersPerPixel,
  getOceanDiscRadiusM,
  getWaterDiscPreviewSpanM,
  getWaterMapRadiusM,
  maxShoreDistanceScaleM,
  normalizeWorldSettings,
} from './worldSettings.js';
import { buildHeightGenFingerprint } from './heightGenFingerprint.js';
import ProfilesBar from './ProfilesBar.jsx';
import { fileFromDataUrl, snapshotFromAppState } from './projectSnapshot.js';
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  ensureActiveProfile,
  exportProfileJson,
  importProfileFromJson,
  loadProfileDocument,
  loadProfileIndex,
  persistActiveProfile,
  renameProfile,
  setActiveProfile,
} from './profileStore.js';

const waterOnlyStarter = [
  { hex: '#b7d3dc', height: 0, tolerance: 0, weight: 1, role: 'water' },
];

const islandColorLadder = [
  { hex: '#b7d3dc', height: 0, tolerance: 0, weight: 1, role: 'water' },
  { hex: '#efe6bd', height: 6, tolerance: 0, weight: 1 },
  { hex: '#ddd68f', height: 22, tolerance: 0, weight: 1 },
  { hex: '#c6d071', height: 70, tolerance: 0, weight: 1 },
  { hex: '#9eb867', height: 145, tolerance: 0, weight: 1 },
  { hex: '#6fa45d', height: 260, tolerance: 0, weight: 1 },
  { hex: '#3d8745', height: 395, tolerance: 0, weight: 1 },
  { hex: '#2f743d', height: 500, tolerance: 0, weight: 1 },
];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function hexFromRgb(r, g, b) {
  return '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('');
}

function rgbFromHex(hex) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length !== 6) return [0, 0, 0];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}


const DEFAULT_OPTIONS = {
  maxHeightM: 500,
  designedBandMode: true,
  exactColorMode: true,
  unknownColorMode: 'nearest',
  protectWaterLevel: true,
  seaLevelM: 0,
  bandBlendStrength: 0.86,
  bandTransitionPx: 11,
  bandBlendPasses: 2,
  cleanTinyRegions: true,
  tinyRegionPasses: 2,
  smoothingSigma: 1.1,
  roundPeaks: 0.64,
  roundPeakRadius: 11,
  cliffStrength: 0.12,
  colorPower: 1.75,
  sampleLockPower: 1.0,
  terraceCount: 0,
  terraceStrength: 0,
  detailPreserve: 0.08,
  curveSmoothStrength: 0.22,
  curveSmoothRadius: 5,
  spikeRemovalStrength: 0.78,
  spikeThresholdM: 24,
  spikeRemovalPasses: 3,
  applyFlatSections: true,
  slopeLimitStrength: 0.5,
  slopeLimitMPerPx: 62,
  slopeLimitIterations: 3,
  preprocessEnabled: false,
  sampleAverageStrength: 0.0,
  sampleAverageToleranceScale: 1.1,
  paletteColorCount: 0,
  paletteReductionStrength: 0,
  paperNoiseBlur: 0,
  paperNoiseStrength: 0,
  ignoreLineStrength: 0,
  lineInpaintRadius: 3.5,
};

/** 3D ocean uses Three.js Water with fixed tuning — no viewport sliders. */
const DEFAULT_WATER_SETTINGS = { enabled: true, seaLevelM: 0 };

const DEFAULT_EXPORT_SETTINGS = {
  oceanRadiusAuto: true,
  oceanRadiusM: 1700,
  waterMapRadiusAuto: true,
  waterMapRadiusM: 3500,
  maxOceanDepthM: 180,
  waterBandStepM: 12,
  waterBandStepIncreaseM: 16,
  waterBandStepGrowthPower: 2,
  oceanFoamRimFadeM: 48,
  depthCurveExponent: 1.25,
  bathymetrySmoothPx: 1,
  bathymetryRelaxPasses: 0,
  coastalVariationStrength: 0.15,
  reefNoiseStrength: 0.08,
  foamWidthM: 12,
  foamStrength: 0.2,
  waterBandSmoothness: 0.35,
  waterColorSteps: 6,
  waterNoiseStrength: 0.1,
  waterNoiseScaleM: 85,
  waterReflectionEnabled: false,
  waterReflectionStrength: 0.38,
  waterReflectionDistortion: 0.2,
  waterReflectionDistortionScale: 0,
  waterReflectionTint: 0.22,
  waterReflectionResolution: 512,
  oceanBandsOffsetM: 0.1,
  oceanFoamOffsetM: 0.14,
  oceanReflectionOffsetM: 0.12,
  coastlineSkirtDepthM: 40,
  seafloorNoiseM: 6,
  circularFalloffSoftnessM: 200,
  previewDetail: 'preview_high',
  webDetail: 'web_export_high',
  gameDetail: 'game_export_medium',
  chunkSize: 16,
  showSeafloorPreview: false,
  keepLargestIsland: false,
  minIslandAreaPx: 16,
  previewSphereRadiusM: 220,
};

const MATERIAL_TOOLTIPS = {
  trees: 'Paints forest canopy zones using the grass PBR tile.',
  rock: 'Paints steep rocky cliff material.',
  gravel: 'Paints pebble/gravel transition zones.',
  sand: 'Paints beach sand.',
  grass: 'Paints lowland grass.',
};


const TOOL_DEFS = [
  { id: 'move', icon: '✥', label: 'Move', tip: 'Move/orbit the camera. No editing happens.' },
  { id: 'select', icon: '⌖', label: 'Select', tip: 'Select structures, markers, or inspect without sculpting.' },
  { id: 'raise', icon: '▲', label: 'Raise', tip: 'Raise terrain under the brush.' },
  { id: 'lower', icon: '▼', label: 'Lower', tip: 'Lower terrain under the brush.' },
  { id: 'smooth', icon: '≈', label: 'Smooth', tip: 'Soften terrain under the brush.' },
  { id: 'flatten', icon: '▰', label: 'Flatten', tip: 'Blend terrain toward the chosen flatten height.' },
  { id: 'paint', icon: '◌', label: 'Paint', tip: 'Paint the selected material texture without changing height.' },
];

const DEFAULT_BRUSH = { size: 46, strength: 0.48, opacity: 0.85, flattenM: 8, edgeSoftness: 0.72, noise: 0.18 };

async function sampleCornerHexFromFile(file) {
  if (!file) return '#b7d3dc';
  const src = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(24, img.width);
  canvas.height = Math.min(24, img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 32) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return hexFromRgb(Math.round(r / Math.max(1, n)), Math.round(g / Math.max(1, n)), Math.round(b / Math.max(1, n)));
}

function newLayer(kind) {
  const base = {
    id: `${kind}_${Date.now()}_${Math.round(Math.random() * 9999)}`,
    name: kind === 'water' ? 'Water overlay'
      : kind === 'structure' ? 'Structure overlay'
        : kind === 'marker' ? 'Marker / POI overlay'
          : kind === 'flat' ? 'Flat section'
            : 'Texture/noise overlay',
    kind,
    enabled: true,
    file: null,
    url: '',
    analysis: null,
  };
  if (kind === 'water') {
    return { ...base, ...getScaledWaterLayerDefaults(DEFAULT_WORLD_SETTINGS, { width: 1024, height: 1024 }), paintStrength: 1 };
  }
  if (kind === 'structure') return { ...base, shape: 'box', objectHeightM: 8, flattenGround: true, snapToGround: true, maskThreshold: 8 };
  if (kind === 'marker') return { ...base, markerType: 'poi', namePrefix: 'Point', radiusM: 4, maskThreshold: 8 };
  if (kind === 'flat') return { ...base, maskThreshold: 8, edgeSoftPx: 6, heightMode: 'median', flattenStrength: 0.72 };
  return { ...base, material: 'trees', noise: 0.35, edgeSoftness: 0.65, maskThreshold: 8 };
}

function enabledFlatLayers(layerList) {
  return (layerList || []).filter((l) => l.kind === 'flat' && l.enabled !== false && l.file);
}

const STAGE_COUNT = 4;

/** Old saves used step 4 = Layers, step 5 = 3D. */
function normalizeRestoredStage(raw) {
  const s = Number(raw) || 1;
  if (s >= 5) return 4;
  if (s === 4) return 1;
  return Math.min(STAGE_COUNT, Math.max(1, s));
}

export default function App() {
  const viewportRef = useRef(null);
  const syncOceanLayerHeights = useCallback((settings) => {
    requestAnimationFrame(() => {
      viewportRef.current?.syncOceanLayerHeights?.(settings);
    });
  }, []);
  const [stage, setStage] = useState(1);
  const [mapFile, setMapFile] = useState(null);
  const [mapUrl, setMapUrl] = useState('');
  const [mapVersion, setMapVersion] = useState(0);
  const restoreDoneRef = useRef(false);
  const profileSwitchingRef = useRef(false);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [activeProfileName, setActiveProfileName] = useState('Profile');
  const [profileList, setProfileList] = useState([]);
  const [profileLastSavedAt, setProfileLastSavedAt] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [samples, setSamples] = useState(waterOnlyStarter);
  const [picked, setPicked] = useState('#b7d3dc');
  const [newHeight, setNewHeight] = useState(0);
  const [dominant, setDominant] = useState([]);
  const [cleanedPreview, setCleanedPreview] = useState('');
  const [heightmap16, setHeightmap16] = useState('');
  const [heightPreview, setHeightPreview] = useState('');
  const [heightGenFingerprint, setHeightGenFingerprint] = useState('');
  const [bakedHeightmap16, setBakedHeightmap16] = useState('');
  const [bakedPreview, setBakedPreview] = useState('');
  const [waterMask, setWaterMask] = useState('');
  const [layers, setLayers] = useState([]);
  const [activeLayerId, setActiveLayerId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tool, setTool] = useState('move');
  const [selectedMaterial, setSelectedMaterial] = useState('trees');
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [waterSettings, setWaterSettings] = useState(DEFAULT_WATER_SETTINGS);
  const [textureSettings, setTextureSettings] = useState(DEFAULT_TEXTURE_SETTINGS);
  const [exportSettings, setExportSettings] = useState(DEFAULT_EXPORT_SETTINGS);
  const [derivedMaps, setDerivedMaps] = useState(null);
  const [waterDiscPreview, setWaterDiscPreview] = useState(null);
  const [similarRadius, setSimilarRadius] = useState(18);
  const [analyzeCount, setAnalyzeCount] = useState(12);
  const [worldSettings, setWorldSettings] = useState(DEFAULT_WORLD_SETTINGS);
  const [mapSizePx, setMapSizePx] = useState({ width: 0, height: 0 });
  const [inlandWaterHeightPreview, setInlandWaterHeightPreview] = useState('');
  const [inlandWaterApplied, setInlandWaterApplied] = useState(false);
  const [inlandWaterFeatures, setInlandWaterFeatures] = useState([]);
  const [inlandWaterPipelineBusy, setInlandWaterPipelineBusy] = useState(false);
  const [inlandWaterPanelPreview, setInlandWaterPanelPreview] = useState(null);

  const finalPreview = bakedPreview || heightPreview;
  const viewportHeightPreview = inlandWaterHeightPreview || finalPreview;
  const finalHeight = bakedHeightmap16 || heightmap16;
  const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0] || null;
  const derivedDepthM = getDerivedDepthM(worldSettings, mapSizePx);
  const metersPerPixel = getMetersPerPixel(worldSettings, mapSizePx);
  const inlandWaterAutoKey = useMemo(() => inlandWaterAutoApplyKey(layers), [layers]);

  const currentHeightFingerprint = useMemo(
    () => buildHeightGenFingerprint({ mapUrl, samples, options, similarRadius, layers }),
    [mapUrl, samples, options, similarRadius, layers],
  );
  const heightOutOfDate = !!heightPreview && currentHeightFingerprint !== heightGenFingerprint;
  const heightGenerating = typeof busy === 'string' && busy.toLowerCase().includes('height');
  const canGenerateHeightmap = !!mapFile && samples.length > 0
    && Math.max(...samples.map((s) => Number(s.height || 0))) > Number(options.seaLevelM || 0) + 0.5;

  const islandExportOptions = useMemo(() => ({
    ...exportSettings,
    maxHeightM: Number(options.maxHeightM || 500),
    seaLevelM: Number(options.seaLevelM ?? waterSettings.seaLevelM ?? 0),
    widthM: Number(worldSettings.widthM || 1480),
    depthM: Number(derivedDepthM || worldSettings.depthM || 1086),
    verticalScale: Number(worldSettings.verticalExaggeration || 1) * getIslandHorizonScale(worldSettings),
    islandHeightScale: getIslandHorizonScale(worldSettings),
    oceanRadiusM: getWaterMapRadiusM(worldSettings, mapSizePx, exportSettings),
    oceanDiscRadiusM: getOceanDiscRadiusM(worldSettings, mapSizePx, exportSettings),
    oceanDiscDiameterM: getOceanDiscRadiusM(worldSettings, mapSizePx, exportSettings) * 2,
    world: {
      widthM: Number(worldSettings.widthM || 1480),
      depthM: Number(derivedDepthM || worldSettings.depthM || 1086),
      maxHeightM: Number(options.maxHeightM || 500),
      verticalExaggeration: Number(worldSettings.verticalExaggeration || 1),
      seaLevelM: Number(options.seaLevelM ?? waterSettings.seaLevelM ?? 0),
      terrainMeshResolution: Number(worldSettings.terrainMeshResolution || 384),
      featureSpacingM: Number(worldSettings.featureSpacingM ?? 22),
      featureScale: Number(worldSettings.featureScale ?? 1),
    },
    ocean: {
      radiusM: getWaterMapRadiusM(worldSettings, mapSizePx, exportSettings),
      discRadiusM: getOceanDiscRadiusM(worldSettings, mapSizePx, exportSettings),
      discDiameterM: getOceanDiscRadiusM(worldSettings, mapSizePx, exportSettings) * 2,
      maxDepthM: Number(exportSettings.maxOceanDepthM || 220),
      depthCurveExponent: Number(exportSettings.depthCurveExponent || 1.25),
      bathymetrySmoothPx: Number(exportSettings.bathymetrySmoothPx ?? 1),
      bathymetryRelaxPasses: Number(exportSettings.bathymetryRelaxPasses ?? 0),
      coastalVariationStrength: Number(exportSettings.coastalVariationStrength ?? 0.18),
      reefNoiseStrength: Number(exportSettings.reefNoiseStrength ?? 0.05),
      foamWidthM: Number(exportSettings.foamWidthM || 10),
      foamStrength: Number(exportSettings.foamStrength ?? 0.22),
      coastlineSkirtDepthM: Number(exportSettings.coastlineSkirtDepthM || 40),
      waterBandStepM: exportSettings.waterBandStepM ?? 12,
      waterBandStepIncreaseM: exportSettings.waterBandStepIncreaseM ?? 16,
      waterBandStepGrowthPower: Number(exportSettings.waterBandStepGrowthPower ?? 2),
      waterBandSmoothness: Number(exportSettings.waterBandSmoothness ?? exportSettings.waterColorSmoothness ?? 0.35),
      waterColorSmoothness: Number(exportSettings.waterBandSmoothness ?? exportSettings.waterColorSmoothness ?? 0.35),
      oceanFoamRimFadeM: Number(exportSettings.oceanFoamRimFadeM ?? 48),
    },
    detail: {
      preview: exportSettings.previewDetail,
      web: exportSettings.webDetail,
      game: exportSettings.gameDetail,
      chunkSize: Number(exportSettings.chunkSize || 16),
    },
  }), [exportSettings, options.maxHeightM, options.seaLevelM, waterSettings.seaLevelM, worldSettings, derivedDepthM]);

  const islandExportOptionsRef = useRef(islandExportOptions);
  islandExportOptionsRef.current = islandExportOptions;

  const waterPreviewOptions = useMemo(() => ({
    ...exportSettings,
    widthM: Number(worldSettings.widthM || 1480),
    depthM: Number(derivedDepthM || worldSettings.depthM || 1086),
    lockAspect: worldSettings.lockAspect,
    mapWidthPx: mapSizePx?.width,
    mapHeightPx: mapSizePx?.height,
    oceanRadiusM: getWaterMapRadiusM(worldSettings, mapSizePx, exportSettings),
    oceanRadiusAuto: exportSettings.waterMapRadiusAuto !== false,
    waterDiscPreviewSpanM: getWaterDiscPreviewSpanM(
      worldSettings,
      mapSizePx,
      getWaterMapRadiusM(worldSettings, mapSizePx, exportSettings),
    ),
    previewSphereRadiusM: Number(exportSettings.previewSphereRadiusM || 120),
  }), [exportSettings, worldSettings, derivedDepthM, mapSizePx]);

  const waterPreviewKey = useMemo(() => JSON.stringify(waterPreviewOptions), [waterPreviewOptions]);

  const derivedPreviewKey = useMemo(() => JSON.stringify({
    maxHeightM: Number(options.maxHeightM || 500),
    seaLevelM: Number(options.seaLevelM ?? waterSettings.seaLevelM ?? 0),
    widthM: Number(worldSettings.widthM || 1480),
    depthM: Number(derivedDepthM || worldSettings.depthM || 1086),
    waterMapRadiusM: getWaterMapRadiusM(worldSettings, mapSizePx, exportSettings),
    waterMapRadiusAuto: exportSettings.waterMapRadiusAuto !== false,
    islandHeightScale: getIslandHorizonScale(worldSettings),
    bathymetrySmoothPx: Number(exportSettings.bathymetrySmoothPx ?? 1),
    coastalVariationStrength: Number(exportSettings.coastalVariationStrength ?? 0.18),
    reefNoiseStrength: Number(exportSettings.reefNoiseStrength ?? 0.05),
    foamWidthM: Number(exportSettings.foamWidthM || 10),
    waterBandStepM: Number(exportSettings.waterBandStepM ?? 12),
    waterBandStepIncreaseM: Number(exportSettings.waterBandStepIncreaseM ?? 16),
    waterBandStepGrowthPower: Number(exportSettings.waterBandStepGrowthPower ?? 2),
    waterBandSmoothness: Number(exportSettings.waterBandSmoothness ?? exportSettings.waterColorSmoothness ?? 0.35),
  }), [options.maxHeightM, options.seaLevelM, waterSettings.seaLevelM, worldSettings, derivedDepthM, exportSettings, mapSizePx]);

  function applySnapshotToState(saved) {
    if (!saved) return;
    setStage(normalizeRestoredStage(saved.stage));
    setMapUrl(saved.mapUrl || '');
    setMapFile(saved.mapUrl ? fileFromDataUrl(saved.mapUrl, saved.mapFileName || 'restored_map.png') : null);
    setSamples(saved.samples?.length ? saved.samples : waterOnlyStarter);
    setPicked(saved.picked || saved.samples?.[0]?.hex || '#b7d3dc');
    setNewHeight(saved.newHeight ?? 0);
    setDominant(saved.dominant || []);
    setCleanedPreview(saved.cleanedPreview || '');
    setHeightmap16(saved.heightmap16 || '');
    setHeightPreview(saved.heightPreview || '');
    setHeightGenFingerprint(saved.heightGenFingerprint || '');
    setBakedHeightmap16(saved.bakedHeightmap16 || '');
    setBakedPreview(saved.bakedPreview || '');
    setWaterMask(saved.waterMask || '');
    setOptions({ ...DEFAULT_OPTIONS, ...(saved.options || {}) });
    setWaterSettings({ ...DEFAULT_WATER_SETTINGS, ...(saved.waterSettings || {}) });
    setTextureSettings(normalizeTextureSettings(saved.textureSettings || {}));
    const restoredExport = { ...DEFAULT_EXPORT_SETTINGS, ...(saved.exportSettings || {}) };
    delete restoredExport.waterBandEdgesM;
    delete restoredExport.waterBandUseLegacyBands;
    setExportSettings(restoredExport);
    setDerivedMaps(saved.derivedMaps || null);
    setWorldSettings(normalizeWorldSettings(saved.worldSettings || {}));
    setMapSizePx(saved.mapSizePx || { width: 0, height: 0 });
    setTool(saved.tool || 'move');
    setSelectedMaterial(saved.selectedMaterial || 'trees');
    setBrush({ ...DEFAULT_BRUSH, ...(saved.brush || {}) });
    setSimilarRadius(saved.similarRadius ?? 18);
    setAnalyzeCount(saved.analyzeCount ?? 12);
    setAdvancedOpen(!!saved.advancedOpen);
    const restoredLayers = (saved.layers || []).map((l) => ({
      ...l,
      file: l.url ? fileFromDataUrl(l.url, `${l.kind || 'layer'}_overlay.png`) : null,
    }));
    setLayers(restoredLayers);
    setActiveLayerId(saved.activeLayerId || restoredLayers[0]?.id || null);
    setMapVersion((v) => v + 1);
  }

  const recipe = useMemo(() => ({
    app: 'Island Dreamforge',
    philosophy: 'Pixel-perfect color bands, automatic slopes, reversible overlays, and game-ready exports.',
    maxHeightM: options.maxHeightM,
    samples,
    stage1Options: options,
    waterSettings,
    textureSettings,
    exportSettings,
    worldSettings,
    layers: layers.map(({ file, url, ...l }) => l),
  }), [samples, options, waterSettings, textureSettings, exportSettings, worldSettings, layers]);


  React.useEffect(() => {
    let alive = true;
    async function bootProfiles() {
      try {
        const { index, snapshot, profileId, profileName } = await ensureActiveProfile();
        if (!alive) return;
        setProfileList(index.profiles || []);
        setActiveProfileId(profileId);
        setActiveProfileName(profileName);
        applySnapshotToState(snapshot);
        const doc = await loadProfileDocument(profileId);
        if (doc?.savedAt) setProfileLastSavedAt(doc.savedAt);
      } catch (e) {
        console.warn('Profile restore failed', e);
      } finally {
        restoreDoneRef.current = true;
      }
    }
    bootProfiles();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!restoreDoneRef.current || !activeProfileId || profileSwitchingRef.current) return;
    const timer = setTimeout(async () => {
      setProfileSaving(true);
      try {
        const savedAt = await persistActiveProfile(
          activeProfileId,
          activeProfileName,
          snapshotFromAppState({
            stage,
            mapUrl,
            mapFile,
            samples,
            picked,
            newHeight,
            dominant,
            cleanedPreview,
            heightmap16,
            heightPreview,
            heightGenFingerprint,
            bakedHeightmap16,
            bakedPreview,
            waterMask,
            layers,
            activeLayerId,
            options,
            waterSettings,
            textureSettings,
            exportSettings,
            derivedMaps,
            worldSettings,
            mapSizePx,
            tool,
            selectedMaterial,
            brush,
            similarRadius,
            analyzeCount,
            advancedOpen,
          }),
        );
        setProfileLastSavedAt(savedAt);
        const index = await loadProfileIndex();
        setProfileList(index.profiles || []);
      } catch (e) {
        console.warn('Profile autosave failed', e);
      } finally {
        setProfileSaving(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [
    activeProfileId,
    activeProfileName,
    stage,
    mapUrl,
    samples,
    picked,
    newHeight,
    dominant,
    cleanedPreview,
    heightmap16,
    heightPreview,
    heightGenFingerprint,
    bakedHeightmap16,
    bakedPreview,
    waterMask,
    layers,
    activeLayerId,
    options,
    waterSettings,
    textureSettings,
    exportSettings,
    derivedMaps,
    worldSettings,
    mapSizePx,
    tool,
    selectedMaterial,
    brush,
    similarRadius,
    analyzeCount,
    advancedOpen,
    mapFile,
  ]);

  async function flushProfileSave() {
    if (!activeProfileId) return;
    const savedAt = await persistActiveProfile(
      activeProfileId,
      activeProfileName,
      snapshotFromAppState({
        stage,
        mapUrl,
        mapFile,
        samples,
        picked,
        newHeight,
        dominant,
        cleanedPreview,
        heightmap16,
        heightPreview,
        heightGenFingerprint,
        bakedHeightmap16,
        bakedPreview,
        waterMask,
        layers,
        activeLayerId,
        options,
        waterSettings,
        textureSettings,
        exportSettings,
        derivedMaps,
        worldSettings,
        mapSizePx,
        tool,
        selectedMaterial,
        brush,
        similarRadius,
        analyzeCount,
        advancedOpen,
      }),
    );
    setProfileLastSavedAt(savedAt);
  }

  async function handleSelectProfile(profileId) {
    if (!profileId || profileId === activeProfileId) return;
    setBusy('Loading profile…');
    profileSwitchingRef.current = true;
    try {
      await flushProfileSave();
      const { snapshot, profileName } = await setActiveProfile(profileId);
      setActiveProfileId(profileId);
      setActiveProfileName(profileName);
      applySnapshotToState(snapshot);
      const index = await loadProfileIndex();
      setProfileList(index.profiles || []);
      const doc = await loadProfileDocument(profileId);
      setProfileLastSavedAt(doc?.savedAt || '');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      profileSwitchingRef.current = false;
      setBusy('');
    }
  }

  async function handleNewProfile() {
    const name = window.prompt('Name for new profile', `Profile ${profileList.length + 1}`);
    if (name === null) return;
    profileSwitchingRef.current = true;
    try {
      await flushProfileSave();
      const { id, name: profileName, snapshot } = await createProfile({ name: name || undefined, snapshot: null });
      const index = await loadProfileIndex();
      setProfileList(index.profiles || []);
      setActiveProfileId(id);
      setActiveProfileName(profileName);
      applySnapshotToState(snapshot);
      setProfileLastSavedAt(new Date().toISOString());
      setError('');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      profileSwitchingRef.current = false;
    }
  }

  async function handleDuplicateProfile() {
    if (!activeProfileId) return;
    profileSwitchingRef.current = true;
    try {
      await flushProfileSave();
      const { id, name, snapshot } = await duplicateProfile(activeProfileId);
      const index = await loadProfileIndex();
      setProfileList(index.profiles || []);
      setActiveProfileId(id);
      setActiveProfileName(name);
      applySnapshotToState(snapshot);
      setProfileLastSavedAt(new Date().toISOString());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      profileSwitchingRef.current = false;
    }
  }

  async function handleRenameProfile(name) {
    if (!activeProfileId || !name?.trim()) return;
    await renameProfile(activeProfileId, name.trim());
    setActiveProfileName(name.trim());
    const index = await loadProfileIndex();
    setProfileList(index.profiles || []);
  }

  async function handleDeleteProfile() {
    if (!activeProfileId || profileList.length <= 1) return;
    if (!window.confirm(`Delete profile "${activeProfileName}"? This cannot be undone.`)) return;
    profileSwitchingRef.current = true;
    try {
      const next = await deleteProfile(activeProfileId);
      const index = await loadProfileIndex();
      setProfileList(index.profiles || []);
      setActiveProfileId(next.profileId);
      setActiveProfileName(next.profileName);
      applySnapshotToState(next.snapshot);
      const doc = await loadProfileDocument(next.profileId);
      setProfileLastSavedAt(doc?.savedAt || '');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      profileSwitchingRef.current = false;
    }
  }

  async function handleImportProfileJson(file) {
    setBusy('Importing profile…');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      profileSwitchingRef.current = true;
      await flushProfileSave();
      const { id, name, snapshot } = await importProfileFromJson(parsed, { setActive: true });
      const index = await loadProfileIndex();
      setProfileList(index.profiles || []);
      setActiveProfileId(id);
      setActiveProfileName(name);
      applySnapshotToState(snapshot);
      const doc = await loadProfileDocument(id);
      setProfileLastSavedAt(doc?.savedAt || '');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      profileSwitchingRef.current = false;
      setBusy('');
    }
  }

  async function handleFile(file, setterFile, setterUrl) {
    if (!file) return;
    setterFile(file);
    setterUrl(await fileToDataUrl(file));
  }

  async function handleBaseMap(file) {
    if (!file) return;
    setBusy('Loading base map…'); setError('');
    try {
      const url = await fileToDataUrl(file);
      const waterHex = await sampleCornerHexFromFile(file);
      setMapFile(file);
      setMapUrl(url);
      setMapVersion(v => v + 1);
      try {
        const imageDims = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 });
          image.onerror = reject;
          image.src = url;
        });
        setMapSizePx(imageDims);
        setWorldSettings(prev => prev.lockAspect && imageDims.width && imageDims.height ? { ...prev, depthM: Math.round(prev.widthM * imageDims.height / imageDims.width) } : prev);
      } catch {}
      setPicked(waterHex);
      setNewHeight(0);
      setSamples(prev => {
        const onlyStarter = !prev.length || (prev.length === 1 && Number(prev[0].height) === 0);
        if (onlyStarter) return [{ hex: waterHex, height: 0, tolerance: 0, weight: 1, role: 'water' }];
        return prev;
      });
      setHeightmap16(''); setHeightPreview(''); setHeightGenFingerprint('');
      setBakedHeightmap16(''); setBakedPreview(''); setWaterMask('');
      setCleanedPreview('');
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(''); }
  }

  async function resetProject() {
    profileSwitchingRef.current = true;
    setStage(1);
    setMapFile(null); setMapUrl(''); setMapVersion(v => v + 1);
    setSamples(waterOnlyStarter); setPicked('#b7d3dc'); setNewHeight(0);
    setDominant([]); setCleanedPreview('');
    setHeightmap16(''); setHeightPreview(''); setHeightGenFingerprint('');
    setBakedHeightmap16(''); setBakedPreview(''); setWaterMask('');
    setLayers([]); setActiveLayerId(null);
    setOptions({ ...DEFAULT_OPTIONS });
    setWaterSettings({ ...DEFAULT_WATER_SETTINGS });
    setTextureSettings({ ...DEFAULT_TEXTURE_SETTINGS });
    setWorldSettings({ ...DEFAULT_WORLD_SETTINGS });
    setMapSizePx({ width: 0, height: 0 });
    setBrush({ ...DEFAULT_BRUSH });
    setSimilarRadius(18);
    setAnalyzeCount(12);
    setAdvancedOpen(false);
    setTool('move'); setSelectedMaterial('trees');
    setError(''); setBusy('');
    try {
      if (activeProfileId) {
        const savedAt = await persistActiveProfile(
          activeProfileId,
          activeProfileName,
          snapshotFromAppState({
            stage: 1,
            mapUrl: '',
            mapFile: null,
            samples: waterOnlyStarter,
            picked: '#b7d3dc',
            newHeight: 0,
            dominant: [],
            cleanedPreview: '',
            heightmap16: '',
            heightPreview: '',
            heightGenFingerprint: '',
            bakedHeightmap16: '',
            bakedPreview: '',
            waterMask: '',
            layers: [],
            activeLayerId: null,
            options: { ...DEFAULT_OPTIONS },
            waterSettings: { ...DEFAULT_WATER_SETTINGS },
            textureSettings: { ...DEFAULT_TEXTURE_SETTINGS },
            exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
            derivedMaps: null,
            worldSettings: { ...DEFAULT_WORLD_SETTINGS },
            mapSizePx: { width: 0, height: 0 },
            tool: 'move',
            selectedMaterial: 'trees',
            brush: { ...DEFAULT_BRUSH },
            similarRadius: 18,
            analyzeCount: 12,
            advancedOpen: false,
          }),
        );
        setProfileLastSavedAt(savedAt);
      }
    } finally {
      profileSwitchingRef.current = false;
    }
  }

  function addHeightPoint(hex = picked) {
    setSamples(prev => {
      const existing = prev.findIndex(s => s.hex.toLowerCase() === hex.toLowerCase());
      const next = { hex, height: Number(newHeight), tolerance: options.exactColorMode ? 0 : Number(similarRadius), weight: 1 };
      if (existing >= 0) return prev.map((s, i) => i === existing ? { ...s, ...next } : s);
      return [...prev, next].sort((a, b) => Number(a.height) - Number(b.height));
    });
  }

  function updateSample(i, patch) {
    setSamples((prev) => prev.map((s, idx) => (
      idx === i ? { ...s, ...patch, tolerance: options.exactColorMode ? 0 : Number(similarRadius) } : s
    )));
  }

  async function analyzeColors() {
    if (!mapFile) return setError('Upload a base map first.');
    setBusy('Finding clean map colors...'); setError('');
    try {
      const form = new FormData();
      form.append('map_image', mapFile);
      form.append('count', analyzeCount);
      const data = await postForm('/api/analyze-colors', form);
      const colors = data.colors || [];
      setDominant(colors);
      if (colors.length) {
        const nextSamples = colors
          .slice()
          .sort((a, b) => Number(a.suggestedHeight ?? 0) - Number(b.suggestedHeight ?? 0))
          .map(c => ({ hex: c.hex, height: Number(c.suggestedHeight ?? 0), tolerance: 0, weight: 1, role: c.role || '' }));
        setSamples(nextSamples);
        setPicked(nextSamples[0]?.hex || picked);
        setNewHeight(nextSamples[0]?.height ?? 0);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function previewCleanMap() {
    if (!mapFile) return setError('Upload a base map first.');
    setBusy('Previewing color cleanup...'); setError('');
    try {
      const form = new FormData();
      form.append('map_image', mapFile);
      form.append('samples', JSON.stringify(samples));
      form.append('options', JSON.stringify(options));
      const data = await postForm('/api/preprocess-map', form);
      setCleanedPreview(data.cleanedPreview);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function generateHeightmap(responseFormat = 'json') {
    if (!mapFile) return setError('Upload a base map first.');
    if (!samples.length) return setError('Add at least the water color at 0 m.');
    if (Math.max(...samples.map(s => Number(s.height || 0))) <= Number(options.seaLevelM || 0) + 0.5) {
      return setError('The current height setup only contains water/sea-level colors, so the result would be a flat black height map. Add at least one land color with a height above 0 m, or use Suggest colors.');
    }
    setBusy(responseFormat === 'zip' ? 'Exporting Stage 1 maps...' : 'Generating smooth band height map...'); setError('');
    try {
      const form = new FormData();
      const fixedSamples = samples.map(s => ({ ...s, tolerance: options.exactColorMode ? 0 : Number(similarRadius) }));
      form.append('map_image', mapFile);
      form.append('samples', JSON.stringify(fixedSamples));
      form.append('options', JSON.stringify(options));
      form.append('response_format', responseFormat);
      const flatLayers = enabledFlatLayers(layers);
      if (options.applyFlatSections !== false && flatLayers.length) {
        form.append('flat_layer_options', JSON.stringify(flatLayers.map((l) => ({
          maskThreshold: l.maskThreshold ?? 8,
          edgeSoftPx: l.edgeSoftPx ?? 0,
          heightMode: l.heightMode || 'median',
          flattenStrength: l.flattenStrength ?? 0.72,
        }))));
        for (const layer of flatLayers) form.append('flat_layers', layer.file);
      }
      if (responseFormat === 'zip') {
        const blob = await postForm('/api/heightmap', form, true);
        downloadBlob(blob, 'island_heightmap_stage1.zip');
      } else {
        const data = await postForm('/api/heightmap', form);
        setHeightmap16(data.heightmap16);
        setHeightPreview(data.preview8);
        setHeightGenFingerprint(buildHeightGenFingerprint({ mapUrl, samples, options, similarRadius, layers }));
        setBakedHeightmap16(''); setBakedPreview('');
        setInlandWaterHeightPreview(''); setInlandWaterApplied(false); setInlandWaterFeatures([]);
        if (data.warning) setError(data.warning);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function addLayer(kind) {
    const l = kind === 'water'
      ? { ...newLayer(kind), ...getScaledWaterLayerDefaults(worldSettings, mapSizePx) }
      : newLayer(kind);
    setLayers((prev) => [...prev, l]);
    setActiveLayerId(l.id);
  }

  async function addBlankWaterOverlay() {
    if (!mapSizePx?.width) return setError('Load a map in step 1 first so overlay size matches.');
    const url = createBlankWaterOverlayDataUrl(mapSizePx);
    const blob = await dataUrlToBlob(url);
    const file = new File([blob], `water_overlay_${mapSizePx.width}x${mapSizePx.height}.png`, { type: 'image/png' });
    const l = { ...newLayer('water'), ...getScaledWaterLayerDefaults(worldSettings, mapSizePx) };
    l.file = file;
    l.url = url;
    setLayers((prev) => [...prev, l]);
    setActiveLayerId(l.id);
  }

  function updateLayer(id, patch) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  function deleteLayer(id) {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (activeLayerId === id) setActiveLayerId(null);
  }

  function clearLayer(id) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, file: null, url: '', analysis: null } : l));
    if (activeLayerId === id) { setBakedHeightmap16(''); setBakedPreview(''); setWaterMask(''); }
  }

  async function setLayerFile(id, file) {
    if (!file) return;
    const url = await fileToDataUrl(file);
    const isWater = layers.find((l) => l.id === id)?.kind === 'water';
    updateLayer(id, { file, url, analysis: null });
    if (isWater) {
      requestAnimationFrame(() => {
        viewportRef.current?.syncRiverTexturePaint?.();
      });
    }
  }

  function syncWaterProc(key, value) {
    const layerKey = {
      riverMaskSmoothPx: 'maskSmoothPx',
      riverCarveDepthM: 'carveDepthM',
    }[key] || key;
    setLayers((prev) => prev.map((l) => (
      l.kind === 'water' ? { ...l, [layerKey]: value } : l
    )));
  }

  function syncWaterMaskSmooth(px) {
    syncWaterProc('riverMaskSmoothPx', px);
  }

  async function refreshRiversOn3d() {
    if (!finalPreview) return setError('Generate step 1 heightmap first.');
    if (stage !== 4) setStage(4);
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (viewportRef.current?.syncRiverTexturePaint) break;
    }
    const ok = await viewportRef.current?.syncRiverTexturePaint?.();
    if (ok === false) {
      setError('River overlay has no painted pixels — use opaque blue/cyan strokes or lower mask sensitivity, then try again.');
    } else if (ok === true) {
      setError('');
    }
  }

  async function analyzeLayer(layer) {
    if (!layer?.file) return setError('Upload an overlay image for this layer first.');
    setBusy(`Analyzing ${layer.name}...`); setError('');
    try {
      const form = new FormData();
      form.append('layer_image', layer.file);
      if (finalHeight) form.append('heightmap', dataUrlToBlob(finalHeight), 'heightmap.png');
      form.append('kind', layer.kind);
      form.append('options', JSON.stringify(buildWaterLayerApiOptions(layer, worldSettings, mapSizePx, options.maxHeightM)));
      const data = await postForm('/api/analyze-layer', form);
      updateLayer(layer.id, { analysis: data });
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function bakeWaterLayer(layer, responseFormat = 'json') {
    const source = bakedHeightmap16 || heightmap16;
    if (!source) return setError('Generate Stage 1 height map first.');
    if (!layer?.file) return setError('Upload or select a water layer first.');
    setBusy(responseFormat === 'zip' ? 'Exporting water stage...' : 'Baking reversible water layer...'); setError('');
    try {
      const form = new FormData();
      form.append('heightmap', dataUrlToBlob(source), 'heightmap.png');
      form.append('water_map', layer.file);
      form.append('options', JSON.stringify({
        ...buildWaterLayerApiOptions(layer, worldSettings, mapSizePx, options.maxHeightM),
        seaLevelM: options.seaLevelM || 0,
      }));
      form.append('response_format', responseFormat);
      if (responseFormat === 'zip') {
        const blob = await postForm('/api/bake-water', form, true);
        downloadBlob(blob, 'island_water_stage2.zip');
      } else {
        const data = await postForm('/api/bake-water', form);
        setBakedHeightmap16(data.heightmap16);
        setBakedPreview(data.preview8);
        setWaterMask(data.waterMask);
        setWaterSettings(prev => ({ ...prev, seaLevelM: options.seaLevelM || 0 }));
        setStage(3);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function exportLayerJson(layer) {
    if (!layer?.analysis) return;
    const blob = new Blob([JSON.stringify({ layer: { ...layer, file: undefined, url: undefined }, analysis: layer.analysis }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${layer.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_features.json`);
  }

  async function appendViewportPreviewFiles(form) {
    const glb = await viewportRef.current?.exportPreviewGlb?.();
    if (glb) form.append('preview_scene', glb, 'island_preview.glb');
    const tex = await viewportRef.current?.getTextureBlob?.();
    if (tex) form.append('terrain_texture', tex, 'terrain_albedo.png');
    const waterTex = await viewportRef.current?.getWaterTextureBlobs?.();
    if (waterTex?.bands) form.append('ocean_bands', waterTex.bands, 'ocean_bands.png');
    if (waterTex?.foam) form.append('ocean_foam', waterTex.foam, 'ocean_foam.png');
  }

  async function exportPreviewGlb() {
    if (!finalPreview) return setError('Open the 3D viewport first (generate heightmap, then step 4).');
    setBusy('Exporting 3D preview GLB...'); setError('');
    try {
      const glb = await viewportRef.current?.exportPreviewGlb?.();
      if (!glb) throw new Error('3D scene not ready — wait for the viewport to finish loading.');
      downloadBlob(glb, 'island_preview.glb');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function exportMesh(fmt = 'glb') {
    if (fmt === 'glb') {
      return exportPreviewGlb();
    }
    if (!finalHeight) return setError('Generate a heightmap first.');
    setBusy(`Exporting ${fmt.toUpperCase()} mesh...`); setError('');
    try {
      const editHeightBlob = await viewportRef.current?.getHeightmapBlob();
      const textureBlob = await viewportRef.current?.getTextureBlob();
      const normalBlob = await viewportRef.current?.getNormalBlob?.();
      const form = new FormData();
      form.append('heightmap', editHeightBlob || dataUrlToBlob(finalHeight), 'edited_heightmap.png');
      if (textureBlob) form.append('texture', textureBlob, 'painted_texture.png');
      form.append('fmt', fmt);
      form.append('options', JSON.stringify(buildMeshExportOptions(worldSettings, derivedDepthM, { maxHeightM: options.maxHeightM })));
      const blob = await postForm('/api/export-mesh', form, true);
      downloadBlob(blob, `island_terrain.${fmt}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function exportProject() {
    if (!finalHeight) return setError('Generate a heightmap first.');
    setBusy('Exporting full project archive...'); setError('');
    try {
      const editHeightBlob = await viewportRef.current?.getHeightmapBlob();
      const textureBlob = await viewportRef.current?.getTextureBlob();
      const normalBlob = await viewportRef.current?.getNormalBlob?.();
      const form = new FormData();
      form.append('heightmap', editHeightBlob || dataUrlToBlob(finalHeight), 'final_heightmap.png');
      if (textureBlob) form.append('texture', textureBlob, 'painted_texture.png');
      if (normalBlob) form.append('normal_map', normalBlob, 'normal_map.png');
      if (waterMask) form.append('water_mask', dataUrlToBlob(waterMask), 'water_mask.png');
      await appendViewportPreviewFiles(form);
      form.append('recipe', JSON.stringify(recipe));
      form.append('options', JSON.stringify(buildMeshExportOptions(worldSettings, derivedDepthM, { maxHeightM: options.maxHeightM })));
      const blob = await postForm('/api/export-project', form, true);
      downloadBlob(blob, 'island_dreamforge_project.zip');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function currentHeightBlobForExport(filename = 'final_heightmap.png') {
    const editHeightBlob = await viewportRef.current?.getHeightmapBlob();
    const source = editHeightBlob || dataUrlToBlob(finalHeight);
    if (!source) return null;
    return { blob: source, filename };
  }

  function refreshWaterDiscPreview({ silent = false } = {}) {
    if (!silent) setBusy('Rendering water disc preview...');
    if (!silent) setError('');
    try {
      setWaterDiscPreview(buildWaterDiscPreview(waterPreviewOptions));
    } catch (e) {
      const msg = e?.message || String(e);
      if (!silent) setError(msg);
      else console.warn('Water disc preview failed', e);
    } finally {
      if (!silent) setBusy('');
    }
  }

  async function refreshDerivedMaps({ silent = false } = {}) {
    if (!finalHeight) return setError('Generate a heightmap first.');
    if (!silent) setBusy('Generating derived island maps...');
    if (!silent) setError('');
    try {
      const current = await currentHeightBlobForExport('derived_heightmap.png');
      const form = new FormData();
      form.append('heightmap', current.blob, current.filename);
      form.append('options', JSON.stringify(islandExportOptionsRef.current));
      const data = await postForm('/api/island-derived-maps', form);
      setDerivedMaps(data);
    } catch (e) {
      if (!silent) setError(e.message);
      else console.warn('Derived map preview refresh failed', e);
    }
    finally { if (!silent) setBusy(''); }
  }

  React.useEffect(() => {
    if (stage !== 3) return;
    refreshWaterDiscPreview({ silent: true });
  }, [stage, waterPreviewKey]);

  React.useEffect(() => {
    const waterActive = layers.some((l) => l.kind === 'water' && l.enabled !== false && l.url);
    if (!finalPreview || !waterActive) {
      setInlandWaterHeightPreview('');
      setInlandWaterApplied(false);
      setInlandWaterFeatures([]);
      setInlandWaterPanelPreview(null);
      return undefined;
    }

    let cancelled = false;
    setInlandWaterPipelineBusy(true);
    (async () => {
      try {
        const out = await runInlandWaterPipeline({
          heightPreviewUrl: finalPreview,
          layers,
          worldSettings,
          mapSizePx,
          maxHeightM: options.maxHeightM,
          seaLevelM: options.seaLevelM ?? waterSettings.seaLevelM ?? 0,
          textureSettings,
        });
        if (cancelled) return;
        if (!out?.processedPreviewUrl) {
          setInlandWaterHeightPreview('');
          setInlandWaterApplied(false);
          setInlandWaterFeatures([]);
          setInlandWaterPanelPreview(null);
          return;
        }
        setInlandWaterHeightPreview(out.processedPreviewUrl);
        setInlandWaterApplied(true);
        setInlandWaterFeatures(out.waterfalls || []);
        setInlandWaterPanelPreview(out);
      } catch (e) {
        if (!cancelled) console.warn('Inland water pipeline failed', e);
      } finally {
        if (!cancelled) setInlandWaterPipelineBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [
    finalPreview,
    inlandWaterAutoKey,
    layers,
    worldSettings,
    mapSizePx,
    options.maxHeightM,
    options.seaLevelM,
    waterSettings.seaLevelM,
    textureSettings,
  ]);

  React.useEffect(() => {
    if (stage !== 4) return undefined;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 40; i++) {
        if (cancelled) return;
        await new Promise((r) => requestAnimationFrame(r));
        if (viewportRef.current?.syncRiverTexturePaint) {
          await viewportRef.current.syncRiverTexturePaint();
          break;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [stage, inlandWaterHeightPreview, inlandWaterAutoKey]);

  React.useEffect(() => {
    syncOceanLayerHeights(exportSettings);
  }, [
    syncOceanLayerHeights,
    exportSettings.oceanBandsOffsetM,
    exportSettings.oceanFoamOffsetM,
    exportSettings.oceanReflectionOffsetM,
  ]);

  React.useEffect(() => {
    if (stage < 3 || !finalHeight) return;
    const timer = setTimeout(() => {
      refreshDerivedMaps({ silent: true });
    }, 450);
    return () => clearTimeout(timer);
  }, [stage, finalHeight, derivedPreviewKey]);

  async function exportWebIsland() {
    if (!finalHeight) return setError('Generate a heightmap first.');
    setBusy('Exporting web portal package...'); setError('');
    try {
      const current = await currentHeightBlobForExport('web_export_heightmap.png');
      const form = new FormData();
      form.append('heightmap', current.blob, current.filename);
      form.append('options', JSON.stringify(islandExportOptions));
      await appendViewportPreviewFiles(form);
      const blob = await postForm('/api/export-web-island', form, true);
      downloadBlob(blob, 'web_export.zip');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function exportGameIsland() {
    if (!finalHeight) return setError('Generate a heightmap first.');
    setBusy('Exporting game package...'); setError('');
    try {
      const current = await currentHeightBlobForExport('game_export_heightmap.png');
      const form = new FormData();
      form.append('heightmap', current.blob, current.filename);
      form.append('options', JSON.stringify(islandExportOptions));
      await appendViewportPreviewFiles(form);
      const blob = await postForm('/api/export-game-island', form, true);
      downloadBlob(blob, 'game_export.zip');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  function downloadDataUrl(dataUrl, name) {
    if (!dataUrl) return;
    downloadBlob(dataUrlToBlob(dataUrl), name);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Fantasy Map → Game Terrain Studio</p>
          <h1>Island Dreamforge</h1>
          <p className="lede">Color heights and flat-section masks, procedural textures, water tuning, and 3D sculpting with scene overlays.</p>
        </div>
        <div className="api-pill">Backend: <span>{API_URL}</span></div>
      </header>

      <ProfilesBar
        profiles={profileList}
        activeProfileId={activeProfileId}
        activeProfileName={activeProfileName}
        lastSavedAt={profileLastSavedAt}
        saving={profileSaving}
        onSelectProfile={handleSelectProfile}
        onNewProfile={handleNewProfile}
        onDuplicateProfile={handleDuplicateProfile}
        onRenameProfile={handleRenameProfile}
        onDeleteProfile={handleDeleteProfile}
        onExportJson={() => activeProfileId && exportProfileJson(activeProfileId)}
        onImportJson={handleImportProfileJson}
      />

      <nav className="stage-tabs">
        <button className={stage === 1 ? 'active' : ''} onClick={() => setStage(1)}>1 · Heights</button>
        <button className={stage === 2 ? 'active' : ''} onClick={() => setStage(2)}>2 · Textures</button>
        <button className={stage === 3 ? 'active' : ''} onClick={() => setStage(3)}>3 · Water</button>
        <button className={stage === 4 ? 'active' : ''} onClick={() => setStage(4)}>4 · 3D / Export</button>
      </nav>

      {busy && <div className="banner busy">{busy}</div>}
      {error && <div className="banner error">{error}</div>}
      <button className="reset-project" onClick={() => { if (confirm('Reset the active profile to defaults? Other profiles are kept.')) resetProject(); }}>Reset active profile</button>

      {stage === 1 && (
        <HeightsStudio
          mapUrl={mapUrl}
          mapVersion={mapVersion}
          samples={samples}
          setSamples={setSamples}
          picked={picked}
          setPicked={setPicked}
          newHeight={newHeight}
          setNewHeight={setNewHeight}
          similarRadius={similarRadius}
          setSimilarRadius={setSimilarRadius}
          options={options}
          setOptions={setOptions}
          worldSettings={worldSettings}
          setWorldSettings={setWorldSettings}
          derivedDepthM={derivedDepthM}
          mapSizePx={mapSizePx}
          metersPerPixel={metersPerPixel}
          heightPreview={heightPreview}
          heightOutOfDate={heightOutOfDate}
          heightGenerating={heightGenerating}
          canGenerateHeightmap={canGenerateHeightmap}
          onEnsureHeightmap={() => generateHeightmap('json')}
          dominant={dominant}
          cleanedPreview={cleanedPreview}
          analyzeCount={analyzeCount}
          setAnalyzeCount={setAnalyzeCount}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
          waterOnlyStarter={waterOnlyStarter}
          islandColorLadder={islandColorLadder}
          onBaseMap={handleBaseMap}
          onAddHeightPoint={() => addHeightPoint()}
          onUpdateSample={updateSample}
          onAnalyzeColors={analyzeColors}
          onPreviewCleanMap={previewCleanMap}
          onGenerateHeightmap={generateHeightmap}
          flatSectionLayers={layers.filter((l) => l.kind === 'flat')}
          applyFlatSections={options.applyFlatSections !== false}
          onApplyFlatSectionsChange={(v) => setOptions((o) => ({ ...o, applyFlatSections: v }))}
          onAddFlatSection={() => addLayer('flat')}
          onUpdateFlatSection={updateLayer}
          onDeleteFlatSection={deleteLayer}
          onClearFlatSection={clearLayer}
          onFlatSectionFile={setLayerFile}
        />
      )}

      {stage === 2 && (
        <TexturesStudio
          settings={textureSettings}
          setSettings={setTextureSettings}
          maxHeightM={options.maxHeightM}
          seaLevelM={options.seaLevelM ?? waterSettings.seaLevelM ?? 0}
          onOpen3D={() => setStage(4)}
          canPreview={!!finalPreview}
        />
      )}

      {stage === 3 && <section className="water-stage">
        <aside className="panel water-controls">
          <h2>3 · Water</h2>
          <p className="muted">Ocean tuning, river/lake overlays, and height shaping before the 3D view.</p>
          <WaterSettingsPanel
            settings={exportSettings}
            setSettings={setExportSettings}
            worldSettings={worldSettings}
            mapSizePx={mapSizePx}
            autoOceanRadiusM={getOceanDiscRadiusM(worldSettings, mapSizePx, { ...exportSettings, oceanRadiusAuto: true })}
            onHeightsChange={syncOceanLayerHeights}
          />
          <div className="actions compact">
            <button type="button" className="primary" onClick={() => refreshWaterDiscPreview()}>Refresh preview</button>
          </div>
          <h3>Rivers & lakes (texture paint)</h3>
          <p className="small muted">
            Upload or create a PNG aligned with your map ({mapSizePx.width ? `${mapSizePx.width}×${mapSizePx.height}px` : 'load step 1 first'}).
            Paint mask strokes on the overlay — pick water color below. Shape lakes, rivers, and sand in <b>Inland shaping</b> below, then open <b>Step 4</b>.
          </p>
          <div className="actions compact">
            <button type="button" onClick={() => addLayer('water')}>+ Water mask</button>
            <button type="button" onClick={() => addBlankWaterOverlay()} disabled={!mapSizePx.width}>New blank overlay (map size)</button>
            <button type="button" className="primary" onClick={() => refreshRiversOn3d()} disabled={!layers.some((l) => l.kind === 'water' && l.url)}>Show rivers on 3D</button>
          </div>
          <div className="water-layer-sections">
            {layers.filter((l) => l.kind === 'water').map((layer) => (
              <SceneLayerCard
                key={layer.id}
                layer={layer}
                variant="section"
                active={activeLayer?.id === layer.id}
                onSelect={setActiveLayerId}
                onChange={(patch) => updateLayer(layer.id, patch)}
                onFile={(file) => setLayerFile(layer.id, file)}
                onDelete={() => deleteLayer(layer.id)}
                onClear={() => clearLayer(layer.id)}
                worldSettings={worldSettings}
                mapSizePx={mapSizePx}
              />
            ))}
          </div>
          <InlandWaterHeightPanel
            embedded
            layers={layers}
            worldSettings={worldSettings}
            mapSizePx={mapSizePx}
            maxHeightM={options.maxHeightM}
            applied={inlandWaterApplied}
            busy={inlandWaterPipelineBusy}
            pipelinePreview={inlandWaterPanelPreview}
            onProcPatch={syncWaterProc}
            onMaskSmoothChange={syncWaterMaskSmooth}
          />
        </aside>
        <main className="panel water-preview-panel">
          <h2>Top-down disc</h2>
          {waterDiscPreview?.waterColor ? (
            <WaterDiscPreview
              waterColorUrl={waterDiscPreview.waterColor}
              diameterM={waterDiscPreview.oceanDiameterM || getOceanDiscRadiusM(worldSettings, mapSizePx, exportSettings) * 2}
              sphereRadiusM={waterDiscPreview.previewSphereRadiusM || exportSettings.previewSphereRadiusM}
            />
          ) : (
            <div className="drop-hint big">Open this tab to generate the water disc preview.</div>
          )}
          <div className="compare layer-compare water-bake-compare">
            <div><h4>Base height</h4>{heightPreview ? <img src={heightPreview} alt="" /> : <div className="drop-hint">Generate step 1 first</div>}</div>
            <div><h4>Overlay preview</h4>{activeLayer?.kind === 'water' && activeLayer?.url ? <img src={activeLayer.url} alt="" /> : <div className="drop-hint">Add a river overlay PNG</div>}</div>
            <div>
              <h4>Carved height</h4>
              {inlandWaterPanelPreview?.processedPreviewUrl ? (
                <img src={inlandWaterPanelPreview.processedPreviewUrl} alt="Processed height with inland water" />
              ) : (
                <div className="drop-hint">{layers.some((l) => l.kind === 'water' && l.url) ? 'Processing…' : 'Add water overlay'}</div>
              )}
            </div>
          </div>
        </main>
      </section>}

      {stage === 4 && <section className="stage3">
        <aside className="panel tools">
          <h2>4 · Sculpt, paint, view, export</h2>
          <div className="icon-toolbar" aria-label="Terrain tools">
            {TOOL_DEFS.map(t => <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label}: ${t.tip}`} aria-label={t.label}><span>{t.icon}</span><small>{t.label}</small></button>)}
          </div>
          <div className="active-tool-note"><b>{TOOL_DEFS.find(t => t.id === tool)?.label || 'Move'}</b> · {TOOL_DEFS.find(t => t.id === tool)?.tip || 'Move/orbit the camera.'}</div>
          <Slider label="Brush size" value={brush.size} min={4} max={220} step={1} suffix="px" onChange={v => setBrush({ ...brush, size: v })} />
          <Slider label="Brush strength" value={brush.strength} min={0.02} max={1} step={0.01} onChange={v => setBrush({ ...brush, strength: v })} />
          <Slider label="Paint opacity" value={brush.opacity} min={0.05} max={1} step={0.01} onChange={v => setBrush({ ...brush, opacity: v })} />
          <Slider label="Paint edge softness" value={brush.edgeSoftness} min={0} max={1} step={0.01} onChange={v => setBrush({ ...brush, edgeSoftness: v })} />
          <Slider label="Paint noise" value={brush.noise} min={0} max={1} step={0.01} onChange={v => setBrush({ ...brush, noise: v })} />
          <Slider label="Flatten height" value={brush.flattenM} min={0} max={options.maxHeightM} step={1} suffix="m" onChange={v => setBrush({ ...brush, flattenM: v })} />
          <h3>Procedural texture step</h3>
          <p className="small muted">Generate a fuzzy artist-style base texture from height and slope, then paint over it safely.</p>
          <h3>Paint material</h3>
          <div className="material-list">{MATERIALS.map(m => <button key={m.id} title={MATERIAL_TOOLTIPS[m.id] || m.label} className={selectedMaterial === m.id ? 'active' : ''} onClick={() => { setSelectedMaterial(m.id); setTool('paint'); }}>{m.label}</button>)}</div>
          <button className="primary" onClick={() => viewportRef.current?.autoTexture()}>Regenerate terrain texture</button>
          <button onClick={() => refreshRiversOn3d()} disabled={!layers.some((l) => l.kind === 'water' && l.url)}>Refresh rivers on texture</button>
          <button onClick={() => viewportRef.current?.regenerateTrees()}>Regenerate forest clumps</button>
          <button onClick={() => viewportRef.current?.resetCamera()}>Reset camera</button>
          <div className="tool-grid">
            <button onClick={() => { const u = viewportRef.current?.getWaterTextureUrls(); if (u?.bands) downloadDataUrl(u.bands, 'sea_bands.png'); else setError('Open the 3D view and let the water build first.'); }}>Download bands PNG</button>
            <button onClick={() => { const u = viewportRef.current?.getWaterTextureUrls(); if (u?.foam) downloadDataUrl(u.foam, 'sea_foam.png'); else setError('Open the 3D view and let the water build first.'); }}>Download foam PNG</button>
          </div>
          <p className="small muted">Lighting and material colors: step 2 · Textures. Ocean: step 3 · Water. Click Regenerate terrain texture after color changes.</p>
          <h3>Scene overlays</h3>
          <p className="small muted">Optional PNGs for structures, markers, and texture hints — analyzed for 3D preview and JSON export.</p>
          <div className="tool-grid">
            <button type="button" onClick={() => addLayer('structure')}>+ Structure</button>
            <button type="button" onClick={() => addLayer('marker')}>+ Marker</button>
            <button type="button" onClick={() => addLayer('texture')}>+ Texture</button>
          </div>
          <div className="layer-list compact-list">
            {layers.filter((l) => l.kind !== 'flat' && l.kind !== 'water').map((layer) => (
              <SceneLayerCard
                key={layer.id}
                layer={layer}
                active={activeLayer?.id === layer.id}
                onSelect={setActiveLayerId}
                onChange={(patch) => updateLayer(layer.id, patch)}
                onFile={(file) => setLayerFile(layer.id, file)}
                onAnalyze={() => analyzeLayer(layer)}
                onExport={() => exportLayerJson(layer)}
                onDelete={() => deleteLayer(layer.id)}
                onClear={() => clearLayer(layer.id)}
                worldSettings={worldSettings}
                mapSizePx={mapSizePx}
              />
            ))}
          </div>
          {activeLayer?.analysis && activeLayer.kind !== 'water' && activeLayer.kind !== 'flat' && (
            <pre className="json-preview">{JSON.stringify({ summary: activeLayer.analysis.summary, firstFeatures: activeLayer.analysis.features?.slice(0, 6) }, null, 2)}</pre>
          )}
          <CollapsibleSection title="Ocean layer heights" defaultOpen>
            <OceanLayerHeightControls
              settings={exportSettings}
              setSettings={setExportSettings}
              onHeightsChange={syncOceanLayerHeights}
            />
          </CollapsibleSection>
          <h3>Exports</h3>
          <div className="tool-grid">
            <button className="primary" onClick={() => exportPreviewGlb()} disabled={!finalPreview}>Export 3D preview (GLB)</button>
            <button onClick={() => exportMesh('obj')}>OBJ (land only)</button>
            <button onClick={() => exportMesh('stl')}>STL (land only)</button>
            <button onClick={() => exportMesh('ply')}>PLY (land only)</button>
          </div>
          <p className="small muted">GLB matches the live viewport: terrain texture + circular ocean (disc, bands, foam), unlit — no skybox. Web/game ZIPs include the same preview scene when the 3D view is open.</p>
          <button className="primary" onClick={exportProject}>Export full project ZIP</button>
          <button onClick={() => downloadDataUrl(finalHeight, 'final_heightmap.png')}>Download final heightmap</button>
          {waterMask && <button onClick={() => downloadDataUrl(waterMask, 'water_mask.png')}>Download water mask</button>}
          <button onClick={() => downloadBlob(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }), 'island_dreamforge_recipe.json')}>Export recipe JSON</button>
          <ExportProfilePanel
            settings={exportSettings}
            setSettings={setExportSettings}
            canExport={!!finalHeight}
            derivedMaps={derivedMaps}
            onRefreshDerivedMaps={refreshDerivedMaps}
            onExportWeb={exportWebIsland}
            onExportGame={exportGameIsland}
          />
        </aside>
        <div className="viewer-wrap">
          {viewportHeightPreview ? <TerrainViewport ref={viewportRef} heightUrl={viewportHeightPreview} maxHeightM={options.maxHeightM} seaLevelM={options.seaLevelM ?? waterSettings.seaLevelM ?? 0} tool={tool} brush={brush} selectedMaterial={selectedMaterial} textureSettings={textureSettings} layers={layers} worldSettings={{ ...worldSettings, depthM: derivedDepthM }} waterDepthUrl={derivedMaps?.waterDepth || ''} waterColorUrl={derivedMaps?.waterColor || ''} shoreDistanceUrl={derivedMaps?.shoreDistancePreview || ''} shoreDistanceMaxM={maxShoreDistanceScaleM(worldSettings, mapSizePx, exportSettings)} foamMaskUrl={derivedMaps?.foamMask || ''} waterMaskUrl={derivedMaps?.waterMask || ''} islandMaskUrl={derivedMaps?.islandMask || ''} materialPreviewUrl={derivedMaps?.materialIds || ''} showSeafloor={!!exportSettings.showSeafloorPreview} oceanSettings={exportSettings} /> : <div className="drop-hint big">Generate Stage 1 first, then the 3D viewport appears here.</div>}
        </div>
      </section>}
    </div>
  );
}
