import { useEffect, useId, useRef, useState } from 'react';
import { t } from './i18n';
import './search-select.css';

export type SearchOption = { value: string; label: string; search?: string };

export function SearchSelect({ value, options, onChange, label, placeholder, disabled, loading, onSearch }: {
  value: string; options: SearchOption[]; onChange: (value: string) => void; label: string;
  placeholder?: string; disabled?: boolean; loading?: boolean; onSearch?: (text: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);
  const visible = onSearch ? options : options.filter(option => `${option.label} ${option.search || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useEffect(() => {
    if (open && !query) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, query]);
  function choose(option: SearchOption) { onChange(option.value); setOpen(false); setQuery(''); }
  return <div className="search-select">
    <input role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={id}
      aria-activedescendant={open && visible[active] ? `${id}-${active}` : undefined}
      autoComplete="off" disabled={disabled} placeholder={placeholder} value={open ? query : selected?.label ?? value}
      onFocus={() => { setOpen(true); setQuery(''); setActive(-1); onSearch?.(''); }}
      onClick={() => { if (!open) { setQuery(''); setActive(-1); onSearch?.(''); } setOpen(true); }}
      onBlur={() => { setOpen(false); setQuery(''); }}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); onSearch?.(event.target.value); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive(index => visible.length ? event.key === 'ArrowDown' ? Math.min(index + 1, visible.length - 1) : index < 0 ? visible.length - 1 : Math.max(0, index - 1) : -1);
        } else if (event.key === 'Enter' && open) {
          event.preventDefault(); if (visible[active]) choose(visible[active]);
        } else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(''); }
      }} />
    {open && <div id={id} className="search-select-options" role="listbox" aria-label={label} aria-busy={loading} ref={list}>
      {visible.map((option, index) => <div id={`${id}-${index}`} key={option.value} role="option" aria-selected={option.value === value}
        className="search-select-option" data-active={index === active} onMouseEnter={() => setActive(index)}
        onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); event.stopPropagation(); choose(option); }}>{option.label}</div>)}
      {(loading || !visible.length) && <div className="search-select-status" role="status">{loading ? t('加载中…') : t('没有匹配选项')}</div>}
    </div>}
  </div>;
}
