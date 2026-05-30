import React, { useEffect, useRef, useState } from 'react';

function hexFromRgb(r, g, b) {
  return '#' + [r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

function rgbFromHex(hex) {
  const v = String(hex || '').replace('#', '').trim();
  if (v.length !== 6) return [0, 0, 0];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export default function MapPicker({
  imageUrl,
  overlayUrl,
  picked,
  pixelPerfect,
  showMatch,
  similarRadius,
  onPick,
  mapVersion = 0,
}) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const sourceDataRef = useRef(null);
  const [loadState, setLoadState] = useState({ loading: false, error: '', width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = 1;
      canvas.height = 1;
      ctx.clearRect(0, 0, 1, 1);
    }
    imageRef.current = null;
    sourceDataRef.current = null;
    if (!imageUrl) return;

    setLoadState({ loading: true, error: '', width: 0, height: 0 });
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      imageRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      sourceDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setLoadState({ loading: false, error: '', width: canvas.width, height: canvas.height });
      requestAnimationFrame(draw);
    };
    img.onerror = () => {
      setLoadState({ loading: false, error: 'The image could not be drawn. Try re-uploading it or use PNG.', width: 0, height: 0 });
    };
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, mapVersion]);

  useEffect(() => { draw(); }, [picked, pixelPerfect, showMatch, similarRadius, overlayUrl, loadState.width, loadState.height]);

  function draw() {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !sourceDataRef.current) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (showMatch && picked) {
      const source = sourceDataRef.current;
      const overlay = ctx.createImageData(canvas.width, canvas.height);
      const [tr, tg, tb] = rgbFromHex(picked);
      const tol = pixelPerfect ? 0 : Number(similarRadius || 18);
      for (let i = 0; i < source.data.length; i += 4) {
        const dr = source.data[i] - tr;
        const dg = source.data[i + 1] - tg;
        const db = source.data[i + 2] - tb;
        const ok = pixelPerfect ? (dr === 0 && dg === 0 && db === 0) : Math.sqrt(dr * dr + dg * dg + db * db) <= tol;
        if (ok) {
          overlay.data[i] = 77;
          overlay.data[i + 1] = 224;
          overlay.data[i + 2] = 255;
          overlay.data[i + 3] = 125;
        }
      }
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.putImageData(overlay, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.restore();
    }

    if (overlayUrl) {
      const o = new Image();
      o.onload = () => {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.drawImage(o, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      };
      o.src = overlayUrl;
    }
  }

  function click(ev) {
    const canvas = canvasRef.current;
    if (!canvas || !sourceDataRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((ev.clientY - rect.top) * (canvas.height / rect.height));
    const src = sourceDataRef.current;
    const idx = (y * canvas.width + x) * 4;
    onPick(hexFromRgb(src.data[idx], src.data[idx + 1], src.data[idx + 2]), { x, y, width: canvas.width, height: canvas.height });
  }

  if (!imageUrl) {
    return <div className="drop-hint">Upload your handmade map or load the included island example.</div>;
  }
  return (
    <div className="map-picker">
      {loadState.loading && <div className="map-status">Loading map…</div>}
      {showMatch && <div className="map-status match">Matching preview is ON — cyan tint shows the selected color</div>}
      {loadState.error && <div className="banner error">{loadState.error}</div>}
      <canvas
        className="map-canvas pixel"
        ref={canvasRef}
        onClick={click}
        title="Pixel-perfect color picker"
        style={{ display: loadState.width ? 'block' : 'none' }}
      />
      {!loadState.width && !loadState.error && <div className="drop-hint">Preparing image preview…</div>}
      <p className="small muted">
        {loadState.width ? `${loadState.width} × ${loadState.height}px · ` : ''}
        Pixel-perfect picker: the app samples the original image pixel, not a scaled preview.
      </p>
    </div>
  );
}
