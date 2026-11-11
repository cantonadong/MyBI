import type { FieldFormats } from './fieldDisplay';
import { formatChartField, titleCase } from './fieldDisplay';
import { getChartLocale, t, translate } from './i18n';
import type { ChartConfig } from './charts/registry';
export type Filter = { sourceId?: string; datasetId?: string; field: string; op: string; value: unknown };
export type FilterMode = 'global' | 'local' | 'both';
export type AnnotationFields = Record<'start' | 'end' | 'label', string>;
export type Annotation = { start: string | null; end: string | null; label: string };
export type Dataset = { owner?: string | null; updated_at?: string | null; storage_path?: string; local_id?: number; fingerprint?: string; annotation_fields?: Partial<AnnotationFields>; snapshot_id?: string; data_as_of?: string; id: string; name: string; schema: { name: string; type: string; display_name?: string }[]; row_count: number; import_method?: 'paste' | 'upload' | 'dynamic' | null; filename?: string | null; version?: number; field_formats?: FieldFormats; dynamic?: { duration_seconds?: number | null; last_run_at?: string | null; next_run_at?: string | null; last_error?: string | null; refreshing?: boolean; schedule: { enabled: boolean; time: string; timezone: string } } };
export type Tile = { id: string; tabId?: string; datasetId: string; config: ChartConfig; followFilterIds?: string[]; filterMode: FilterMode; filters: Filter[]; x: number; y: number; w: number; h: number };
export type ReportTab = { id: string; name: string };
export type CanvasGrid = { columns: number; rows: number };
export type InsertSide = 'left' | 'right' | 'top' | 'bottom';
export type Document = { tabs?: ReportTab[]; showGuides?: boolean; refreshSchedule?: { enabled: boolean; time: string; timezone: string }; highlightWeekends?: boolean; charts: Tile[]; filters: Filter[]; datasets: Dataset[]; grid?: CanvasGrid };
export type SavedReport = { id: string; pages?: number; published?: boolean; storage_path?: string; local_id?: number; fingerprint?: string; name: string; owner?: string | null; updated_at?: string | null };
export function chartTitle(config: ChartConfig, dataset?: Dataset, filters: Filter[] = [], locale = getChartLocale()): string {
  if (config.type === 'filter') return config.title || '';
  const label = (name: string) => {
    const text = dataset?.schema.find(field => field.name === name)?.display_name || name;
    return titleCase(text);
  };
  const multiple = ['bar', 'line', 'area', 'mixed', 'candlestick'].includes(config.type);
  const metrics = (multiple ? config.measures || [config.measure, config.secondMeasure] : [config.measure, ...(config.type === 'scatter' ? [config.secondMeasure] : [])]).filter((field): field is string => !!field).map(field => {
    const method = config.metricAggregations?.[field] || config.aggregation || 'sum';
    return label(field) + (method === 'sum' || ['scatter', 'histogram', 'boxplot', 'candlestick'].includes(config.type) ? '' : ` (${method})`);
  }).join(', ');
  const dimensions = (['kpi', 'gauge', 'histogram'].includes(config.type) ? [] : multiple && config.type !== 'candlestick' ? config.dimensions || [config.dimension] : [config.dimension]).filter((field): field is string => !!field).map(label).join(', ');
  const title = config.autoTitle === false ? config.title || '' : metrics ? metrics + (dimensions ? ' by ' + dimensions : '') : config.title || '';
  const selections = filters.flatMap(filter => {
    const field = dataset?.schema.find(field => field.name === filter.field && ['string', 'date'].includes(field.type));
    if (!field || (filter.datasetId && filter.datasetId !== dataset?.id) || !['in', 'date_between'].includes(filter.op)) return [];
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (!values.length || values.some(value => value === '' || value === undefined)) return [];
    return [titleCase(field.display_name || field.name) + ': ' + values.map(value => value === null ? translate(locale, '（空）') : titleCase(formatChartField(value, dataset?.field_formats?.[field.name], locale))).join(filter.op === 'date_between' ? ' – ' : ', ')];
  });
  return [title, ...new Set(selections)].filter(Boolean).join(' · ');
}
export function chartSort(config: ChartConfig): string {
  return config.sort || 'none';
}
export function filterMatchesChart(tile: Tile, filter: Tile, dataset?: Dataset): boolean {
  if (filter.config.type !== 'filter' || tile.datasetId !== filter.datasetId || !dataset) return false;
  const schema = dataset.schema.filter(field => ['string', 'date'].includes(field.type)).map(field => field.name);
  const fields = filter.config.filterStyle === 'cascade' ? filter.config.filterFields || [] : [filter.config.dimension];
  return fields.some(field => !!field && schema.includes(field));
}
export function followedFilterIds(tile: Tile, charts: Tile[], dataset?: Dataset): string[] {
  if (tile.followFilterIds) return charts.filter(chart => tile.followFilterIds!.includes(chart.id) && filterMatchesChart(tile, chart, dataset)).map(chart => chart.id);
  const above = charts.filter(chart => chart.y + chart.h <= tile.y && filterMatchesChart(tile, chart, dataset));
  above.sort((a, b) => (b.y + b.h) - (a.y + a.h) || Math.abs(a.x + a.w / 2 - tile.x - tile.w / 2) - Math.abs(b.x + b.w / 2 - tile.x - tile.w / 2) || a.x - b.x);
  return above.length && filterMatchesChart(tile, above[0], dataset) ? [above[0].id] : [];
}
export function nextFilterTitle(charts: Tile[]): string {
  const filters = charts.filter(chart => chart.config.type === 'filter');
  const number = Math.max(filters.length, ...filters.map(chart => Number(chart.config.title?.match(/\s(\d+)$/)?.[1]) || 0)) + 1;
  return t('筛选器 {0}', number);
}
export function lastDateRange(end: string, count = 1, unit: ChartConfig['filterLastUnit'] = 'day'): [string, string] {
  const finish = new Date(end + 'T00:00:00Z');
  if (!Number.isFinite(finish.getTime())) return ['', ''];
  const amount = Number.isFinite(count) ? Math.max(1, Math.min(10000, Math.trunc(count))) : 1;
  const start = new Date(finish);
  const months = unit === 'month' ? 1 : unit === 'quarter' ? 3 : unit === 'year' ? 12 : 0;
  if (months) {
    const day = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months * amount);
    const last = new Date(start);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    start.setUTCDate(Math.min(day, last.getUTCDate()) + 1);
  } else start.setUTCDate(start.getUTCDate() - amount * (unit === 'week' ? 7 : 1) + 1);
  return [start.getUTCFullYear() < 1 ? '0001-01-01' : start.toISOString().slice(0, 10), end];
}
export function controlFilters(tile: Tile, dataset?: Dataset): Filter[] {
  const c = tile.config;
  if (c.type !== 'filter' || !dataset) return [];
  const dimensions = new Set(dataset.schema.filter(field => ['string', 'date'].includes(field.type)).map(field => field.name));
  const scope = { sourceId: tile.id, datasetId: tile.datasetId };
  if (c.filterStyle === 'date-range' || c.filterStyle === 'date-last') {
    const range = c.filterStyle === 'date-last' ? lastDateRange(c.filterRange?.[1] || '', c.filterLastCount, c.filterLastUnit) : c.filterRange;
    return c.dimension && dimensions.has(c.dimension) && range?.every(Boolean) && range[0] <= range[1] ? [{ ...scope, field: c.dimension, op: 'date_between', value: range }] : [];
  }
  const fields = c.filterStyle === 'cascade' ? c.filterFields || [] : [c.dimension || ''];
  return fields.flatMap(field => dimensions.has(field) && c.filterValues?.[field]?.length ? [{ ...scope, field, op: 'in', value: c.filterValues[field] }] : []);
}
export function gridFor(doc: Document): CanvasGrid {
  return doc.grid || { columns: 12, rows: Math.max(20, ...doc.charts.map(tile => tile.y + tile.h)) };
}
export function canUseGrid(charts: Tile[], grid: CanvasGrid): boolean {
  return charts.every(tile => tile.x + tile.w <= grid.columns && tile.y + tile.h <= grid.rows);
}
export function findGridSpace(charts: Tile[], w: number, h: number, grid: CanvasGrid, at?: { x: number; y: number }): { x: number; y: number } | null {
  const available = (x: number, y: number) => x >= 0 && y >= 0 && x + w <= grid.columns && y + h <= grid.rows && charts.every(tile => x + w <= tile.x || x >= tile.x + tile.w || y + h <= tile.y || y >= tile.y + tile.h);
  if (at) return available(at.x, at.y) ? at : null;
  // ponytail: first-fit scanning is bounded by 24 x 100 cells; use a spatial index for unbounded canvases.
  for (let y = 0; y <= grid.rows - h; y++) {
    for (let x = 0; x <= grid.columns - w; x++) {
      if (available(x, y)) return { x, y };
    }
  }
  return null;
}
export function insertGridTile(charts: Tile[], movingId: string, targetId: string, side: InsertSide, columns: number): Tile[] | null {
  const moving = charts.find(chart => chart.id === movingId), target = charts.find(chart => chart.id === targetId);
  if (!moving || !target || moving === target) return null;
  const horizontal = side === 'left' || side === 'right';
  if (horizontal && columns < 6) return null;
  const w = Math.min(columns, Math.max(target.w, horizontal ? 6 : 3)), h = Math.max(target.h, horizontal ? 3 : 6);
  const x = Math.min(target.x, columns - w), y = target.y;
  const length = horizontal ? w : h;
  const ratio = horizontal ? moving.w / (moving.w + target.w) : moving.h / (moving.h + target.h);
  const movingLength = Math.max(3, Math.min(length - 3, Math.round(length * ratio))), targetLength = length - movingLength;
  const before = side === 'left' || side === 'top';
  const moved = { ...moving, x: horizontal && !before ? x + targetLength : x, y: !horizontal && !before ? y + targetLength : y, w: horizontal ? movingLength : w, h: horizontal ? h : movingLength };
  const resized = { ...target, x: horizontal && before ? x + movingLength : x, y: !horizontal && before ? y + movingLength : y, w: horizontal ? targetLength : w, h: horizontal ? h : targetLength };
  return pushGridTiles(charts, [moved, resized]);
}
export function moveGridTile(charts: Tile[], movingId: string, at: { x: number; y: number }, columns: number): Tile[] | null {
  const moving = charts.find(chart => chart.id === movingId);
  if (!moving) return null;
  const w = Math.min(moving.w, columns);
  return pushGridTiles(charts, [{ ...moving, w, x: Math.max(0, Math.min(at.x, columns - w)), y: Math.max(0, at.y) }]);
}
export function pushGridTiles(charts: Tile[], placed: Tile[]): Tile[] {
  const pinned = new Set(placed.map(chart => chart.id));
  for (const chart of charts.filter(item => !pinned.has(item.id)).sort((a, b) => a.y - b.y || a.x - b.x)) {
    let next = chart;
    let collisions = placed.filter(item => next.x < item.x + item.w && next.x + next.w > item.x && next.y < item.y + item.h && next.y + next.h > item.y);
    while (collisions.length) {
      next = { ...next, y: Math.max(...collisions.map(item => item.y + item.h)) };
      collisions = placed.filter(item => next.x < item.x + item.w && next.x + next.w > item.x && next.y < item.y + item.h && next.y + next.h > item.y);
    }
    placed.push(next);
  }
  const positions = new Map(placed.map(chart => [chart.id, chart]));
  return charts.map(chart => positions.get(chart.id)!);
}
export function effectiveFilters(mode: FilterMode, global: Filter[], local: Filter[], fields?: string[]): Filter[] {
  const inherited = fields ? global.filter(filter => fields.includes(filter.field)) : global;
  return mode === 'global' ? inherited : mode === 'local' ? local : [...inherited, ...local];
}
export const publicReportAccess = document.documentElement.dataset.publicView === 'true';

