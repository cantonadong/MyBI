import { t } from "./i18n";
import { ChartConfig } from './charts/registry';

export function FieldBindings({ config: c, fields, onChange }: { config: ChartConfig; fields: { name: string; type: string; display_name?: string }[]; onChange: (next: Partial<ChartConfig>) => void }) {
  const dimensions = fields.filter(field => ['string', 'date'].includes(field.type));
  const metrics = fields.filter(field => ['number', 'integer'].includes(field.type));
  const multiple = ['bar', 'line', 'area', 'mixed'].includes(c.type);
  const axisDimensions = c.dimensions || (c.dimension ? [c.dimension] : []);
  const nextDimension = dimensions.find(field => !axisDimensions.includes(field.name));
  const updateDimensions = (next: string[]) => onChange({ dimensions: next, dimension: next[0] });
  const moveDimension = (index: number, offset: number) => {
    const next = [...axisDimensions];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    updateDimensions(next);
  };
  const measures = c.measures || [c.measure, c.secondMeasure].filter((v): v is string => !!v);
  const mixedSeries = measures.map((field, index) => ({ ...(c.metricSeries?.[index] || c.mixedSeries?.[field] || { type: c.type === 'line' || index ? 'line' as const : 'bar' as const, axis: 'left' as const }) }));
  const update = (next: string[]) => onChange({ measures: next, measure: next[0], secondMeasure: undefined, metricSeries: next.map((_, index) => mixedSeries[index] || { type: 'line', axis: 'left' }) });
  const updateMixed = (next: string[], settings = mixedSeries) => onChange({ measures: next, measure: next[0], secondMeasure: undefined, metricSeries: settings });
  const updateAxis = (index: number, axis: 'left' | 'right') => {
    const next = mixedSeries.map((series, i) => i === index ? { ...series, axis } : { ...series });
    if (c.type === 'mixed' && next[index].type === 'bar') next.forEach(series => { if (series.type === 'line') series.axis = axis === 'left' ? 'right' : 'left'; });
    onChange({ metricSeries: next });
  };
  const select = (label: string, value: string | undefined, change: (value: string) => void, candidates = metrics) => <label>{label}<select aria-label={label} value={value || ''} onChange={e => change(e.target.value)}><option value="">{t("请选择")}</option>{candidates.map(f => <option key={f.name} value={f.name}>{f.display_name || f.name}</option>)}</select></label>;
  const axisRange = (side: 'left' | 'right') => <fieldset className="axis-settings" key={side}>
    <legend>{c.horizontal ? side === 'left' ? t('\u4e0b\u8f74') : t('\u4e0a\u8f74') : side === 'left' ? t('\u5de6\u8f74') : t('\u53f3\u8f74')}</legend>
    {(['min', 'max'] as const).map(key => <label key={key}>{key === 'min' ? t('\u6700\u5c0f\u503c') : t('\u6700\u5927\u503c')}<input key={String(c.axisSettings?.[side]?.[key])} type="number" step="any" placeholder={t('\u81ea\u52a8')} defaultValue={c.axisSettings?.[side]?.[key] ?? ''} onInput={event => event.currentTarget.setCustomValidity('')} onBlur={event => {
      const input = event.currentTarget;
      const value = input.value === '' ? undefined : input.valueAsNumber;
      if (input.validity.badInput || (value !== undefined && !Number.isFinite(value))) { input.setCustomValidity(t('\u8bf7\u8f93\u5165\u6709\u6548\u6570\u503c')); input.reportValidity(); return; }
      const settings = { min: c.axisSettings?.[side]?.min, max: c.axisSettings?.[side]?.max, [key]: value };
      if (settings.min !== undefined && settings.max !== undefined && settings.min > settings.max) [settings.min, settings.max] = [settings.max, settings.min];
      onChange({ axisSettings: { ...c.axisSettings, [side]: settings } });
    }} /></label>)}
  </fieldset>;
  if (c.type === 'table') return null;
  const hierarchy = ['tree', 'treemap', 'sunburst'].includes(c.type);
  const axis = c.horizontal ? t("X 轴") : t("Y 轴");
  const nextMetric = metrics.find(f => !measures.includes(f.name)) || metrics[0];
  return <>
    {!['kpi', 'filter'].includes(c.type) && <fieldset className="axis-settings"><legend>{t('数据标签设置')}</legend>
      {!['table', 'gauge'].includes(c.type) && <label>{t('数据标签显示位置')}<select aria-label={t('数据标签显示位置')} value={c.labelPosition || 'auto'} onChange={event => onChange({ labelPosition: event.target.value as ChartConfig['labelPosition'] })}>
        <option value="auto">{t('自动')}</option><option value="top">{t('上方')}</option><option value="center">{t('中心')}</option><option value="bottom">{t('底部')}</option>
      </select></label>}
      <label>{t('数值单位')}<select aria-label={t('数值单位')} value={c.labelUnit || 'auto'} onChange={event => onChange({ labelUnit: event.target.value as ChartConfig['labelUnit'] })}>
        <option value="auto">{t('自动')}</option><option value="none">{t('原值')}</option><option value="k">K</option><option value="m">M</option><option value="b">B</option>
      </select></label>
    </fieldset>}
    {multiple ? <section className="metric-bindings">
      <div className="binding-heading"><strong>{c.horizontal ? t('Y 轴') : t('X 轴')}</strong><button className="binding-button" aria-label={t('添加维度')} title={t('添加维度')} disabled={!nextDimension || axisDimensions.length >= 32} onClick={() => { if (nextDimension) updateDimensions([...axisDimensions, nextDimension.name]); }}>＋</button></div>
      {(axisDimensions.length ? axisDimensions : ['']).map((field, index) => <div className="metric-binding-row" key={index}>
        <label><span className="sr-only">{t('维度 {0}', index + 1)}</span><select aria-label={t('维度 {0}', index + 1)} value={field} onChange={event => updateDimensions((axisDimensions.length ? axisDimensions : ['']).map((name, i) => i === index ? event.target.value : name).filter(Boolean))}><option value="">{t('请选择')}</option>{dimensions.map(dimension => <option key={dimension.name} value={dimension.name} disabled={dimension.name !== field && axisDimensions.includes(dimension.name)}>{dimension.display_name || dimension.name}</option>)}</select></label>
        <button className="binding-button" aria-label={t('上移维度 {0}', index + 1)} title={t('上移')} disabled={!field || index === 0} onClick={() => moveDimension(index, -1)}>↑</button>
        <button className="binding-button" aria-label={t('下移维度 {0}', index + 1)} title={t('下移')} disabled={!field || index === axisDimensions.length - 1} onClick={() => moveDimension(index, 1)}>↓</button>
        <button className="binding-button" aria-label={t('移除维度 {0}', index + 1)} title={t('移除维度')} disabled={!field} onClick={() => updateDimensions(axisDimensions.filter((_, i) => i !== index))}>×</button>
      </div>)}
    </section> : !['kpi', 'gauge', 'histogram'].includes(c.type) && select(c.type === 'sankey' ? t("来源节点") : hierarchy ? t("一级分类") : c.horizontal ? t("Y 轴") : t("X 轴"), c.dimension, dimension => onChange({ dimension }), dimensions)}
    {(c.type === 'heatmap' || c.type === 'sankey' || hierarchy) && select(c.type === 'heatmap' ? t("Y 轴") : c.type === 'sankey' ? t("目标节点") : t("下一级分类（可选）"), c.secondDimension, secondDimension => onChange({ secondDimension }), dimensions)}
    {['bar', 'line', 'area', 'mixed', 'waterfall', 'boxplot', 'heatmap', 'histogram', 'candlestick'].includes(c.type) && <label>{c.horizontal ? t('Y 轴显示密度') : t('X 轴显示密度')}<select aria-label={c.horizontal ? t('Y 轴显示密度') : t('X 轴显示密度')} value={c.axisLabelDensity || 'auto'} onChange={event => onChange({ axisLabelDensity: event.target.value as ChartConfig['axisLabelDensity'] })}>
      <option value="auto">{t('自动')}</option><option value="all">{t('全部')}</option>{['1', '2', '3'].map(value => <option key={value} value={value}>{t('每隔 {0} 个', value)}</option>)}
    </select></label>}
    {!['kpi', 'filter'].includes(c.type) && <><label>{t('指标数值标签显示密度')}<select aria-label={t('指标数值标签显示密度')} value={c.labelDensity || 'auto'} onChange={event => onChange({ labelDensity: event.target.value as ChartConfig['labelDensity'] })}>
        <option value="auto">{t('自动')}</option><option value="all">{t('全部')}</option>{['1', '2', '3'].map(value => <option key={value} value={value}>{t('每隔 {0} 个', value)}</option>)}
      </select></label>
      <label>{t('只显示前 X 个')}<input type="number" aria-label={t('只显示前 X 个')} min={1} max={10000} step={1} placeholder={t('不限制')} value={c.labelLimit ?? ''} onChange={event => onChange({ labelLimit: event.target.value === '' ? undefined : Math.max(1, Math.min(10000, Math.trunc(Number(event.target.value)))) })} /></label>
      </>}
    {['bar', 'line', 'area', 'mixed', 'waterfall', 'boxplot', 'heatmap', 'candlestick'].includes(c.type) && <>
      <label>{t('X 轴排序')}<select aria-label={t('X 轴排序')} value={c.xAxisSort || 'none'} onChange={event => onChange({ xAxisSort: event.target.value as ChartConfig['xAxisSort'] })}>
        <option value="none">{t('默认（数据顺序）')}</option><option value="asc">{t('升序')}</option><option value="desc">{t('降序')}</option><option value="custom">{t('自定义')}</option>
      </select></label>
      {c.xAxisSort === 'custom' && <label>{t('自定义类别顺序')}<textarea aria-label={t('自定义类别顺序')} rows={5} value={c.xAxisOrderText || ''} placeholder={t('粘贴类别名称，每行一个，或用逗号、Tab 分隔')} onChange={event => onChange({ xAxisOrderText: event.target.value })} /><small>{t('按文本顺序排列，未列出的类别保留原顺序放在末尾。')}</small></label>}
    </>}
    {c.type === 'candlestick' ? <>{['开盘', '收盘', '最低', '最高'].map((label, index) => <div key={label}>{select(t(label), c.measures?.[index], value => { const next = Array.from({ length: 4 }, (_, i) => i === index ? value : c.measures?.[i] || ''); onChange({ measures: next, measure: next[0], secondMeasure: undefined }); })}</div>)}</> : c.type === 'mixed' ? (['bar', 'line'] as const).map(type => <section className="mixed-metric-group" key={type}>
      <div className="binding-heading"><strong>{type === 'bar' ? t('柱状指标') : t('折线指标')}</strong><button className="binding-button" aria-label={type === 'bar' ? t('添加柱状指标') : t('添加折线指标')} title={type === 'bar' ? t('添加柱状指标') : t('添加折线指标')} disabled={!nextMetric || measures.length >= 32} onClick={() => {
        if (!nextMetric) return;
        const bar = mixedSeries.find(series => series.type === 'bar');
        const axis = type === 'bar' ? bar?.axis || 'left' : bar?.axis === 'right' ? 'left' : 'right';
        updateMixed([...measures, nextMetric.name], [...mixedSeries, { type, axis }]);
      }}>＋</button></div>
      {measures.map((field, index) => ({ field, index })).filter(({ index }) => mixedSeries[index]?.type === type).map(({ field, index }) => <div className="mixed-metric-item" key={index}>
        <div className="metric-binding-row"><label><span className="sr-only">{type === 'bar' ? t('柱状指标') : t('折线指标')}</span><select aria-label={type === 'bar' ? t('柱状指标') : t('折线指标')} value={field} onChange={event => updateMixed(measures.map((name, i) => i === index ? event.target.value : name))}>{metrics.map(metric => <option key={metric.name} value={metric.name}>{metric.display_name || metric.name}</option>)}</select></label>
          <button className="binding-button metric-remove" aria-label={t('删除指标 {0}', index + 1)} title={t('移除此指标')} onClick={() => updateMixed(measures.filter((_, i) => i !== index), mixedSeries.filter((_, i) => i !== index))}>×</button>
        </div>
        <label className="mixed-metric-axis">{t('刻度')}<select aria-label={t('指标 {0} 刻度', index + 1)} value={mixedSeries[index].axis} onChange={event => updateAxis(index, event.target.value as 'left' | 'right')}><option value="left">{c.horizontal ? t('下轴') : t('左轴')}</option><option value="right">{c.horizontal ? t('上轴') : t('右轴')}</option></select></label>
      </div>)}
      {!mixedSeries.some(series => series.type === type) && <p className="mixed-metric-empty">{t('尚未添加指标')}</p>}
      <details className="mixed-group-settings"><summary>{type === 'bar' ? t('柱状设置') : t('折线设置')}</summary>
        {type === 'bar' ? <label><input type="checkbox" checked={!!c.stacked} onChange={event => onChange({ stacked: event.target.checked })} />{t('堆叠')}</label> : <label><input type="checkbox" checked={!!c.smooth} onChange={event => onChange({ smooth: event.target.checked })} />{t('平滑线')}</label>}
      {(['left', 'right'] as const).filter(side => mixedSeries.some(series => series.type === type && series.axis === side)).map(axisRange)}
      </details>
    </section>) : multiple ? <div className="metric-bindings">
      <div className="binding-heading"><span>{axis}</span><button className="binding-button" aria-label={t("添加指标")} title={t("添加指标")} disabled={!nextMetric || measures.length >= 32} onClick={() => { if (nextMetric) update([...measures, nextMetric.name]); }}>＋</button></div>
      {(measures.length ? measures : ['']).map((value, index) => <div className={c.type === 'line' ? 'mixed-metric-item' : undefined} key={index}><div className="metric-binding-row">
        <label><span className="sr-only">{axis}{index ? t("指标 {0}", index + 1) : ''}</span><select aria-label={axis + (index ? t("指标 {0}", index + 1) : '')} value={value} onChange={e => update((measures.length ? measures : ['']).map((item, i) => i === index ? e.target.value : item))}><option value="">{t("请选择")}</option>{metrics.map(f => <option key={f.name} value={f.name}>{f.display_name || f.name}</option>)}</select></label>
        <button className="binding-button metric-remove" aria-label={t("删除指标 {0}", index + 1)} title={t("移除此指标")} onClick={() => updateMixed(measures.filter((_, i) => i !== index), mixedSeries.filter((_, i) => i !== index))}>×</button>
      </div>{c.type === 'line' && <label className="mixed-metric-axis">{t('刻度')}<select aria-label={t('指标 {0} 刻度', index + 1)} disabled={!value} value={mixedSeries[index]?.axis || 'left'} onChange={event => updateAxis(index, event.target.value as 'left' | 'right')}><option value="left">{c.horizontal ? t('下轴') : t('左轴')}</option><option value="right">{c.horizontal ? t('上轴') : t('右轴')}</option></select></label>}</div>)}
      {(c.type === 'line' ? (['left', 'right'] as const).filter(side => mixedSeries.some(series => series.axis === side)) : ['left'] as const).map(axisRange)}
    </div> : <div className="metric-binding-row">{select(c.type === 'heatmap' ? t("颜色数值") : c.type === 'sankey' ? t("连接数值") : c.type === 'histogram' ? t("X 轴数值") : t("Y 轴"), c.measure, measure => onChange({ measure, measures: undefined }))}<button className="binding-button metric-remove" aria-label={t("删除指标 1")} title={t("移除此指标")} onClick={() => onChange({ measure: undefined, measures: undefined })}>×</button></div>}
    {c.type !== 'candlestick' && measures.filter(Boolean).map(field => <label key={'aggregation-' + field}>{field} · {t('聚合')}<select value={c.metricAggregations?.[field] || c.aggregation || 'sum'} onChange={event => onChange({ metricAggregations: { ...c.metricAggregations, [field]: event.target.value as NonNullable<ChartConfig['aggregation']> } })}>{['sum', 'avg', 'count', 'min', 'max', 'count_distinct'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
    {['bar', 'line', 'area', 'mixed', 'waterfall', 'boxplot', 'heatmap', 'histogram', 'candlestick'].includes(c.type) && <label><input type="checkbox" checked={!!c.axisLabelRotate} onChange={event => onChange({ axisLabelRotate: event.target.checked })} />{t('X 轴标签倾斜 45°')}</label>}
    {c.type === 'scatter' && select(t("气泡大小（可选）"), c.secondMeasure, secondMeasure => onChange({ secondMeasure }))}

  </>;
}
