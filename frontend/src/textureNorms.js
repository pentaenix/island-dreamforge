/** Normalized sea / sand / wet bands for procedural texture painting (0–1 height). */

export function textureNormsFromSettings(settings = {}, world = {}) {
  const maxH = Math.max(1, Number(settings.maxHeightM ?? world.maxHeightM ?? 500));
  const seaM = Number(settings.seaLevelM ?? world.seaLevelM ?? 0);
  const sandM = Math.max(0.5, Number(settings.sandHeightM ?? 14));
  const wetM = Math.max(0, Number(settings.wetSandWidthM ?? 5));
  return {
    maxHeightM: maxH,
    seaLevelM: seaM,
    seaNorm: seaM / maxH,
    sandNorm: sandM / maxH,
    wetNorm: wetM / maxH,
    sandHeightM: sandM,
    wetSandWidthM: wetM,
  };
}
