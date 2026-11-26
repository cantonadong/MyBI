import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { t } from './i18n';
import type { DatasetFolder } from './dashboard';

type Entry = { id: string; name: string; tag: ReactNode; unused: boolean };
type DatasetDrag = { id: string; pointerId: number; x: number; y: number; active: boolean };
export function DatasetFolderMenu({ entries, folders, activeTabId, activeId, onSelect, onChange, onReorder }: {
  entries: Entry[];
  folders: DatasetFolder[];
  activeTabId: string;
  activeId?: string;
  onSelect: (id: string) => void;
  onChange: (folders: DatasetFolder[]) => void;
  onReorder: (from: string, to: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState([activeTabId]);
  const [draggedId, setDraggedId] = useState('');
  const [target, setTarget] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<DatasetDrag | null>(null);
  const frame = useRef(0);
  useEffect(() => {
    const element = menu.current!;
    const wheel = (event: WheelEvent) => {
      if (!drag.current?.active || !list.current) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 34 : event.deltaMode === 2 ? list.current.clientHeight : 1;
      list.current.scrollTop += event.deltaY * scale;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const searchable = entries.length + folders.length > 10;
  const query = searchable && !draggedId ? search.trim().toLocaleLowerCase() : '';
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  const folderOf = (id: string) => folders.find(folder => folder.datasetIds.includes(id))?.id;
  const members = (folder: DatasetFolder) => entries.filter(entry => folder.datasetIds.includes(entry.id));
  const root = entries.filter(entry => !folderOf(entry.id));
  const move = (id: string, folderId?: string) => {
    if (folderOf(id) === folderId) return;
    onChange(folders.map(folder => folder.id === folderId ? { ...folder, datasetIds: [...folder.datasetIds, id] } :
      folder.datasetIds.includes(id) ? { ...folder, datasetIds: folder.datasetIds.filter(item => item !== id) } : folder));
    if (folderId) setExpanded(items => items.includes(folderId) ? items : [...items, folderId]);
  };
  const endDrag = () => {
    drag.current = null;
    cancelAnimationFrame(frame.current);
    setDraggedId('');
    setTarget('');
  };
  const hitTarget = (x: number, y: number) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-dataset-drop]');
    return row && menu.current?.contains(row) ? row.dataset.datasetDrop || '' : '';
  };
  const scrollDrag = () => {
    const current = drag.current, scroller = list.current;
    if (!current?.active || !scroller) return;
    const { x, y, id } = current;
    const { top, bottom, left, right, height } = scroller.getBoundingClientRect();
    if (x >= left && x <= right && y >= top - 24 && y <= bottom + 24) {
      const edge = Math.min(28, height / 2);
      if (y < top + edge) scroller.scrollTop -= Math.min(14, (top + edge - y) / 2);
      else if (y > bottom - edge) scroller.scrollTop += Math.min(14, (y - bottom + edge) / 2);
    }
    const hit = hitTarget(x, y);
    setTarget(hit === id ? '' : hit);
    frame.current = requestAnimationFrame(scrollDrag);
  };
  const trackDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
      current.active = true;
      setDraggedId(current.id);
      frame.current = requestAnimationFrame(scrollDrag);
    }
    current.x = event.clientX;
    current.y = event.clientY;
  };
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.active) {
      const hit = hitTarget(event.clientX, event.clientY);
      if (hit === 'root') move(current.id);
      else if (folders.some(folder => folder.id === hit)) move(current.id, hit);
      else if (hit && hit !== current.id) {
        const folderId = folderOf(hit);
        if (folderId === folderOf(current.id)) onReorder(current.id, hit);
        else move(current.id, folderId);
      }
    }
    endDrag();
  };
  const dropZone = (key: string) => ({
    'data-dataset-drop': key,
    'data-drop-target': target === key || undefined,
  });
  const datasetRow = (entry: Entry, siblings: Entry[], folderId?: string) =>
    <button key={entry.id} type="button" className={folderId ? 'dataset-folder-member' : undefined}
      aria-pressed={activeId === entry.id} title={entry.name}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        drag.current = { id: entry.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      }}
      {...dropZone(entry.id)}
      onKeyDown={event => {
        if (!event.altKey) return;
        if (event.key === 'ArrowLeft' && folderId) { event.preventDefault(); move(entry.id); }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const next = siblings[siblings.indexOf(entry) + (event.key === 'ArrowUp' ? -1 : 1)];
          if (next) onReorder(entry.id, next.id);
        }
      }}
      onClick={() => onSelect(entry.id)}>
      {entry.tag}<span className="dataset-option-caption">
        <span className="dataset-option-name">{entry.name}</span>
        {entry.unused && <span className="dataset-label dataset-unused-label">{t('未用')}</span>}
      </span>
      <span className="report-tab-grip" aria-hidden="true"><Icon name="grip" /></span>
    </button>;
  return (
    <div ref={menu} tabIndex={-1} className="dataset-options footer-picker-options dataset-order-options dataset-folder-menu"
      data-dragging={!!draggedId || undefined} onPointerMove={trackDrag} onPointerUp={finishDrag}
      onPointerCancel={endDrag} onLostPointerCapture={event => { if (event.target === event.currentTarget) endDrag(); }}
      onPointerLeave={() => { if (!drag.current?.active) drag.current = null; }}
      onDragStart={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'Escape' && drag.current?.active) { event.stopPropagation(); endDrag(); }
      }}>
      {draggedId && folderOf(draggedId) && <div className="dataset-root-drop" {...dropZone('root')}>{t('移到顶层列表')}</div>}
      {searchable && <input type="search" aria-label={t('搜索数据集和文件夹')} placeholder={t('搜索数据集和文件夹')} value={search} onChange={event => setSearch(event.target.value)} />}
      <div ref={list} className="dataset-folder-list">
        {folders.map(folder => {
          const children = members(folder);
          const visible = matches(folder.name) ? children : children.filter(entry => matches(entry.name));
          if (!matches(folder.name) && !visible.length) return null;
          const open = !draggedId && (expanded.includes(folder.id) || !!query);
          return <div key={folder.id}>
            <button type="button" className="dataset-folder-row" aria-expanded={open} title={folder.name}
              {...dropZone(folder.id)}
              onClick={() => setExpanded(items => open ? items.filter(id => id !== folder.id) : [...items, folder.id])}>
              <img src="/import-icons/chevron-down.svg" alt="" /><Icon name="folder" /><span className="dataset-option-name">{folder.name}</span>
            </button>
            {open && visible.map(entry => datasetRow(entry, children, folder.id))}
          </div>;
        })}
        {root.filter(entry => matches(entry.name)).map(entry => datasetRow(entry, root))}
      </div>
    </div>
  );
}
