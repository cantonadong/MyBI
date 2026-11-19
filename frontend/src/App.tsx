import { confirmAction } from './confirmAction';
import { defaultScheduleTime, formatUpdatedAt, localTimeZone } from './dateTime';
import { TimePicker } from './TimePicker';
import { getLocale, getChartLocale, setLanguage, setChartLanguage, setLocaleOverride, translate, t, useLanguage, useChartLanguage, type Language } from './i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { QueryResults } from './QueryResults';
import { Pagination } from './Pagination';
import { ReportTabs } from './ReportTabs';
import GridLayout, { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { ChartView } from './charts/ChartView';
import { chartRegistry, ChartConfig, ChartType } from './charts/registry';
import { api, publicReportAccess, offlineExport, portalId, setPortalReport, fieldTypeIssues, controlFilters, filterMatchesChart, followedFilterIds, nextFilterTitle, nextMetricConfig, normalizeDocument, closeVacatedRows, arrangeAfterChange, minCols, ROW_HEIGHT, ROW_GAP, ROW_UNIT, MIN_CHART_ROWS, MIN_FILTER_ROWS, minWidth, FILTER_DEFAULT_ROWS, chartTitle, chartSort, Dataset, Document, SavedReport, Filter, json, Tile, gridFor, findGridSpace, insertGridTile, moveGridTile, pushGridTiles, placeInRowGap, InsertSide } from './dashboard';
import { AnnotationImport, AnnotationRole } from './AnnotationImport';
import type { Annotation, AnnotationFields, ExportPayload } from './dashboard';
import { FieldBindings } from './FieldBindings';
import { FieldSettings } from './DatasetPreview';
import { ValueLabelsEditor } from './ValueLabelsEditor';
import { chartImage } from './chartImage';
import { Icon } from './Icon';
import { FilterControl, FilterProperties } from './FilterControl';
import { ReportsPage } from './ReportsPage';
import { UserProfile } from './UserProfile';
import { PublicAccessSettings, copyPublicReportLink } from './PublicAccessSettings';
import { CommentsPanel } from './CommentsPanel';
import { DynamicSource, executionError, queryDuration, DynamicSourceConfig, DynamicSourcePreview, DynamicSourceCache } from './DynamicSource';
import { ConnectionsSettings } from './ConnectionsSettings';
import { ScheduledQueries } from './ScheduledQueries';
import { PermissionsPage, PortalsPage, RolesPage, UsersPage } from './AccessPages';
import { TimezoneSelect } from './TimezoneSelect';
import { DatasetManager } from './DatasetManager';
import { chartColors, chartPalettes, randomChartColors } from './charts/palettes';

const LAST_CANVAS_WIDTH_KEY = 'mybi.lastCanvasWidth';
const lastCanvasWidth = () => { try { return Number(localStorage.getItem(LAST_CANVAS_WIDTH_KEY)) || undefined; } catch { return undefined; } };

const empty: Document = { rowScale: 2, colScale: 2, charts: [], filters: [], datasets: [] };
function nameWithTime(name: string, date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${name} ${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
// Left-menu modules shown as list pages (same layout as Datasets).
type ModulePanel = 'scheduled' | 'portals' | 'users' | 'roles' | 'permissions';
const modulePaths: Record<ModulePanel, string> = { scheduled: '/scheduled-queries', portals: '/portals', users: '/users', roles: '/roles', permissions: '/permissions' };
const moduleLabels = { portals: 'Portal', users: '用户管理', roles: '角色管理', permissions: '权限管理' } as const;
type PortalInfo = { id: string; name: string; reports: { id: string; name: string }[] };
// Default names count within the current report only: 数据集1, 2… or 标注1, 2… for annotation datasets.
function nextDatasetName(existing: { name: string }[], annotation = false) {
  const pattern = annotation ? /^(?:标注|Annotation )(\d+)$/ : /^(?:数据集|Dataset )(\d+)$/;
  return t(annotation ? '标注{0}' : '数据集{0}', Math.max(0, ...existing.map(item => Number(pattern.exec(item.name)?.[1] || 0))) + 1);
}
// The tag always shows the actual source kind (annotation datasets too); English tags are fixed 3-letter codes so the label width never changes.
function DatasetTag({ dynamic }: { dynamic?: unknown }) {
  const text = dynamic ? '动态' : '静态';
  return <span className="dataset-label">{getLocale() === 'en' ? t('tag:' + text) : text}</span>;
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}
function fieldChangeMessage(previous: any[] | undefined, schema: any[]) {
  if (!previous) return '';
  const before = new Set(previous.map(field => field.source || field.name));
  const after = new Set(schema.map(field => field.source || field.name));
  return t('字段重新识别：{0} → {1}，新增 {2}，移除 {3}', previous.length, schema.length, [...after].filter(field => !before.has(field)).length, [...before].filter(field => !after.has(field)).length);
}
function annotationFieldSettings(preview: any, roles: AnnotationRole[]) {
  const formats = { ...preview.field_formats };
  const schema = preview.schema.map((field: any, index: number) => {
    if (!roles[index]) return field;
    const name = field.source || field.name;
    formats[name] = { kind: 'text', format: 'number', decimals: 0, ...(['label', 'comment'].includes(roles[index]) ? formats[name]?.valueLabels ? { valueLabels: formats[name].valueLabels } : {} : { dateFormat: formats[name]?.dateFormat || 'MMM d' }) };
    return { ...field, type: ['label', 'comment'].includes(roles[index]) ? 'string' : 'date' };
  });
  return { ...preview, schema, field_formats: formats };
}
function datasetDisplayName(source?: Dataset) {
  if (!source) return '';
  return source.updated_at || source.data_as_of ? `${source.name} ${formatUpdatedAt(source.updated_at || source.data_as_of)}` : source.name;
}
function navigateTo(path: string, replace = false) {
  if (offlineExport || portalId) return; // exported file:// pages and portal pages keep their own URL
  if (window.location.pathname + window.location.search + window.location.hash !== path) window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}


type ChartResult = { rows: Record<string, unknown>[]; data_as_of?: string; config?: ChartConfig };
// Recent chart query results by dataset version + request; bounded so long sessions don't grow without limit.
const chartResults = new Map<string, ChartResult>();
function rememberChartResult(key: string, value: ChartResult) {
  chartResults.delete(key); chartResults.set(key, value);
  while (chartResults.size > 300) chartResults.delete(chartResults.keys().next().value!);
}
function chartRequest(config: ChartConfig, dataset: Dataset, global: Filter[], page: number, pageSize: number, published: boolean) {
  const raw = ['scatter', 'histogram', 'boxplot', 'table', 'candlestick'].includes(config.type);
  // Followed filters are already scoped to this chart; they may come from another dataset sharing the field name.
  const filters = global.filter(filter => dataset.schema.some(field => field.name === filter.field && ['string', 'date'].includes(field.type))).filter(f => f.op === 'is_null' || (Array.isArray(f.value) ? f.value.every(v => v !== '') : f.value !== '')).map(({ field, op, value }) => ({ field, op, value }));
  return JSON.stringify({ ...(published ? { snapshot_id: dataset.snapshot_id } : {}), fields: dataset.schema.map(f => f.name), filters, limit: config.type === 'table' ? Math.min(pageSize, config.limit ? config.limit - page * pageSize : pageSize) : config.limit || null, offset: config.type === 'table' ? page * pageSize : 0, dimension: ['kpi', 'gauge'].includes(config.type) ? undefined : config.dimension, dimensions: ['bar', 'line', 'area', 'mixed'].includes(config.type) ? config.dimensions : undefined, measure: config.measure, measures: ['bar', 'line', 'area', 'mixed', 'candlestick'].includes(config.type) ? config.measures : undefined, second_measure: ['bar', 'line', 'area', 'mixed', 'scatter'].includes(config.type) ? config.secondMeasure : undefined, second_dimension: ['bar', 'line', 'area', 'mixed'].includes(config.type) ? config.legendField || undefined : ['tree', 'treemap', 'sunburst', 'sankey', 'heatmap'].includes(config.type) ? config.secondDimension : undefined, chart_type: config.type, sort_measure: (config.measures || [config.measure, config.secondMeasure]).includes(config.sortMeasure) ? config.sortMeasure : undefined, ...(!raw ? { aggregation: config.aggregation || 'sum', metric_aggregations: Object.fromEntries(Object.entries(config.metricAggregations || {}).filter(([field]) => (config.measures || [config.measure, config.secondMeasure]).includes(field))), metric_expression: config.expression || undefined } : {}), sort: chartSort(config) });
}

function ChartTile({ tile, dataset, global: incomingFilters, showUpdatedAt, theme, highlightWeekends, annotations, published = false }: { annotations: Annotation[]; highlightWeekends?: boolean; published?: boolean; theme: { palette: string; colors?: string[]; locale?: 'en' | 'zh-CN' }; tile: Tile; dataset?: Dataset; global: Filter[]; showUpdatedAt: boolean }) {
  const filterKey = JSON.stringify(incomingFilters);
  const global = useMemo(() => JSON.parse(filterKey) as Filter[], [filterKey]);
  const { locale: defaultLocale } = useChartLanguage();
  const locale = theme.locale || defaultLocale;
  const t = (text: string, ...values: unknown[]) => translate(locale, text, values);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requestedPage, setPage] = useState(0);
  const pageSize = 10;
  const config = tile.config;
  const page = config.type === 'table' && config.limit ? Math.min(requestedPage, Math.ceil(config.limit / pageSize) - 1) : requestedPage;
  const hasField = (name?: string) => !!dataset?.schema.some(field => field.name === name);
  const configured = !!dataset && (config.type !== 'candlestick' || config.measures?.length === 4 && config.measures.every(hasField)) && (!['bar', 'line', 'area', 'mixed'].includes(config.type) || (config.dimensions || []).every(hasField)) && (config.type === 'table' || (hasField(config.measure) && (['kpi', 'gauge', 'histogram', 'boxplot'].includes(config.type) || hasField(config.dimension)) && (!['heatmap', 'sankey'].includes(config.type) || hasField(config.secondDimension)) && (config.type !== 'map' || !!config.mapGeoJSON)));
  const request = configured && dataset ? chartRequest(config, dataset, global, page, pageSize, published) : '';
  // Same request on the same dataset version → reuse the cached result (switching report tabs remounts the canvas).
  const cacheKey = request && dataset ? [dataset.id, dataset.snapshot_id || '', dataset.version || '', dataset.data_as_of || '', dataset.updated_at || '', request].join('|') : '';
  const [result, setResult] = useState<ChartResult>(() => chartResults.get(cacheKey) || { rows: [] });
  // Cached results render without the entry animation, so revisiting a tab shows charts immediately.
  const [fromCache, setFromCache] = useState(() => chartResults.has(cacheKey));
  const dataConfig = result.config ? Object.fromEntries((['dimension', 'dimensions', 'measure', 'measures', 'secondMeasure', 'secondDimension', 'legendField', 'legendOrder', 'aggregation', 'metricAggregations', 'expression'] as const).map(key => [key, result.config![key]])) : {};
  const displayConfig = useMemo(() => ({ ...tile.config, ...dataConfig, title: chartTitle({ ...tile.config, ...dataConfig }, dataset, global, locale), ...theme, highlightWeekends, annotations: tile.config.showAnnotations && dataset?.schema.find(field => field.name === tile.config.dimension)?.type === 'date' ? annotations : [], locale, colors: theme.palette === 'random' ? randomChartColors(tile.id) : theme.colors, fieldFormats: dataset?.field_formats }), [tile.config, result.config, tile.id, theme, highlightWeekends, annotations, dataset?.schema, dataset?.field_formats, global, locale]);
  useEffect(() => setPage(0), [config.type, config.dimension, config.dimensions, config.measure, config.measures, config.secondMeasure, config.secondDimension, config.legendField, config.aggregation, config.metricAggregations, config.sortMeasure, config.expression, config.sort, config.xAxisSort, config.limit, global, pageSize]);
  useEffect(() => {
    if (!configured || !dataset) { setError(''); setResult({ rows: [] }); setLoading(false); return; }
    const cached = chartResults.get(cacheKey);
    if (cached) { setResult(cached); setFromCache(true); setError(''); setLoading(false); return; }
    let active = true;
    setLoading(true); setError(''); setFromCache(false);
    const config = tile.config;
    api(`/datasets/${dataset.id}/view-query`, { ...json({}), body: request })
      .then(data => { const value = { ...data, config: { ...config, legendOrder: data.legend_order } }; rememberChartResult(cacheKey, value); if (active) setResult(value); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cacheKey, configured]);
  if (!configured) return config.type === 'candlestick' ? <p className="tile-error">{t('请选择开盘、收盘、最低、最高四个数值字段')}</p> : null;
  return <>{error ? <div role="alert" className="tile-error">{error}</div> : loading && !result.rows.length ? <p className="tile-error">{t("加载中…")}</p> : result.rows.length || tile.config.type === 'table' ? <ChartView config={displayConfig} rows={result.rows} page={page} pageSize={pageSize} onPageChange={setPage} animate={!fromCache} /> : <p className="tile-error">{t("没有符合筛选条件的数据")}</p>}{showUpdatedAt && result.data_as_of && <small className="data-time">{t("更新时间")} {formatUpdatedAt(result.data_as_of)}</small>}</>;
}

export default function App() {
  const { language } = useLanguage();
  const { chartLanguage } = useChartLanguage();
  const [doc, setDoc] = useState<Document>(empty), [selected, setSelected] = useState(''), [name, setName] = useState(() => nameWithTime(t('未命名报表')));
  const [activeTabId, setActiveTabId] = useState('');
  const [openingReport, setOpeningReport] = useState(false);
  const tabs = doc.tabs?.length ? doc.tabs : [{ id: 'main', name: t('标签页 {0}', 1) }];
  const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0];
  const tabCharts = useMemo(() => doc.charts.filter(chart => (chart.tabId || tabs[0].id) === activeTab.id), [doc.charts, tabs[0].id, activeTab.id]);
  const [id, setId] = useState(''), [version, setVersion] = useState(1), [dirty, setDirty] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { document: Document; name: string; version: number; selected: string; activeDatasetId: string; importedIds: string[] }>>(() => {
    try { const stored = JSON.parse(localStorage.getItem('mybi.report-drafts') || '{}'); return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}; } catch { return {}; }
  });
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [toast, setToast] = useState({ text: '', id: 0 });
  const message = toast.text;
  const setMessage = (text: string) => setToast(previous => ({ text, id: previous.id + 1 }));
  const [dashboards, setDashboards] = useState<SavedReport[]>([]), [datasets, setDatasets] = useState<Dataset[]>([]);
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const workspaceScroll = useRef<HTMLDivElement>(null);
  const [viewportRows, setViewportRows] = useState(12);
  // Bumped after every drag / resize so react-grid-layout always re-syncs to the saved layout. It only re-reads the
  // layout prop when it changes, and otherwise keeps its own (overlap-allowing) drag positions on screen.
  const [layoutRevision, setLayoutRevision] = useState(0);
  // Resizing a single tile snaps its width to 1/3, 1/2 or 2/3 of the canvas when within one column of it.
  const [resizing, setResizing] = useState(false);
  // The dragged component's original place stays outlined while dragging.
  const [draggingId, setDraggingId] = useState('');
  const [chartsScrolling, setChartsScrolling] = useState(false);
  const scrollTimer = useRef<number>();
  const importDialog = useRef<HTMLDialogElement>(null);
  const datasetPicker = useRef<HTMLDetailsElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const sidebarDrag = useRef<{ side: 'left' | 'right'; x: number; width: number } | null>(null);
  const [showImport, setShowImport] = useState(false), [paste, setPaste] = useState(''), [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<'static' | 'dynamic'>(() => { try { return localStorage.getItem('mybi.import-source-kind') === 'dynamic' ? 'dynamic' : 'static'; } catch { return 'static'; } });
  const lastSourceKind = useRef(sourceKind);
  const selectSourceKind = (kind: 'static' | 'dynamic') => { setSourceKind(kind); lastSourceKind.current = kind; try { localStorage.setItem('mybi.import-source-kind', kind); } catch { setMessage(t('无法保存设置，请检查浏览器存储权限')); } };
  const [asAnnotation, setAsAnnotation] = useState(false);
  const [mergeAnnotations, setMergeAnnotations] = useState(false);
  const [refreshingReport, setRefreshingReport] = useState(false);
  const [queryResults, setQueryResults] = useState<Dataset | null>(null);
  const [resultPage, setResultPage] = useState(0);
  const [annotationOrder, setAnnotationOrder] = useState<AnnotationRole[]>(['label', 'start', 'end', 'comment']);
  const [annotations, setAnnotations] = useState<Annotation[]>([]), [annotationError, setAnnotationError] = useState('');
  const annotationSources = datasets.filter(source => importedIds.includes(source.id) && Object.keys(source.annotation_fields || {}).length);
  const annotationKey = JSON.stringify(annotationSources.map(source => [source.id, source.snapshot_id, source.annotation_fields]));
  useEffect(() => {
    let active = true;
    setAnnotations([]); setAnnotationError('');
    Promise.all(annotationSources.map(async source => {
      const rows: Annotation[] = [];
      let snapshot = source.snapshot_id;
      for (let offset = 0; ; offset += 1000) {
        if (!active) return [];
        const result = await api(`/datasets/${source.id}/view-query`, json({ fields: Object.values(source.annotation_fields!), chart_type: 'annotation', snapshot_id: snapshot, limit: 1000, offset }));
        snapshot = result.snapshot_id; rows.push(...result.rows);
        if (result.rows.length < 1000) return rows;
      }
    })).then(results => { if (active) setAnnotations(results.flat()); }).catch(error => { if (active) setAnnotationError(error.message); });
    return () => { active = false; };
  }, [annotationKey]);
  const [dynamicDraft, setDynamicDraft] = useState<DynamicSourceConfig | null>(null);
  const dynamicCache = useRef<DynamicSourceCache>({ previews: new Map() });
  const [dynamicQuerying, setDynamicQuerying] = useState(false);
  const [dynamicReady, setDynamicReady] = useState(false);
  const [sheets, setSheets] = useState<string[]>([]), [sheet, setSheet] = useState(''), [preview, setPreview] = useState<any>(null), [busy, setBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState(publicReportAccess);
  const [publishedView, setPublishedView] = useState(publicReportAccess);
  const [publishing, setPublishing] = useState(false);
  const [permissionReport, setPermissionReport] = useState(''), [portal, setPortal] = useState<PortalInfo | null>(null), [portalReportId, setPortalReportId] = useState(''), [publishedTheme, setPublishedTheme] = useState<{ palette: string; colors?: string[]; locale?: 'en' | 'zh-CN'; canvasWidth?: number }>({ palette: 'modern' });
  const [commentChart, setCommentChart] = useState('');
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setCommentCounts({}); if (!id || offlineExport) return;
    let active = true;
    api(`/dashboards/${id}/comment-counts`).then(value => { if (active) setCommentCounts(value); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [id, publishedView]);
  const [panel, setPanel] = useState<'charts' | 'history' | ModulePanel>('charts');
  const [showReports, setShowReports] = useState(!publicReportAccess);
  const [reportAction, setReportAction] = useState<{ kind: 'new' } | { kind: 'delete'; report: SavedReport } | null>(null);
  const reportDialog = useRef<HTMLDialogElement>(null);
  const [reportBusy, setReportBusy] = useState(false), [reportError, setReportError] = useState('');
  useEffect(() => { if (reportAction) { setReportError(''); reportDialog.current?.showModal(); } }, [reportAction]);
  const [savedDatasets, setSavedDatasets] = useState<Dataset[]>([]), [activeDatasetId, setActiveDatasetId] = useState('');
  const grid = { ...gridFor({ ...doc, charts: tabCharts }), rows: Math.max(viewportRows, Math.max(0, ...tabCharts.map(chart => chart.y + chart.h)) + (previewMode ? 0 : 4)) };
  // side 'gap': landing in blank space beside a row at the chart's own width; row: the joined row's top (grid y).
  const [insertion, setInsertion] = useState<{ charts: Tile[]; movingId: string; targetId?: string; side?: InsertSide | 'gap'; row?: number } | null>(null);
  const insertionRef = useRef<typeof insertion>(null);
  const dragAnchor = useRef({ x: 0, y: 0 });
  const [deleted, setDeleted] = useState<{ chart: Tile; index: number; expiresAt: number; session: number } | null>(null);
  const [editingSource, setEditingSource] = useState(false), [editingField, setEditingField] = useState('');
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const dynamicImport = editingDataset ? !!editingDataset.dynamic : sourceKind === 'dynamic';
  const [viewingDataset, setViewingDataset] = useState(false);
  const [copied, setCopied] = useState<Tile | null>(null), [pasteArmed, setPasteArmed] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null), pasteAt = useRef<{ x: number; y: number }>();
  // One width for every kept-alive tab grid, measured on the always-visible canvas surface. RGL's WidthProvider
  // measured each grid itself: hidden tabs collapsed to width 0 and never recovered, and first renders animated
  // from a default 1280px. Zero widths (hidden / detached) are ignored.
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const surfaceObserver = useRef<ResizeObserver>();
  const setCanvasNode = useCallback((node: HTMLDivElement | null) => {
    canvasRef.current = node;
    surfaceObserver.current?.disconnect();
    if (!node) return;
    // The last editor canvas width is remembered so publishing from the reports list can still center the page.
    const measure = () => { if (node.clientWidth > 0) { setSurfaceWidth(node.clientWidth); try { localStorage.setItem(LAST_CANVAS_WIDTH_KEY, String(node.clientWidth)); } catch { /* storage unavailable */ } } };
    surfaceObserver.current = new ResizeObserver(measure);
    surfaceObserver.current.observe(node);
    measure();
  }, []);
  const activeDataset = datasets.find(item => item.id === activeDatasetId);
  const [encoding, setEncoding] = useState('utf-8-sig'), [delimiter, setDelimiter] = useState('');
  const [hasHeader, setHasHeader] = useState(true), [datasetName, setDatasetName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState('profile');
  useEffect(() => { if (showSettings) setSettingsSection('profile'); }, [showSettings]);
  const [theme, setTheme] = useState<{ palette: string; colors?: string[]; locale?: 'en' | 'zh-CN' }>(() => {
    try { const value = JSON.parse(localStorage.getItem('mybi.chart-theme') || 'null'); if (value && [...chartPalettes.map(item => item.id), 'random', 'custom'].includes(value.palette)) return value; } catch {}
    return { palette: chartPalettes[0].id };
  });
  const updateTheme = (value: { palette: string; colors?: string[]; locale?: 'en' | 'zh-CN' }) => {
    try { localStorage.setItem('mybi.chart-theme', JSON.stringify(value)); setTheme(value); }
    catch { setMessage(t('\u65e0\u6cd5\u4fdd\u5b58\u8bbe\u7f6e\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u5b58\u50a8\u6743\u9650')); }
  };
  const editorPath = id ? '/reports/' + encodeURIComponent(id) : '/reports/new';
  const activePath = showSettings ? '/settings' : showReports ? '/reports' : panel === 'history' ? '/datasets' : panel in modulePaths ? modulePaths[panel as ModulePanel] : editorPath;

  useEffect(() => {
    if (showImport) {
      setSourceKind(editingDataset ? editingDataset.dynamic ? 'dynamic' : 'static' : lastSourceKind.current);
      const roles = editingDataset?.annotation_fields;
      setAsAnnotation(!!roles && !!Object.keys(roles).length); setMergeAnnotations(!!editingDataset?.annotation_merge);
      setAnnotationOrder(roles && Object.keys(roles).length ? editingDataset!.schema.map(field => (Object.keys(roles) as AnnotationRole[]).find(role => roles[role] === field.name)!).filter(Boolean) : ['label', 'start', 'end', 'comment']);
      setDynamicDraft(null); setDynamicReady(false);
      if (!editingDataset) { setPaste(''); setFile(null); setSheets([]); setSheet(''); setPreview(null); setDatasetName(''); setMessage(''); }
      importDialog.current?.showModal();
    }
  }, [showImport]);
  useEffect(() => { document.title = publishedView ? name : 'MyBI'; }, [publishedView, name]);
  useEffect(() => {
    const closePicker = (event: PointerEvent) => { if (datasetPicker.current && !datasetPicker.current.contains(event.target as Node)) datasetPicker.current.open = false; };
    document.addEventListener('pointerdown', closePicker);
    return () => document.removeEventListener('pointerdown', closePicker);
  }, []);
  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);
  useEffect(() => {
    const preventSelectAll = (event: KeyboardEvent) => {
      const target = event.target;
      const input = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(target.type)) || (target instanceof HTMLElement && target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !input) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('keydown', preventSelectAll, true);
    return () => document.removeEventListener('keydown', preventSelectAll, true);
  }, []);
  useEffect(() => {
    const viewport = workspaceScroll.current;
    const resize = () => { if (viewport?.clientHeight) setViewportRows(Math.max(10, Math.floor((viewport.clientHeight - 12) / ROW_UNIT))); };
    const observer = new ResizeObserver(resize);
    if (viewport) observer.observe(viewport);
    resize();
    return () => observer.disconnect();
  }, [showSettings, showReports]);

  const setSidebarWidth = (side: 'left' | 'right', width: number) => {
    const root = appRef.current!;
    const style = getComputedStyle(root), tracks = style.gridTemplateColumns.split(' ').map(parseFloat);
    const minimum = parseFloat(style.getPropertyValue(`--${side}-min`));
    const maximum = root.clientWidth - tracks[0] - tracks[side === 'left' ? 3 : 1] - 280;
    root.style.setProperty(`--${side}-width`, Math.max(minimum, Math.min(width, maximum)) + 'px');
  };
  const sidebarResizer = (side: 'left' | 'right') => <div className={`sidebar-resizer resize-${side}`} role="separator" aria-label={side === 'left' ? t("调整图表栏宽度") : t("调整配置栏宽度")} aria-orientation="vertical" tabIndex={0}
    onPointerDown={e => { e.preventDefault(); const width = e.currentTarget.parentElement!.getBoundingClientRect().width; sidebarDrag.current = { side, x: e.clientX, width }; e.currentTarget.setPointerCapture(e.pointerId); appRef.current!.classList.add('resizing-sidebar'); }}
    onPointerMove={e => { const drag = sidebarDrag.current; if (drag?.side === side) setSidebarWidth(side, drag.width + (e.clientX - drag.x) * (side === 'left' ? 1 : -1)); }}
    onPointerUp={e => { sidebarDrag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); appRef.current!.classList.remove('resizing-sidebar'); }}
    onPointerCancel={() => { sidebarDrag.current = null; appRef.current!.classList.remove('resizing-sidebar'); }}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setSidebarWidth(side, e.currentTarget.parentElement!.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 12 : -12) * (side === 'left' ? 1 : -1)); } }} />;
  const [defaultDecimals, setDefaultDecimals] = useState(() => {
    try { const saved = localStorage.getItem('data-workbench.default-decimals'); const value = saved === null ? 1 : Number(saved); return Number.isInteger(value) && value >= 1 && value <= 8 ? value : 1; }
    catch { return 1; }
  });
  const [defaultRounding, setDefaultRounding] = useState<'halfExpand' | 'trunc'>(() => {
    try { return localStorage.getItem('data-workbench.default-rounding') === 'trunc' ? 'trunc' : 'halfExpand'; }
    catch { return 'halfExpand'; }
  });
  const [showUpdatedAt, setShowUpdatedAt] = useState(() => {
    try { return localStorage.getItem('data-workbench.show-updated-at') === 'true'; }
    catch { return false; }
  });
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try { return localStorage.getItem('data-workbench.autosave-enabled') === 'true'; } catch { return false; }
  });
  const [autoSaveMinutes, setAutoSaveMinutes] = useState(() => {
    try { const value = Number(localStorage.getItem('data-workbench.autosave-minutes')); return Number.isInteger(value) && value >= 1 && value <= 1440 ? value : 10; } catch { return 10; }
  });
  useEffect(() => {
    if (!message || (showImport && !preview?.typeIssues)) return;
    const timer = window.setTimeout(() => setMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [toast.id, showImport, preview?.typeIssues]);
  const detectedPreview = useRef<any>(null);
  const reviewedImport = useRef('');
  useEffect(() => {
    reviewedImport.current = '';
    if (preview?.typeIssues) { setPreview((previous: any) => ({ ...previous, typeIssues: undefined })); setMessage(''); }
  }, [preview?.schema, preview?.field_formats, file, paste, sheet, encoding, delimiter, hasHeader, datasetName]);
  const uploadInput = useRef<HTMLInputElement>(null);
  const selectImportFile = (selected: File | null) => {
    if (selected && !/\.(csv|xlsx?)$/i.test(selected.name)) { setMessage(t("请选择 CSV、XLS 或 XLSX 文件")); return; }
    setEditingSource(true); setFile(selected); setSheets([]); setSheet(''); setMessage('');
  };
  const history = useRef<Document[]>([]), future = useRef<Document[]>([]);
  const current = useRef({ doc, name, datasets }); current.current = { doc, name, datasets };
  const session = useRef(0), saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    if (!id || !dirty) return;
    setDrafts(previous => ({ ...previous, [id]: { document: { ...doc, datasets: datasets.filter(source => importedIds.includes(source.id)) }, name, version, selected, activeDatasetId, importedIds } }));
  }, [id, dirty, doc, name, datasets, version, selected, activeDatasetId, importedIds]);
  useEffect(() => {
    try { localStorage.setItem('mybi.report-drafts', JSON.stringify(drafts)); }
    catch { setMessage(t('\u65e0\u6cd5\u8bb0\u5f55\u672c\u5730\u8349\u7a3f\uff0c\u8bf7\u4e3b\u52a8\u4fdd\u5b58')); }
  }, [drafts]);
  const clearDraft = (reportId: string) => setDrafts(previous => { const next = { ...previous }; delete next[reportId]; return next; });
  const tile = tabCharts.find(chart => chart.id === selected);
  const dataset = datasets.find(item => item.id === (tile?.datasetId || (importedIds.includes(activeDatasetId) ? activeDatasetId : importedIds[0])));
  // All tabs' filter values: hidden (kept-alive) tabs keep rendering with their own filters.
  const candidateFilters = doc.charts.flatMap(chart => controlFilters(chart, datasets.find(source => source.id === chart.datasetId)));
  const filterSignature = JSON.stringify(candidateFilters);
  const canvasFilters = useMemo(() => candidateFilters, [filterSignature]);
  const dynamicDatasetIds = JSON.stringify(datasets.filter(source => importedIds.includes(source.id) && source.dynamic).map(source => source.id).sort());
  useEffect(() => {
    if (dynamicDatasetIds === '[]') return;
    let active = true;
    const refreshDatasets = () => {
      if (document.hidden) return;
      api('/datasets').then((items: Dataset[]) => {
        if (!active) return;
        setSavedDatasets(items);
        setDatasets(previous => previous.map(source => {
          const next = source.dynamic && items.find(item => item.id === source.id);
          return next && JSON.stringify(next) !== JSON.stringify(source) ? next : source;
        }));
      }).catch(error => { if (active) setMessage(error.message); });
    };
    const timer = window.setInterval(refreshDatasets, 15000);
    window.addEventListener('focus', refreshDatasets);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refreshDatasets); };
  }, [id, publishedView, dynamicDatasetIds]);
  // Published pages drop the empty rows above a tab's first chart.
  const displayFor = (charts: Tile[]) => { const top = publishedView && charts.length ? Math.min(...charts.map(chart => chart.y)) : 0; return publishedView ? charts.map(chart => ({ ...chart, y: chart.y - top })) : charts; };
  const displayCharts = displayFor(tabCharts);
  const chartsOfTab = (tabId: string) => tabId === activeTab.id ? tabCharts : doc.charts.filter(chart => (chart.tabId || tabs[0].id) === tabId);
  // Tabs already shown stay mounted (hidden) so switching back is instant instead of rebuilding every chart.
  const [visitedTabs, setVisitedTabs] = useState<string[]>([]);
  useEffect(() => { setVisitedTabs([]); }, [id, publishedView]);
  useEffect(() => { setVisitedTabs(previous => previous.includes(activeTab.id) ? previous : [...previous, activeTab.id]); }, [activeTab.id, id, publishedView]);
  const keptTabs = [...visitedTabs.filter(tabId => tabs.some(tab => tab.id === tabId)), ...(visitedTabs.includes(activeTab.id) ? [] : [activeTab.id])];
  const displayColumns = grid.columns;
  const displayRows = Math.max(publishedView ? 1 : viewportRows, ...displayCharts.map(chart => chart.y + chart.h));
  const annotationCharts = doc.charts.filter(chart => ['bar', 'line', 'area', 'mixed', 'candlestick', 'waterfall', 'boxplot', 'heatmap'].includes(chart.config.type) && !chart.config.horizontal && datasets.find(source => source.id === chart.datasetId)?.schema.some(field => field.name === chart.config.dimension && field.type === 'date'));
  const reportSchedule = doc.refreshSchedule || { enabled: false, time: defaultScheduleTime(), timezone: localTimeZone() };
  // Published view and exported page center the canvas at the width it had in the editor.
  useEffect(() => { setLocaleOverride(publishedView ? publishedTheme.locale || null : null); }, [publishedView, publishedTheme.locale]);
  const publishedCanvasWidth = publishedView ? offlineExport?.canvasWidth || publishedTheme.canvasWidth || doc.canvasWidth : undefined;
  // Published / exported pages: line the first tab up with the canvas content's left edge by measuring both
  // (padding, scrollbars and centring make a pure CSS formula drift).
  const publishedWorkspace = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const main = publishedWorkspace.current;
    if (!publishedView || !main) return;
    const align = () => {
      // Measure the tab list container, not a tab: the list scrolls horizontally to show the active tab.
      const bar = main.querySelector<HTMLElement>(':scope > .report-tabs-top'), list = bar?.querySelector<HTMLElement>('[role=tablist]'), surface = canvasRef.current;
      if (!bar || !list || !surface) return;
      const delta = surface.getBoundingClientRect().left - list.getBoundingClientRect().left;
      if (Math.abs(delta) > 0.5) bar.style.paddingLeft = Math.max(0, (parseFloat(getComputedStyle(bar).paddingLeft) || 0) + delta) + 'px';
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(main);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [publishedView, tabs.length, publishedCanvasWidth, surfaceWidth]);
  // Published pages: scrolling down tucks the tab bar away, scrolling up brings it back.
  useEffect(() => {
    const scroller = workspaceScroll.current, main = publishedWorkspace.current;
    if (!publishedView || !scroller || !main) return;
    let last = scroller.scrollTop, hidden = false;
    const show = (next: boolean) => {
      const bar = main.querySelector<HTMLElement>(':scope > .report-tabs-top');
      if (!bar || next === hidden) return;
      hidden = next;
      bar.style.marginTop = next ? `-${bar.offsetHeight}px` : '0px';
    };
    const scroll = () => {
      const top = scroller.scrollTop, delta = top - last;
      if (Math.abs(delta) < 4) return;
      show(delta > 0 && top > 24);
      last = top;
    };
    scroller.addEventListener('scroll', scroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', scroll); show(false); };
  }, [publishedView, id, tabs.length]);
  const pageFilters = tabCharts.filter(chart => chart.config.type === 'filter');
  const filterIds = tile ? followedFilterIds(tile, tabCharts, dataset) : [];
  // Charts may pick any filter on the page; the selection is stored as-is and applies where the field exists.
  const chosenFilterIds = tile ? tile.followFilterIds ?? filterIds : [];
  const setChartFilters = (chart: Tile, ids: string[]) => change({ ...doc, charts: tabCharts.map(item => item.id === chart.id ? { ...item, followFilterIds: ids } : item) });
  const chartFilters = (chart: Tile, charts = tabCharts) => canvasFilters.filter(filter => !!filter.sourceId && followedFilterIds(chart, charts, datasets.find(source => source.id === chart.datasetId)).includes(filter.sourceId));
  const change = (next: Document, wholeReport = false) => {
    if (!wholeReport && next.charts !== doc.charts) next = { ...next, charts: [...doc.charts.filter(chart => (chart.tabId || tabs[0].id) !== activeTab.id), ...next.charts.map(chart => ({ ...chart, tabId: activeTab.id }))] };
    if (publishedView) { setDoc(next); return; }
    history.current.push(doc); future.current = []; setDoc(next); setDirty(true);
  };
  const selectTab = (tabId: string) => {
    setActiveTabId(tabId); setSelected(''); setCommentChart(''); setDeleted(null); setPasteArmed(false);
    insertionRef.current = null; setInsertion(null); pasteAt.current = undefined;
    workspaceScroll.current?.scrollTo({ top: 0, left: 0 });
  };
  // Magnetic widths while resizing: within one column of 1/4, 1/3, 1/2, 2/3 or 3/4 of the canvas, the width snaps to it
  // (the edge opposite the dragged handle stays put). Mutating the item is how react-grid-layout accepts it.
  const snapWidth = (item: Layout, old: Layout) => {
    const columns = grid.columns;
    const target = [columns / 4, columns / 3, columns / 2, (columns * 2) / 3, (columns * 3) / 4].find(value => Number.isInteger(value) && Math.abs(item.w - value) <= 1);
    if (target === undefined || target === item.w) return;
    const fromLeft = item.x !== old.x, right = item.x + item.w;
    item.w = target;
    item.x = Math.max(0, Math.min(fromLeft ? right - target : item.x, columns - target));
  };
  const updateLayout = (layout: Layout[], movedId?: string) => {
    const charts = tabCharts.map(chart => {
      const position = layout.find(item => item.i === chart.id);
      return position && (position.x !== chart.x || position.y !== chart.y || position.w !== chart.w || position.h !== chart.h) ? { ...chart, x: position.x, y: position.y, w: position.w, h: position.h, ...(chart.config.type === 'filter' && (position.w !== chart.w || position.h !== chart.h) ? { config: { ...chart.config, filterAutoWidth: false } } : {}) } : chart;
    });
    if (charts.some((chart, index) => chart !== tabCharts[index])) change({ ...doc, charts: movedId ? closeVacatedRows(tabCharts, charts, movedId) : charts });
  };
  const fitFilterWidth = (chartId: string, width: number) => {
    if (publishedView) return;
    const canvasWidth = canvasRef.current?.clientWidth;
    if (!canvasWidth) return;
    // Auto-sized filters: at least 1/4 of the canvas wide and always the default height (manual resizing turns this off).
    const w = Math.min(grid.columns, Math.max(minWidth(grid.columns), Math.ceil((width + 8) / ((canvasWidth + 8) / grid.columns)))), h = FILTER_DEFAULT_ROWS;
    const currentChart = current.current.doc.charts.find(chart => chart.id === chartId);
    if (!currentChart?.config.filterAutoWidth || currentChart.w === w && currentChart.h === h) return;
    setDoc(previous => {
      const chart = previous.charts.find(item => item.id === chartId);
      if (!chart?.config.filterAutoWidth || chart.w === w && chart.h === h) return previous;
      const tabId = chart.tabId || previous.tabs?.[0]?.id || 'main';
      const onTab = (item: Tile) => (item.tabId || previous.tabs?.[0]?.id || 'main') === tabId;
      const charts = previous.charts.filter(onTab).map(item => item.id === chartId ? { ...item, w, h } : item);
      return { ...previous, charts: [...previous.charts.filter(item => !onTab(item)), ...moveGridTile(charts, chartId, chart, grid.columns)!] };
    });
    setDirty(true);
  };
  // Pixel box of a grid position, matching react-grid-layout's own placement (8px column gap, no padding).
  const gridPixels = (chart: Pick<Tile, 'x' | 'y' | 'w' | 'h'>) => {
    const column = (surfaceWidth - 8 * (grid.columns - 1)) / grid.columns;
    return { left: Math.round((column + 8) * chart.x), top: Math.round(ROW_UNIT * chart.y), width: Math.round(column * chart.w + Math.max(0, chart.w - 1) * 8), height: Math.round(ROW_HEIGHT * chart.h + Math.max(0, chart.h - 1) * ROW_GAP) };
  };
  // Sideways drop preview: only the target row's other cards shift to their 1/2, 1/3 or 1/4 slots so the dashed slot
  // beneath them shows. The dragged chart and every other row stay put until release.
  const sidewaysInsertion = insertion && insertion.side !== 'top' && insertion.side !== 'bottom' ? insertion : null;
  const sidewaysRow = sidewaysInsertion?.row;
  const previewShift = (chart: Tile) => {
    const placed = sidewaysInsertion && chart.id !== sidewaysInsertion.movingId && chart.y === sidewaysRow ? sidewaysInsertion.charts.find(item => item.id === chart.id) : undefined;
    // Keep the row where it is on screen (the drop may also close rows the dragged chart leaves, which only applies on release).
    if (!placed || (placed.x === chart.x && placed.w === chart.w && placed.h === chart.h)) return undefined;
    const box = gridPixels({ ...placed, y: chart.y });
    return { '--shift-x': box.left + 'px', '--shift-y': box.top + 'px', '--shift-w': box.width + 'px', '--shift-h': box.height + 'px' } as CSSProperties;
  };
  const previewInsertion = (movingId: string, event: MouseEvent) => {
    const touch = event as MouseEvent & { touches?: TouchList; changedTouches?: TouchList };
    const point = touch.touches?.[0] || touch.changedTouches?.[0] || event;
    // Drop model: the pointer decides. Over another component: its left / right quarter → join its row (1:1, 1:1:1,
    // 1:1:1:1); otherwise its top / bottom half → insert as a new row above / below that row. Filters and charts never
    // share a row, so a sideways drop between them becomes above / below. Over blank canvas → before the next row
    // below the pointer, or after the last one. Other components never move until release.
    const moving = tabCharts.find(chart => chart.id === movingId);
    const canvas = canvasRef.current?.getBoundingClientRect();
    let target: Tile | undefined, side: InsertSide | undefined;
    // The dragged chart's original place stays outlined and is inert: over it nothing is previewed and a release there
    // leaves the layout unchanged.
    const originBox = canvas && moving && gridPixels(moving);
    if (canvas && originBox && point.clientX >= canvas.left + originBox.left && point.clientX <= canvas.left + originBox.left + originBox.width && point.clientY >= canvas.top + originBox.top && point.clientY <= canvas.top + originBox.top + originBox.height) {
      insertionRef.current = null; setInsertion(null);
      return null;
    }
    for (const candidate of tabCharts) {
      if (candidate.id === movingId) continue;
      // Hit-test the saved grid position, not the DOM: a sideways preview shifts cards, which must not change the target.
      const box = canvas && gridPixels(candidate);
      const rect = canvas && box && { left: canvas.left + box.left, top: canvas.top + box.top, right: canvas.left + box.left + box.width, bottom: canvas.top + box.top + box.height, width: box.width, height: box.height };
      if (!rect || point.clientX < rect.left || point.clientX > rect.right || point.clientY < rect.top || point.clientY > rect.bottom) continue;
      const x = (point.clientX - rect.left) / rect.width, y = (point.clientY - rect.top) / rect.height;
      target = candidate;
      // The box splits along its diagonals: the left / right triangles (50% of the area) join the row as a left / right
      // layout; the top / bottom triangles (the other 50%) insert a new row above / below, shown as a highlight line.
      side = Math.min(x, 1 - x) < Math.min(y, 1 - y) ? (x < .5 ? 'left' : 'right') : y < .5 ? 'top' : 'bottom';
      if ((side === 'left' || side === 'right') && moving && (moving.config.type === 'filter') !== (candidate.config.type === 'filter')) side = y < .5 ? 'top' : 'bottom';
      break;
    }
    // Blank space beside a row that fits the dragged chart's width: preview it landing there at its own width.
    if (!target && moving && canvas && point.clientX >= canvas.left && point.clientX <= canvas.right && point.clientY >= canvas.top) {
      const pointerRow = Math.floor((point.clientY - canvas.top) / ROW_UNIT), column = Math.floor((point.clientX - canvas.left) / ((canvas.width + 8) / grid.columns));
      const rowY = [...new Set(tabCharts.filter(chart => chart.id !== movingId).map(chart => chart.y))].find(y => pointerRow >= y && pointerRow < y + Math.max(...tabCharts.filter(chart => chart.id !== movingId && chart.y === y).map(chart => chart.h)));
      const placed = rowY === undefined ? null : placeInRowGap(tabCharts, movingId, rowY, column, grid.columns);
      const landed = placed?.find(chart => chart.id === movingId);
      if (placed && landed && rowY !== undefined) {
        const current = insertionRef.current;
        if (current?.movingId === movingId && current.side === 'gap' && current.row === rowY && current.charts.find(chart => chart.id === movingId)?.x === landed.x) return current;
        const next = { charts: arrangeAfterChange(tabCharts, placed, grid.columns), movingId, side: 'gap' as const, row: rowY };
        insertionRef.current = next; setInsertion(next);
        return next;
      }
    }
    if (!target && moving && canvas && point.clientX >= canvas.left && point.clientX <= canvas.right && point.clientY >= canvas.top) {
      const row = (point.clientY - canvas.top) / ROW_UNIT, rest = tabCharts.filter(chart => chart.id !== movingId);
      const below = rest.filter(chart => chart.y >= row).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      const last = [...rest].sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x)[0];
      if (below) { target = below; side = 'top'; } else if (last) { target = last; side = 'bottom'; }
    }
    if (insertionRef.current?.movingId === movingId && target && insertionRef.current.targetId === target.id && insertionRef.current.side === side) return insertionRef.current;
    let next: typeof insertion = null;
    if (moving && target && side) {
      let placed = insertGridTile(tabCharts, movingId, target.id, side, grid.columns);
      // A full row (4) or a sideways drop that cannot fit falls back to inserting above / below that row.
      if (!placed && (side === 'left' || side === 'right')) { side = 'bottom'; placed = insertGridTile(tabCharts, movingId, target.id, side, grid.columns); }
      if (placed) next = { charts: arrangeAfterChange(tabCharts, placed, grid.columns), movingId, targetId: target.id, side, row: target.y };
    }
    insertionRef.current = next; setInsertion(next);
    return next;
  };
  const patchTile = (next: Partial<Tile>) => { if (tile) change({ ...doc, charts: tabCharts.map(item => item.id === tile.id ? { ...item, ...next } : item) }); };
  const patchConfig = (next: Partial<ChartConfig>) => {
    if (!tile) return;
    if ((['type', 'dimension', 'dimensions', 'measure', 'measures', 'secondDimension', 'secondMeasure', 'legendField', 'aggregation', 'metricAggregations', 'expression'] as const).some(key => key in next && JSON.stringify(next[key]) !== JSON.stringify(tile.config[key]))) next = { ...next, autoTitle: true };
    patchTile({ ...(!tile.datasetId && dataset && ['dimension', 'dimensions', 'measure', 'measures', 'secondDimension', 'secondMeasure', 'legendField'].some(field => field in next) ? { datasetId: dataset.id } : {}), config: { ...tile.config, ...next } });
  };
  const selectDataset = (datasetId: string) => {
    const source = datasets.find(item => item.id === datasetId);
    if (!source) return;
    setActiveDatasetId(datasetId);
    if (tile && tile.datasetId !== datasetId) {
      const c = tile.config;
      const dimensions = source.schema.filter(field => ['string', 'date'].includes(field.type));
      const metrics = source.schema.filter(field => ['number', 'integer'].includes(field.type));
      const keptDimensions = (c.dimensions || [c.dimension].filter((name): name is string => !!name)).filter(name => dimensions.some(field => field.name === name));
      const previousMeasures = c.measures || [c.measure, c.secondMeasure].filter((name): name is string => !!name);
      const keptMeasures = previousMeasures.filter(name => metrics.some(field => field.name === name));
      const nextDimensions = keptDimensions.length ? keptDimensions : dimensions.slice(0, 1).map(field => field.name);
      const nextMeasures = keptMeasures.length ? keptMeasures : metrics.slice(0, 1).map(field => field.name);
      patchTile({ datasetId, config: { ...c, dimension: nextDimensions[0], dimensions: c.dimensions ? nextDimensions : undefined,
        measure: nextMeasures[0], measures: c.measures ? nextMeasures : undefined,
        metricSeries: c.metricSeries ? nextMeasures.map(name => c.metricSeries![previousMeasures.indexOf(name)] || { type: 'line', axis: 'left' }) : undefined,
        secondMeasure: metrics.some(field => field.name === c.secondMeasure) ? c.secondMeasure : undefined,
        secondDimension: dimensions.some(field => field.name === c.secondDimension) ? c.secondDimension : undefined,
        legendField: dimensions.some(field => field.name === c.legendField) ? c.legendField : undefined,
      } });
      setCommentChart('');
    }
  };
  const rememberDataset = (item: Dataset) => setDatasets(items => [...items.filter(d => d.id !== item.id), item]);
  const refreshSavedDatasets = () => api('/datasets').then(setSavedDatasets).catch(e => setMessage(e.message));
  const acceptDataset = (item: Dataset) => {
    rememberDataset(item);
    setSavedDatasets(items => [...items.filter(value => value.id !== item.id), item]);
    setDoc(previous => ({ ...previous, datasets: previous.datasets.map(value => value.id === item.id ? item : value) }));
    if (importedIds.includes(item.id)) setDirty(true);
  };
  const preparePreview = (value: any) => {
    if (!asAnnotation) return value;
    const fields = value.schema.slice(0, 4);
    let label = fields.findIndex((field: any) => /version|(?:^|_)ver(?:$|_)|label|标签|版本/i.test(field.name));
    if (label < 0) label = fields.findIndex((field: any) => field.type === 'string');
    if (label < 0) label = 0;
    let start = fields.findIndex((field: any, index: number) => index !== label && /start|begin|开始|起始/i.test(field.name));
    if (start < 0) start = fields.findIndex((_: any, index: number) => index !== label);
    let end = fields.findIndex((field: any, index: number) => index !== label && index !== start && /end|finish|结束|截止/i.test(field.name));
    if (end < 0) end = fields.findIndex((_: any, index: number) => index !== label && index !== start);
    const roles: AnnotationRole[] = [];
    if (label >= 0) roles[label] = 'label';
    if (start >= 0) roles[start] = 'start';
    if (end >= 0) roles[end] = 'end';
    const comment = fields.findIndex((_: any, index: number) => !roles[index]);
    if (comment >= 0) roles[comment] = 'comment';
    setAnnotationOrder(roles);
    // Annotations read only the first four columns; the rest are dropped here so they never show up.
    return { ...annotationFieldSettings({ ...value, schema: fields }, roles), annotation: true };
  };
  const previewDynamic = (source: DynamicSourceConfig, result: DynamicSourcePreview) => {
    if (detectedPreview.current?.preview_id === result.preview_id && !!detectedPreview.current.annotation === asAnnotation) { setDynamicDraft(source); setPreview(detectedPreview.current); return; }
    const renames = source.field_settings?.renames || {};
    const previousSchema = detectedPreview.current?.preview_id ? detectedPreview.current.schema : editingDataset?.schema.map(field => ({ ...field, source: Object.keys(renames).find(original => renames[original] === field.name) || field.name }));
    const value = { ...result, schema: result.schema.map(field => {
      const target = renames[field.name] || field.name;
      const previous = editingDataset?.schema.find(item => item.name === target);
      return editingDataset ? { ...field, source: field.name, target, name: previous?.display_name || target } : field;
    }), field_formats: Object.fromEntries(Object.entries(result.field_formats).map(([field, format]: [string, any]) => {
      const target = renames[field] || field;
      const previous = editingDataset?.schema.find(item => item.name === target && item.type === result.schema.find(item => item.name === field)?.type);
      return [field, previous && editingDataset?.field_formats?.[target] || { ...format, rounding: defaultRounding, decimals: format.kind === 'decimal' || format.format === 'percent' ? defaultDecimals : 0 }];
    })) };
    setDynamicDraft(source); setPaste(''); setFile(null); setSheets([]); setSheet(''); setMessage(fieldChangeMessage(previousSchema, result.schema));
    if (editingDataset) setEditingSource(true);
    if (detectedPreview.current?.preview_id !== result.preview_id) setDatasetName(editingDataset ? source.name : nextDatasetName(datasets, asAnnotation));
    const prepared = preparePreview(value);
    detectedPreview.current = prepared; setPreview(prepared);
  };
  const refresh = () => { refreshSavedDatasets(); api('/dashboards').then(setDashboards).catch(e => setMessage(e.message)); };

  const copyChart = (chart: Tile) => {
    setCopied(structuredClone(chart)); setPasteArmed(true); pasteAt.current = undefined;
    canvasRef.current?.focus({ preventScroll: true });
    setMessage(t("图表已复制，点击画布空白位置或按 Ctrl+V 粘贴"));
  };
  const copyChartImage = async (chart: Tile) => {
    try {
      const element = document.getElementById('chart-' + chart.id);
      if (!element || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error(t("浏览器不支持图片剪贴板"));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': chartImage(element) })]);
      setMessage(t("图片已复制"));
    } catch (error) { setMessage(t("图片复制失败：") + (error as Error).message); }
  };
  // Self-contained interactive page: the single-file app runtime (dist/export) plus the report and its dataset rows;
  // the page boots in published view and answers chart/filter queries in the browser (offlineQuery.ts).
  const exportPage = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const sources = datasets.filter(source => importedIds.includes(source.id) || doc.charts.some(chart => chart.datasetId === source.id));
      const text = async (path: string) => { const response = await fetch(path, { cache: 'no-store' }); if (!response.ok) throw new Error(t('导出组件缺失，请重新构建 MyBI')); return response.text(); };
      const [runtime, styles] = await Promise.all([text('/export/runtime.js'), text('/export/runtime.css')]);
      const data = Object.fromEntries(await Promise.all(sources.map(async source => [source.id, await api(`/datasets/${encodeURIComponent(source.id)}/export-rows`)] as const)));
      const annotationRows = Object.fromEntries(await Promise.all(annotationSources.filter(source => sources.includes(source)).map(async source => {
        const rows: unknown[] = [];
        for (let offset = 0; ; offset += 1000) {
          const result = await api(`/datasets/${source.id}/view-query`, json({ fields: Object.values(source.annotation_fields!), chart_type: 'annotation', limit: 1000, offset }));
          rows.push(...result.rows);
          if (result.rows.length < 1000) return [source.id, rows] as const;
        }
      })));
      const { refreshSchedule: _schedule, ...reportDocument } = doc;
      const payload: ExportPayload = { report: { id: id || 'export', name: name.trim() || t('未命名报表'), document: { ...reportDocument, datasets: sources.map(source => ({ ...source, snapshot_id: data[source.id].snapshot_id, data_as_of: data[source.id].data_as_of, dynamic: source.dynamic ? { schedule: { enabled: false, time: '00:00', timezone: 'UTC' } } : undefined })) }, theme: { ...theme, locale: getChartLocale(), canvasWidth: canvasRef.current?.clientWidth } }, canvasWidth: canvasRef.current?.clientWidth, data, annotations: annotationRows };
      // Inline the few root-relative images so the file works offline.
      const images = [...new Set([...`${runtime}${styles}`.matchAll(/\/(?:import-icons\/[\w.-]+\.svg|dialogue_bubble\.svg)/g)].map(match => match[0]))];
      const inlined = new Map(await Promise.all(images.map(async path => [path, 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(await text(path))))] as const)));
      const inline = (source: string) => images.reduce((result, path) => result.split(path).join(inlined.get(path)!), source);
      const title = escapeHtml(name.trim() || t('未命名报表'));
      const html = `<!doctype html><html lang="${getLocale()}" data-public-view="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${inline(styles).replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script>window.__MYBI_EXPORT__=${JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script><script>${inline(runtime).replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      link.download = (name.trim() || 'report').replace(/[\\/:*?"<>|]/g, '_') + '.html';
      link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setMessage(t('页面已导出'));
    } catch (error) { setMessage((error as Error).message); }
    finally { setPublishing(false); }
  };
  const pasteChart = (at?: { x: number; y: number }) => {
    if (!copied || previewMode) return;
    if (at) {
      // Paste where the user clicked: the copy goes into that spot (e.g. the blank space between two components)
      // and everything it overlaps below moves down. Clicks under the last component paste right after it.
      const bottom = Math.max(0, ...tabCharts.map(chart => chart.y + chart.h));
      const w = Math.min(copied.w, grid.columns);
      const x = Math.max(0, Math.min(at.x, grid.columns - w));
      // A click on the thin gap between two stacked tiles falls inside the upper tile's last row: place the copy
      // below whatever tile covers the clicked row, so only tiles underneath move down.
      let y = Math.max(0, Math.min(at.y, bottom));
      const covering = tabCharts.find(chart => chart.y <= y && y < chart.y + chart.h && chart.x < x + w && chart.x + chart.w > x);
      if (covering) y = covering.y + covering.h;
      const copy = { ...structuredClone(copied), id: crypto.randomUUID(), w, x, y };
      if (copy.config.type === 'filter') copy.config.title = nextFilterTitle(tabCharts);
      else copy.config = nextMetricConfig(copy.config, datasets.find(item => item.id === copy.datasetId));
      change({ ...doc, charts: pushGridTiles([...tabCharts, copy], [copy]) }); setCopied(structuredClone(copy)); setSelected(copy.id); setActiveDatasetId(copy.datasetId); setPasteArmed(false); setMessage(t("已粘贴，可在右侧修改图表"));
      return;
    }
    // No click position (Ctrl+V before clicking the canvas): first free space, else after the last component.
    const pasteGrid = { ...grid, rows: Math.max(grid.rows, Math.max(0, ...tabCharts.map(chart => chart.y + chart.h)) + copied.h) };
    const position = findGridSpace(tabCharts, copied.w, copied.h, pasteGrid);
    if (!position) { setMessage(t("图表宽度超出画布，请调整图表宽度")); return; }
    const copy = { ...structuredClone(copied), id: crypto.randomUUID(), ...position };
    if (copy.config.type === 'filter') copy.config.title = nextFilterTitle(tabCharts);
    else copy.config = nextMetricConfig(copy.config, datasets.find(item => item.id === copy.datasetId));
    // Later pastes continue from this copy, stepping through the remaining metrics.
    change({ ...doc, charts: [...tabCharts, copy] }); setCopied(structuredClone(copy)); setSelected(copy.id); setActiveDatasetId(copy.datasetId); setPasteArmed(false); setMessage(t("已粘贴，可在右侧修改图表"));
  };
  useEffect(() => {
    const paste = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v' || !copied || previewMode || showImport || showSettings || showReports) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],dialog')) return;
      event.preventDefault(); pasteChart(pasteAt.current);
    };
    document.addEventListener('keydown', paste);
    return () => document.removeEventListener('keydown', paste);
  }, [copied, doc, activeTab.id, previewMode, showImport, showSettings, showReports, grid.columns, grid.rows]);
  const deleteChart = (chart: Tile) => {
    const index = tabCharts.findIndex(item => item.id === chart.id);
    // Rows left completely empty by the deleted tile close up, so the components below move up.
    const remaining = arrangeAfterChange(tabCharts, tabCharts.filter(item => item.id !== chart.id), grid.columns);
    change({ ...doc, charts: remaining });
    const next = remaining[Math.min(index, remaining.length - 1)];
    setSelected(next?.id || '');
    if (next) setActiveDatasetId(next.datasetId);
    setDeleted({ chart, index, expiresAt: Date.now() + 3000, session: session.current });
  };
  useEffect(() => {
    const removeSelected = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.key !== 'Delete' || !tile || previewMode || showReports || showSettings || showImport || reportAction) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],dialog')) return;
      event.preventDefault(); deleteChart(tile);
    };
    document.addEventListener('keydown', removeSelected);
    return () => document.removeEventListener('keydown', removeSelected);
  }, [tile, doc, previewMode, showReports, showSettings, showImport, reportAction]);
  const restoreDeleted = () => {
    if (!deleted || deleted.session !== session.current || Date.now() >= deleted.expiresAt) { setDeleted(null); return; }
    if (tabCharts.some(item => item.id === deleted.chart.id)) { setDeleted(null); return; }
    const width = Math.min(deleted.chart.w, grid.columns);
    // Undo: put the tile back where it was and push the components below down again (reverses the row close-up).
    const restored = { ...deleted.chart, w: width, x: Math.max(0, Math.min(deleted.chart.x, grid.columns - width)) };
    const charts = [...tabCharts];
    charts.splice(deleted.index, 0, restored);
    change({ ...doc, charts: pushGridTiles(charts, [restored]) }); setSelected(deleted.chart.id); setActiveDatasetId(deleted.chart.datasetId); setDeleted(null);
  };
  useEffect(() => {
    if (!deleted) return;
    const timer = window.setTimeout(() => setDeleted(null), Math.max(0, deleted.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deleted]);
  useEffect(() => { if (!publicReportAccess) refresh(); }, []);
  const addChart = (type: ChartType) => {
    const sourceId = type === 'filter' && tile ? tile.datasetId : importedIds.includes(activeDatasetId) ? activeDatasetId : importedIds[0] || activeDatasetId;
    const source = datasets.find(item => item.id === sourceId) || dataset;
    if (!source) { setEditingSource(false); setEditingField(''); setEditingDataset(null); setShowImport(true); return; }
    const newId = crypto.randomUUID();
    const w = type === 'filter' ? Math.min(grid.columns, Math.max(minWidth(grid.columns), Math.ceil(188 / (((canvasRef.current?.clientWidth || 720) + 8) / grid.columns)))) : grid.columns, h = type === 'filter' ? FILTER_DEFAULT_ROWS : Math.min(10, grid.rows), position = type === 'filter' ? { x: tile ? Math.min(tile.x, grid.columns - w) : 0, y: tile ? tile.y + tile.h : Math.max(0, ...tabCharts.map(chart => chart.y + chart.h)) } : findGridSpace(tabCharts, w, h, grid) || { x: 0, y: Math.max(0, ...tabCharts.map(chart => chart.y + chart.h)) };
    const added: Tile = { id: newId, datasetId: source.id, config: { type, ...(type === 'filter' ? { filterStyle: 'dropdown' as const, filterAutoWidth: true, filterFields: source.schema.filter(field => ['string', 'date'].includes(field.type)).slice(0, 2).map(field => field.name) } : {}), title: type === 'filter' ? nextFilterTitle(tabCharts) : chartRegistry.find(c => c.id === type)?.label, dimension: source.schema.find(f => ['string', 'date'].includes(f.type))?.name, measure: source.schema.find(f => ['number', 'integer'].includes(f.type))?.name, ...(type === 'candlestick' ? { measures: source.schema.filter(f => ['number', 'integer'].includes(f.type)).slice(0, 4).map(f => f.name) } : {}), aggregation: 'sum', color: '#5969f4', legend: true }, filters: [], filterMode: 'global', ...position, w, h };
    change({ ...doc, charts: type === 'filter' ? pushGridTiles([...tabCharts, added], [added]) : [...tabCharts, added] }); setSelected(newId);
  };
  const rememberDashboard = (value: string) => {
    try { localStorage.setItem('data-workbench.last-dashboard', value); } catch {}
  };
  const save = async (force = false) => {
    if (saving.current || publishedView || (!dirty && !force) || !name.trim()) return;
    saving.current = true; setIsSaving(true);
    const token = session.current, savedDoc = doc, savedName = name, savedDatasets = datasets;
    try {
      const body = { name, document: { ...doc, canvasWidth: canvasRef.current?.clientWidth || doc.canvasWidth, refreshSchedule: reportSchedule, datasets: datasets.filter(source => importedIds.includes(source.id)) }, version };
      let saved;
      try { saved = await api(id ? `/dashboards/${id}` : '/dashboards', { ...json(body), method: id ? 'PUT' : 'POST' }); }
      catch (error) {
        // Version conflict: a previous save may have landed without its response (e.g. service restart) or another window saved.
        // Adopt the server version when it already holds this content; otherwise ask before overwriting it.
        if (!id || (error as { detail?: unknown }).detail !== '报表已被其他操作修改，请重新打开后再保存') throw error;
        const server = await api(`/dashboards/${id}`);
        const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
        if (server.name === body.name && stable(server.document) === stable(body.document)) saved = server;
        else if (await confirmAction(t('服务器上的报表版本与当前编辑内容不一致（可能是上次保存已成功但未收到响应，或在其他窗口修改过）。用当前内容覆盖服务器版本？'))) saved = await api(`/dashboards/${id}`, { ...json({ ...body, version: server.version }), method: 'PUT' });
        else throw error;
      }
      if (session.current === token) { rememberDashboard(saved.id); if (!showReports && !showSettings && panel === 'charts') navigateTo('/reports/' + encodeURIComponent(saved.id), true); setSaveError(''); setId(saved.id); setVersion(saved.version); const unchanged = current.current.doc === savedDoc && current.current.name === savedName && current.current.datasets === savedDatasets; setDirty(!unchanged); if (unchanged) { clearDraft(saved.id); setRestoredDraft(false); } setMessage(unchanged ? t("已保存") : t("仍有新修改待保存")); setDashboards(items => [...items.filter(item => item.id !== saved.id), saved]); }
      return saved;
    } catch (e) { if (session.current === token) { setSaveError((e as Error).message); setMessage(t("保存失败：") + (e as Error).message); } }
    finally { saving.current = false; setIsSaving(false); }
  };
  useEffect(() => { setSaveError(''); }, [doc, name, datasets]);
  const saveAction = useRef(save); saveAction.current = save;
  useEffect(() => {
    if (!autoSaveEnabled || restoredDraft || publishedView) return;
    const timer = window.setInterval(() => void saveAction.current(), autoSaveMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [autoSaveEnabled, autoSaveMinutes, restoredDraft, publishedView]);
  const open = async (value: string, replace = false, useDraft = false, discardConfirmed = false) => {
    if (!value) return;
    if (dirty && !discardConfirmed && !(useDraft && value === id) && !await confirmAction(t("\u5f53\u524d\u4fee\u6539\u5c1a\u672a\u4fdd\u5b58\uff0c\u4ecd\u7136\u6253\u5f00\uff1f"))) { navigateTo(activePath, true); return; }
    const token = ++session.current; setDeleted(null); setOpeningReport(true);
    try {
      const item = await api(`/dashboards/${value}?include_datasets=true`);
      const draft = useDraft ? drafts[value] : undefined;
      if (draft?.document?.charts && draft.document.datasets) { item.document = draft.document; item.name = draft.name; }
      else if (useDraft) { setMessage(t('\u672c\u5730\u8349\u7a3f\u4e0d\u53ef\u7528')); return; }
      const ids = [...new Set<string>([...item.document.charts.map((chart: Tile) => chart.datasetId).filter(Boolean), ...(item.document.datasets || []).map((source: Dataset) => source.id)])];
      const sources = await Promise.allSettled(ids.map(async sourceId => {
        if (draft || !item.datasets) return api('/datasets/' + sourceId);
        const source = item.datasets.find((source: Dataset) => source.id === sourceId);
        if (!source) throw new Error('Dataset not found');
        return source;
      }));
      if (session.current !== token) return;
      for (const source of sources) if (source.status === 'fulfilled') rememberDataset(source.value);
      if (draft) for (const source of draft.document.datasets) rememberDataset(source);
      setPublishedView(false); setPreviewMode(false); setCommentChart(''); rememberDashboard(item.id); navigateTo('/reports/' + encodeURIComponent(item.id) + (draft ? '?draft=1' : ''), replace); setShowReports(false); setDoc(normalizeDocument(item.document)); setActiveTabId(''); setName(item.name); setId(item.id); setVersion(item.version); setDirty(!!draft); setRestoredDraft(!!draft); setImportedIds(draft?.importedIds || sources.flatMap((source, index) => source.status === 'fulfilled' ? [ids[index]] : [])); setSelected(''); setActiveDatasetId(draft?.activeDatasetId || item.document.charts[0]?.datasetId || ids[0] || ''); setShowSettings(false); setPanel('charts'); history.current = []; future.current = [];
    } catch (e) { if (session.current === token) { setMessage((e as Error).message); navigateTo(activePath, true); } }
    finally { if (session.current === token) setOpeningReport(false); }
  };
  const copyReport = async (reportId: string) => {
    if (reportBusy || saving.current) return;
    if (dirty && !await confirmAction(t('\u5f53\u524d\u4fee\u6539\u5c1a\u672a\u4fdd\u5b58\uff0c\u4ecd\u7136\u6253\u5f00\uff1f'))) return;
    setReportBusy(true);
    try {
      const source = await api(`/dashboards/${reportId}`);
      const suffix = t('\uff08\u526f\u672c\uff09');
      const copy = await api('/dashboards', json({ name: source.name.slice(0, 255 - suffix.length) + suffix, document: source.document, version: 1 }));
      setDashboards(items => [copy, ...items]);
      await open(copy.id, false, false, true);
    } catch (error) { setMessage((error as Error).message); }
    finally { setReportBusy(false); }
  };
  const openPublished = async (reportId: string) => {
    const token = ++session.current; setOpeningReport(true);
    try {
      const item = await api(`/dashboards/${reportId}/published`);
      if (session.current !== token) return;
      setDoc(normalizeDocument(item.document)); setActiveTabId(''); setDatasets(item.document.datasets || []); setId(item.id); setName(item.name);
      setImportedIds((item.document.datasets || []).map((source: Dataset) => source.id));
      setDirty(false); setRestoredDraft(false); setPublishedTheme(item.theme); setPublishedView(true); setPreviewMode(true);
      setShowReports(false); setShowSettings(false); setPanel('charts'); setSelected(''); setCommentChart(''); setDeleted(null); setPasteArmed(false);
      insertionRef.current = null; setInsertion(null); navigateTo('/view/' + encodeURIComponent(reportId));
    } catch (error) { setMessage((error as Error).message); if (!publicReportAccess) navigateTo(activePath, true); }
    finally { if (session.current === token) setOpeningReport(false); }
  };
  // Portal page: the left menu switches between the portal's published reports in place.
  const openPortalReport = (reportId: string) => { setPortalReport(reportId); setPortalReportId(reportId); void openPublished(reportId); };
  const viewReport = async (reportId: string) => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      await api(`/dashboards/${reportId}/published`);
      if (tab) tab.location.replace('/view/' + encodeURIComponent(reportId));
      else setMessage(t('\u8bf7\u5141\u8bb8\u6d4f\u89c8\u5668\u6253\u5f00\u65b0\u6807\u7b7e\u9875'));
    } catch (error) { tab?.close(); setMessage((error as Error).message); }
  };
  const publish = async (reportId?: string) => {
    if (publishing || saving.current) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setPublishing(true);
    try {
      let saved;
      if (reportId) {
        const draft = reportId === id && dirty ? { name, document: { ...doc, datasets: datasets.filter(source => importedIds.includes(source.id)) }, version } : drafts[reportId];
        saved = draft ? await api(`/dashboards/${reportId}`, { ...json({ name: draft.name, document: draft.document, version: draft.version }), method: 'PUT' }) : await api(`/dashboards/${reportId}`);
        if (draft) {
          clearDraft(reportId);
          if (reportId === id) { setVersion(saved.version); setDirty(false); setRestoredDraft(false); }
        }
      } else saved = await save(true);
      if (!saved) { tab?.close(); return; }
      // The editor canvas width is published so the view page centers the canvas at the same width (as the exported page
      // does). Publishing from the reports list has no canvas: use the width saved with the report, else the last editor width.
      const editing = (!reportId || reportId === id) && canvasRef.current?.clientWidth;
      await api(`/dashboards/${saved.id}/publish`, json({ version: saved.version, theme: { ...theme, locale: getChartLocale(), canvasWidth: editing || saved.document?.canvasWidth || lastCanvasWidth() } }));
      setDashboards(items => items.map(item => item.id === saved.id ? { ...item, name: saved.name, updated_at: saved.updated_at, published: true, pages: saved.pages, fingerprint: saved.fingerprint } : item));
      if (tab) tab.location.replace('/view/' + encodeURIComponent(saved.id));
      setMessage(t(tab ? '\u5df2\u53d1\u5e03' : '\u5df2\u53d1\u5e03\uff0c\u8bf7\u5141\u8bb8\u6d4f\u89c8\u5668\u6253\u5f00\u65b0\u6807\u7b7e\u9875'));
    } catch (error) { tab?.close(); setMessage((error as Error).message); }
    finally { setPublishing(false); }
  };
  const resetReport = () => {
    ++session.current; setOpeningReport(false); history.current = []; future.current = []; setRestoredDraft(false); setPublishedView(false); setPreviewMode(false); setCommentChart('');
    setDoc({ rowScale: 2, colScale: 2, charts: [], filters: [], datasets: [] }); setActiveTabId(''); setDatasets([]); setImportedIds([]);
    setName(nameWithTime(t('未命名报表'))); setId(''); setVersion(1); setDirty(false); setSelected(''); setActiveDatasetId('');
    setDeleted(null); setCopied(null); setPasteArmed(false); insertionRef.current = null; setInsertion(null);
    setSaveError(''); setPreviewMode(false); setShowSettings(false); setShowReports(false); setPanel('charts'); setMessage('');
    navigateTo('/reports/new');
    try { localStorage.removeItem('data-workbench.last-dashboard'); } catch {}
  };
  const newReport = () => {
    if (saving.current) return;
    if (dirty) setReportAction({ kind: 'new' }); else resetReport();
  };
  const confirmReportAction = async () => {
    if (!reportAction || reportBusy) return;
    if (reportAction.kind === 'new') { resetReport(); setReportAction(null); return; }
    setReportBusy(true); setReportError('');
    try {
      const deletedId = reportAction.report.id;
      await api('/dashboards/' + deletedId, { method: 'DELETE' });
      clearDraft(deletedId);
      setDashboards(items => items.filter(item => item.id !== deletedId));
      if (id === deletedId) { resetReport(); setDirty(false); setShowReports(true); navigateTo('/reports', true); }
      try { if (localStorage.getItem('data-workbench.last-dashboard') === deletedId) localStorage.removeItem('data-workbench.last-dashboard'); } catch {}
      setReportAction(null); setMessage(t('\u62a5\u8868\u5df2\u5220\u9664'));
    } catch (error) { setReportError((error as Error).message); }
    finally { setReportBusy(false); }
  };
  const restoreRoute = useRef<() => void>();
  restoreRoute.current = () => {
    if (offlineExport) { void openPublished(offlineExport.report.id); return; }
    if (portalId) { api('/portal').then((value: PortalInfo) => { setPortal(value); if (value.reports[0]) openPortalReport(value.reports[0].id); }).catch(error => setMessage(error.message)); return; }
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    const view = path.match(/^\/view\/([^/]+)$/);
    if (view) { void openPublished(decodeURIComponent(view[1])); return; }
    const legacy = new URLSearchParams(window.location.hash.slice(1)).get('dashboard');
    if (legacy) { void open(legacy, true); return; }
    if (path === '/settings') { setPublishedView(false); setPreviewMode(false); setShowSettings(true); return; }
    const module = (Object.keys(modulePaths) as ModulePanel[]).find(key => modulePaths[key] === path);
    if (module) { setPublishedView(false); setPreviewMode(false); setShowSettings(false); setShowReports(false); setPanel(module); return; }
    if (path === '/datasets') { setPublishedView(false); setPreviewMode(false); setShowSettings(false); setShowReports(false); setPanel('history'); navigateTo('/datasets'); refreshSavedDatasets(); return; }
    if (path === '/reports/new') {
      if (!id && !showReports && !showSettings && panel === 'charts') return;
      newReport(); return;
    }
    const match = path.match(/^\/reports\/([^/]+)$/);
    if (match) { void open(decodeURIComponent(match[1]), true, new URLSearchParams(window.location.search).get('draft') === '1'); return; }
    if (path === '/') {
      let value: string | null = null;
      try { value = localStorage.getItem('data-workbench.last-dashboard'); } catch {}
      if (value) { void open(value, true); return; }
    }
    setPublishedView(false); setPreviewMode(false); setCommentChart(''); setShowSettings(false); setShowReports(true); navigateTo('/reports', true);
    api('/dashboards').then(setDashboards).catch(error => setMessage(error.message));
  };
  useEffect(() => {
    const restore = () => restoreRoute.current?.();
    restore(); window.addEventListener('popstate', restore); window.addEventListener('hashchange', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore); };
  }, []);
  const openFieldSettings = async (target = dataset, readOnly = false, sourceFirst = false) => {
    setEditingField(''); setEditingSource(false); setMessage(''); setViewingDataset(readOnly);
    if (!target) { setEditingDataset(null); setPreview(null); setShowImport(true); return; }
    setBusy(true);
    try {
      const source = await api('/datasets/' + target.id);
      const sample = await api(`/datasets/${target.id}/view-query`, json({ snapshot_id: source.snapshot_id, fields: source.schema.map((field: any) => field.name), limit: 1 }));

      const result = { schema: source.schema.map((field: any) => ({ ...field, source: field.name, name: field.display_name || field.name, type: field.type === 'boolean' ? 'string' : field.type === 'datetime' ? 'date' : field.type })), rows: sample.rows, field_formats: source.field_formats };
      setEditingDataset(source); setPaste(''); setFile(null); setSheets([]); setSheet(''); setHasHeader(true); setDelimiter('\t'); setEncoding('utf-8-sig'); setDatasetName(source.name);
      detectedPreview.current = result; setPreview(sourceFirst && source.dynamic ? null : result); setShowImport(true);
      rememberDataset(source);
      setSavedDatasets(items => [...items.filter(item => item.id !== source.id), source]);
    } catch (error) { setViewingDataset(false); setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const showDataSource = async () => {
    if (dynamicDraft && !editingDataset) { detectedPreview.current = preview; setEditingField(''); setPreview(null); return; }
    if (editingDataset?.dynamic) { detectedPreview.current = preview; setMessage(''); setEditingField(''); setPreview(null); setSourceKind('dynamic'); return; }
    setBusy(true); setMessage('');
    try {
      if (editingDataset && !editingSource) {
        const data = await api(`/datasets/${editingDataset.id}/source`);
        if (data.version !== editingDataset.version) throw new Error(t('\u6570\u636e\u96c6\u5df2\u88ab\u4fee\u6539\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u5b57\u6bb5\u914d\u7f6e\u540e\u518d\u8bd5'));
        setPaste(data.text);
      }
      detectedPreview.current = preview; setEditingField(''); setPreview(null);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const importRequest = async (confirmImport = false, selectedSheet = sheet) => {
    setBusy(true); setMessage('');
    let signature = '';
    try {
      let result: any;
      const annotationFields = asAnnotation && preview ? Object.fromEntries(annotationOrder.slice(0, Math.min(4, preview.schema.length)).map((role, index) => [role, dynamicDraft && editingDataset ? preview.schema[index]?.target || preview.schema[index]?.source || preview.schema[index]?.name : editingDataset && !editingSource ? preview.schema[index]?.source || preview.schema[index]?.name : preview.schema[index]?.name.trim()])) as AnnotationFields : {};
      if (confirmImport && asAnnotation && preview.schema.length < 3) throw new Error(t('标注必须包含标签、开始日期、结束日期，可选补充说明列'));
      const fieldOrder = preview ? [...preview.schema].slice(0, asAnnotation ? 4 : undefined).sort((a: any, b: any) => asAnnotation ? 0 : Number(['number', 'integer'].includes(a.type)) - Number(['number', 'integer'].includes(b.type))).map((field: any) => field.source || field.name) : [];
      const overrides = preview ? Object.fromEntries(preview.schema.slice(0, asAnnotation ? 4 : undefined).map((f: any) => [f.source || f.name, f.type])) : {};
      const renames = preview ? Object.fromEntries(preview.schema.slice(0, asAnnotation ? 4 : undefined).map((f: any) => [f.source || f.name, dynamicDraft && editingDataset ? f.target || f.source || f.name : editingDataset && editingSource ? f.source || f.name : f.name])) : {};
      const formats = preview ? Object.fromEntries(preview.schema.slice(0, asAnnotation ? 4 : undefined).filter((f: any) => ['number', 'integer'].includes(f.type) || (['string', 'date'].includes(f.type) && (preview.field_formats?.[f.source || f.name]?.dateFormat || preview.field_formats?.[f.source || f.name]?.valueLabels))).map((f: any) => [editingDataset && editingSource ? f.source || f.name : f.name.trim(), { valueLabels: preview.field_formats?.[f.source || f.name]?.valueLabels, dateFormat: preview.field_formats?.[f.source || f.name]?.dateFormat, kind: preview.field_formats?.[f.source || f.name]?.kind || (f.type === 'integer' ? 'integer' : 'decimal'), format: preview.field_formats?.[f.source || f.name]?.format || 'number', rounding: preview.field_formats?.[f.source || f.name]?.rounding || defaultRounding, decimals: preview.field_formats?.[f.source || f.name]?.decimals ?? (f.type === 'integer' ? 0 : defaultDecimals) }])) : {};
      signature = JSON.stringify({ annotationFields, mergeAnnotations, fieldOrder, overrides, renames, formats, datasetName, dynamicDraft, previewId: preview?.preview_id, paste: file ? undefined : paste, file: file && [file.name, file.size, file.lastModified], selectedSheet, encoding, delimiter, hasHeader, datasetId: editingDataset?.id, version: editingDataset?.version });
      const confirmConversion = confirmImport && reviewedImport.current === signature;
      if (confirmImport && dynamicDraft) {
        const dynamicFormats = editingDataset ? Object.fromEntries(Object.entries(formats).map(([field, format]) => [renames[field], format])) : formats;
        const displayNames = editingDataset ? Object.fromEntries(preview.schema.slice(0, asAnnotation ? 4 : undefined).map((field: any) => [renames[field.source || field.name], field.name.trim()])) : {};
        result = await api(editingDataset ? `/datasets/${editingDataset.id}/dynamic` : '/sources', { ...json({ ...dynamicDraft, version: editingDataset?.version, annotation_merge: mergeAnnotations, annotation_fields: annotationFields, name: datasetName.trim(), preview_id: preview.preview_id, overrides, renames, formats: dynamicFormats, display_names: displayNames, field_order: fieldOrder, confirm_conversion: confirmConversion }), method: editingDataset ? 'PUT' : 'POST' });
      } else if (confirmImport && editingDataset && !editingSource) {
        result = await api(`/datasets/${editingDataset.id}/fields`, { ...json({ name: datasetName.trim(), annotation_merge: mergeAnnotations, annotation_fields: annotationFields, version: editingDataset.version, types: overrides, display_names: renames, formats: Object.fromEntries(preview.schema.filter((field: any) => formats[field.name.trim()]).map((field: any) => [field.source || field.name, formats[field.name.trim()]])), field_order: fieldOrder, confirm_conversion: confirmConversion }), method: 'PATCH' });
      }
      else if (file) {
        const form = new FormData(); form.append('file', file); form.append('annotation_merge', String(mergeAnnotations)); form.append('annotation_fields', JSON.stringify(annotationFields)); form.append('annotation_order', JSON.stringify([])); form.append('confirm_conversion', String(confirmConversion)); if (editingDataset) { form.append('dataset_id', editingDataset.id); form.append('version', String(editingDataset.version)); } form.append('name', confirmImport ? datasetName.trim() : file.name); if (selectedSheet) form.append('sheet', selectedSheet); form.append('preview', String(!confirmImport)); form.append('overrides', JSON.stringify(overrides)); form.append('renames', JSON.stringify(renames)); form.append('formats', JSON.stringify(formats)); form.append('encoding', encoding); form.append('delimiter', delimiter); form.append('has_header', String(hasHeader)); form.append('field_order', JSON.stringify(fieldOrder));
        result = await api('/imports/files', { method: 'POST', body: form });
        if (result.sheets) {
          setSheets(result.sheets);
          const first = selectedSheet || result.sheets[0];
          if (!first) throw new Error(t("工作簿没有可用工作表"));
          setSheet(first); form.set('sheet', first);
          result = await api('/imports/files', { method: 'POST', body: form });
        }
      }
      else result = await api('/imports/paste', json({ name: confirmImport ? datasetName.trim() : t("粘贴数据"), text: paste, annotation_merge: mergeAnnotations, annotation_fields: annotationFields, annotation_order: [], preview: !confirmImport, confirm_conversion: confirmConversion, dataset_id: editingDataset?.id, version: editingDataset?.version, overrides, renames, formats, delimiter: delimiter || undefined, has_header: hasHeader, field_order: fieldOrder }));
      if (!confirmImport) {
        setMessage(fieldChangeMessage(detectedPreview.current?.schema || editingDataset?.schema, result.schema));
        result.field_formats = Object.fromEntries(Object.entries(result.field_formats).map(([field, format]: [string, any]) => [field, editingDataset?.schema.find(original => original.name === field && original.type === result.schema.find((item: any) => item.name === field)?.type) && editingDataset.field_formats?.[field] || { ...format, rounding: defaultRounding, decimals: format.kind === 'decimal' || format.format === 'percent' ? defaultDecimals : 0 }]));
        if (editingDataset) result.schema = result.schema.map((field: any) => ({ ...field, source: field.name, name: editingDataset.schema.find(original => original.name === field.name)?.display_name || field.name }));
        if (file && selectedSheet) setSheet(selectedSheet);
        if (!preview) setDatasetName(editingDataset?.name || nextDatasetName(datasets, asAnnotation));
        result = preparePreview(result); detectedPreview.current = result; setPreview(result);
        if (!editingDataset) { setDynamicDraft(null); if (file) setPaste(''); }
      }
      else {
        for (const [key, value] of dynamicCache.current.previews) if (value.preview_id === preview?.preview_id) dynamicCache.current.previews.delete(key);
        acceptDataset(result); setShowImport(false); setFile(null); setPreview(null); setEditingDataset(null); setEditingField('');
        if (panel === 'charts') { setActiveDatasetId(asAnnotation ? activeDatasetId : result.id); setSelected(''); navigateTo(editorPath); setImportedIds(items => [...items.filter(value => value !== result.id), result.id]); setDirty(true); }
        setMessage(t('数据集已接入'));
      }
    } catch (e) {
      const issues = confirmImport ? fieldTypeIssues(e) : undefined;
      if (issues) { setPreview((previous: any) => ({ ...previous, typeIssues: issues })); reviewedImport.current = signature; setMessage(t('已标红不匹配的样例，再次保存应用展示设置，原始数据不变。')); }
      else setMessage((e as Error).message);
    } finally { setBusy(false); }
  };
  const reportTabs = <ReportTabs tabs={tabs} activeId={activeTab.id} readOnly={publishedView} onSelect={selectTab} onCreate={tabName => {
    const tab = { id: crypto.randomUUID(), name: tabName };
    change({ ...doc, tabs: [...tabs, tab] }); selectTab(tab.id);
  }} onRename={(tabId, tabName) => change({ ...doc, tabs: tabs.map(tab => tab.id === tabId ? { ...tab, name: tabName } : tab) })} onDelete={tabId => {
    if (tabs.length === 1) return;
    const remaining = tabs.filter(tab => tab.id !== tabId);
    change({ ...doc, tabs: remaining, charts: doc.charts.filter(chart => (chart.tabId || tabs[0].id) !== tabId) }, true);
    if (activeTab.id === tabId) selectTab(remaining[remaining.length - 1].id);
  }} />;
  return <div ref={appRef} className={`app-shell ${publishedView ? 'published-view' : ''} ${publishedView ? 'canvas-display' : ''} ${commentChart ? 'comments-open' : ''} ${showSettings ? "settings-open" : showReports ? "reports-open" : panel === "history" || panel in modulePaths ? "datasets-open" : ""} ${portal ? 'portal-view' : ''}`}>
    {queryResults && <QueryResults key={queryResults.id} dataset={queryResults} onClose={() => setQueryResults(null)} />}{openingReport && <div className="report-loading" role="status" aria-live="polite">{t('正在打开报表…')}</div>}
    <aside className="rail">
      <button aria-label={t("历史数据集")} className={!showSettings && !showReports && panel === 'history' ? 'rail-active' : ''} onClick={() => { setShowSettings(false); setShowReports(false); setPanel('history'); navigateTo('/datasets'); refreshSavedDatasets(); }}><Icon name="datasets" /><span>{t("数据集")}</span></button>
      <button aria-label={t("报表")} className={!showSettings && (showReports || panel === 'charts') ? 'rail-active' : ''} onClick={() => { setShowSettings(false); setShowReports(true); navigateTo('/reports'); api('/dashboards').then(setDashboards).catch(error => setMessage(error.message)); }}><Icon name="report" /><span>{t("报表")}</span></button>
      <button aria-label={t("定时任务")} className={!showSettings && !showReports && panel === 'scheduled' ? 'rail-active' : ''} onClick={() => { setShowSettings(false); setShowReports(false); setPanel('scheduled'); navigateTo('/scheduled-queries'); }}><Icon name="schedule" /><span>{t("定时任务")}</span></button>
      {(['portals', 'users', 'roles', 'permissions'] as const).map(module => <button key={module} aria-label={t(moduleLabels[module])} className={!showSettings && !showReports && panel === module ? 'rail-active' : ''} onClick={() => { setShowSettings(false); setShowReports(false); setPanel(module); navigateTo(modulePaths[module]); }}><Icon name={module === 'portals' ? 'portal' : module === 'users' ? 'user' : module === 'roles' ? 'roles' : 'permissions'} /><span>{t(moduleLabels[module])}</span></button>)}
      <button className={showSettings ? 'rail-active rail-settings' : 'rail-settings'} aria-label={t("设置")} onClick={() => { setShowSettings(true); navigateTo('/settings'); }}><Icon name="settings" /><span>{t("设置")}</span></button>
    </aside>
    {portal && <nav className="portal-menu" aria-label={portal.name}><h1 title={portal.name}>{portal.name}</h1>{portal.reports.length ? portal.reports.map(report => <button key={report.id} aria-current={report.id === portalReportId ? 'page' : undefined} title={report.name} onClick={() => { if (report.id !== portalReportId) openPortalReport(report.id); }}>{report.name}</button>) : <p>{t('暂无已发布的报表')}</p>}</nav>}
    {showReports && !showSettings && <ReportsPage reports={dashboards} drafts={Object.keys(drafts)} onRestore={value => void open(value, false, true)} busy={isSaving || reportBusy || publishing || openingReport} onShare={async reportId => { try { await copyPublicReportLink(reportId); setMessage(t('\u62a5\u8868\u94fe\u63a5\u5df2\u590d\u5236')); } catch (error) { setMessage((error as Error).message); } }} onPublish={value => void publish(value)} onView={value => void viewReport(value)} onEdit={value => void open(value)} onPermission={value => { setPermissionReport(value); setShowReports(false); setShowSettings(false); setPanel('permissions'); navigateTo(modulePaths.permissions); }} onCopy={value => void copyReport(value)} onDelete={report => setReportAction({ kind: 'delete', report })} onNew={newReport} />}
    {reportAction && <dialog ref={reportDialog} className="modal report-confirmation" aria-label={reportAction.kind === 'new' ? t('\u65b0\u5efa\u62a5\u8868') : t('\u5220\u9664\u62a5\u8868')} onCancel={event => { event.preventDefault(); if (!reportBusy) { setReportAction(null); navigateTo(activePath, true); } }}>
      <h2>{reportAction.kind === 'new' ? t('\u65b0\u5efa\u62a5\u8868') : t('\u5220\u9664\u62a5\u8868')}</h2>
      <p>{reportAction.kind === 'new' ? t('\u5f53\u524d\u62a5\u8868\u6709\u672a\u4fdd\u5b58\u4fee\u6539\uff0c\u662f\u5426\u653e\u5f03\u5e76\u65b0\u5efa\uff1f') : t('\u786e\u5b9a\u5220\u9664\u62a5\u8868\u201c{0}\u201d\uff1f\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\u3002', reportAction.report.name)}</p>
      {reportAction.kind === 'delete' && reportAction.report.id === id && dirty && <p>{t('\u540c\u65f6\u653e\u5f03\u5f53\u524d\u672a\u4fdd\u5b58\u7684\u4fee\u6539\u3002')}</p>}
      {reportError && <p role="alert">{reportError}</p>}
      <div className="modal-actions"><button disabled={reportBusy} onClick={() => { setReportAction(null); navigateTo(activePath, true); }}>{t('\u53d6\u6d88')}</button><button className="primary" disabled={reportBusy} onClick={() => void confirmReportAction()}>{reportBusy ? t('\u5904\u7406\u4e2d\u2026') : t('\u786e\u8ba4')}</button></div>
    </dialog>}
    <section className="sidebar left-panel">
      {sidebarResizer('left')}

        <div className="toolbar-controls"><button onClick={() => addChart('filter')}><Icon name="funnel" />{t("筛选器")}</button></div><div className="section-title">{t("可选图表")}</div><div className="chart-list-frame"><div tabIndex={0} aria-label={t("可选图表列表")} className={`chart-grid ${chartsScrolling ? 'is-scrolling' : ''}`} onScroll={e => { const list = e.currentTarget, height = Math.max(20, list.clientHeight * list.clientHeight / list.scrollHeight); list.parentElement!.style.setProperty('--thumb-height', height + 'px'); list.parentElement!.style.setProperty('--thumb-top', (list.scrollTop / Math.max(1, list.scrollHeight - list.clientHeight) * (list.clientHeight - height)) + 'px'); setChartsScrolling(true); window.clearTimeout(scrollTimer.current); scrollTimer.current = window.setTimeout(() => setChartsScrolling(false), 650); }}>{chartRegistry.map(chart => <button key={chart.id} onClick={() => addChart(chart.id)}><Icon name={chart.id} />{chart.label}</button>)}</div><span className="chart-scroll-thumb" aria-hidden="true" /></div>
    </section>
    {panel === 'portals' || panel === 'users' || panel === 'roles' || panel === 'permissions' ? <main className="reports-page dataset-management access-page">{panel === 'portals' ? <PortalsPage onMessage={setMessage} /> : panel === 'users' ? <UsersPage onMessage={setMessage} /> : panel === 'roles' ? <RolesPage onMessage={setMessage} /> : <PermissionsPage onMessage={setMessage} openReportId={permissionReport} onOpened={() => setPermissionReport('')} />}</main> : panel === 'scheduled' ? <main className="reports-page dataset-management scheduled-page"><ScheduledQueries onMessage={setMessage} onOpenReport={reportId => void open(reportId)} /></main> : panel === 'history' ? <DatasetManager onEdit={source => void openFieldSettings(source, false, true)} onMessage={setMessage} onView={source => void openFieldSettings(source, true)} datasets={savedDatasets} onConnect={() => { setEditingDataset(null); setPreview(null); setShowImport(true); }} onDeleted={value => { setSavedDatasets(items => items.filter(item => item.id !== value)); setDatasets(items => items.filter(item => item.id !== value)); setImportedIds(items => items.filter(item => item !== value)); }} /> : <main ref={publishedWorkspace} className="workspace">{publishedView && reportTabs}{restoredDraft && <div className="draft-notice" role="status"><span>{t('\u5df2\u52a0\u8f7d\u672a\u4fdd\u5b58\u5185\u5bb9\uff0c\u786e\u8ba4\u4f7f\u7528\u540e\u8bf7\u70b9\u51fb\u4fdd\u5b58')}</span><button onClick={() => void open(id)}>{t('\u6253\u5f00\u5df2\u4fdd\u5b58\u7248\u672c')}</button></div>}<div id="report-tab-panel" role="tabpanel" aria-labelledby={publishedView && tabs.length === 1 ? undefined : 'report-tab-' + activeTab.id} aria-label={publishedView && tabs.length === 1 ? activeTab.name : undefined} ref={workspaceScroll} className="workspace-scroll" onClick={event => { if (!pasteArmed && !(event.target as Element).closest('.chart-card')) { setSelected(''); setCommentChart(''); } }}>
      <div ref={setCanvasNode} tabIndex={0} className={`grid-surface ${resizing ? 'is-resizing' : ''} ${pasteArmed ? 'paste-armed' : ''} ${!previewMode && tile && tile.config.type !== 'filter' ? 'chart-focused' : ''}`} data-testid="grid-surface" style={{ minHeight: Math.max(displayRows, ...(insertion?.charts.map(chart => chart.y + chart.h + (previewMode ? 0 : 4)) || [])) * ROW_UNIT - ROW_GAP, ...(publishedCanvasWidth ? { maxWidth: publishedCanvasWidth, margin: '0 auto' } : {}) }} onClick={e => { if ((e.target as HTMLElement).closest('.chart-card')) return; const r = e.currentTarget.getBoundingClientRect(); const at = { x: Math.floor((e.clientX - r.left) / ((r.width + 8) / grid.columns)), y: Math.floor((e.clientY - r.top) / ROW_UNIT) }; pasteAt.current = at; e.currentTarget.focus({ preventScroll: true }); if (pasteArmed) pasteChart(at); else { setSelected(''); setCommentChart(''); } }} onPaste={e => { if (copied && !previewMode) { e.preventDefault(); pasteChart(pasteAt.current); } }} onKeyDown={e => { if (e.key === 'Escape') { setPasteArmed(false); setSelected(''); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && tile && !previewMode) { e.preventDefault(); copyChart(tile); } }}>
      {!tabCharts.length && <div className="empty-canvas">{t("\u5148\u63a5\u5165\u6570\u636e\uff0c\u518d\u4ece\u5de6\u4fa7\u6dfb\u52a0\u4efb\u610f\u6570\u91cf\u7684\u56fe\u8868")}</div>}
      {!publishedView && !previewMode && doc.showGuides && <div className="grid-guides" aria-hidden="true">{(doc.guideType === 'thirds' ? [1 / 3, 2 / 3] : [1 / 4, 1 / 2, 3 / 4]).map(part => <span key={part} style={{ left: `calc((100% + 8px) * ${part} - 4px)` }} />)}</div>}
      {/* Drag slot sits beneath the cards: the origin while dragging, or the 1/2 · 1/3 · 1/4 slot of a sideways drop. */}
      {draggingId && (() => { const origin = tabCharts.find(chart => chart.id === draggingId), joined = sidewaysInsertion?.charts.find(chart => chart.id === sidewaysInsertion.movingId), slot = joined && sidewaysRow !== undefined && sidewaysRow !== null ? { ...joined, y: sidewaysRow } : undefined; if (!origin) return null; const at = gridPixels(origin), to = slot && gridPixels(slot); return <div className="insertion-preview insertion-under" aria-hidden="true"><div className="drag-slot drag-origin" style={{ left: at.left, top: at.top, width: at.width, height: at.height }} />{to && <div className="drag-slot" style={{ left: to.left, top: to.top, width: to.width, height: to.height }}><span>{t('松开以插入')}</span></div>}</div>; })()}
      {surfaceWidth > 0 && keptTabs.map(tabId => { const active = tabId === activeTab.id, tabItems = chartsOfTab(tabId), shown = active ? displayCharts : displayFor(tabItems); return <div key={tabId} className="tab-canvas" style={active ? undefined : { display: 'none' }}>
      <GridLayout width={surfaceWidth} className="canvas multi-canvas" cols={displayColumns} rowHeight={ROW_HEIGHT} margin={[8, ROW_GAP]} containerPadding={[0, 0]} compactType={null} preventCollision={false} allowOverlap={true} style={active ? { minHeight: Math.max(displayRows * ROW_UNIT - ROW_GAP, publishedView ? 0 : Math.max(0, ...displayCharts.map(chart => chart.y + chart.h)) * ROW_UNIT - ROW_GAP + 100) } : undefined} draggableHandle=".tile-drag-handle" draggableCancel=".tile-actions,button:not(.tile-drag-handle)" isDraggable={active && !previewMode && !publishedView} isResizable={active && !previewMode && !publishedView} resizeHandles={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']} layout={shown.map(c => ({ i: c.id, x: c.x, y: c.y, w: c.w, h: c.h, minW: minCols(c, displayColumns), minH: c.config.type === 'filter' ? MIN_FILTER_ROWS : MIN_CHART_ROWS, layoutRevision } as Layout))} onResizeStart={() => setResizing(true)} onResize={(_layout, old, item) => snapWidth(item, old)} onDragStart={(_layout, _old, _item, _placeholder, event, node) => { const rect = node.getBoundingClientRect(); const touch = event as MouseEvent & { touches?: TouchList }; const point = touch.touches?.[0] || event; dragAnchor.current = { x: point.clientX - rect.left, y: point.clientY - rect.top }; insertionRef.current = null; setInsertion(null); setDraggingId(_item.i); }} onDrag={(_layout, _old, item, _placeholder, event) => { previewInsertion(item.i, event); }} onDragStop={(layout, _old, item, _placeholder, event) => { const next = previewInsertion(item.i, event); insertionRef.current = null; setInsertion(null); setDraggingId(''); if (next) change({ ...doc, charts: next.charts.map(chart => { const original = tabCharts.find(item => item.id === chart.id)!; return chart.config.type === 'filter' && (chart.w !== original.w || chart.h !== original.h) ? { ...chart, config: { ...chart.config, filterAutoWidth: false } } : chart; }) }); void layout; setLayoutRevision(value => value + 1); }} onResizeStop={(_layout, _old, item) => {
        setResizing(false); snapWidth(item, _old);
        setLayoutRevision(value => value + 1);
        const chart = tabCharts.find(chart => chart.id === item.i);
        if (chart) change({ ...doc, charts: pushGridTiles(tabCharts, [{ ...chart, x: item.x, y: item.y, w: item.w, h: item.h, config: { ...chart.config, ...(chart.config.type === 'filter' ? { filterAutoWidth: false } : {}) } }]) });
      }}>
        {shown.map(c => <article key={c.id} id={'chart-' + c.id} data-testid="chart-tile" style={previewShift(c)} className={`chart-card ${previewShift(c) ? 'preview-shift' : ''} ${c.config.type === 'kpi' ? 'kpi-card' : ''} ${c.config.type === 'filter' ? 'filter-card' : ''} ${c.config.type !== 'filter' && c.config.description?.trim() ? 'chart-with-note' : ''} ${!publishedView && selected === c.id ? 'active-card' : ''}`} onPointerDownCapture={() => { if (publishedView) return; setSelected(c.id); setActiveDatasetId(c.datasetId); }} onClick={() => { if (publishedView) return; setCommentChart(''); setSelected(c.id); setActiveDatasetId(c.datasetId); }}><div className="card-head">{/* Filter titles only link filters to charts (properties sidebar); they are never shown on the canvas. */}<strong title={c.config.type === 'filter' ? undefined : chartTitle(c.config, datasets.find(dataset => dataset.id === c.datasetId), chartFilters(c, tabItems), publishedView ? publishedTheme.locale || getChartLocale() : getChartLocale())}>{c.config.type === 'filter' ? '' : chartTitle(c.config, datasets.find(dataset => dataset.id === c.datasetId), chartFilters(c, tabItems), publishedView ? publishedTheme.locale || getChartLocale() : getChartLocale())}</strong>{!previewMode && <button className="tile-drag-handle" aria-label={t('\u62d6\u52a8\u7ec4\u4ef6')} title={t('\u6309\u4f4f\u62d6\u52a8\u7ec4\u4ef6')}>&#8943;</button>}<div className="tile-actions">{!offlineExport && c.config.type !== 'filter' && <button className="comment-button" aria-label={t('\u8bc4\u8bba') + ' ' + (commentCounts[c.id] || 0)} onClick={event => { event.stopPropagation(); setSelected(c.id); setCommentChart(c.id); }}><Icon name="comment" /><span>{commentCounts[c.id] || 0}</span></button>}{!previewMode && <button title={t("\u590d\u5236\u56fe\u8868")} aria-label={t("\u590d\u5236\u56fe\u8868")} onClick={e => { e.stopPropagation(); copyChart(c); }}><Icon name="copy" /></button>}{c.config.type !== 'filter' && <button title={t("\u590d\u5236\u4e3a\u56fe\u7247")} aria-label={t("\u590d\u5236\u4e3a\u56fe\u7247")} onClick={e => { e.stopPropagation(); void copyChartImage(c); }}><Icon name="image" /></button>}{!previewMode && <button className="remove-dataset remove-component" aria-label={t("\u5220\u9664\u56fe\u8868")} onClick={e => { e.stopPropagation(); deleteChart(c); }}><Icon name="remove" /></button>}</div></div>{c.config.type === 'filter' ? <FilterControl displayLocale={publishedView ? publishedTheme.locale : undefined} tile={c} onContentWidth={width => fitFilterWidth(c.id, width)} dataset={datasets.find(d => d.id === c.datasetId)} global={[]} onChange={(config, automatic) => { if (automatic) { setDoc(previous => ({ ...previous, charts: previous.charts.map(item => item.id === c.id ? { ...item, config: { ...item.config, ...config } } : item) })); if (!publishedView) setDirty(true); } else change({ ...doc, charts: tabCharts.map(item => item.id === c.id ? { ...item, config: { ...item.config, ...config } } : item) }); }} /> : <ChartTile annotations={annotations} highlightWeekends={doc.highlightWeekends} published={publishedView} theme={publishedView ? publishedTheme : theme} showUpdatedAt={showUpdatedAt} tile={c} dataset={datasets.find(d => d.id === c.datasetId)} global={chartFilters(c, tabItems)} />}{c.config.type !== 'filter' && c.config.description?.trim() && <aside className="chart-note" role="note" aria-label={translate(publishedView ? publishedTheme.locale || getChartLocale() : getChartLocale(), '图表说明')}>{c.config.description}</aside>}</article>)}
      </GridLayout></div>; })}
      {insertion && (insertion.side === 'top' || insertion.side === 'bottom') && <div className="insertion-preview" aria-hidden="true">{(() => { const target = tabCharts.find(chart => chart.id === insertion.targetId); if (!target) return null; const row = insertion.side === 'top' ? target.y : Math.max(...tabCharts.filter(chart => chart.id !== insertion.movingId && chart.y === target.y).map(chart => chart.y + chart.h)); return <div className="insertion-line" style={{ top: Math.max(0, row * ROW_UNIT - ROW_GAP / 2 - 1) }}><span>{t('松开以插入')}</span></div>; })()}</div>}
      </div></div><footer className="workspace-status"><div className="canvas-toolbar bottom-toolbar"><button title={t("撤销")} aria-label={t("撤销")} disabled={!history.current.length} onClick={() => { setDeleted(null); future.current.push(doc); setDoc(history.current.pop()!); setDirty(true); }}><Icon name="undo" /></button><button title={t("重做")} aria-label={t("重做")} disabled={!future.current.length} onClick={() => { setDeleted(null); history.current.push(doc); setDoc(future.current.pop()!); setDirty(true); }}><Icon name="redo" /></button></div><div className="footer-data-controls"><button className="import-button square-add-button" title={t("接入数据")} aria-label={t("接入数据")} disabled={busy} onClick={() => { setEditingDataset(null); setEditingSource(false); setEditingField(''); setPreview(null); setShowImport(true); }}><Icon name="add" /></button><div className="working-dataset"><details className="dataset-picker" ref={datasetPicker} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label={t('\u9009\u62e9\u6570\u636e\u96c6')} aria-disabled={!importedIds.length} tabIndex={importedIds.length ? 0 : -1} onClick={event => { if (!importedIds.length) event.preventDefault(); }} title={datasetDisplayName(dataset)}>{dataset && <DatasetTag dynamic={dataset.dynamic} />}<span>{datasetDisplayName(dataset) || t('\u6682\u65e0\u6570\u636e\u96c6')}</span><img src="/import-icons/chevron-down.svg" alt="" /></summary><div className="dataset-options">{importedIds.map(value => <button key={value} aria-pressed={value === dataset?.id} title={datasetDisplayName(datasets.find(item => item.id === value))} onClick={() => { selectDataset(value); if (datasetPicker.current) datasetPicker.current.open = false; }}><DatasetTag dynamic={datasets.find(item => item.id === value)?.dynamic} /><span className="dataset-option-name">{datasetDisplayName(datasets.find(item => item.id === value)) || value}</span></button>)}</div></details><button className="dataset-configure" title={t('\u5b57\u6bb5\u914d\u7f6e')} aria-label={t('\u5b57\u6bb5\u914d\u7f6e')} disabled={busy} onClick={() => void openFieldSettings()}><Icon name="settings" /></button><button className="remove-dataset" disabled={busy || !dataset} title={t('\u79fb\u9664\u5f53\u524d\u6570\u636e\u96c6')} aria-label={t('\u79fb\u9664\u5f53\u524d\u6570\u636e\u96c6')} onClick={() => { if (!dataset) return; const removed = dataset.id, remaining = importedIds.filter(value => value !== removed); setImportedIds(remaining); setDatasets(items => items.filter(item => item.id !== removed)); change({ ...doc, datasets: doc.datasets.filter(item => item.id !== removed), charts: doc.charts.map(chart => chart.datasetId === removed ? { ...chart, datasetId: '' } : chart) }, true); setActiveDatasetId(remaining[remaining.length - 1] || ''); setSelected(''); }}><Icon name="close" /></button></div></div>{!publishedView && reportTabs}<div className="report-editor-actions">{saveError && <span role="alert">{t("保存失败")}<button onClick={() => setSaveError('')}>{t("重试")}</button></span>}<div className="publish-menu"><button className="primary" aria-haspopup="menu" disabled={publishing || isSaving || !name.trim()} onClick={() => void publish()}>{publishing ? t('\u53d1\u5e03\u4e2d\u2026') : t('\u53d1\u5e03')}</button><div className="publish-menu-options" role="menu" aria-label={t('\u53d1\u5e03\u9009\u9879')}><div><button role="menuitem" disabled={publishing || !tabCharts.length} title={t('\u5bfc\u51fa\u4e3a\u53ef\u4ea4\u4e92\u7684 HTML \u6587\u4ef6\uff08\u542b\u5168\u90e8\u6807\u7b7e\u9875\u548c\u6570\u636e\uff09')} onClick={() => void exportPage()}>{t('\u53d1\u5e03\u4e3a\u9875\u9762')}</button></div></div></div><button className="primary save-dashboard" disabled={isSaving || !dirty || !name.trim()} onClick={() => void save()}>{isSaving ? t("保存中…") : t("保存")}</button></div></footer></main>}
    <aside className="sidebar properties">{sidebarResizer('right')}<div className="property-body" key={commentChart || tile?.id || 'report'}>{!commentChart && !tile && <fieldset className="axis-settings"><legend>{t('\u6574\u4f53\u8bbe\u7f6e')}</legend><label>{t('\u62a5\u8868\u6807\u9898')}<input className="report-name" aria-label={t("仪表板名称")} value={name} onChange={e => { setName(e.target.value); setDirty(true); }} /></label><label><input type="checkbox" checked={!!doc.highlightWeekends} onChange={event => change({ ...doc, highlightWeekends: event.target.checked })} />{t('\u9ad8\u4eae\u663e\u793a\u5468\u672b')}</label><label><input type="checkbox" checked={!!doc.showGuides} onChange={event => change({ ...doc, showGuides: event.target.checked })} />{t('显示参考线')}</label><label>{t('参考线类型')}<select aria-label={t('参考线类型')} disabled={!doc.showGuides} value={doc.guideType || 'quarters'} onChange={event => change({ ...doc, guideType: event.target.value as Document['guideType'] })}><option value="quarters">{t('4 分线（1/4、1/2、3/4）')}</option><option value="thirds">{t('3 分线（1/3、2/3）')}</option></select></label><label><input type="checkbox" checked={annotationCharts.length > 0 && annotationCharts.every(chart => chart.config.showAnnotations)} onChange={event => change({ ...doc, charts: doc.charts.map(chart => ({ ...chart, config: { ...chart.config, showAnnotations: event.target.checked && annotationCharts.some(item => item.id === chart.id) } })) })} />{t('显示标注')}</label></fieldset>}{!commentChart && !tile && <fieldset className="axis-settings report-refresh-settings"><legend>{t('每日定时查询')}</legend><label><input type="checkbox" checked={reportSchedule.enabled} onChange={event => change({ ...doc, refreshSchedule: { ...reportSchedule, enabled: event.target.checked } })} />{t('自动刷新报表数据集')}</label><label>{t('执行时间')}<TimePicker label={t('执行时间')} value={reportSchedule.time} disabled={!reportSchedule.enabled} onChange={time => change({ ...doc, refreshSchedule: { ...reportSchedule, time } })} /></label>{reportSchedule.timezone === 'UTC' && <small>{t('本地执行时间：{0}', new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(new Date().toISOString().slice(0, 10) + 'T' + reportSchedule.time + ':00Z')))}</small>}<TimezoneSelect disabled={!reportSchedule.enabled} value={reportSchedule.timezone} onChange={timezone => change({ ...doc, refreshSchedule: { ...reportSchedule, timezone } })} /><button disabled={refreshingReport || !datasets.some(source => importedIds.includes(source.id) && source.dynamic)} onClick={async () => { setRefreshingReport(true); try { for (const source of datasets.filter(source => importedIds.includes(source.id) && source.dynamic)) { try { const result = await api(`/datasets/${source.id}/refresh?force=true`, json({})); acceptDataset(result); } catch (error) { setMessage((error as Error).message); } } } finally { setRefreshingReport(false); } }}>{t(refreshingReport ? '执行中…' : '执行')}</button><div className="report-refresh-results">{datasets.filter(source => importedIds.includes(source.id) && source.dynamic).slice(resultPage * 10, (resultPage + 1) * 10).map(source => <div key={source.id}><strong>{source.name}</strong><span>{t('上次执行')} · {formatUpdatedAt(source.dynamic?.last_run_at)}</span><span>{t('结果更新时间')} · {formatUpdatedAt(source.data_as_of)}</span><span>{source.dynamic?.refreshing ? t('执行中…') : executionError(source.dynamic?.last_error) || t('缓存结果：{0} 行', source.row_count)}</span><button disabled={refreshingReport} onClick={() => setQueryResults(source)}>{t('查看结果')}</button></div>)}</div><Pagination page={resultPage} total={datasets.filter(source => importedIds.includes(source.id) && source.dynamic).length} onChange={setResultPage} disabled={refreshingReport} /></fieldset>}{commentChart ? <CommentsPanel key={commentChart} reportId={id} chartId={commentChart} onClose={() => setCommentChart('')} onCount={count => setCommentCounts(previous => ({ ...previous, [commentChart]: count }))} /> : tile?.config.type === 'filter' ? <><h3>{t("筛选器配置")}</h3><FilterProperties config={tile.config} dataset={dataset} onChange={patchConfig} /><fieldset className="axis-settings filter-targets"><legend>{t('关联图表')}</legend><div className="filter-target-tree"><strong title={activeTab.name}>{activeTab.name}</strong>{tabCharts.some(chart => chart.config.type !== 'filter') ? <ul>{tabCharts.filter(chart => chart.config.type !== 'filter').sort((a, b) => a.y - b.y || a.x - b.x).map(chart => { const source = datasets.find(item => item.id === chart.datasetId), followed = chart.followFilterIds ?? followedFilterIds(chart, tabCharts, source); return <li key={chart.id}><label><input type="checkbox" checked={followed.includes(tile.id)} onChange={event => setChartFilters(chart, event.target.checked ? [...followed, tile.id] : followed.filter(value => value !== tile.id))} /><span title={chartTitle(chart.config, source)}>{chartTitle(chart.config, source) || t('未命名图表')}</span></label>{!filterMatchesChart(chart, tile, source) && <small>{t('（图表数据集没有该筛选字段，暂不生效）')}</small>}</li>; })}</ul> : <small>{t('当前页面没有图表')}</small>}</div></fieldset></> : tile ? <><h3>{t("图表配置")}</h3><label>{t('已关联数据集')}<select value={tile.datasetId} onChange={event => selectDataset(event.target.value)}>{datasets.filter(source => importedIds.includes(source.id) && !Object.keys(source.annotation_fields || {}).length).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label><label>{t("图表标题")}<input aria-label={t("图表标题")} value={chartTitle(tile.config, dataset)} onChange={e => patchConfig({ title: e.target.value, autoTitle: false })} /></label><label>{t('说明信息')}<textarea aria-label={t('说明信息')} rows={3} value={tile.config.description || ''} placeholder={t('填写后显示在图表底部')} onChange={event => patchConfig({ description: event.target.value })} /></label><fieldset className="axis-settings chart-type-settings"><legend>{t("图表类型")}</legend><select aria-label={t('图表类型')} value={tile.config.type} onChange={event => patchConfig({ type: event.target.value as ChartConfig['type'] })}>{chartRegistry.map(chart => <option key={chart.id} value={chart.id}>{chart.label}</option>)}</select></fieldset><fieldset className="axis-settings"><legend>{t('跟随筛选器')}</legend>
      <label>{t('跟随方式')}<select aria-label={t('跟随方式')} value={tile.followFilterIds === undefined ? 'nearest' : tile.followFilterIds.length ? 'selected' : 'none'} onChange={event => patchTile({ followFilterIds: event.target.value === 'nearest' ? undefined : event.target.value === 'none' ? [] : filterIds.length ? filterIds : pageFilters.slice(0, 1).map(filter => filter.id) })}>
        <option value="nearest">{t('上方最近的筛选器')}</option><option value="none">{t('不跟随')}</option><option value="selected">{t('指定筛选器')}</option>
      </select></label>
      {tile.followFilterIds === undefined && <small>{filterIds.length ? pageFilters.find(filter => filter.id === filterIds[0])?.config.title : t('上方没有包含相同字段的筛选器，当前不跟随')}</small>}
      {tile.followFilterIds !== undefined && pageFilters.map(filter => <label key={filter.id}><input type="checkbox" checked={chosenFilterIds.includes(filter.id)} onChange={event => patchTile({ followFilterIds: event.target.checked ? [...chosenFilterIds, filter.id] : chosenFilterIds.filter(id => id !== filter.id) })} />{filter.config.title || t('筛选器')}{!filterMatchesChart(tile, filter, dataset) && <small>{t('（图表数据集没有该筛选字段，暂不生效）')}</small>}</label>)}
      {tile.followFilterIds !== undefined && !pageFilters.length && <small>{t('当前页面没有筛选器')}</small>}
    </fieldset>{tile.config.type === 'pie' && <label><input type="checkbox" checked={!!(tile.config.piePercent ?? tile.config.legendPercent)} onChange={event => patchConfig({ piePercent: event.target.checked, legendPercent: undefined, ...(event.target.checked ? { labels: true } : {}) })} />{t('数据标签显示百分比')}</label>}<FieldBindings key={tile.id} config={tile.config} fields={dataset?.schema || []} onChange={patchConfig} />{annotationSources.length > 0 && <><label><input type="checkbox" checked={!!tile.config.showAnnotations} onChange={event => patchConfig({ showAnnotations: event.target.checked })} />{t('显示标注')}</label>{tile.config.showAnnotations && <label>{t('标注样式')}<select value={tile.config.annotationStyle || 'range'} onChange={event => patchConfig({ annotationStyle: event.target.value as ChartConfig['annotationStyle'] })}><option value="start">{t('开始日期竖线')}</option><option value="range">{t('日期区间')}</option></select></label>}{tile.config.showAnnotations && annotationError && <p role="alert" className="source-error">{annotationError}</p>}</>}<label>{t("Legend / 系列分组")}<select aria-label={t("Legend 字段")} disabled={!['bar', 'line', 'area', 'mixed', 'scatter'].includes(tile.config.type)} value={tile.config.legendField || ''} onChange={e => patchConfig({ legendField: e.target.value })}><option value="">{t("不按字段分组")}</option>{dataset?.schema.filter(field => ['string', 'date'].includes(field.type)).map(field => <option key={field.name} value={field.name}>{field.display_name || field.name}</option>)}</select></label><label>{t("聚合")}<select value={tile.config.aggregation} onChange={e => patchConfig({ aggregation: e.target.value as ChartConfig['aggregation'] })}>{(['sum', 'avg', 'count', 'min', 'max', 'count_distinct'] as const).map(a => <option key={a} value={a}>{t(({ sum: '求和', avg: '平均值', count: '计数', min: '最小值', max: '最大值', count_distinct: '去重计数' })[a])}</option>)}</select></label><label>{t("排序")}<select value={chartSort(tile.config)} onChange={e => patchConfig({ sort: e.target.value })}><option value="none">{t("原顺序")}</option><option value="desc">{t("指标降序")}</option><option value="asc">{t("指标升序")}</option></select></label>{(tile.config.measures || [tile.config.measure, tile.config.secondMeasure].filter(Boolean)).length > 1 && <label>{t('排序指标')}<select value={(tile.config.measures || [tile.config.measure, tile.config.secondMeasure]).includes(tile.config.sortMeasure) ? tile.config.sortMeasure : tile.config.measure} onChange={event => patchConfig({ sortMeasure: event.target.value })}>{(tile.config.measures || [tile.config.measure, tile.config.secondMeasure]).filter(Boolean).map(field => <option key={field} value={field}>{field}</option>)}</select></label>}<details className="top-n-settings" key={'top-n-' + tile.id}><summary>{t("Top N / 最大结果")}{tile.config.limit ? ` · ${tile.config.limit}` : ''}</summary><label>{t('最大结果数')}<input type="number" min={1} max={10000} step={1} value={tile.config.limit ?? ''} placeholder={t('不限制')} onChange={event => { const value = event.target.valueAsNumber; if (!event.target.value) patchConfig({ limit: undefined }); else if (Number.isInteger(value) && value >= 1 && value <= 10000) patchConfig({ limit: value }); }} /></label></details>{<label>{t('图例')}<select value={tile.config.legendAuto === false ? tile.config.legend ? 'show' : 'hide' : 'auto'} onChange={event => patchConfig({ legendAuto: event.target.value === 'auto', legend: event.target.value === 'show' })}><option value="auto">{t('自动')}</option><option value="show">{t('显示')}</option><option value="hide">{t('隐藏')}</option></select></label>}{['bar', 'line', 'area', 'mixed', 'waterfall', 'histogram', 'boxplot', 'heatmap', 'scatter'].includes(tile.config.type) && <label><input type="checkbox" checked={!!tile.config.axisHover} onChange={event => patchConfig({ axisHover: event.target.checked })} />{t('\u60ac\u505c\u6574\u5217 / \u6574\u884c\u663e\u793a\u6570\u503c')}</label>}{(['labels', 'smooth' , 'stacked', 'horizontal', 'donut'] as const).map((key, i) => (tile.config.type === 'mixed' && (key === 'smooth' || key === 'stacked') || tile.config.type === 'candlestick' && ['smooth', 'stacked', 'horizontal', 'donut'].includes(key)) ? null : <label key={key}><input type="checkbox" checked={!!tile.config[key]} onChange={e => patchConfig({ [key]: e.target.checked })} />{[t("数据标签"), t("平滑线"), t("堆叠"), t("横向"), t("环形")][i]}</label>)}{tile.config.type === 'map' && <label>{t("地图 GeoJSON")}<input type="file" accept=".json,.geojson" onChange={async e => { try { const f = e.target.files?.[0]; if (f) patchConfig({ mapGeoJSON: JSON.parse(await f.text()) }); } catch { setMessage(t("无效 GeoJSON")); } }} /></label>}</> : <p>{t("选择图表以配置数据、样式和筛选器")}</p>}</div></aside>
    {deleted && deleted.session === session.current && <div className="delete-toast" data-testid="delete-toast" role="status"><span>{t("图表已删除")}</span><button onClick={restoreDeleted}>{t("撤销")}</button><small>{t("5 秒内可恢复")}</small></div>}

    {showSettings && <main className="settings-page" aria-label={t("设置")}><nav className="settings-nav" aria-label={t('设置导航')}>{[
        ['profile', '个人资料'], ['public-access', '报表对外访问'], ['connections', '连接关联'], ['theme', '主题配色'], ['formats', '数据格式'], ['display', '报表显示'], ['save', '保存'], ['language', '语言'],
      ].map(([id, label]) => <a key={id} href={'#settings-' + id} aria-current={settingsSection === id ? 'location' : undefined} onClick={event => { event.preventDefault(); setSettingsSection(id); }}>{t(label)}</a>)}</nav><div className="settings-content">
      <header className="settings-heading"><h2>{t("设置")}</h2><button onClick={() => { setShowSettings(false); navigateTo(showReports ? '/reports' : panel === 'history' ? '/datasets' : panel in modulePaths ? modulePaths[panel as ModulePanel] : editorPath); }}>{t("返回画布")}</button></header>{settingsSection === 'public-access' && <PublicAccessSettings onMessage={setMessage} />}{settingsSection === 'profile' && <UserProfile onMessage={setMessage} />}{settingsSection === 'connections' && <ConnectionsSettings onMessage={setMessage} />}{settingsSection === 'theme' && <section id="settings-theme" className="settings-card"><h3>{t('\u4e3b\u9898\u914d\u8272')}</h3><div className="chart-palette">
      <div className="chart-palette-options">{[...chartPalettes, { id: 'random', label: '\u968f\u673a', colors: randomChartColors('preview').slice(0, 6) }].map(palette => <button type="button" key={palette.id} aria-label={t(palette.label)} aria-pressed={theme.palette === palette.id} className={theme.palette === palette.id ? 'selected' : ''} onClick={() => updateTheme({ palette: palette.id })}><span className="chart-palette-name">{t(palette.label)}</span><span className="chart-palette-strip">{palette.colors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</span></button>)}</div>
      <details className="chart-palette-custom"><summary>{t('\u81ea\u5b9a\u4e49\u914d\u8272')}</summary><div className="chart-palette-colors">{chartColors({ type: 'bar', ...theme }).slice(0, 6).map((color, index) => <input key={index} type="color" aria-label={t('\u914d\u8272') + ' ' + (index + 1)} value={color} onChange={event => { const colors = chartColors({ type: 'bar', ...theme }).slice(0, 6); colors[index] = event.target.value; updateTheme({ palette: 'custom', colors }); }} />)}</div></details>
      <p>{t('\u968f\u673a\u914d\u8272\u5728\u540c\u4e00\u7ec4\u4ef6\u5185\u6bcf 64 \u4e2a\u989c\u8272\u5faa\u73af\uff0c\u8fde\u7eed 64 \u4e2a\u4e0d\u91cd\u590d')}</p></div></section>}
      {settingsSection === 'formats' && <section id="settings-formats" className="settings-card">
      <h3>{t("数据格式")}</h3><label>{t("默认小数位")}<select aria-label={t("默认小数位")} value={defaultDecimals} onChange={e => { const value = Number(e.target.value); try { localStorage.setItem('data-workbench.default-decimals', String(value)); setDefaultDecimals(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }}>{Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {t("位")}</option>)}</select></label>
      <label>{t("截取逻辑")}<select aria-label={t("截取逻辑")} value={defaultRounding} onChange={e => { const value = e.target.value as 'halfExpand' | 'trunc'; try { localStorage.setItem('data-workbench.default-rounding', value); setDefaultRounding(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }}><option value="halfExpand">{t("四舍五入")}</option><option value="trunc">{t("截断")}</option></select></label>
      </section>}
      {settingsSection === 'display' && <section id="settings-display" className="settings-card"><h3>{t("报表显示")}</h3><label><span>{t("显示更新时间戳")}</span><input type="checkbox" aria-label={t("显示更新时间戳")} checked={showUpdatedAt} onChange={e => { const value = e.target.checked; try { localStorage.setItem('data-workbench.show-updated-at', String(value)); setShowUpdatedAt(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }} /></label></section>}
      {settingsSection === 'save' && <section id="settings-save" className="settings-card"><h3>{t("保存")}</h3>
        <label><span>{t("自动保存")}</span><input type="checkbox" aria-label={t("自动保存")} checked={autoSaveEnabled} onChange={e => { const value = e.target.checked; try { localStorage.setItem('data-workbench.autosave-enabled', String(value)); setAutoSaveEnabled(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }} /></label>
        <label><span>{t("自动保存间隔（分钟）")}</span><input type="number" aria-label={t("自动保存间隔（分钟）")} min={1} max={1440} step={1} value={autoSaveMinutes} onChange={e => { const value = e.target.valueAsNumber; if (!Number.isInteger(value) || value < 1 || value > 1440) return; try { localStorage.setItem('data-workbench.autosave-minutes', String(value)); setAutoSaveMinutes(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }} /></label>
      </section>}
      {settingsSection === 'language' && <section id="settings-language" className="settings-card"><h3>{t('语言')}</h3>
        <label><span>{t('软件界面语言')}<small>{t('所有操作界面：菜单、设置、属性栏、提示等')}</small></span><select aria-label={t('软件界面语言')} value={language} onChange={e => { try { setLanguage(e.target.value as Language); } catch { setMessage(t('无法保存设置，请检查浏览器存储权限')); } }}>
          <option value="auto">{t('自动（跟随浏览器）')}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
        </select></label>
        <label><span>{t('画布界面语言')}<small>{t('终端用户看到的内容：画布图表、筛选器、发布页面和导出页面（含数字与日期格式）')}</small></span><select aria-label={t('画布界面语言')} value={chartLanguage} onChange={event => { try { setChartLanguage(event.target.value as Language); } catch { setMessage(t('无法保存设置，请检查浏览器存储权限')); } }}>
          <option value="auto">{t('跟随界面语言')}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
        </select></label>
      </section>}
    </div></main>}
    {showImport && <dialog ref={importDialog} className="import-dialog" aria-label={t("\u63a5\u5165\u6570\u636e")} onCancel={e => { e.preventDefault(); if (!busy || dynamicQuerying) { setBusy(false); setShowImport(false); setPreview(null); setEditingDataset(null); setViewingDataset(false); } }}><section className={`modal import-modal ${preview ? 'import-config' : ''}`} aria-busy={busy} onDragOver={e => { if (!preview && sourceKind === 'static' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }} onDrop={e => { e.preventDefault(); if (!preview && sourceKind === 'static' && !busy && e.dataTransfer.files.length) selectImportFile(e.dataTransfer.files[0]); }} onKeyDown={e => { if (e.key === 'Escape' && (!busy || dynamicQuerying)) { setShowImport(false); setPreview(null); setEditingDataset(null); setViewingDataset(false); } }}>
      <div className="modal-head"><div className="import-heading"><h2>{preview ? t("字段配置与数据预览") : t("\u63a5\u5165\u6570\u636e")}</h2></div><button className="import-close" aria-label={t("关闭")} disabled={busy && !dynamicQuerying} onClick={() => { setBusy(false); setShowImport(false); setPreview(null); setEditingDataset(null); setViewingDataset(false); }}><Icon name="close" /></button></div>
      {!preview && <div className="source-tabs" role="tablist" aria-label={t('接入方式')} onKeyDown={event => {
        if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const kind = event.key === 'Home' ? 'static' : event.key === 'End' ? 'dynamic' : sourceKind === 'static' ? 'dynamic' : 'static';
        if (editingDataset) return;
        selectSourceKind(kind); event.currentTarget.querySelector<HTMLButtonElement>('#source-tab-' + kind)?.focus();
      }}><button id="source-tab-static" role="tab" aria-selected={sourceKind === 'static'} aria-controls="source-panel" tabIndex={sourceKind === 'static' ? 0 : -1} disabled={busy || !!editingDataset?.dynamic} onClick={() => selectSourceKind('static')}>{t('文件或粘贴')}</button><button id="source-tab-dynamic" role="tab" aria-selected={sourceKind === 'dynamic'} aria-controls="source-panel" tabIndex={sourceKind === 'dynamic' ? 0 : -1} disabled={busy || !!editingDataset && !editingDataset.dynamic} onClick={() => selectSourceKind('dynamic')}>{t('动态数据集')}</button></div>}
      <div id="source-panel" role={!preview && !editingDataset ? 'tabpanel' : undefined} aria-labelledby={!preview && !editingDataset ? 'source-tab-' + sourceKind : undefined} className={`import-body ${sourceKind === 'dynamic' ? 'dynamic-import-body' : ''}`}>
      {(!editingDataset || editingDataset.dynamic) && <div style={{ display: dynamicImport && !preview ? undefined : 'none' }}><DynamicSource key={editingDataset?.id || 'new'} cache={dynamicCache.current} onQuerying={setDynamicQuerying} onExistingPreview={editingDataset ? () => setPreview(detectedPreview.current) : undefined} dataset={editingDataset || undefined} active={dynamicImport} onBusy={setBusy} onReady={setDynamicReady} onPreview={previewDynamic} /></div>}
      <div style={{ display: sourceKind === 'static' || preview ? undefined : 'none' }}>
      {!preview ? <>
        <div className="import-source-grid">
          <div className="import-source-title"><img src="/import-icons/clipboard.svg" alt="" /><strong>{t("粘贴数据")}</strong></div>
          <button className="upload-button" disabled={busy} onClick={() => uploadInput.current?.click()}><img src="/import-icons/upload.svg" alt="" />{file ? t("更换本地文件") : t("本地文件上传")}</button>
          <input ref={uploadInput} className="sr-only" aria-label={t("选择文件")} type="file" accept=".csv,.xls,.xlsx" disabled={busy} onChange={e => { selectImportFile(e.target.files?.[0] || null); e.target.value = ''; }} />
        </div>
        {file ? <div className="import-file"><img src="/import-icons/file.svg" alt="" /><strong title={file.name}>{file.name}</strong><button className="clear-file" disabled={busy} onClick={() => { setFile(null); setSheets([]); setSheet(''); }}>{t("移除文件")}</button><span>{t("可拖拽本地文件到窗口内实现替换")}</span></div> : <div className="paste-editor"><div className="paste-lines" aria-hidden="true"><div>{Array.from({ length: paste.split('\n').length }, (_, i) => <span key={i}>{i + 1}</span>)}</div></div><textarea aria-label={t("粘贴数据")} placeholder={t("在此粘贴 Excel 表格或 CSV 数据…")} disabled={busy} value={paste} onScroll={e => { const numbers = e.currentTarget.previousElementSibling?.firstElementChild as HTMLElement | null; if (numbers) numbers.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`; }} onChange={e => { setEditingSource(true); setPaste(e.target.value); setMessage(''); }} /></div>}
        <div className="import-options" onChange={() => setEditingSource(true)}><label>{t("文本编码")}<select aria-label={t("文本编码")} disabled={busy || !file || !file.name.toLowerCase().endsWith('.csv')} value={encoding} onChange={e => setEncoding(e.target.value)}><option value="utf-8-sig">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16">UTF-16</option><option value="cp1252">Windows-1252</option></select></label><label>{t("分隔符")}<select aria-label={t("分隔符")} disabled={busy || (!!file && !file.name.toLowerCase().endsWith('.csv'))} value={delimiter} onChange={e => setDelimiter(e.target.value)}><option value="">{t("自动识别")}</option><option value=",">{t("逗号")}</option><option value=";">{t("分号")}</option><option value={'\t'}>Tab</option><option value="|">{t("竖线")}</option></select></label><label className="header-option"><input type="checkbox" disabled={busy} checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} />{t("首行作为列名")}</label></div>
        {sheets.length > 0 && <label className="import-sheet">{t("工作表")}<select aria-label={t("工作表")} disabled={busy} value={sheet} onChange={e => setSheet(e.target.value)}>{sheets.map(value => <option key={value}>{value}</option>)}</select></label>}
      </> : <>
        <label className="dataset-name"><DatasetTag dynamic={dynamicImport} />{t("数据集名称")}<input aria-label={t("数据集名称")} maxLength={255} readOnly={viewingDataset} disabled={busy} value={datasetName} onChange={e => setDatasetName(e.target.value)} /></label>

        {sheets.length > 0 && <label className="import-sheet">{t("工作表")}<select aria-label={t("工作表")} disabled={busy} value={sheet} onChange={e => importRequest(false, e.target.value)}>{sheets.map(value => <option key={value}>{value}</option>)}</select></label>}
        {editingField && editingDataset ? <ValueLabelsEditor dataset={editingDataset} field={editingField} names={preview.field_formats?.[editingField]?.valueLabels || {}} busy={busy} onChange={valueLabels => setPreview((previous: any) => ({ ...previous, field_formats: { ...previous.field_formats, [editingField]: { ...(previous.field_formats?.[editingField] || { kind: 'text', format: 'number', decimals: 0 }), valueLabels } } }))} /> : <FieldSettings readOnly={viewingDataset} onRemove={viewingDataset ? undefined : index => { if (asAnnotation) setAnnotationOrder(annotationOrder.filter((_, i) => i !== index)); setPreview((previous: any) => ({ ...previous, schema: previous.schema.filter((_: any, i: number) => i !== index) })); }} annotationRoles={asAnnotation ? annotationOrder : undefined} onAnnotationRole={(index, role) => { const next = [...annotationOrder], old = next[index], other = next.indexOf(role); next[index] = role; if (other >= 0) next[other] = old; setAnnotationOrder(next); setPreview((previous: any) => annotationFieldSettings(previous, next)); }} preserveOrder={asAnnotation} onEditValues={editingDataset && !viewingDataset ? setEditingField : undefined} typeIssues={preview.typeIssues} onReorder={viewingDataset ? undefined : schema => { if (asAnnotation) setAnnotationOrder(schema.map(field => annotationOrder[preview.schema.findIndex((item: any) => (item.source || item.name) === (field.source || field.name))])); setPreview((previous: any) => ({ ...previous, schema })); }} defaultDecimals={defaultDecimals} defaultRounding={defaultRounding} schema={preview.schema} rows={preview.rows || []} formats={preview.field_formats} busy={busy}
          onChange={(field, type, format) => setPreview((previous: any) => ({ ...previous, schema: previous.schema.map((item: any) => (item.source || item.name) === field ? { ...item, type } : item), field_formats: { ...previous.field_formats, [field]: format } }))}
          onRename={(index, name) => setPreview((previous: any) => ({ ...previous, schema: previous.schema.map((field: any, i: number) => i === index ? { ...field, source: field.source || field.name, name } : field) }))} />}
      </>}
      {message && (sourceKind === 'static' || preview || editingDataset?.dynamic) && (preview?.typeIssues ? <div key={toast.id} className="workbench-message" role="status">{message}</div> : <p className="import-error" role="alert">{message}</p>)}
      </div>
      {!preview && !editingDataset?.dynamic && <AnnotationImport merge={mergeAnnotations} onMerge={setMergeAnnotations} checked={asAnnotation} busy={busy} onChecked={setAsAnnotation} />}
      </div>
      <div className="modal-actions">{viewingDataset ? <button onClick={() => { setShowImport(false); setPreview(null); setEditingDataset(null); setViewingDataset(false); }}>{t('关闭')}</button> : <>{editingField && <button disabled={busy} onClick={() => setEditingField('')}>{t('\u8fd4\u56de\u5b57\u6bb5\u914d\u7f6e')}</button>}<button className="import-cancel" disabled={busy && !dynamicQuerying} onClick={() => { setBusy(false); setShowImport(false); setPreview(null); setEditingDataset(null); setViewingDataset(false); }}>{t("取消")}</button>{preview && <><button disabled={busy} onClick={() => setPreview((previous: any) => ({ ...previous, schema: detectedPreview.current.schema, field_formats: detectedPreview.current.field_formats }))}>{t("重置")}</button><button disabled={busy} onClick={() => void showDataSource()}><img src="/import-icons/arrow-left.svg" alt="" />{t("数据源")}</button></>}<button className="primary" type={!preview && dynamicImport ? 'submit' : 'button'} form={!preview && dynamicImport ? 'dynamic-source-import' : undefined} disabled={busy || (preview ? !datasetName.trim() : dynamicImport ? !dynamicReady : !file && !paste.trim())} onClick={() => { if (preview || !dynamicImport) void importRequest(!!preview); }}>{busy ? <><span className="busy-spinner" aria-hidden="true" />{t(dynamicQuerying ? '查询中…' : '处理中…')}</> : preview ? t("保存") : <>{t("字段配置")}<img src="/import-icons/arrow-right.svg" alt="" /></>}</button></>}</div>
    </section></dialog>}

    {!showImport && message && <div key={toast.id} className="workbench-message" role="status">{message}</div>}
  </div>;
}
