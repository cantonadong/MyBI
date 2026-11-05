import { getChartLocale, translate } from '../i18n';
import type { ChartConfig } from './registry';
import { formatValue as valueString } from './registry';
import { formatChartField as fieldValue, metricFormat, parseCategoryOrder, type FieldFormat } from '../fieldDisplay';
import { chartColors } from './palettes';
export type Row = Record<string, unknown>;
const categoryName = (value: unknown) => value == null ? 'NULL' : String(value);
function buildOption(c: ChartConfig, rows: Row[], mapName: string, locale: 'en' | 'zh-CN'): any {
  const formatField = (value: unknown, format?: FieldFormat) => fieldValue(value, format, locale);
  const formatValue = (value: number, format: ChartConfig['format']) => valueString(value, format, locale);
  const t = (text: string) => translate(locale, text);
  const d = c.dimension || '', m = c.measure || '', d2 = c.secondDimension || '', m2 = c.secondMeasure || '';
  const names = rows.map(r => categoryName(r[d])), values = rows.map(r => Number(r[m] ?? 0));
  const groupName = (group: unknown) => formatField(group, c.fieldFormats?.[c.legendField || '']);
  const named = names.map((name, i) => ({ name, value: values[i] }));
  const colors = chartColors(c);
  const base: any = { animation: false, color: colors, tooltip: { renderMode: 'richText', valueFormatter: (value: number) => formatValue(Number(value), c.format) }, legend: { show: c.legend, bottom: 0 } };
  const cart: any = { grid: { left: 65, right: 30, top: 25, bottom: 55 }, xAxis: { type: 'category', data: names }, yAxis: { type: 'value', axisLabel: { formatter: (value: number) => formatValue(value, c.format) } } };
  const label = { show: c.labels };
  if (c.type === 'pie') return { ...base, series: [{ type: 'pie', radius: c.donut ? ['40%', '70%'] : '70%', data: named, label }] };
  if (c.type === 'gauge') return { ...base, series: [{ type: 'gauge', max: Math.max(100, ...values), data: [{ value: values[0] || 0, name: m }] }] };
  if (c.type === 'funnel') return { ...base, series: [{ type: 'funnel', data: named, label }] };
  if (c.type === 'radar') return { ...base, radar: { indicator: names.map(name => ({ name, max: Math.max(1, ...values) * 1.2 })) }, series: [{ type: 'radar', label, data: [{ name: m, value: values }] }] };
  if (c.type === 'scatter') { const groups = c.legendField ? [...new Set(rows.map(row => row[c.legendField!]))] : [undefined]; return { ...base, xAxis: { type: 'value', name: d }, yAxis: { type: 'value', name: m }, series: groups.map(group => ({ name: c.legendField ? JSON.stringify(group) : m, _displayName: c.legendField ? groupName(group) : m, type: 'scatter', label, data: rows.filter(row => !c.legendField || row[c.legendField] === group).map(r => [Number(r[d]), Number(r[m]), Number(r[m2] || 10)]), symbolSize: (v: number[]) => m2 ? Math.max(5, Math.min(60, Math.sqrt(Math.abs(v[2])))) : 12 })) }; }
  if (c.type === 'heatmap') { const xs = [...new Set(names)], ys = [...new Set(rows.map(r => categoryName(r[d2])))]; return { ...base, grid: cart.grid, xAxis: { type: 'category', data: xs }, yAxis: { type: 'category', data: ys }, visualMap: { min: Math.min(...values), max: Math.max(...values), bottom: 0 }, series: [{ type: 'heatmap', data: rows.map(r => [xs.indexOf(categoryName(r[d])), ys.indexOf(categoryName(r[d2])), Number(r[m])]), label }] }; }
  if (c.type === 'sankey') {
    if (!d2) throw new Error(t("桑基图需要第二维度作为目标节点"));
    const nodes = [...new Set(rows.flatMap(r => [categoryName(r[d]), String(r[d2])]))];
    const links = rows.map(r => ({ source: categoryName(r[d]), target: String(r[d2]), value: Number(r[m]) }));
    const adjacent = new Map<string, string[]>(); links.forEach(link => adjacent.set(link.source, [...(adjacent.get(link.source) || []), link.target]));
    const visited = new Set<string>(), active = new Set<string>();
    const visit = (node: string): boolean => { if (active.has(node)) return true; if (visited.has(node)) return false; active.add(node); if ((adjacent.get(node) || []).some(visit)) return true; active.delete(node); visited.add(node); return false; };
    if (nodes.some(visit)) throw new Error(t("桑基图不支持循环连接"));
    return { ...base, series: [{ type: 'sankey', data: nodes.map(name => ({ name })), links, label }] };
  }
  if (['tree', 'treemap', 'sunburst'].includes(c.type)) { const children = [...new Set(names)].map(name => { const matching = rows.filter(r => categoryName(r[d]) === name); return { name, value: matching.reduce((sum, row) => sum + Number(row[m]), 0), children: d2 ? matching.map(r => ({ name: String(r[d2]), value: Number(r[m]) })) : undefined }; }); return { ...base, series: [{ type: c.type, data: c.type === 'tree' ? [{ name: c.title || t("数据"), children }] : children, label: { show: c.labels ?? true } }] }; }
  if (c.type === 'map') { if (!c.mapGeoJSON) throw new Error(t("请上传地图 GeoJSON 并绑定区域名称")); return { ...base, visualMap: { min: Math.min(...values), max: Math.max(...values) }, series: [{ type: 'map', map: mapName, roam: true, data: named, label }] }; }
  if (c.type === 'histogram') { if (rows[0]?.__bin !== undefined) return { ...base, ...cart, xAxis: { type: 'category', data: rows.map(r => Number(r.__bin)) }, series: [{ type: 'bar', barCategoryGap: 0, data: rows.map(r => r.__count), label }] }; const count = Math.max(1, Math.ceil(Math.sqrt(values.length))), min = Math.min(...values), width = (Math.max(...values) - min) / count || 1; const bins = Array<number>(count).fill(0); values.forEach(v => bins[Math.min(count - 1, Math.floor((v - min) / width))]++); return { ...base, ...cart, xAxis: { type: 'category', data: bins.map((_, i) => `${min + i * width}–${min + (i + 1) * width}`) }, series: [{ type: 'bar', barCategoryGap: 0, data: bins, label }] }; }
  if (c.type === 'boxplot') { const groups = [...new Set(names)]; const data = rows[0]?.__box ? rows.map(r => r.__box) : groups.map(g => { const v = rows.filter(r => categoryName(r[d]) === g).map(r => Number(r[m])).sort((a, b) => a - b); const q = (p: number) => { const i = (v.length - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo); }; return [v[0], q(.25), q(.5), q(.75), v[v.length - 1]]; }); return { ...base, ...cart, xAxis: { type: 'category', data: groups }, series: [{ type: 'boxplot', data, label }] }; }
  if (c.type === 'waterfall') {
    let total = 0;
    const spans = values.map((value, index) => { const before = total; total += value; return [index, before, total]; });
    return { ...base, ...cart, series: [{ type: 'custom', data: spans, encode: { x: 0, y: [1, 2] }, renderItem: (_: unknown, api: any) => { const start = api.coord([api.value(0), api.value(1)]), end = api.coord([api.value(0), api.value(2)]), width = api.size([1, 0])[0] * .6; return { type: 'rect', shape: { x: start[0] - width / 2, y: Math.min(start[1], end[1]), width, height: Math.max(1, Math.abs(end[1] - start[1])) }, style: { fill: colors[0] } }; } }] };
  }
  const metrics = c.measures || [m, m2].filter(Boolean);
  const series: any[] = metrics.map((metric, index) => {
    const type = c.type === 'mixed' ? (c.metricSeries?.[index] || c.mixedSeries?.[metric])?.type || (index ? 'line' : 'bar') : ['line', 'area'].includes(c.type) ? 'line' : 'bar';
    const axisIndex = ['mixed', 'line'].includes(c.type) && (c.metricSeries?.[index] || c.mixedSeries?.[metric])?.axis === 'right' ? 1 : 0;
    return { name: metrics.indexOf(metric) !== metrics.lastIndexOf(metric) ? JSON.stringify([index, metric]) : metric, _displayName: metric, _field: metric, type, ...(['mixed', 'line'].includes(c.type) ? { [c.horizontal ? 'xAxisIndex' : 'yAxisIndex']: axisIndex } : {}), data: rows.map(row => row[metric] == null ? null : Number(row[metric])), smooth: c.smooth, areaStyle: c.type === 'area' ? {} : undefined, stack: c.stacked ? c.type === 'mixed' ? type === 'bar' ? `bar-${axisIndex}` : undefined : c.type === 'line' ? `line-${axisIndex}` : 'total' : undefined, label };
  });
  if (['bar', 'line', 'area'].includes(c.type)) cart.yAxis = { ...cart.yAxis, min: c.axisSettings?.left?.min, max: c.axisSettings?.left?.max };
  if (c.type === 'mixed' || (c.type === 'line' && metrics.some((metric, index) => (c.metricSeries?.[index] || c.mixedSeries?.[metric])?.axis === 'right'))) {
    cart.yAxis = (['left', 'right'] as const).map((axis, index) => ({ type: 'value', min: c.axisSettings?.[axis]?.min, max: c.axisSettings?.[axis]?.max, position: c.horizontal ? index ? 'top' : 'bottom' : axis, show: series.some(item => item[c.horizontal ? 'xAxisIndex' : 'yAxisIndex'] === index), splitLine: { show: index === 0 } }));
    if (c.horizontal) cart.grid.top = 55;
    else cart.grid.right = 65;
  }
  if (c.legendField) {
    const field = c.legendField;
    const categories = [...new Map(rows.map(row => [JSON.stringify(row[d]), row[d]])).values()];
    const groups = [...new Map(rows.map(row => [JSON.stringify(row[field]), row[field]])).values()];
    const indexed = new Map(rows.map(row => [JSON.stringify([row[d], row[field]]), row]));
    const exclusiveGroups = indexed.size === categories.length;
    const templates = [...series];
    series.splice(0, series.length);
    groups.forEach(group => templates.forEach((template) => series.push({ ...template, ...(exclusiveGroups && template.type === 'bar' && !template.stack ? { stack: JSON.stringify(['legend', template.name]) } : {}), name: JSON.stringify([group, template.name]), _displayName: groupName(group) + (metrics.length > 1 ? ' · ' + template.name : ''), data: categories.map(category => indexed.get(JSON.stringify([category, group]))?.[template._field] ?? null) })));
    cart.xAxis = { ...cart.xAxis, data: categories.map(value => String(value ?? 'NULL')) };
  }
  if (c.type === 'mixed') {
    series.sort((a, b) => Number(a.type === 'line') - Number(b.type === 'line'));
    series.forEach((item, index) => {
      const color = colors[index % colors.length];
      item.itemStyle = { ...item.itemStyle, color };
      if (item.type === 'line') item.lineStyle = { ...item.lineStyle, color };
    });
  }
  return { ...base, ...cart, ...(c.horizontal ? { xAxis: cart.yAxis, yAxis: cart.xAxis } : {}), series };
}

