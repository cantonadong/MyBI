import { useRef } from 'react';
import { t } from './i18n';
import type { AnnotationFields } from './dashboard';

export type AnnotationRole = keyof AnnotationFields;
const labels = { start: '开始日期', end: '结束日期', label: '标签' };

export function AnnotationImport({ checked, order, busy, onChecked, onOrder }: { checked: boolean; order: AnnotationRole[]; busy: boolean; onChecked: (value: boolean) => void; onOrder: (value: AnnotationRole[]) => void }) {
  const dragging = useRef(false);
  const moveLabel = (index: number) => { const next: AnnotationRole[] = order.filter(role => role !== 'label'); next.splice(index, 0, 'label'); onOrder(next); };
  return <div className="annotation-import">
    <label><input type="checkbox" checked={checked} disabled={busy} onChange={event => onChecked(event.target.checked)} />{t('作为 annotation')}</label>
    {checked && <><p className="source-hint">{t('拖拽标签表头调整列顺序；日期允许 NULL，表示无边界。')}</p>
      <table className="annotation-headers"><thead><tr>{order.map((role, index) => <th key={role} onDragOver={event => { if (dragging.current && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => { if (!dragging.current || busy) return; event.preventDefault(); event.stopPropagation(); moveLabel(index); dragging.current = false; }}>
        {role === 'label' ? <button type="button" draggable={!busy} disabled={busy} title={t('拖拽或用左右方向键移动标签')} onDragStart={event => { dragging.current = true; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', 'annotation-label'); }} onDragEnd={() => { dragging.current = false; }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveLabel(Math.max(0, Math.min(2, index + (event.key === 'ArrowLeft' ? -1 : 1)))); } }}>⠿ {t(labels[role])}</button> : t(labels[role])}
      </th>)}</tr></thead></table>
    </>}
  </div>;
}
