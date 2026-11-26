import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ChartDescription({ text, label }: { text: string; label: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number>();
  const [mode, setMode] = useState<'hover' | 'pinned' | null>(null);
  const keepHover = () => window.clearTimeout(hoverTimer.current);
  const closeHover = () => {
    keepHover();
    hoverTimer.current = window.setTimeout(() => setMode(value => value === 'hover' ? null : value), 150);
  };

  useEffect(() => {
    if (!mode) return;
    const closeOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (!tooltip.current?.contains(target) && !button.current?.contains(target)) setMode(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMode(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    window.addEventListener('scroll', closeOutside, true);
    window.addEventListener('resize', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      window.removeEventListener('scroll', closeOutside, true);
      window.removeEventListener('resize', closeOutside);
      document.removeEventListener('keydown', escape);
      window.clearTimeout(hoverTimer.current);
    };
  }, [mode]);

  const bounds = mode && button.current?.getBoundingClientRect();
  const above = bounds && bounds.bottom > window.innerHeight / 2;
  return <>
    <button ref={button} className="chart-description-trigger" type="button" aria-label={label}
      aria-describedby={mode ? id : undefined} aria-expanded={!!mode}
      onPointerEnter={event => {
        keepHover();
        if (event.pointerType === 'mouse') setMode(value => value || 'hover');
      }}
      onPointerLeave={closeHover} onBlur={closeHover}
      onClick={event => { event.stopPropagation(); setMode(value => value === 'pinned' ? null : 'pinned'); }}>?</button>
    {bounds && createPortal(
      <span ref={tooltip} id={id} className="chart-description-tooltip" role="tooltip"
        onPointerEnter={keepHover} onPointerLeave={closeHover} onClick={event => event.stopPropagation()}
        style={{
          left: Math.max(8, Math.min(bounds.left, window.innerWidth - 328)),
          ...(above ? { bottom: window.innerHeight - bounds.top + 4 } : { top: bounds.bottom + 4 }),
          maxHeight: Math.max(24, (above ? bounds.top : window.innerHeight - bounds.bottom) - 12),
        }}>{text}</span>,
      document.body,
    )}
  </>;
}