export function optionFor(c: ChartConfig, rows: Row[], mapName = 'dashboard-map', size: { width: number; height: number; measureText?: (text: string) => number } = { width: 600, height: 300 }): any {
  const locale = c.locale || getChartLocale();
  const formatField = (value: unknown, format?: FieldFormat) => fieldValue(value, format, locale);
  const formatValue = (value: number, format: ChartConfig['format']) => valueString(value, format, locale);
  const categoryLabels = new Map<string, string>();
  if (['bar', 'line', 'area', 'mixed'].includes(c.type) && (c.dimensions?.length || 0) > 1) {
    const dimensions = c.dimensions!;
    let key = '__dw_category';
    while (rows.some(row => key in row) || dimensions.includes(key) || key in (c.fieldFormats || {})) key += '_';
    rows = rows.map(row => {
      const category = JSON.stringify(dimensions.map(field => row[field] ?? null));
      categoryLabels.set(category, dimensions.map(field => formatField(row[field], c.fieldFormats?.[field])).join(' / '));
      return { ...row, [key]: category };
    });
    c = { ...c, dimension: key };
  }
  const categoryText = (value: unknown) => categoryLabels.get(String(value)) ?? categoryName(value);
  const originalHeatmapY = c.type === 'heatmap' ? [...new Set(rows.map(row => categoryName(row[c.secondDimension || ''])))] : undefined;
  if (c.xAxisSort && c.xAxisSort !== 'none' && c.dimension && ['bar', 'line', 'area', 'mixed', 'waterfall', 'boxplot', 'heatmap'].includes(c.type)) {
    const ranks = parseCategoryOrder(c.xAxisOrderText || '');
    const dimension = c.dimension;
    const rank = (value: unknown) => ranks.get(categoryText(value).trim()) ?? ranks.get(formatField(value, c.fieldFormats?.[dimension]).trim()) ?? ranks.size;
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    rows = [...rows].sort((a, b) => {
      if (c.xAxisSort === 'custom') return rank(a[dimension]) - rank(b[dimension]);
      if (a[dimension] == null || b[dimension] == null) return a[dimension] == null ? b[dimension] == null ? 0 : 1 : -1;
      const difference = typeof a[dimension] === 'number' && typeof b[dimension] === 'number' ? Number(a[dimension]) - Number(b[dimension]) : collator.compare(categoryText(a[dimension]), categoryText(b[dimension]));
      return c.xAxisSort === 'desc' ? -difference : difference;
    });
  }
  const option = buildOption(c, rows, mapName, locale);
  if (originalHeatmapY) {
    option.series[0].data.forEach((point: number[]) => { point[1] = originalHeatmapY.indexOf(option.yAxis.data[point[1]]); });
    option.yAxis.data = originalHeatmapY;
  }
  const seriesNames = new Map<string, string>(option.series.map((series: any) => [series.name, series._displayName || series.name]));
  option.legend.formatter = (name: string) => seriesNames.get(name) || name;
  const primary = c.measure || '', dimension = c.dimension || '';
  const formatted = (value: unknown, field: string) => c.fieldFormats ? formatField(value, c.fieldFormats[field]) : value == null ? 'NULL' : typeof value === 'number' ? formatValue(value, c.format) : String(value);
  const metricValue = (value: unknown, field: string) => metricFormat(c, field) ? formatField(value, metricFormat(c, field)) : formatted(value, field);
  const category = (value: unknown, field: string) => categoryLabels.get(String(value)) ?? (value == null || value === 'NULL' ? 'NULL' : formatted(c.fieldFormats?.[field] && c.fieldFormats[field].kind !== 'text' ? Number(value) : value, field));
  const labelValue = (value: unknown, field: string) => {
    const format = metricFormat(c, field);
    if (!c.labelUnit || c.labelUnit === 'none' || typeof value !== 'number' || format?.format === 'percent' || (!format && c.format === 'percent')) return metricValue(value, field);
    const magnitude = Math.abs(value);
    const unit = c.labelUnit === 'auto' ? magnitude >= 1e9 ? 'b' : magnitude >= 1e6 ? 'm' : magnitude >= 1e3 ? 'k' : 'none' : c.labelUnit;
    if (unit === 'none') return metricValue(value, field);
    const divisor = { k: 1e3, m: 1e6, b: 1e9 }[unit];
    return formatField(value / divisor, { kind: 'decimal', format: 'number', decimals: format?.decimals || 1, rounding: format?.rounding }) + unit.toUpperCase();
  };
  const cartesian = ['bar', 'line', 'area', 'mixed'].includes(c.type);
  const count = Math.max(1, ...option.series.map((series: any) => series.data?.length || 1));
  const metricCount = cartesian ? option.series.length : 1;
  const labels = rows.flatMap(row => (c.measures || [primary, c.secondMeasure].filter(Boolean) as string[]).map(field => labelValue(row[field], field)));
  // ponytail: non-browser callers use a 7px glyph estimate; the live chart supplies canvas text measurements.
  const longest = labels.reduce((a, b) => b.length > a.length ? b : a, '');
  const textWidth = Math.max(12, size.measureText ? size.measureText(longest) : longest.length * 7);
  const span = Math.max(1, c.horizontal ? size.height - 80 : size.width - 95);
  const stride = !c.labelDensity || c.labelDensity === 'auto' ? Math.max(1, Math.ceil(count * metricCount * (c.horizontal ? 18 : textWidth + 10) / span)) : c.labelDensity === 'all' ? 1 : Number(c.labelDensity) + 1;
  const numberAxis = c.horizontal ? option.xAxis : option.yAxis;
  if (Array.isArray(numberAxis)) numberAxis.forEach((axis, index) => {
    const field = option.series.find((series: any) => series[c.horizontal ? 'xAxisIndex' : 'yAxisIndex'] === index)?._field || primary;
    axis.axisLabel = { formatter: (value: number) => metricValue(value, field) };
  });
  if (numberAxis?.type === 'value') numberAxis.axisLabel = { ...numberAxis.axisLabel, formatter: (value: number) => c.type === 'histogram' ? formatField(value, { kind: 'integer', format: 'number', decimals: 0 }) : metricValue(value, primary) };
  const categoryAxis = c.horizontal ? option.yAxis : option.xAxis;
  if (categoryAxis?.type === 'category' && c.type !== 'histogram') categoryAxis.axisLabel = { ...categoryAxis.axisLabel, formatter: (value: unknown) => category(value, dimension) };
  if (c.type === 'scatter') {
    option.xAxis.axisLabel = { formatter: (value: number) => formatted(value, dimension) };
    option.yAxis.axisLabel = { formatter: (value: number) => formatted(value, primary) };
  }
  if (c.type === 'heatmap') option.yAxis.axisLabel = { formatter: (value: unknown) => category(value, c.secondDimension || '') };
  if (option.visualMap && c.palette) option.visualMap.inRange = { color: ['#f1f5f9', chartColors(c)[0]] };
  if (option.visualMap) option.visualMap.formatter = (value: number) => metricValue(value, primary);
  if (c.type === 'histogram') option.xAxis.axisLabel = { formatter: (value: unknown) => String(value).includes('–') ? String(value).split('–').map(part => formatted(Number(part), primary)).join('–') : formatted(Number(value), primary) };
  if (categoryAxis?.type === 'category') categoryAxis.axisLabel = { ...categoryAxis.axisLabel, interval: !c.axisLabelDensity || c.axisLabelDensity === 'auto' ? 'auto' : c.axisLabelDensity === 'all' ? 0 : Number(c.axisLabelDensity) };
  if (c.highlightWeekends && option.xAxis?.type === 'category') {
    option.xAxis.splitArea = { show: true, interval: 0, areaStyle: { color: option.xAxis.data.map((value: unknown) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return 'transparent';
      const day = new Date(value.slice(0, 10) + 'T00:00:00Z').getUTCDay();
      return day === 6 || day === 0 ? 'rgba(34, 197, 94, 0.06)' : 'transparent';
    }) } };
  }
  const labelStyle = { color: '#202738', fontWeight: 'normal', textBorderColor: '#fff', textBorderWidth: 3 };
  const hideOverlap = !c.labelDensity || c.labelDensity === 'auto';
  type LabelRect = { x: number; y: number; width: number; height: number };
  const placedLabels = new Map<string, LabelRect>();
  const layoutLabel = (params: { seriesIndex: number; dataIndex: number; text: string; labelRect: LabelRect }) => {
    if (!params.text) return { hideOverlap };
    const key = `${params.seriesIndex}:${params.dataIndex}`;
    // ECharts reuses the callback on resize; a repeated label starts a new layout pass.
    if (placedLabels.has(key)) placedLabels.clear();
    const rect = { ...params.labelRect };
    const axis = c.horizontal ? 'x' : 'y', length = c.horizontal ? 'width' : 'height';
    const cross = c.horizontal ? 'y' : 'x', breadth = c.horizontal ? 'height' : 'width';
    const limit = Math.max(4, (c.horizontal ? size.width - 4 : size.height - 55) - rect[length]);
    const preferred = Math.max(4, Math.min(limit, rect[axis]));
    // shortcut: scans placed labels; use a spatial index if dense charts make layout slow.
    const blockers = [...placedLabels.values()].filter(other => rect[cross] < other[cross] + other[breadth] + 4 && rect[cross] + rect[breadth] + 4 > other[cross]);
    const candidates = [preferred, ...blockers.flatMap(other => [other[axis] - rect[length] - 4, other[axis] + other[length] + 4])]
      .filter(value => value >= 4 && value <= limit).sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
    rect[axis] = candidates.find(value => blockers.every(other => value + rect[length] + 4 <= other[axis] || value >= other[axis] + other[length] + 4)) ?? preferred;
    placedLabels.set(key, rect);
    return rect[axis] === params.labelRect[axis] ? { hideOverlap } : { x: rect.x, y: rect.y, align: 'left', verticalAlign: 'top', hideOverlap };
  };
  option.series.forEach((series: any) => {
    const field = series._field || primary;
    delete series._field;
    delete series._displayName;
    const valueText = (value: any, label = false): string => {
      const metric = label ? labelValue : metricValue;
      if (c.type === 'histogram') return label ? labelValue(value, field) : formatField(value, { kind: 'integer', format: 'number', decimals: 0 });
      if (Array.isArray(value)) {
        if (c.type === 'heatmap') return metric(value[2], field);
        if (c.type === 'scatter') return label ? [labelValue(value[0], dimension), labelValue(value[1], field), ...(c.secondMeasure ? [labelValue(value[2], c.secondMeasure)] : [])].join(', ') : [formatted(value[0], dimension), formatted(value[1], field), ...(c.secondMeasure ? [formatted(value[2], c.secondMeasure)] : [])].join(', ');
        if (c.type === 'waterfall') return metric(value[2] - value[1], field);
        return value.map(item => metric(item, field)).join(', ');
      }
      return metric(value, field);
    };
    series.tooltip = { ...series.tooltip, valueFormatter: (value: any) => valueText(value) };
    if (cartesian) series.tooltip.formatter = (params: any) => category(params.name, dimension) + '\n' + (seriesNames.get(params.seriesName) || params.seriesName) + ': ' + valueText(params.value);
    if (c.type === 'scatter') series.tooltip.formatter = (params: any) => [
      ...(c.legendField ? [seriesNames.get(params.seriesName) || params.seriesName] : []),
      dimension + ': ' + formatted(params.value[0], dimension),
      field + ': ' + formatted(params.value[1], field),
      ...(c.secondMeasure ? [c.secondMeasure + ': ' + formatted(params.value[2], c.secondMeasure)] : []),
    ].join('\n');
    series.labelLayout = cartesian || c.type === 'scatter' ? layoutLabel : { ...series.labelLayout, moveOverlap: c.horizontal ? 'shiftX' : 'shiftY', hideOverlap };
    series.labelLine = { ...series.labelLine, show: true, lineStyle: { ...series.labelLine?.lineStyle, color: '#8790a4', width: 1 } };
    series.label = { ...series.label, ...labelStyle, show: ['tree', 'treemap', 'sunburst'].includes(c.type) ? c.labels ?? true : c.labels, ...(series.type === 'bar' ? { position: 'outside' } : {}), formatter: (params: any) => {
      if ((cartesian || (c.labelDensity && c.labelDensity !== 'auto')) && (params.dimensionIndex ?? params.dataIndex) % stride !== 0) return '';
      if (['tree', 'treemap', 'sunburst'].includes(c.type)) return c.labels ? params.name + ': ' + valueText(params.value, true) : params.name;
      return valueText(params.value, true);
    } };
    if (c.type === 'waterfall' && c.labels) {
      const renderItem = series.renderItem;
      series.renderItem = (params: any, api: any) => {
        const shape = renderItem(params, api);
        shape.textContent = { type: 'text', style: { ...labelStyle, text: series.label.formatter({ dataIndex: params.dataIndex, value: [api.value(0), api.value(1), api.value(2)] }), fill: labelStyle.color, stroke: labelStyle.textBorderColor, lineWidth: labelStyle.textBorderWidth } };
        shape.textConfig = { position: 'top' };
        return shape;
      };
    }
    if (c.type === 'gauge') { series.detail = { ...series.detail, ...labelStyle, formatter: (value: number) => labelValue(value, field) }; series.axisLabel = { ...series.axisLabel, formatter: (value: number) => metricValue(value, field) }; }
  });
  if (c.axisHover && option.xAxis && option.yAxis) {
    const axis = option.yAxis.type === 'category' && option.xAxis.type !== 'category' ? 'y' : 'x';
    option.tooltip = { ...option.tooltip, trigger: 'axis', axisPointer: { axis, type: 'line' }, formatter: (items: any[]) => {
      if (!items.length) return '';
      const heading = c.type === 'histogram' ? items[0].axisValueLabel : category(items[0].axisValue, dimension);
      return [heading, ...items.map(item => (seriesNames.get(item.seriesName) || item.seriesName) + ': ' + option.series[item.seriesIndex].tooltip.valueFormatter(item.value))].join('\n');
    } };
  }
  if (c.annotations?.length && option.xAxis?.type === 'category' && !c.horizontal) {
    const dates = option.xAxis.data.map((value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? Date.parse(value.slice(0, 10)) : NaN);
    const ascending = dates.every((value: number, index: number) => Number.isFinite(value) && (!index || value >= dates[index - 1]));
    const descending = dates.every((value: number, index: number) => Number.isFinite(value) && (!index || value <= dates[index - 1]));
    if (dates.length && (ascending || descending)) {
      const minimum = Math.min(...dates), maximum = Math.max(...dates);
      const chronological = dates.map((date: number, index: number) => ({ date, index })).sort((a: any, b: any) => a.date - b.date);
      const positionAt = (date: number) => {
        const index = chronological.findIndex((item: any) => item.date >= date);
        if (index <= 0) return chronological[index < 0 ? chronological.length - 1 : 0].index;
        const before = chronological[index - 1], after = chronological[index];
        return before.index + (after.index - before.index) * (date - before.date) / (after.date - before.date);
      };
      const lanes: number[] = [];
      const spans = c.annotations.flatMap((item, index) => {
        const start = item.start ? Date.parse(item.start) - 43200000 : minimum, end = item.end ? Date.parse(item.end) + 43200000 : maximum;
        if (end < minimum || start > maximum) return [];
        const from = positionAt(Math.max(minimum, start)), to = positionAt(Math.min(maximum, end));
        return [{ ...item, startBoundary: start, endBoundary: end, from: Math.min(from, to), to: Math.max(from, to), color: chartColors(c)[index % chartColors(c).length], lane: 0 }];
      }).sort((a, b) => a.from - b.from || a.to - b.to);
      spans.forEach(span => {
        let lane = lanes.findIndex(end => end < span.from || end === span.from && span.from < span.to);
        if (lane < 0) lane = lanes.length;
        lanes[lane] = span.to; span.lane = lane;
      });
      const laneHeight = 23;
      // shortcut: keep at least 60px for the plot; compact cards may hide excess annotation lanes.
      const visibleLanes = Math.max(0, Math.min(lanes.length, Math.floor((size.height - 140) / laneHeight)));
      if (visibleLanes) {
        option.grid.top = Math.max(Number(option.grid.top) || 25, 8 + visibleLanes * laneHeight);
        option.series.push({
          type: 'custom', silent: true, clip: false, z: 0, tooltip: { show: false },
          data: spans.map(span => [span.from, span.to]), encode: { x: [0, 1], y: [], tooltip: [] },
          renderItem: (params: any, api: any) => {
            const span = spans[params.dataIndex], grid = params.coordSys;
            const leftBound = ascending ? span.startBoundary : span.endBoundary, rightBound = ascending ? span.endBoundary : span.startBoundary;
            const x = leftBound > minimum && leftBound < maximum ? api.coord([span.from, 0])[0] : grid.x;
            const right = rightBound > minimum && rightBound < maximum ? Math.max(x + 2, api.coord([span.to, 0])[0]) : grid.x + grid.width;
            const width = right - x, top = 8 + span.lane * laneHeight;
            const children: any[] = [{ type: 'rect', shape: { x, y: grid.y, width, height: grid.height }, style: { fill: span.color, opacity: .09 } }];
            if (span.lane < visibleLanes) children.push(
              { type: 'rect', shape: { x, y: top, width, height: 20, r: 3 }, style: { fill: span.color, opacity: .18 } },
              { type: 'text', style: { x: x + width / 2, y: top + 10, text: span.label, fill: span.color, fontSize: 12, fontWeight: 600, align: 'center', verticalAlign: 'middle', width: Math.max(0, width - 8), overflow: 'truncate' } },
            );
            for (const [bound, boundaryX] of [[ascending ? span.start : span.end, x], [ascending ? span.end : span.start, right]] as const) {
              if (bound && Date.parse(bound) >= minimum && Date.parse(bound) <= maximum) children.push({ type: 'line', shape: { x1: boundaryX, x2: boundaryX, y1: grid.y, y2: grid.y + grid.height }, style: { stroke: span.color, lineWidth: 1, lineDash: [4, 3], opacity: .7 } });
            }
            return { type: 'group', children };
          },
        });
      }
    }
  }
  return option;
}

