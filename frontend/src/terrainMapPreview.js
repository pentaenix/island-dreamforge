/**
 * 2D terrain map previews (albedo + normal) from a height grid — shared by inland water panel and future path tools.
 */

import {
  buildSlopeFieldFromHeights,
  paintProceduralTerrainTexture,
} from './proceduralTerrainTexture.js';
import { textureNormsFromSettings } from './textureNorms.js';
import { getDerivedDepthM, getWorldMaxHeightM } from './worldSettings.js';
import { imageDataToPreviewUrl } from './heightmapField.js';

export function previewTerrainMapsFromHeightField({
  heightsNorm,
  rows,
  cols,
  textureSettings = {},
  worldSettings = {},
  maxHeightM = 500,
  seaLevelM = 0,
  textureSize = 768,
  landAt = null,
}) {
  const world = worldSettings || {};
  const worldMaxH = getWorldMaxHeightM(maxHeightM, world);
  const widthM = Number(world.widthM || 1480);
  const depthM = getDerivedDepthM(world, { width: cols, height: rows });
  const norms = textureNormsFromSettings(textureSettings, { maxHeightM, seaLevelM });
  const settings = { ...textureSettings };
  const size = Math.max(256, Math.min(1024, Math.round(textureSize || 768)));

  const slopes = buildSlopeFieldFromHeights(heightsNorm, rows, cols, {
    widthM,
    depthM,
    maxHeightM: worldMaxH,
  });

  const defaultLandAt = (r, c, h) => h > norms.seaNorm + 0.002;

  const painted = paintProceduralTerrainTexture({
    size,
    heights: heightsNorm,
    slopes,
    rows,
    cols,
    settings,
    seaNorm: norms.seaNorm,
    sandNorm: norms.sandNorm,
    worldW: widthM,
    worldD: depthM,
    maxHeightM: worldMaxH,
    seaLevelM,
    landAt: landAt || defaultLandAt,
    sampleMaterial: null,
  });

  return {
    colorUrl: imageDataToPreviewUrl(painted.color),
    normalUrl: imageDataToPreviewUrl(painted.normal),
    size,
  };
}
