import { useEffect, useRef, useState } from 'react';
import { getChartLocale, t, translate } from './i18n';
import { tabTitle } from './dashboard';
import { Icon } from './Icon';
import type { ReportTab } from './dashboard';

export function ReportTabs({ tabs, activeId, readOnly = false, onSelect, onCreate, onCopy, onRename, onDelete, onReorder }: { tabs: ReportTab[]; activeId: string; readOnly?: boolean; onSelect: (id: string) => void; onCreate: (name: string) => void; onCopy: (id: string) => void; onRename: (id: string, name: string) => void; onDelete: (id: string) => void; onReorder: (ids: string[]) => void }) {
  // Tabs are reordered by dragging rows in the tab picker; the order is previewed locally and committed once on drop.
  const [order, setOrder] = useState<string[] | null>(null);
  const dragged = useRef('');
  const ordered = order ? order.map(id => tabs.find(tab => tab.id === id)).filter((tab): tab is ReportTab => !!tab) : tabs;
  const move = (id: string, offset: number) => {
    const ids = tabs.map(tab => tab.id), from = ids.indexOf(id), to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1); ids.splice(to, 0, id); onReorder(ids);
  };
  const [action, setAction] = useState<{ kind: 'new' | 'rename' | 'delete'; tab?: ReportTab } | null>(null);
  const [name, setName] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDetailsElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const scrollbarTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(scrollbarTimer.current), []);
  useEffect(() => {
    const list = tabList.current;
    if (!list) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || list.scrollWidth <= list.clientWidth) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1;
      event.preventDefault();
      list.scrollLeft += event.deltaY * scale;
    };
    list.addEventListener('wheel', wheel, { passive: false });
    return () => list.removeEventListener('wheel', wheel);
  }, [readOnly, tabs.length]);
  // Center the active tab without moving the report itself.
  useEffect(() => {
    const button = activeButton.current, list = button?.closest<HTMLElement>('.report-tab-list');
    if (!button) return;
    if (!list) { button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
    const tab = button.getBoundingClientRect(), view = list.getBoundingClientRect();
    const left = activeId === tabs[0]?.id ? 0 : list.scrollLeft + tab.left - view.left + (tab.width - view.width) / 2;
    list.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [activeId, tabs[0]?.id]);
  useEffect(() => { if (action) dialog.current?.showModal(); }, [action]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (picker.current && !picker.current.contains(event.target as Node)) picker.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const edit = (kind: 'new' | 'rename' | 'delete', tab?: ReportTab) => {
    if (picker.current) picker.current.open = false;
    const number = Math.max(tabs.length, ...tabs.map(item => Number(item.name.match(/^(?:标签页|Tab)\s*(\d+)$/i)?.[1]) || 0)) + 1;
    setName(tab?.name || translate(getChartLocale(), '标签页 {0}', [number]));
    setAction({ kind, tab });
  };
  const title = action?.kind === 'delete' ? t('删除标签页') : action?.kind === 'rename' ? t('重命名标签页') : t('新建标签页');
  if (readOnly && tabs.length === 1) return null;
  return <>
    <nav className={`report-tabs ${readOnly ? 'report-tabs-top' : 'report-tabs-bottom'}`} aria-label={t('报表标签页')}
      onTouchStart={readOnly ? event => event.currentTarget.classList.add('report-tabs-touching') : undefined}
      onTouchEnd={readOnly ? event => event.currentTarget.classList.remove('report-tabs-touching') : undefined}
      onTouchCancel={readOnly ? event => event.currentTarget.classList.remove('report-tabs-touching') : undefined}>
      {!readOnly && <><button type="button" className="import-button report-tab-add square-add-button" title={t('新建标签页')} aria-label={t('新建标签页')} onClick={() => edit('new')}><Icon name="add" /></button><div className="working-dataset"><details ref={picker} className="dataset-picker report-tab-picker" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary id={'report-tab-' + activeId} aria-controls="report-tab-panel" aria-label={t('选择标签页')}><span>{tabs.find(tab => tab.id === activeId)?.name}</span><img src="/import-icons/chevron-down.svg" alt="" /></summary><div className="dataset-options footer-picker-options report-tab-options">{ordered.map(tab => <div className={`report-tab-option ${order && dragged.current === tab.id ? 'tab-dragging' : ''}`} key={tab.id} draggable onDragStart={event => { dragged.current = tab.id; setOrder(tabs.map(item => item.id)); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.id); }} onDragOver={event => {
            if (!order || !dragged.current) return;
            event.preventDefault(); event.dataTransfer.dropEffect = 'move';
            const from = order.indexOf(dragged.current), to = order.indexOf(tab.id);
            if (from === to) return;
            const bounds = event.currentTarget.getBoundingClientRect(), middle = bounds.top + bounds.height / 2;
            if ((from < to && event.clientY >= middle) || (from > to && event.clientY <= middle)) { const next = [...order]; next.splice(from, 1); next.splice(to, 0, dragged.current); setOrder(next); }
          }} onDrop={event => event.preventDefault()} onDragEnd={() => { if (order && order.join() !== tabs.map(item => item.id).join()) onReorder(order); dragged.current = ''; setOrder(null); }}><button aria-pressed={tab.id === activeId} title={tabTitle(tab.name)} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onKeyDown={event => { if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); move(tab.id, event.key === 'ArrowUp' ? -1 : 1); } }} onClick={() => { onSelect(tab.id); if (picker.current) { picker.current.open = false; picker.current.querySelector('summary')?.focus(); } }}><span className="dataset-option-name">{tabTitle(tab.name)}</span></button><div className="report-tab-actions"><button type="button" title={t('复制标签页')} aria-label={t('复制标签页 {0}', tab.name)} onClick={() => { if (picker.current) picker.current.open = false; onCopy(tab.id); }}><Icon name="copy" /></button><span className="report-tab-grip" aria-hidden="true" title={t('拖拽调整标签页顺序')}><Icon name="grip" /></span></div></div>)}</div></details><button type="button" className="dataset-configure" title={t('重命名标签页')} aria-label={t('重命名标签页')} onClick={() => edit('rename', tabs.find(tab => tab.id === activeId))}><Icon name="settings" /></button><button type="button" className="remove-dataset" disabled={tabs.length === 1} title={t('删除标签页')} aria-label={t('删除标签页')} onClick={() => edit('delete', tabs.find(tab => tab.id === activeId))}><Icon name="close" /></button></div></>}
      {readOnly && <div ref={tabList} className="report-tab-list" role="tablist" aria-label={t('报表标签页')} onScroll={event => {
        const list = event.currentTarget;
        const scale = list.clientWidth / list.scrollWidth;
        if (scale >= 1) return;
        list.parentElement?.style.setProperty('--tab-scroll-width', `${list.clientWidth * scale}px`);
        list.parentElement?.style.setProperty('--tab-scroll-left', `${list.offsetLeft + list.scrollLeft * scale}px`);
        list.classList.add('report-tabs-scrolling');
        window.clearTimeout(scrollbarTimer.current);
        scrollbarTimer.current = window.setTimeout(() => list.classList.remove('report-tabs-scrolling'), 150);
      }}>
        {tabs.map((tab, index) => <div className={`report-tab-item ${tab.id === activeId ? 'active' : ''}`} key={tab.id}>
          <button ref={tab.id === activeId ? activeButton : undefined} id={'report-tab-' + tab.id} type="button" role="tab" aria-selected={tab.id === activeId} aria-controls="report-tab-panel" tabIndex={tab.id === activeId ? 0 : -1} title={tabTitle(tab.name)} onClick={() => onSelect(tab.id)} onDoubleClick={() => { if (!readOnly) edit('rename', tab); }} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); onSelect(tabs[next].id);
            document.getElementById('report-tab-' + tabs[next].id)?.focus({ preventScroll: true });
          }}><span>{tabTitle(tab.name)}</span></button>
        </div>)}
      </div>}
    </nav>
    {action && <dialog ref={dialog} className="modal report-tab-dialog" aria-label={title} onCancel={event => { event.preventDefault(); setAction(null); }}><form onSubmit={event => {
      event.preventDefault();
      if (action.kind === 'delete') onDelete(action.tab!.id);
      else if (name.trim()) {
        if (action.kind === 'new') onCreate(name.trim());
        else onRename(action.tab!.id, name.trim());
      } else return;
      setAction(null);
    }}><h3>{title}</h3>{action.kind === 'delete' ? <p>{t('删除标签页“{0}”及其中的所有图表？', action.tab!.name)}</p> : <label>{t('标签页名称')}<input autoFocus required maxLength={80} value={name} onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)} /></label>}<div className="modal-actions"><button type="button" onClick={() => setAction(null)}>{t('取消')}</button><button className="primary" disabled={action.kind !== 'delete' && !name.trim()}>{action.kind === 'delete' ? t('删除') : t('保存')}</button></div></form></dialog>}
  </>;
}
