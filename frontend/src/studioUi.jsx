import React, { useEffect, useRef, useState } from 'react';

export function PageTitle({ eyebrow, title, children }) {
  return (
    <section className="studio-page-title">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className="studio-page-heading">{title}</h2>
      {children && <p className="studio-page-lede">{children}</p>}
    </section>
  );
}

export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={value === opt.id ? 'active' : ''}
          onClick={() => onChange(opt.id)}
          title={opt.title}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function WorkflowSteps({ steps }) {
  return (
    <ol className="workflow-steps" aria-label="Heights workflow">
      {steps.map((step) => (
        <li key={step.id} className={step.done ? 'done' : step.active ? 'active' : ''}>
          <span className="workflow-step-index">{step.index}</span>
          <span className="workflow-step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function InspectorPanel({ eyebrow, title, children }) {
  return (
    <aside className="heights-inspector">
      <div className="panel-header">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        {title && <h3>{title}</h3>}
      </div>
      {children}
    </aside>
  );
}

export function HelpModal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="studio-help-backdrop" onClick={onClose} role="presentation">
      <div
        className="studio-help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="studio-help-close" onClick={onClose} aria-label="Close help">×</button>
        <h3 id="studio-help-title">{title}</h3>
        {children}
        <button type="button" className="primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
  commitOnRelease = false,
}) {
  const [live, setLive] = useState(value);
  const liveRef = useRef(value);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) {
      setLive(value);
      liveRef.current = value;
    }
  }, [value]);

  function commit() {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    if (!commitOnRelease || !wasDragging) return;
    if (Math.abs(liveRef.current - value) > 1e-6) onChange(liveRef.current);
  }

  return (
    <label className={`slider ${commitOnRelease && live !== value ? 'is-pending' : ''}`}>
      <span>
        {label}
        <b>{live}{suffix}</b>
        {commitOnRelease && live !== value && <em className="slider-pending"> · release to apply</em>}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={live}
        onChange={(e) => {
          const v = Number(e.target.value);
          liveRef.current = v;
          setLive(v);
          if (!commitOnRelease) onChange(v);
        }}
        onPointerDown={() => { draggingRef.current = true; }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onBlur={() => { if (commitOnRelease) commit(); }}
        onKeyUp={(e) => {
          if (commitOnRelease && (e.key === 'Enter' || e.key === ' ')) commit();
        }}
      />
    </label>
  );
}

export function Swatch({ color, onClick }) {
  return <button type="button" className="swatch" style={{ background: color }} onClick={onClick} title={color} />;
}

export function CollapsibleSection({ title, defaultOpen = true, children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`collapsible-section ${className} ${open ? 'is-open' : ''}`}>
      <button type="button" className="collapsible-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{title}</span>
        <span className="collapsible-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
