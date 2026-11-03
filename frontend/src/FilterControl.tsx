import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, Dataset, Filter, Tile } from './dashboard';
import { ChartConfig } from './charts/registry';
import { formatChartField as formatField, parseCategoryOrder } from './fieldDisplay';
import { t, translate, useChartLanguage } from './i18n';

type Value = string | number | boolean | null;

function FilterChoices({ dataset, field, filters, values, tiled, multiple, disabled, sort, orderText, onChange, displayLocale }: { displayLocale?: 'en' | 'zh-CN'; dataset: Dataset; field: string; filters: Filter[]; values: Value[]; tiled: boolean; multiple: boolean; disabled: boolean; sort: ChartConfig['filterSort']; orderText: string; onChange: (values: Value[]) => void }) {
  const [options, setOptions] = useState<Value[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const { locale: defaultLocale } = useChartLanguage();
  const locale = displayLocale || defaultLocale;
  const t = (text: string, ...values: unknown[]) => translate(locale, text, values);
  const query = JSON.stringify({ snapshot_id: dataset.snapshot_id, fields: [field], filters, distinct: true, chart_type: 'filter', limit: 10000 });
  useEffect(() => {
    if (disabled || !field) { setOptions([]); return; }
    let active = true;
    setLoading(true); setError('');
    api(`/datasets/${dataset.id}/view-query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: query })
      .then(result => { if (active) setOptions(result.rows.map((row: Record<string, Value>) => row[field])); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dataset.id, dataset.version, field, query, disabled]);
  const label = (value: Value) => value === null ? t('（空）') : formatField(value, dataset.field_formats?.[field], locale);
  const choices = [...new Map([...options, ...values].map(value => [JSON.stringify(value), value])).values()];
  if (sort && sort !== 'none') {
    const ranks = parseCategoryOrder(orderText);
    const rank = (value: Value) => ranks.get(String(value ?? 'NULL').trim()) ?? ranks.get(label(value).trim()) ?? ranks.size;
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    choices.sort((a, b) => {
      if (sort === 'custom') return rank(a) - rank(b);
      if (a === null || b === null) return a === null ? b === null ? 0 : 1 : -1;
      const difference = collator.compare(label(a), label(b));
      return sort === 'desc' ? -difference : difference;
    });
  }
  return <div className="filter-choices">
    {error && <p role="alert">{error}</p>}
    {tiled ? <div className="filter-tiles"><button aria-pressed={!values.length} disabled={disabled} onClick={() => onChange([])}>{t('全部')}</button>{choices.map(value => <button key={JSON.stringify(value)} aria-pressed={values.includes(value)} disabled={disabled} onClick={() => onChange(values.includes(value) ? values.filter(item => item !== value) : multiple ? [...values, value] : [value])}>{label(value)}</button>)}</div> : multiple ?
      <details className="filter-multiselect" onToggle={event => { if (disabled || loading) event.currentTarget.open = false; }}>
        <summary aria-disabled={disabled || loading} onClick={event => { if (disabled || loading) event.preventDefault(); }}>{loading ? t('加载中…') : values.length ? values.map(label).join(', ') : t('全部')}</summary>
        <div className="filter-multiselect-options"><button disabled={disabled || loading} onClick={() => onChange([])}>{t('全部')}</button>{choices.map(value => <label key={JSON.stringify(value)}><input type="checkbox" disabled={disabled || loading} checked={values.includes(value)} onChange={() => onChange(values.includes(value) ? values.filter(item => item !== value) : [...values, value])} /><span>{label(value)}</span></label>)}</div>
      </details> :
      <select aria-label={dataset.schema.find(item => item.name === field)?.display_name || field} disabled={disabled || loading} value={values.length ? JSON.stringify(values[0]) : ''} onChange={event => onChange(event.target.value === '' ? [] : [JSON.parse(event.target.value)])}>
        <option value="">{loading ? t('加载中…') : t('全部')}</option>{choices.map(value => <option key={JSON.stringify(value)} value={JSON.stringify(value)}>{label(value)}</option>)}
      </select>}
    {options.length >= 10000 && <small>{t('最多显示 10000 个不同值')}</small>}
  </div>;
}

export function FilterControl({ tile, dataset, global, onChange, onContentWidth, displayLocale }: { displayLocale?: 'en' | 'zh-CN'; tile: Tile; dataset?: Dataset; global: Filter[]; onChange: (config: Partial<ChartConfig>) => void; onContentWidth?: (width: number) => void }) {
  const { locale: defaultLocale } = useChartLanguage();
  const locale = displayLocale || defaultLocale;
  const t = (text: string, ...values: unknown[]) => translate(locale, text, values);
  const c = tile.config;
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!c.filterAutoWidth || !element || !onContentWidth) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    const style = getComputedStyle(element);
    const measure = () => {
      context.font = '14px ' + style.fontFamily;
      let width = Math.max(180, 2 * context.measureText(c.title || '').width + 68);
      context.font = '12px ' + style.fontFamily;
      element.querySelectorAll('.filter-level>span,select,.filter-multiselect>summary').forEach(node => {
        const text = node instanceof HTMLSelectElement ? node.selectedOptions[0]?.text || '' : node.textContent || '';
        width = Math.max(width, context.measureText(text).width + 64);
      });
      element.querySelectorAll('.filter-tiles').forEach(group => {
        width = Math.max(width, 24 + Array.from(group.children).reduce((sum, button) => sum + context.measureText(button.textContent || '').width + 25, 0));
      });
      if (c.filterStyle === 'date-range') width = Math.max(width, 310);
      onContentWidth(width);
    };
    const resize = new ResizeObserver(measure), mutation = new MutationObserver(measure);
    resize.observe(element); mutation.observe(element, { childList: true, subtree: true, characterData: true }); measure();
    return () => { resize.disconnect(); mutation.disconnect(); };
  }, [c, dataset, onContentWidth]);
  if (!dataset) return null;
  const fields = (c.filterStyle === 'cascade' ? c.filterFields || [] : [c.dimension || '']).filter(field => dataset.schema.some(item => item.name === field && ['string', 'date'].includes(item.type)));
  if (!fields.length) return <p className="filter-hint">{t('请在属性栏选择筛选字段')}</p>;
  const active = global.filter(filter => filter.sourceId !== tile.id && (!filter.datasetId || filter.datasetId === dataset.id) && dataset.schema.some(field => field.name === filter.field));
  const selected = c.filterValues || {};
  return <div ref={content} className="filter-control" lang={locale}>
    {c.filterStyle === 'date-range' ? <div className="filter-date-range">
      <label>{t('开始日期')}<input type="date" aria-label={t('开始日期')} max={c.filterRange?.[1] || undefined} value={c.filterRange?.[0] || ''} onChange={event => onChange({ filterRange: [event.target.value, c.filterRange?.[1] || ''] })} /></label>
      <label>{t('结束日期')}<input type="date" aria-label={t('结束日期')} min={c.filterRange?.[0] || undefined} value={c.filterRange?.[1] || ''} onChange={event => onChange({ filterRange: [c.filterRange?.[0] || '', event.target.value] })} /></label>
      {c.filterRange?.every(Boolean) && c.filterRange[0] > c.filterRange[1] && <p role="alert">{t('开始日期不能晚于结束日期')}</p>}
    </div> : fields.map((field, index) => <div className="filter-level" key={field}><span>{dataset.schema.find(item => item.name === field)?.display_name || field}</span>
      <FilterChoices displayLocale={locale} dataset={dataset} field={field} tiled={c.filterStyle === 'tiles'} multiple={(c.filterSelection || (c.filterStyle === 'tiles' ? 'multiple' : 'single')) === 'multiple'} disabled={c.filterStyle === 'cascade' && fields.slice(0, index).some(parent => !selected[parent]?.length)} values={selected[field] || []} sort={c.filterSort} orderText={c.filterOrderText || ''}
        filters={[...active, ...fields.slice(0, index).flatMap(parent => selected[parent]?.length ? [{ field: parent, op: 'in', value: selected[parent] }] : [])]}
        onChange={values => onChange({ filterValues: { ...Object.fromEntries(fields.slice(0, index).map(parent => [parent, selected[parent] || []])), [field]: values } })} />
    </div>)}
    <button className="filter-clear" disabled={!Object.values(selected).some(values => values.length) && !c.filterRange?.some(Boolean)} onClick={() => onChange({ filterValues: {}, filterRange: ['', ''] })}>{t('清空筛选')}</button>
  </div>;
}

export function FilterProperties({ config: c, dataset, onChange }: { config: ChartConfig; dataset?: Dataset; onChange: (config: Partial<ChartConfig>) => void }) {
  const schema = (dataset?.schema || []).filter(field => ['string', 'date'].includes(field.type));
  const fields = (c.filterFields || []).filter(name => schema.some(field => field.name === name));
  const candidates = c.filterStyle === 'date-range' ? schema.filter(field => ['date', 'string'].includes(field.type)) : schema;
  const options = candidates.map(field => <option key={field.name} value={field.name}>{field.display_name || field.name}</option>);
  return <>
    <label>{t('筛选器标题')}<input value={c.title || ''} onChange={event => onChange({ title: event.target.value })} /></label>
    {!schema.length && <p className="filter-hint">{t('数据集没有文本或日期维度')}</p>}
    <label>{t('筛选器样式')}<select value={c.filterStyle || 'dropdown'} onChange={event => { const style = event.target.value as ChartConfig['filterStyle']; const first = (style === 'date-range' ? schema.find(field => field.type === 'date') : schema[0])?.name || ''; onChange({ filterStyle: style, dimension: first, filterFields: schema.slice(0, 2).map(field => field.name), filterValues: {}, filterRange: ['', ''] }); }}>
      <option value="date-range">{t('日期范围')}</option><option value="dropdown">{t('下拉')}</option><option value="tiles">{t('平铺')}</option><option value="cascade">{t('级联下拉')}</option>
    </select></label>
    {c.filterStyle !== 'date-range' && <label>{t('选择模式')}<select value={c.filterSelection || (c.filterStyle === 'tiles' ? 'multiple' : 'single')} onChange={event => {
      const mode = event.target.value as ChartConfig['filterSelection'];
      const current = c.filterValues || {};
      const keep = mode === 'single' && c.filterStyle === 'cascade' ? fields.slice(0, 1) : Object.keys(current);
      onChange({ filterSelection: mode, filterValues: Object.fromEntries(keep.map(field => [field, mode === 'single' ? (current[field] || []).slice(0, 1) : current[field] || []])) });
    }}><option value="single">{t('单选')}</option><option value="multiple">{t('多选')}</option></select></label>}
    {c.filterStyle !== 'date-range' && <>
      <label>{t('筛选项排序')}<select value={c.filterSort || 'none'} onChange={event => onChange({ filterSort: event.target.value as ChartConfig['filterSort'] })}>
        <option value="none">{t('默认（数据顺序）')}</option><option value="asc">{t('升序')}</option><option value="desc">{t('降序')}</option><option value="custom">{t('自定义')}</option>
      </select></label>
      {c.filterSort === 'custom' && <label>{t('自定义筛选项顺序')}<textarea rows={5} value={c.filterOrderText || ''} placeholder={t('粘贴类别名称，每行一个，或用逗号、Tab 分隔')} onChange={event => onChange({ filterOrderText: event.target.value })} /><small>{t('按文本顺序排列，未列出的类别保留原顺序放在末尾。')}</small></label>}
    </>}
    {c.filterStyle === 'cascade' ? <>{fields.map((field, index) => <div className="metric-binding-row" key={index}><label>{t('级联字段 {0}', index + 1)}<select value={field} onChange={event => onChange({ filterFields: fields.map((name, i) => i === index ? event.target.value : name), filterValues: {} })}>{schema.map(item => <option key={item.name} value={item.name} disabled={item.name !== field && fields.includes(item.name)}>{item.display_name || item.name}</option>)}</select></label><button className="binding-button metric-remove" aria-label={t('移除字段')} onClick={() => onChange({ filterFields: fields.filter((_, i) => i !== index), filterValues: {} })}>×</button></div>)}
      <button disabled={fields.length >= schema.length} onClick={() => { const next = schema.find(field => !fields.includes(field.name)); if (next) onChange({ filterFields: [...fields, next.name], filterValues: {} }); }}>{t('添加级联字段')}</button>
    </> : <label>{t('筛选字段')}<select value={schema.some(field => field.name === c.dimension) ? c.dimension : ''} onChange={event => onChange({ dimension: event.target.value, filterValues: {}, filterRange: ['', ''] })}><option value="">{t('请选择')}</option>{options}</select></label>}
    <p className="filter-hint">{t('筛选同一数据集的图表；级联字段按从上到下的顺序联动。')}</p>
  </>;
}
