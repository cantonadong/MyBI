import { useEffect, useRef, useState } from 'react';
import { getChartLocale, t, translate } from './i18n';
import { tabTitle } from './dashboard';
import { Icon } from './Icon';
import type { ReportTab } from './dashboard';

export function ReportTabs({ tabs, activeId, readOnly = false, onSelect, onCreate, onCopy, onRename, onDelete }: { tabs: ReportTab[]; activeId: string; readOnly?: boolean; onSelect: (id: string) => void; onCreate: (name: string) => void; onCopy: (id: string) => void; onRename: (id: string, name: string) => void; onDelete: (id: string) => void }) {
  const [action, setAction] = useState<{ kind: 'new' | 'rename' | 'delete'; tab?: ReportTab } | null>(null);
  const [name, setName] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDetailsElement>(null);
  // Keep the active tab visible by scrolling only the tab list (scrollIntoView would also move the page around it).
  useEffect(() => {
    const button = activeButton.current, list = button?.closest<HTMLElement>('.report-tab-list');
    if (!button) return;
    if (!list) { button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
    const tab = button.getBoundingClientRect(), view = list.getBoundingClientRect();
    if (tab.left < view.left) list.scrollLeft -= view.left - tab.left;
    else if (tab.right > view.right) list.scrollLeft += tab.right - view.right;
  }, [activeId]);
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
    <nav className={`report-tabs ${readOnly ? 'report-tabs-top' : 'report-tabs-bottom'}`} aria-label={t('报表标签页')}>
      {!readOnly && <><button type="button" className="import-button report-tab-add square-add-button" title={t('新建标签页')} aria-label={t('新建标签页')} onClick={() => edit('new')}><Icon name="add" /></button><div className="working-dataset"><details ref={picker} className="dataset-picker report-tab-picker" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary id={'report-tab-' + activeId} aria-controls="report-tab-panel" aria-label={t('选择标签页')}><span>{tabs.find(tab => tab.id === activeId)?.name}</span><img src="/import-icons/chevron-down.svg" alt="" /></summary><div className="dataset-options report-tab-options">{tabs.map(tab => <div className="report-tab-option" key={tab.id}><button aria-pressed={tab.id === activeId} title={tabTitle(tab.name)} onClick={() => { onSelect(tab.id); if (picker.current) { picker.current.open = false; picker.current.querySelector('summary')?.focus(); } }}>{tabTitle(tab.name)}</button><div className="report-tab-actions"><button type="button" title={t('复制标签页')} aria-label={t('复制标签页 {0}', tab.name)} onClick={() => { if (picker.current) picker.current.open = false; onCopy(tab.id); }}><Icon name="copy" /></button><button type="button" title={t('重命名标签页')} aria-label={t('重命名标签页 {0}', tab.name)} onClick={() => edit('rename', tab)}><Icon name="edit" /></button><button type="button" disabled={tabs.length === 1} title={t('删除标签页')} aria-label={t('删除标签页 {0}', tab.name)} onClick={() => edit('delete', tab)}><Icon name="close" /></button></div></div>)}</div></details><button type="button" className="dataset-configure" title={t('复制标签页')} aria-label={t('复制标签页')} onClick={() => onCopy(activeId)}><Icon name="copy" /></button><button type="button" className="dataset-configure" title={t('重命名标签页')} aria-label={t('重命名标签页')} onClick={() => edit('rename', tabs.find(tab => tab.id === activeId))}><Icon name="settings" /></button><button type="button" className="remove-dataset" disabled={tabs.length === 1} title={t('删除标签页')} aria-label={t('删除标签页')} onClick={() => edit('delete', tabs.find(tab => tab.id === activeId))}><Icon name="close" /></button></div></>}
      {readOnly && <div className="report-tab-list" role="tablist" aria-label={t('报表标签页')}>
        {tabs.map((tab, index) => <div className={`report-tab-item ${tab.id === activeId ? 'active' : ''}`} key={tab.id}>
          <button ref={tab.id === activeId ? activeButton : undefined} id={'report-tab-' + tab.id} type="button" role="tab" aria-selected={tab.id === activeId} aria-controls="report-tab-panel" tabIndex={tab.id === activeId ? 0 : -1} title={tabTitle(tab.name)} onClick={() => onSelect(tab.id)} onDoubleClick={() => { if (!readOnly) edit('rename', tab); }} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); onSelect(tabs[next].id);
            document.getElementById('report-tab-' + tabs[next].id)?.focus();
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
