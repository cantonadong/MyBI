import type { FieldFormats } from './fieldDisplay';
import { formatChartField, titleCase } from './fieldDisplay';
import { getChartLocale, t, translate } from './i18n';
import type { ChartConfig } from './charts/registry';
import { offlineViewQuery, type OfflineData, type OfflineRequest } from './offlineQuery';
// inTitle: the source filter has "应用到图表标题" on, so its selection is appended to chart titles.
export type Filter = { sourceId?: string; datasetId?: string; inTitle?: boolean; field: string; op: string; value: unknown };
export type FilterMode = 'global' | 'local' | 'both';
export type AnnotationFields = Record<'start' | 'end' | 'label', string> & { comment?: string };
export type Annotation = { comment?: string; start: string | null; end: string | null; label: string };
export type Dataset = { baseline_labels?: string[]; baseline_values?: Record<string, number> | Record<string, number>[]; owner?: string | null; updated_at?: string | null; storage_path?: string; local_id?: number; fingerprint?: string; annotation_merge?: boolean; annotation_fields?: Partial<AnnotationFields>; snapshot_id?: string; data_as_of?: string; id: string; name: string; schema: { name: string; type: string; display_name?: string }[]; row_count: number; import_method?: 'paste' | 'upload' | 'dynamic' | null; filename?: string | null; version?: number; field_formats?: FieldFormats; dynamic?: { duration_seconds?: number | null; last_run_at?: string | null; next_run_at?: string | null; last_error?: string | null; refreshing?: boolean; schedule: { enabled: boolean; time: string; timezone: string } } };
export type Tile = { id: string; tabId?: string; datasetId: string; config: ChartConfig; followFilterIds?: string[]; filterMode: FilterMode; filters: Filter[]; x: number; y: number; w: number; h: number };
export type ReportTab = { id: string; name: string };
export type DatasetFolder = { id: string; name: string; datasetIds: string[] };
export type CanvasGrid = { columns: number; rows: number };
export type InsertSide = 'left' | 'right' | 'top' | 'bottom';
export type Document = { rowScale?: number; colScale?: number; tabs?: ReportTab[]; datasetFolders?: DatasetFolder[]; orderedDatasets?: boolean; showGuides?: boolean; guideType?: 'thirds' | 'quarters' | 'sixths' | 'twelfths'; canvasWidth?: number; refreshSchedule?: { enabled: boolean; time: string; timezone: string }; highlightWeekends?: boolean; charts: Tile[]; filters: Filter[]; datasets: Dataset[]; grid?: CanvasGrid };
export type SavedReport = { id: string; pages?: number; published?: boolean; storage_path?: string; local_id?: number; fingerprint?: string; name: string; owner?: string | null; updated_at?: string | null };
export function chartTitle(config: ChartConfig, dataset?: Dataset, filters: Filter[] = [], locale = getChartLocale()): string {
  if (config.type === 'filter') return config.title || ''; // shown exactly as set in the properties sidebar
  const label = (name: string) => {
    const displayName = dataset?.schema.find(field => field.name === name)?.display_name;
    if (displayName && displayName !== name) return displayName;
    // Underscores become spaces; common metric abbreviations (DAU, ARPU …) are shown in capitals.
    return titleCase(name).replace(/_+/g, ' ').replace(/\b(?:[dwm]au|arp(?:p)?u|ltv|gmv|roi|ctr|cvr|cpa|cpc|cpm|cpi|kpi|pcu|acu|ccu)\b/gi, word => word.toUpperCase());
  };
  const multiple = ['bar', 'line', 'area', 'mixed', 'candlestick'].includes(config.type);
  const metrics = (multiple ? config.measures || [config.measure, config.secondMeasure] : [config.measure, ...(config.type === 'scatter' ? [config.secondMeasure] : [])]).filter((field): field is string => !!field).map(field => {
    const method = config.metricAggregations?.[field] || config.aggregation || 'sum';
    return label(field) + (method === 'sum' || ['scatter', 'histogram', 'boxplot', 'candlestick'].includes(config.type) ? '' : ` (${method})`);
  }).join(', ');
  // Automatic titles name only the metrics; dimensions are never appended.
  const title = config.autoTitle === false ? config.title || '' : metrics || config.title || '';
  const selections = filters.flatMap(filter => {
    const field = dataset?.schema.find(field => field.name === filter.field && ['string', 'date'].includes(field.type));
    if (!filter.inTitle || !field || !['in', 'date_between'].includes(filter.op)) return [];
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (!values.length || values.some(value => value === '' || value === undefined)) return [];
    return [titleCase(field.display_name || field.name) + ': ' + values.map(value => value === null ? translate(locale, '（空）') : titleCase(formatChartField(value, dataset?.field_formats?.[field.name], locale))).join(filter.op === 'date_between' ? ' – ' : ', ')];
  });
  return [title, ...new Set(selections)].filter(Boolean).join(' · ');
}
export function chartSort(config: ChartConfig): string {
  return config.sort || 'none';
}
// A filter applies to a chart when the chart's dataset has one of the filter's text/date fields (matched by name,
// across datasets), so one filter can drive every chart below it that shares the field.
export function filterMatchesChart(tile: Tile, filter: Tile, dataset?: Dataset): boolean {
  if (filter.config.type !== 'filter' || tile.config.type === 'filter' || !dataset) return false;
  const schema = dataset.schema.filter(field => ['string', 'date'].includes(field.type)).map(field => field.name);
  const fields = filter.config.filterStyle === 'cascade' ? filter.config.filterFields || [] : [filter.config.dimension];
  return fields.some(field => !!field && schema.includes(field));
}
// Default: the nearest applicable filter above the chart in the layout, however many charts sit in between.
// Explicit followFilterIds (chosen freely by the user) are kept as chosen; only applicable ones take effect.
export function followedFilterIds(tile: Tile, charts: Tile[], dataset?: Dataset): string[] {
  if (tile.followFilterIds) return charts.filter(chart => tile.followFilterIds!.includes(chart.id) && filterMatchesChart(tile, chart, dataset)).map(chart => chart.id);
  const above = charts.filter(chart => chart.y + chart.h <= tile.y && filterMatchesChart(tile, chart, dataset));
  above.sort((a, b) => (b.y + b.h) - (a.y + a.h) || Math.abs(a.x + a.w / 2 - tile.x - tile.w / 2) - Math.abs(b.x + b.w / 2 - tile.x - tile.w / 2) || a.x - b.x);
  return above.length ? [above[0].id] : [];
}
// Default filter titles ("筛选器 3" / "Filter 3") are canvas content: shown in the canvas language whatever they were created in.
export function filterTitle(title: string | undefined, locale = getChartLocale()): string {
  const number = /^(?:筛选器|Filter)\s*(\d+)$/.exec((title || '').trim())?.[1];
  return number ? translate(locale, '筛选器 {0}', [number]) : title || '';
}
// Default tab names ("标签页 2" / "Tab 2") are canvas content too.
export function tabTitle(name: string, locale = getChartLocale()): string {
  const number = /^(?:标签页|Tab)\s*(\d+)$/.exec(name.trim())?.[1];
  return number ? translate(locale, '标签页 {0}', [number]) : name;
}
export function nextFilterTitle(charts: Tile[]): string {
  const filters = charts.filter(chart => chart.config.type === 'filter');
  const number = Math.max(filters.length, ...filters.map(chart => Number(chart.config.title?.match(/\s(\d+)$/)?.[1]) || 0)) + 1;
  return translate(getChartLocale(), '筛选器 {0}', [number]);
}
// Pasted charts advance to the dataset's next metric after the copied chart's last one; at the final metric they keep it.
export function nextMetricConfig(config: ChartConfig, dataset?: Dataset): ChartConfig {
  const metrics = (dataset?.schema || []).filter(field => ['number', 'integer'].includes(field.type)).map(field => field.name);
  const current = (config.measures?.length ? config.measures : [config.measure]).filter((field): field is string => !!field);
  const index = current.length ? metrics.indexOf(current[current.length - 1]) : -1;
  if (config.type === 'filter' || index < 0 || index === metrics.length - 1) return config;
  const next = metrics[index + 1];
  return { ...config, measure: next, ...(config.measures ? { measures: [next] } : {}), ...(config.sortMeasure && current.includes(config.sortMeasure) ? { sortMeasure: next } : {}) };
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
  const scope = { sourceId: tile.id, datasetId: tile.datasetId, inTitle: !!c.filterInTitle };
  const dateField = dataset.schema.some(field => field.name === c.dimension && field.type === 'date');
  if (dateField && (c.filterStyle === 'date-range' || c.filterStyle === 'date-last')) {
    const range = c.filterStyle === 'date-last' ? lastDateRange(c.filterRange?.[1] || '', c.filterLastCount, c.filterLastUnit) : c.filterRange;
    return c.dimension && range?.every(Boolean) && range[0] <= range[1] ? [{ ...scope, field: c.dimension, op: 'date_between', value: range }] : c.filterRequired && c.dimension ? [{ ...scope, field: c.dimension, op: 'in', value: [] }] : [];
  }
  const fields = c.filterStyle === 'cascade' ? c.filterFields || [] : [c.dimension || ''];
  return fields.flatMap(field => dimensions.has(field) && (c.filterValues?.[field]?.length || c.filterRequired) ? [{ ...scope, field, op: 'in', value: c.filterValues?.[field] || [] }] : []);
}
// Canvas rows are 26px + 8px gap (34px per row). Documents saved before used 60px rows (68px per row): opening one
// doubles every y / h, which keeps the same pixel layout while allowing half-height filters.
export const ROW_HEIGHT = 26, ROW_GAP = 8, ROW_UNIT = ROW_HEIGHT + ROW_GAP;
export const MIN_CHART_ROWS = 6, MIN_FILTER_ROWS = 3, FILTER_DEFAULT_ROWS = 6;
// 24 columns (documents saved with 12 columns double x / w on open; same pixel layout). Charts and filters are at
// least 1/4 of the canvas wide; a row holds at most 4 side-by-side components.
export const GRID_COLUMNS = 24, MIN_CHART_COLS = 6, MIN_FILTER_COLS = 6, MAX_ROW_ITEMS = 4;
// Every component (filter or chart) is at least 1/4 of the canvas wide.
export const minWidth = (columns = GRID_COLUMNS) => Math.ceil(columns / 4);
export const minCols = (_tile: Tile, columns = GRID_COLUMNS) => minWidth(columns);
export function normalizeDocument(doc: Document): Document {
  let next = doc;
  if (doc.datasetFolders?.length) {
    const tabs = doc.tabs?.length ? doc.tabs : [{ id: 'main', name: t('标签页 {0}', 1) }];
    const migrated: DatasetFolder[] = [];
    for (const folder of doc.datasetFolders) {
      const tab = tabs.find(item => item.id === folder.id) || tabs.find(item => tabTitle(item.name) === tabTitle(folder.name));
      if (!tab) continue;
      const existing = migrated.find(item => item.id === tab.id);
      if (existing) existing.datasetIds = [...new Set([...existing.datasetIds, ...folder.datasetIds])];
      else migrated.push({ ...tab, datasetIds: folder.datasetIds });
    }
    next = { ...next, datasetFolders: migrated };
  }
  if (next.rowScale !== 2) next = { ...next, rowScale: 2, charts: (next.charts || []).map(chart => ({ ...chart, y: chart.y * 2, h: chart.h * 2 })), ...(next.grid ? { grid: { ...next.grid, rows: next.grid.rows * 2 } } : {}) };
  if (next.colScale !== 2) next = { ...next, colScale: 2, charts: next.charts.map(chart => ({ ...chart, x: chart.x * 2, w: chart.w * 2 })), ...(next.grid ? { grid: { ...next.grid, columns: next.grid.columns * 2 } } : {}) };
  // Components saved narrower than 1/4 widen to it; anything they now overlap moves down (per tab, reading order).
  const columns = gridFor(next).columns, min = minWidth(columns);
  if (next.charts.some(chart => chart.w < min)) {
    const tabOf = (chart: Tile) => chart.tabId || next.tabs?.[0]?.id || '';
    const widened = next.charts.map(chart => chart.w < min ? { ...chart, w: min, x: Math.max(0, Math.min(chart.x, columns - min)) } : chart);
    const positions = new Map([...new Set(widened.map(tabOf))].flatMap(tab => pushGridTiles(widened.filter(chart => tabOf(chart) === tab), []).map(chart => [chart.id, chart] as const)));
    next = { ...next, charts: widened.map(chart => positions.get(chart.id) || chart) };
  }
  return next;
}
export function gridFor(doc: Document): CanvasGrid {
  return doc.grid || { columns: GRID_COLUMNS, rows: Math.max(40, ...doc.charts.map(tile => tile.y + tile.h)) };
}
// Lay members out left to right across [left, right) in equal widths (remainder to the first ones).
function spreadRow(members: Tile[], left: number, right: number, height?: number): Tile[] {
  const base = Math.floor((right - left) / members.length);
  let extra = right - left - base * members.length, x = left;
  return members.map(member => { const w = base + (extra-- > 0 ? 1 : 0); const placed = { ...member, x, w, ...(height ? { h: height } : {}) }; x += w; return placed; });
}
// Refilled tiles replace their originals but are not pinned, so they can still be pushed out of the way.
const withRefill = (charts: Tile[], refilled: Tile[]) => charts.map(chart => refilled.find(item => item.id === chart.id) || chart);
// When a tile leaves a row of side-by-side tiles, the rest of that row widens to fill the space it left.
function refillOriginRow(charts: Tile[], moving: Tile, exclude: Set<string>): Tile[] {
  const row = charts.filter(chart => chart.id !== moving.id && chart.y === moving.y && !exclude.has(chart.id)).sort((a, b) => a.x - b.x);
  if (!row.length) return [];
  const all = [...row, moving];
  return spreadRow(row, Math.min(...all.map(chart => chart.x)), Math.max(...all.map(chart => chart.x + chart.w)));
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
export function insertGridTile(charts: Tile[], movingId: string, targetId: string, side: InsertSide, columns: number, snapWidth: (width: number, maxWidth: number) => number): Tile[] | null {
  const moving = charts.find(chart => chart.id === movingId), target = charts.find(chart => chart.id === targetId);
  if (!moving || !target || moving === target) return null;
  const isFilter = (tile: Tile) => tile.config.type === 'filter';
  const others = charts.filter(chart => chart.id !== moving.id);
  // A "row" is the tiles sharing the target's top edge.
  const row = others.filter(chart => chart.y === target.y).sort((a, b) => a.x - b.x);
  if (side === 'top' || side === 'bottom') {
    // Up / down: insert as a new row above / below the target's whole row (the row is never split); every tile from
    // that point down moves down by the dragged tile's height. The moved tile keeps its snapped width.
    const y = side === 'top' ? target.y : Math.max(...row.map(chart => chart.y + chart.h));
    const rest = withRefill(others, refillOriginRow(charts, moving, new Set())).map(chart => chart.y >= y ? { ...chart, y: chart.y + moving.h } : chart);
    const placed = { ...moving, y, x: 0, w: snapWidth(moving.w, columns) };
    return pushGridTiles([...rest, placed], [placed]); // also clears tall legacy tiles that span the insertion line
  }
  // Left / right: join the target's row next to the target. Filters and charts never share a row. Chart rows keep the
  // widths users sized (1/4, 1/3, 1/2 …) when the row still has at least 1/4 free, the dragged chart taking up to that
  // space; otherwise they split the full width equally (1:1, 1:1:1, 1:1:1:1, at most 4). Filter rows keep each
  // filter's own width and height, left to right.
  if (isFilter(moving) !== isFilter(target) || row.some(chart => isFilter(chart) !== isFilter(moving)) || row.length >= MAX_ROW_ITEMS) return null;
  const order = [...row];
  order.splice(order.indexOf(target) + (side === 'right' ? 1 : 0), 0, moving);
  const height = Math.max(...row.map(chart => chart.h));
  let placed: Tile[];
  if (isFilter(moving)) {
    const room = columns - row.reduce((sum, chart) => sum + chart.w, 0);
    if (room < minWidth(columns)) return null;
    let x = 0;
    placed = order.map(chart => { const w = chart.id === moving.id ? snapWidth(Math.min(chart.w, room), room) : chart.w; const next = { ...chart, x, w, y: target.y }; x += w; return next; });
  } else {
    if (Math.floor(columns / order.length) < minWidth(columns)) return null;
    const room = columns - row.reduce((sum, chart) => sum + chart.w, 0);
    if (room >= minWidth(columns)) {
      let x = 0;
      placed = order.map(chart => { const w = chart.id === moving.id ? snapWidth(Math.min(moving.w, room), room) : chart.w; const next = { ...chart, x, w, y: target.y, h: height }; x += w; return next; });
    } else placed = spreadRow(order, 0, columns, height).map(chart => ({ ...chart, y: target.y, w: chart.id === moving.id ? snapWidth(chart.w, chart.w) : chart.w }));
  }
  const sameRow = moving.y === target.y;
  return pushGridTiles(withRefill(charts, sameRow ? [] : refillOriginRow(charts, moving, new Set(order.map(chart => chart.id)))), placed);
}
// A horizontal move keeps the tile's size and drag anchor. Drops from another row centre the snapped tile in the gap.
export function placeInRowGap(charts: Tile[], movingId: string, rowY: number, column: number, columns: number, snapWidth: (width: number, maxWidth: number) => number, preferredX?: number): Tile[] | null {
  const moving = charts.find(chart => chart.id === movingId);
  if (!moving) return null;
  const isFilter = (tile: Tile) => tile.config.type === 'filter';
  const row = charts.filter(chart => chart.id !== movingId && chart.y === rowY);
  const sameRow = moving.y === rowY;
  if (!sameRow && (!row.length || row.length >= MAX_ROW_ITEMS || row.some(chart => isFilter(chart) !== isFilter(moving)))) return null;
  const h = sameRow || isFilter(moving) ? moving.h : Math.max(...row.map(chart => chart.h));
  // Everything (other than the dragged tile) overlapping the band the tile would occupy blocks columns.
  const blocking = charts.filter(chart => chart.id !== movingId && chart.y < rowY + h && chart.y + chart.h > rowY).sort((a, b) => a.x - b.x);
  let left = 0, gap: [number, number] | null = null;
  for (const chart of [...blocking, { x: columns, w: 0 } as Tile]) {
    if (column >= left && column < chart.x) { gap = [left, chart.x]; break; }
    left = Math.max(left, chart.x + chart.w);
  }
  if (!gap || gap[1] - gap[0] < moving.w) return null;
  const w = sameRow ? moving.w : snapWidth(moving.w, gap[1] - gap[0]);
  const x = Math.max(gap[0], Math.min(preferredX ?? column - Math.floor(w / 2), gap[1] - w));
  if (sameRow && x === moving.x) return null;
  return pushGridTiles(withRefill(charts, sameRow ? [] : refillOriginRow(charts, moving, new Set())), [{ ...moving, w, h, y: rowY, x }]);
}
// Tidy after a drop or delete: close rows the operation emptied, then stretch any chart that this operation left
// alone in its row (nothing beside it any more) to the full width. Charts already alone keep the width users sized.
export function arrangeAfterChange(before: Tile[], after: Tile[], columns: number, movingId?: string): Tile[] {
  const closed = closeVacatedRows(before, after);
  const alone = (charts: Tile[], chart: Tile) => !charts.some(other => other.id !== chart.id && other.y < chart.y + chart.h && other.y + other.h > chart.y);
  return closed.map(chart => {
    const previous = before.find(item => item.id === chart.id);
    return chart.id !== movingId && chart.config.type !== 'filter' && alone(closed, chart) && (!previous || !alone(before, previous)) ? { ...chart, x: 0, w: columns } : chart;
  });
}
// After a drag or delete, rows that had a component before but are now empty across the whole canvas (left behind
// by the moved/deleted tile or by tiles pushed away) are closed up, so the operation never leaves a gap the user
// did not make. Blank rows the user left on purpose were already empty before, so they are kept.
export function closeVacatedRows(before: Tile[], after: Tile[], _changedId?: string): Tile[] {
  const used = (charts: Tile[], row: number) => charts.some(chart => chart.y <= row && row < chart.y + chart.h);
  let charts = after;
  const last = Math.max(0, ...before.map(chart => chart.y + chart.h), ...after.map(chart => chart.y + chart.h));
  for (let row = last - 1; row >= 0; row--) {
    if (!used(before, row) || used(charts, row) || !charts.some(chart => chart.y > row)) continue;
    charts = charts.map(chart => chart.y > row ? { ...chart, y: chart.y - 1 } : chart);
  }
  return charts;
}
export function moveGridTile(charts: Tile[], movingId: string, at: { x: number; y: number }, columns: number): Tile[] | null {
  const moving = charts.find(chart => chart.id === movingId);
  if (!moving) return null;
  const w = Math.min(moving.w, columns);
  const placed = { ...moving, w, x: Math.max(0, Math.min(at.x, columns - w)), y: Math.max(0, at.y) };
  return pushGridTiles(withRefill(charts, placed.y === moving.y ? [] : refillOriginRow(charts, moving, new Set())), [placed]);
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
// Exported interactive page: the report and its dataset rows are embedded, and queries run in the browser.
export type ExportPayload = { report: { id: string; name: string; document: Document; theme: Record<string, unknown> }; canvasWidth?: number; data: Record<string, OfflineData & { snapshot_id?: string; data_as_of?: string }>; annotations: Record<string, unknown[]> };
export const offlineExport = (window as unknown as { __MYBI_EXPORT__?: ExportPayload }).__MYBI_EXPORT__;
export const publicReportAccess = !!offlineExport || document.documentElement.dataset.publicView === 'true';
export const portalId = !publicReportAccess ? window.location.pathname.match(/^\/portal\/([^/]+)$/)?.[1] : undefined;

function offlineApi(payload: ExportPayload, path: string, options?: RequestInit) {
  if (/^\/dashboards\/[^/]+\/published$/.test(path)) return JSON.parse(JSON.stringify(payload.report));
  const query = /^\/datasets\/([^/]+)\/view-query$/.exec(path);
  const source = query && payload.report.document.datasets.find(item => item.id === decodeURIComponent(query[1]));
  if (!query || !source) throw new Error(t('离线页面不支持此操作'));
  const request = JSON.parse(String(options?.body || '{}')) as OfflineRequest;
  const data = payload.data[source.id];
  if (request.chart_type === 'annotation') {
    const rows = payload.annotations[source.id] || [], offset = request.offset || 0;
    return { snapshot_id: data?.snapshot_id, rows: rows.slice(offset, request.limit ? offset + request.limit : undefined), legend_order: [] };
  }
  if (!data) throw new Error(t('离线页面缺少数据集数据'));
  return offlineViewQuery(data, Object.fromEntries(source.schema.map(field => [field.name, field.type])), request, { snapshot_id: data.snapshot_id, data_as_of: data.data_as_of });
}

export async function api(path: string, options?: RequestInit) {
  if (offlineExport) {
    try { return offlineApi(offlineExport, path, options); }
    catch (error) { throw new Error(t((error as Error).message)); }
  }
  if (publicReportAccess) {
    const reportId = window.location.pathname.match(/^\/view\/([^/]+)$/)?.[1];
    if (!reportId) throw new Error(t('报表不存在或未发布'));
    // /dashboards/{id}/published, /comment-counts, /charts/{chart}/comments → /public/{id}/…
    const own = `/dashboards/${decodeURIComponent(reportId)}`;
    if (path.startsWith(own + '/')) path = path.slice(own.length);
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
