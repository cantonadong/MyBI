import type { FieldFormats } from './fieldDisplay';
import { t } from './i18n';
import type { ChartConfig } from './charts/registry';
export type Filter = { sourceId?: string; datasetId?: string; field: string; op: string; value: unknown };
export type FilterMode = 'global' | 'local' | 'both';
export type Dataset = { snapshot_id?: string; data_as_of?: string; id: string; name: string; schema: { name: string; type: string; display_name?: string }[]; row_count: number; import_method?: 'paste' | 'upload' | null; filename?: string | null; version?: number; field_formats?: FieldFormats };
export type Tile = { id: string; datasetId: string; config: ChartConfig; filterMode: FilterMode; filters: Filter[]; x: number; y: number; w: number; h: number };
export type CanvasGrid = { columns: number; rows: number };
export type InsertSide = 'left' | 'right' | 'top' | 'bottom';
export type Document = { highlightWeekends?: boolean; charts: Tile[]; filters: Filter[]; datasets: Dataset[]; grid?: CanvasGrid };
export type SavedReport = { id: string; name: string; owner?: string | null; updated_at?: string | null };
export function controlFilters(tile: Tile, dataset?: Dataset): Filter[] {
  const c = tile.config;
  if (c.type !== 'filter' || !dataset) return [];
  const dimensions = new Set(dataset.schema.filter(field => ['string', 'date'].includes(field.type)).map(field => field.name));
  const scope = { sourceId: tile.id, datasetId: tile.datasetId };
  if (c.filterStyle === 'date-range') return c.dimension && dimensions.has(c.dimension) && c.filterRange?.every(Boolean) && c.filterRange[0] <= c.filterRange[1] ? [{ ...scope, field: c.dimension, op: 'date_between', value: c.filterRange }] : [];
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
function pushGridTiles(charts: Tile[], placed: Tile[]): Tile[] {
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
export async function api(path: string, options?: RequestInit) {
  const response = await fetch('/api' + path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.detail?.code === 'type_conversion_required' ? t('字段类型与部分数据不一致，请调整类型或确认转换') : t(typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail || response.statusText));
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
