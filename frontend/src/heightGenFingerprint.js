/** Fingerprint of inputs that affect backend heightmap generation. */

/** Options that change the baked heightmap (not profile-only magnify / world scale). */
const HEIGHT_OPTION_KEYS = [
  'maxHeightM',
  'seaLevelM',
  'exactColorMode',
  'bandBlendStrength',
  'bandTransitionPx',
  'bandBlendPasses',
  'smoothingSigma',
  'roundPeaks',
  'roundPeakRadius',
  'cliffStrength',
  'spikeRemovalStrength',
  'slopeLimitMPerPx',
  'preprocessEnabled',
  'sampleAverageStrength',
  'paletteColorCount',
  'ignoreLineStrength',
  'paperNoiseBlur',
  'curveSmoothStrength',
];

export function buildHeightGenFingerprint({
  mapUrl = '',
  samples = [],
  options = {},
  similarRadius = 18,
}) {
  const opts = {};
  for (const key of HEIGHT_OPTION_KEYS) {
    if (options[key] !== undefined) opts[key] = options[key];
  }
  return JSON.stringify({
    mapUrl,
    similarRadius,
    samples: samples.map((s) => ({
      hex: String(s.hex || '').toLowerCase(),
      height: Number(s.height) || 0,
    })),
    options: opts,
  });
}
