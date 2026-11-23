import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';

const HOURS = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'));
const MINUTES = ['00', '10', '15', '20', '30', '40', '45', '50'];

// Next / previous value in a cyclic list; a value outside the list (e.g. a stored 13:05) moves to its neighbour.
function step(list: string[], current: string, direction: 1 | -1) {
  const index = list.indexOf(current);
  if (index >= 0) return list[(index + direction + list.length) % list.length];
  const after = list.findIndex(item => item > current);
  if (direction === 1) return list[after < 0 ? 0 : after];
  return list[after < 0 ? list.length - 1 : (after - 1 + list.length) % list.length];
}

// (preventDefault on clicks: inside a <label>, the browser would otherwise forward clicks to the first list button.)
// Shared 24-hour time picker: click opens hour / minute lists; the mouse wheel or arrow keys change HH and MM
// separately (HH 00–23 and MM 00/10/15/20/30/40/45/50, both wrapping around).
export function TimePicker({ value, onChange, disabled = false, label }: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string }) {
  const [hour = '00', minute = '00'] = (value || '00:00').split(':');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), hourPart = useRef<HTMLSpanElement>(null), minutePart = useRef<HTMLSpanElement>(null);
  const latest = useRef({ hour, minute, disabled, onChange }); latest.current = { hour, minute, disabled, onChange };
  const set = (nextHour: string, nextMinute: string) => { if (`${nextHour}:${nextMinute}` !== value) onChange(`${nextHour}:${nextMinute}`); };
  // Native non-passive wheel listeners so the page does not scroll while adjusting the time.
  useEffect(() => {
    const attach = (node: HTMLElement | null, part: 'hour' | 'minute') => {
      if (!node) return () => {};
      const wheel = (event: WheelEvent) => {
        const { hour, minute, disabled, onChange } = latest.current;
        if (disabled || !event.deltaY) return;
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : -1;
        onChange(part === 'hour' ? `${step(HOURS, hour, direction)}:${minute}` : `${hour}:${step(MINUTES, minute, direction)}`);
      };
      node.addEventListener('wheel', wheel, { passive: false });
      return () => node.removeEventListener('wheel', wheel);
    };
    const detachHour = attach(hourPart.current, 'hour'), detachMinute = attach(minutePart.current, 'minute');
    return () => { detachHour(); detachMinute(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  // Show the selected hour / minute in the middle of each list when it opens.
  useEffect(() => {
    if (!open) return;
    root.current?.querySelectorAll<HTMLElement>('.time-picker-lists [aria-selected=true]').forEach(option => { const list = option.parentElement!; list.scrollTop = option.offsetTop - list.clientHeight / 2 + option.offsetHeight / 2; });
  }, [open]);
  const keys = (part: 'hour' | 'minute') => (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(!open); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? 1 : -1;
    if (part === 'hour') set(step(HOURS, hour, direction), minute); else set(hour, step(MINUTES, minute, direction));
  };
  return <div ref={root} className={`time-picker${disabled ? ' time-picker-disabled' : ''}${open ? ' time-picker-open' : ''}`} onClick={event => { event.preventDefault(); if (!disabled) setOpen(!open); }}>
    <span ref={hourPart} className="time-picker-part" role="spinbutton" tabIndex={disabled ? -1 : 0} aria-label={`${label} ${t('小时')}`} aria-valuenow={Number(hour)} aria-valuemin={0} aria-valuemax={23} aria-disabled={disabled} onKeyDown={keys('hour')}>{hour}</span>
    <span aria-hidden="true">:</span>
    <span ref={minutePart} className="time-picker-part" role="spinbutton" tabIndex={disabled ? -1 : 0} aria-label={`${label} ${t('分钟')}`} aria-valuenow={Number(minute)} aria-valuemin={0} aria-valuemax={59} aria-disabled={disabled} onKeyDown={keys('minute')}>{minute}</span>
    {open && <div className="time-picker-lists" onClick={event => { event.preventDefault(); event.stopPropagation(); }}>
      <div role="listbox" aria-label={`${label} ${t('小时')}`}>{HOURS.map(item => <button type="button" key={item} role="option" aria-selected={item === hour} onClick={() => set(item, minute)}>{item}</button>)}</div>
      <div role="listbox" aria-label={`${label} ${t('分钟')}`}>{MINUTES.map(item => <button type="button" key={item} role="option" aria-selected={item === minute} onClick={() => { set(hour, item); setOpen(false); }}>{item}</button>)}</div>
    </div>}
  </div>;
}