export async function api(path: string, options?: RequestInit) {
  if (publicReportAccess) {
    const reportId = window.location.pathname.match(/^\/view\/([^/]+)$/)?.[1];
    if (!reportId) throw new Error(t('报表不存在或未发布'));
    if (path === `/dashboards/${decodeURIComponent(reportId)}/published`) path = '/published';
    path = '/public/' + reportId + path;
  }
  const response = await fetch('/api' + path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.detail?.code === 'type_conversion_required' ? t('字段类型与部分数据不一致，请调整类型或确认转换') : error.detail?.code === 'source_query_failed' ? `${t('数据库查询失败')}：${error.detail.message}` : error.detail?.code === 'source_validation_failed' ? t(error.detail.message) : Array.isArray(error.detail) ? error.detail.map((entry: { msg: string }) => t(entry.msg.replace(/^Value error, /, ''))).join('; ') : t(typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail || response.statusText));
    throw Object.assign(new Error(message), { detail: error.detail });
  }
  return response.status === 204 ? null : response.json();
}
export const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function fieldTypeIssues(error: unknown): Record<string, string[]> | undefined {
  const detail = (error as { detail?: { code: string; fields: { field: string; examples: string[] }[] } })?.detail;
  if (detail?.code !== 'type_conversion_required') return undefined;
  return Object.fromEntries(detail.fields.map(field => [field.field, field.examples]));
}
