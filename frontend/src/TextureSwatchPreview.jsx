import React from 'react';
import TextureMountPreview from './TextureMountPreview.jsx';

/** Interactive 3D demo hill showing procedural textures on shore, flats, and ridge. */
export default function TextureSwatchPreview({ settings, maxHeightM, seaLevelM }) {
  return <TextureMountPreview settings={settings} maxHeightM={maxHeightM} seaLevelM={seaLevelM} />;
}
