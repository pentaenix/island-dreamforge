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
  layers = [],
}) {
  const opts = {};
  for (const key of HEIGHT_OPTION_KEYS) {
    if (options[key] !== undefined) opts[key] = options[key];
  }
  if (options.applyFlatSections !== undefined) opts.applyFlatSections = options.applyFlatSections;
  const flatLayers = (layers || [])
    .filter((l) => l.kind === 'flat' && l.enabled !== false && l.url)
    .map((l) => ({
      id: l.id,
      url: l.url,
      maskThreshold: l.maskThreshold ?? 8,
      edgeSoftPx: l.edgeSoftPx ?? 0,
      heightMode: l.heightMode || 'median',
      flattenStrength: l.flattenStrength ?? 0.72,
    }));
  return JSON.stringify({
    mapUrl,
    similarRadius,
    samples: samples.map((s) => ({
      hex: String(s.hex || '').toLowerCase(),
      height: Number(s.height) || 0,
      smoothness: s.smoothness == null ? null : Number(s.smoothness),
    })),
    options: opts,
    flatLayers,
  });
}
