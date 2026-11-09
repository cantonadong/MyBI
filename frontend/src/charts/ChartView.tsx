import { getChartLocale, translate, useChartLanguage } from '../i18n';
import { useEffect, useId, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { ChartConfig } from './registry';
import { optionFor, Row } from './options';
import { chartColors } from './palettes';
import { formatChartField as fieldValue, metricFormat, type FieldFormat } from '../fieldDisplay';
export function ChartView({ config, rows, page = 0, pageSize = 10, onPageChange, onPageSizeChange }: { config: ChartConfig; rows: Row[]; page?: number; pageSize?: number; onPageChange?: (page: number) => void; onPageSizeChange?: (size: number) => void }) {
  const { locale: defaultLocale } = useChartLanguage();
  const locale = config.locale || defaultLocale;
  const ref = useRef<HTMLDivElement>(null), [error, setError] = useState('');
  const mapName = useId();
  const latest = useRef({ config, rows }); latest.current = { config, rows };
  const t = (text: string, ...values: unknown[]) => translate(latest.current.config.locale || getChartLocale(), text, values);
  const formatField = (value: unknown, format?: FieldFormat) => fieldValue(value, format, locale);
  const updateChart = useRef<() => void>();
  const tableScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = tableScroll.current;
    if (config.type !== 'table' || !element || !onPageSizeChange) return;
    const measure = () => {
      const headerHeight = element.querySelector('thead')?.getBoundingClientRect().height || 35;
      const rowHeight = element.querySelector('tbody tr')?.getBoundingClientRect().height || 35;
      onPageSizeChange(Math.max(1, Math.min(10000, Math.floor((element.clientHeight - headerHeight) / rowHeight))));
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [config.type, rows, onPageSizeChange]);
  useEffect(() => {
    if (!ref.current || ['kpi', 'table'].includes(config.type)) return;
    let chart: echarts.ECharts | undefined;
    let selected: Record<string, boolean> | undefined;
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = '12px sans-serif';
    const update = () => {
      if (!chart) return;
      chart.resize();
      const { config, rows } = latest.current;
      if (config.type === 'map' && config.mapGeoJSON) echarts.registerMap(mapName, config.mapGeoJSON as any);
      const option = optionFor(config, rows, mapName, { width: chart.getWidth(), height: chart.getHeight(), measureText: context ? text => context.measureText(text).width : undefined });
      if (selected) option.legend.selected = selected;
      const partial = selected && Object.values(selected).some(value => !value);
      option.legend.left = 'center';
      option.legend.selector = [{ type: 'all', title: t('重置') }];
      option.legend.selectorPosition = 'end';
      const style = getComputedStyle(document.documentElement);
      option.legend.textStyle = { fontFamily: style.fontFamily, fontSize: 12, color: style.getPropertyValue('--ui-text').trim() };
      option.legend.selectorLabel = { ...option.legend.textStyle, opacity: partial ? 1 : 0, backgroundColor: '#fff', borderColor: style.getPropertyValue('--ui-border').trim(), borderWidth: 1, borderRadius: 5, padding: [5, 9], lineHeight: 16 };
      option.legend.emphasis = { selectorLabel: { opacity: partial ? 1 : 0, color: style.getPropertyValue('--ui-accent').trim(), backgroundColor: style.getPropertyValue('--ui-hover').trim(), borderColor: style.getPropertyValue('--ui-accent').trim() } };
      chart.setOption(option, true);
    };
    const observer = new ResizeObserver(update);
    try {
      setError(''); chart = echarts.init(ref.current); updateChart.current = update; update(); observer.observe(ref.current);
      chart.on('legendselectchanged', (event: any) => {
        const names = Object.keys(event.selected);
        selected = Object.fromEntries(names.map(name => [name, selected ? !!event.selected[name] : name === event.name]));
        if (!Object.values(selected).some(Boolean)) selected = undefined;
        update();
      });
      chart.on('legendselectall', () => { selected = undefined; update(); });
    }
    catch (e) { setError((e as Error).message); }
    return () => { updateChart.current = undefined; observer.disconnect(); chart?.dispose(); };
  }, [config.type, mapName]);
  useEffect(() => {
    try { setError(''); updateChart.current?.(); }
    catch (e) { setError((e as Error).message); }
  }, [config, rows, locale]);
  if (config.type === 'kpi') { const value = rows[0]?.[config.measure || '']; return <div className="metric" style={{ color: chartColors(config)[0] }}><div className="metric-value">{value === null || value === undefined ? '—' : formatField(value, metricFormat(config, config.measure || ''))}</div><div className="metric-title">{config.title}</div></div>; }
  if (config.type === 'table') { const fields = Object.keys(rows[0] || {}); return <div className="table-component"><div ref={tableScroll} className="table-scroll"><table><thead><tr>{fields.map(f => <th key={f}>{f}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{fields.map(f => <td key={f}>{formatField(row[f], config.fieldFormats?.[f])}</td>)}</tr>)}</tbody></table></div><div className="table-pagination"><button disabled={!page} onClick={() => onPageChange?.(page - 1)}>{t("上一页")}</button><span> {t("第")} {page + 1} {t("页")} </span><button disabled={rows.length < pageSize} onClick={() => onPageChange?.(page + 1)}>{t("下一页")}</button></div></div>; }
  return <>{error && <div role="alert">{error}</div>}<div ref={ref} className="chart-view" aria-label={`${config.title || config.type} chart`} /></>;
}
