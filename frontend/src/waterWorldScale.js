/**
 * Scale ocean band distances from resort reference to current island width.
 */

import { REFERENCE_ISLAND_WIDTH_M, getIslandHorizonScale } from './worldSettings.js';

export function getWorldOceanSettings(oceanSettings = {}, worldSettings = {}) {
  const scale = getIslandHorizonScale(worldSettings);
  const ocean = { ...oceanSettings };
  if (Array.isArray(ocean.waterBandEdgesM) && ocean.waterBandEdgesM.length >= 2) {
    ocean.waterBandEdgesM = ocean.waterBandEdgesM.map((v) => Number(v) * scale);
  } else {
    if (ocean.waterBandStepM != null) ocean.waterBandStepM = Number(ocean.waterBandStepM) * scale;
    if (ocean.waterBandStepIncreaseM != null) ocean.waterBandStepIncreaseM = Number(ocean.waterBandStepIncreaseM) * scale;
  }
  if (ocean.oceanFoamRimFadeM != null) ocean.oceanFoamRimFadeM = Number(ocean.oceanFoamRimFadeM) * scale;
  if (ocean.foamWidthM != null) ocean.foamWidthM = Number(ocean.foamWidthM) * scale;
  ocean.widthM = Number(worldSettings.widthM || REFERENCE_ISLAND_WIDTH_M);
  ocean.islandHorizonScale = scale;
  return ocean;
}

export { getIslandHorizonScale as getWaterLayerHorizonScale };
