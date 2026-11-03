import { t } from "./i18n";
import { Filter } from './dashboard';
export function Filters({ value, onChange, fields, fieldLabels = {} }: { value: Filter[]; onChange: (next: Filter[]) => void; fields: string[]; fieldLabels?: Record<string, string> }) {
  const patch = (index: number, next: Partial<Filter>) => onChange(value.map((item, i) => i === index ? { ...item, ...next } : item));
  return <div className="filter-editor">{value.map((filter, index) => <div className="filter-row" key={index}>
    <select aria-label={t("筛选字段 {0}", index + 1)} value={filter.field} onChange={e => patch(index, { field: e.target.value })}>{fields.map(field => <option key={field} value={field}>{fieldLabels[field] || field}</option>)}</select>
    <select aria-label={t("筛选类型 {0}", index + 1)} value={filter.op} onChange={e => patch(index, { op: e.target.value, value: e.target.value === 'between' ? ['', ''] : '' })}>
      <option value="eq">{t("单选 / 等于")}</option><option value="in">{t("多选（逗号分隔）")}</option><option value="contains">{t("文本包含")}</option><option value="between">{t("数值 / 日期范围")}</option><option value="is_null">{t("为空")}</option>
    </select>
    {filter.op === 'between' ? <div className="range-inputs">{[0, 1].map(i => <input key={i} aria-label={i ? t("上限") : t("下限")} value={String((filter.value as unknown[])?.[i] ?? '')} onChange={e => { const values = [...(Array.isArray(filter.value) ? filter.value : ['', ''])]; values[i] = e.target.value; patch(index, { value: values }); }} />)}</div> : filter.op !== 'is_null' && <input aria-label={t("筛选值 {0}", index + 1)} value={Array.isArray(filter.value) ? filter.value.join(',') : String(filter.value ?? '')} onChange={e => patch(index, { value: filter.op === 'in' ? e.target.value.split(',').map(v => v.trim()) : e.target.value })} />}
    <button onClick={() => onChange(value.filter((_, i) => i !== index))}>{t("删除条件")}</button>
  </div>)}<button className="add-filter" disabled={!fields.length} onClick={() => onChange([...value, { field: fields[0], op: 'contains', value: '' }])}>{t("＋ 添加筛选条件")}</button></div>;
}
