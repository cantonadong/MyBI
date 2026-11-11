import { Pagination } from './Pagination';
import { t } from "./i18n";
import { useLayoutEffect, useRef, useState } from 'react';
import { FieldFormat, FieldFormats, formatField, dateFormats } from './fieldDisplay';

import { Icon } from './Icon';
import type { AnnotationRole } from './AnnotationImport';

type SettingField = { name: string; type: string; source?: string };
export function FieldSettings({ schema, rows, typeIssues = {}, formats = {}, busy = false, readOnly = false, defaultDecimals = 1, defaultRounding = 'halfExpand', onChange, onRename, onReorder, onEditValues, onRemove, annotationRoles, onAnnotationRole, preserveOrder = false, configuration = !!onRename }: {
  schema: SettingField[]; rows: Record<string, unknown>[]; typeIssues?: Record<string, string[]>; formats?: FieldFormats; busy?: boolean; readOnly?: boolean; defaultDecimals?: number; defaultRounding?: FieldFormat['rounding'];
  onChange: (field: string, type: string, format: FieldFormat) => void;
  onRename?: (index: number, name: string) => void;
  onRemove?: (index: number) => void;
  annotationRoles?: AnnotationRole[];
  onAnnotationRole?: (index: number, role: AnnotationRole) => void;
  onReorder?: (schema: SettingField[]) => void;
  configuration?: boolean;
  preserveOrder?: boolean;
  onEditValues?: (field: string) => void;
}) {
  const draggedField = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const positions = useRef(new Map<string, number>());
  const ordered = preserveOrder ? schema : [...schema].sort((a, b) => Number(['number', 'integer'].includes(a.type)) - Number(['number', 'integer'].includes(b.type)));
  const [requestedPage, setPage] = useState(0);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(ordered.length / 10) - 1));
  const dimensionCount = ordered.filter(field => !['number', 'integer'].includes(field.type)).length;
  useLayoutEffect(() => {
    table.current?.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(row => {
      const previous = positions.current.get(row.dataset.field!);
      if (previous !== undefined) {
        const offset = previous - row.getBoundingClientRect().top;
        if (offset && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.22,1.15,.36,1)' });
      }
    });
    positions.current.clear();
  }, [schema]);
  const move = (field: SettingField, target: SettingField) => {
    if (busy || field === target || ['number', 'integer'].includes(field.type) !== ['number', 'integer'].includes(target.type)) return;
    const next = ordered.filter(item => item !== field);
    next.splice(ordered.indexOf(target), 0, field);
    table.current?.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(row => {
      positions.current.set(row.dataset.field!, row.getBoundingClientRect().top);
      row.getAnimations().forEach(animation => animation.cancel());
    });
    onReorder?.(next);
  };
  return <div className="field-settings-scroll" tabIndex={0} aria-label={t("字段配置与样本预览")}><table ref={table} className={`field-settings-table${configuration ? ' field-settings-numbered' : ''}`}><thead><tr>{configuration && <th>{t('序号')}</th>}{configuration && <th>{t("源字段")}</th>}{annotationRoles && <th>{t("Annotation 字段")}</th>}<th>{configuration ? t("展示名称") : t("字段")}</th><th>{t("数据类型")}</th><th>{t("格式")}</th><th>{t("小数位")}</th>{Array.from({ length: configuration ? 1 : 5 }, (_, i) => <th key={i}>{configuration ? t("数据") : t("样本 {0}", i + 1)}</th>)}</tr></thead><tbody>{ordered.slice(page * 10, (page + 1) * 10).map((field, row) => {
    const position = page * 10 + row;
    const index = schema.indexOf(field);
    const key = field.source || field.name;
    const issue = typeIssues[key] || typeIssues[field.name];
    const handle = onReorder && <button className="field-drag-handle" aria-label={t("调整 {0} 顺序", key)} title={t("拖拽调整组内顺序；方向键上下移动")} disabled={busy || readOnly} draggable={!busy} onDragStart={e => { draggedField.current = key; setDragging(key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); }} onDragEnd={() => { draggedField.current = null; setDragging(null); }} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const target = ordered[ordered.indexOf(field) + (e.key === 'ArrowUp' ? -1 : 1)]; if (target) move(field, target); } }}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="2" r="1" fill="currentColor" /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="10" r="1" fill="currentColor" /></svg></button>;
    const numeric = ['number', 'integer'].includes(field.type);
    const saved = formats[key];
    const format: FieldFormat = saved || { kind: field.type === 'integer' ? 'integer' : numeric ? 'decimal' : 'text', format: 'number', rounding: defaultRounding, decimals: field.type === 'integer' ? 0 : defaultDecimals };
    const subtype = format.format === 'percent' ? 'percent' : format.kind === 'integer' ? 'integer' : 'decimal';
    const decimals = Math.max(1, Math.min(4, format.decimals));
    return <tr key={key} data-field={key} className={`${numeric ? 'field-numeric' : 'field-dimension'} ${dragging === key ? 'field-dragging' : ''}`} onDragOver={e => {
      const moving = ordered.find(item => (item.source || item.name) === draggedField.current);
      if (!onReorder || busy || !moving || ['number', 'integer'].includes(moving.type) !== numeric) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const from = ordered.indexOf(moving), to = ordered.indexOf(field);
      const bounds = e.currentTarget.getBoundingClientRect();
      const animationOffset = new DOMMatrixReadOnly(getComputedStyle(e.currentTarget).transform).m42;
      const midpoint = bounds.top - animationOffset + bounds.height / 2;
      if ((from < to && e.clientY >= midpoint) || (from > to && e.clientY <= midpoint)) move(moving, field);
    }} onDrop={e => { e.preventDefault(); e.stopPropagation(); draggedField.current = null; setDragging(null); }}>{configuration && <td>{!preserveOrder && numeric ? position - dimensionCount + 1 : position + 1}</td>}{configuration && <th className="field-source" scope="row" title={key}>{handle}{key}{onRemove && <button className="field-drag-handle field-remove" disabled={busy || schema.length <= 1} aria-label={t('舍弃字段 {0}', key)} onClick={() => onRemove(index)}><Icon name="remove" /></button>}</th>}{annotationRoles && <td><select aria-label={key + " " + t("Annotation 字段")} disabled={busy || readOnly} value={annotationRoles[index] || ""} onChange={event => onAnnotationRole?.(index, event.target.value as AnnotationRole)}><option value="" disabled>{t("不作为 Annotation")}</option>{(["start", "end", "label"] as const).map(role => <option key={role} value={role}>{t({ start: "开始日期", end: "结束日期", label: "标签" }[role])}</option>)}</select></td>}<td>{configuration ? <div className="field-name-control"><input readOnly={readOnly || !onRename} aria-label={t("列名 {0}", index + 1)} disabled={busy || readOnly} value={field.name} onChange={e => onRename?.(index, e.target.value)} />{!numeric && onEditValues && <button className="field-value-settings" disabled={busy || readOnly} aria-label={t('设置 {0} 的显示对应关系', key)} title={t('值与显示名称')} onClick={() => onEditValues(key)}><Icon name="settings" /></button>}</div> : <>{handle}{field.name}</>}</td><td><select aria-label={key + t(" 字段类型")} disabled={busy || readOnly} value={numeric ? 'number' : field.type} onChange={e => {
      const type = e.target.value;
      onChange(key, type, { kind: type === 'number' ? 'decimal' : 'text', format: 'number', rounding: defaultRounding, decimals: type === 'number' ? defaultDecimals : 0, ...(type === 'date' ? { dateFormat: 'MMM d' } : {}) });
    }}><option value="string">{t("文本")}</option><option value="date">{t("日期")}</option><option value="number">{t("数值")}</option></select></td><td>{numeric && <select aria-label={key + t(" 数值类型")} disabled={busy || readOnly} value={subtype} onChange={e => {
      const next = e.target.value;
      onChange(key, field.type, { kind: next === 'integer' ? 'integer' : 'decimal', format: next === 'percent' ? 'percent' : 'number', rounding: format.rounding || defaultRounding, decimals: next === 'integer' ? 0 : subtype === 'integer' ? defaultDecimals : decimals });
    }}><option value="integer">{t("整数")}</option><option value="decimal">{t("小数")}</option><option value="percent">{t("百分比")}</option></select>}{field.type === 'date' && <select aria-label={key + t('日期格式')} disabled={busy || readOnly} value={format.dateFormat || 'MMM d'} onChange={event => onChange(key, field.type, { ...format, kind: 'text', format: 'number', decimals: 0, dateFormat: event.target.value })}>{dateFormats.map(pattern => <option key={pattern} value={pattern}>{formatField('2026-10-11', { kind: 'text', format: 'number', decimals: 0, dateFormat: pattern })} ({pattern})</option>)}</select>}</td><td>{numeric && subtype !== 'integer' ? <select aria-label={key + t(" 小数位数")} disabled={busy || readOnly} value={decimals} onChange={e => onChange(key, field.type, { ...format, decimals: Number(e.target.value) })}>{Array.from({ length: 4 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> : configuration && <span className="empty-decimals" aria-hidden="true" />}</td>{Array.from({ length: configuration ? 1 : 5 }, (_, i) => <td className="field-sample" key={i}>{issue && i === 0 ? <span className="field-type-issue">{issue.join(', ')}</span> : i < rows.length ? formatField(rows[i][key], numeric ? { ...format, decimals: subtype === 'integer' ? 0 : decimals } : field.type === 'date' ? { ...format, dateFormat: format.dateFormat || 'MMM d' } : { kind: 'text', format: 'number', decimals: 0 }) : '—'}</td>)}</tr>;
  })}</tbody></table><Pagination page={page} total={ordered.length} onChange={setPage} disabled={busy} /></div>;
}

