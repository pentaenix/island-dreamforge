import React from 'react';

/** Top-down ocean disc; model is painted into the image (smooth circle, not a low-poly overlay). */
export default function WaterDiscPreview({ waterColorUrl, diameterM, sphereRadiusM }) {
  const diameter = Math.max(0, Math.round(Number(diameterM) || 0));
  const sphereR = Math.max(0, Math.round(Number(sphereRadiusM) || 0));

  return (
    <div className="water-disc-preview">
      <div className="water-disc-topview" aria-label={`Ocean disc Ø ${diameter} m, model Ø ${sphereR * 2} m`}>
        {waterColorUrl ? (
          <img src={waterColorUrl} alt="" className="water-disc-img" draggable={false} />
        ) : (
          <div className="water-disc-placeholder">No preview</div>
        )}
      </div>
      <p className="water-disc-caption">
        Top-down · disc <b>Ø {diameter} m</b> · model <b>Ø {sphereR * 2} m</b>
      </p>
    </div>
  );
}
