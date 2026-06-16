/**
 * Shared inland water height + preview pipeline (Step 3 panel & Step 4 auto-apply).
 */

import {
  heightFieldToPreviewUrl,
  loadHeightFieldFromPreview,
} from './heightmapField.js';
import { buildHeightmapWaterMask } from './riverTexturePaint.js';
import {
  inlandWaterProcessOptionsFromLayers,
  processInlandWaterHeights,
} from './inlandWaterHeightProcess.js';
import { previewTerrainMapsFromHeightField } from './terrainMapPreview.js';

export async function runInlandWaterPipeline({
  heightPreviewUrl,
  layers = [],
  worldSettings = {},
  mapSizePx = {},
  maxHeightM = 500,
  seaLevelM = 0,
  textureSettings = {},
}) {
  const waterLayers = (layers || []).filter((l) => l.kind === 'water' && l.enabled !== false && l.url);
  if (!heightPreviewUrl || !waterLayers.length) {
    return null;
  }

  const procOptions = inlandWaterProcessOptionsFromLayers(waterLayers, worldSettings, mapSizePx, maxHeightM);
  if (!procOptions) return null;

  const field = await loadHeightFieldFromPreview(heightPreviewUrl);
  if (!field) throw new Error('Could not load height preview.');

  const { mask, carveMask, classifyMask, overlayW, overlayH } = await buildHeightmapWaterMask(
    waterLayers,
    field.rows,
    field.cols,
    8,
    procOptions.riverMaskSmoothPx ?? 3,
  );

  const result = processInlandWaterHeights(
    field.heightsNorm,
    field.rows,
    field.cols,
    mask,
    {
      ...procOptions,
      overlayW,
      overlayH,
      maxHeightM,
      carveMask: carveMask || mask,
      classifyMask: classifyMask || carveMask || mask,
    },
  );

  const sourcePreviewUrl = heightFieldToPreviewUrl(field.heightsNorm, field.rows, field.cols);
  const processedPreviewUrl = heightFieldToPreviewUrl(result.heights, field.rows, field.cols);
  const maps = previewTerrainMapsFromHeightField({
    heightsNorm: result.heights,
    rows: field.rows,
    cols: field.cols,
    textureSettings,
    worldSettings,
    maxHeightM,
    seaLevelM,
  });

  return {
    sourcePreviewUrl,
    processedPreviewUrl,
    normalPreviewUrl: maps.normalUrl,
    summary: result.summary,
    waterfalls: result.features.filter((f) => f.kind === 'waterfall'),
  };
}

/** Stable key for auto-apply dependency tracking. */
export function inlandWaterAutoApplyKey(layers = []) {
  return JSON.stringify(
    (layers || [])
      .filter((l) => l.kind === 'water')
      .map((l) => ({
        id: l.id,
        url: l.url,
        enabled: l.enabled,
        maskThreshold: l.maskThreshold,
        maskSmoothPx: l.maskSmoothPx,
        riverSlimPx: l.riverSlimPx,
        paintStrength: l.paintStrength,
        paintColor: l.paintColor,
        lakeFlattenStrength: l.lakeFlattenStrength,
        lakeDepthM: l.lakeDepthM,
        carveDepthM: l.carveDepthM,
        riverChannelStrength: l.riverChannelStrength,
        waterfallCarveStrength: l.waterfallCarveStrength,
        sandBankAmount: l.sandBankAmount,
        largeWaterAreaPx: l.largeWaterAreaPx,
      })),
  );
}
