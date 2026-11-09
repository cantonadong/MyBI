import { getLocale, getChartLocale, setLanguage, setChartLanguage, translate, t, useLanguage, useChartLanguage, type Language } from './i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { WidthProvider, Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { ChartView } from './charts/ChartView';
import { chartRegistry, ChartConfig, ChartType } from './charts/registry';
import { api, fieldTypeIssues, controlFilters, filterMatchesChart, followedFilterIds, nextFilterTitle, chartTitle, chartSort, Dataset, Document, SavedReport, Filter, json, Tile, gridFor, findGridSpace, insertGridTile, moveGridTile, pushGridTiles, InsertSide } from './dashboard';
import { AnnotationImport, AnnotationRole } from './AnnotationImport';
import type { Annotation, AnnotationFields } from './dashboard';
import { FieldBindings } from './FieldBindings';
import { FieldSettings } from './DatasetPreview';
import { ValueLabelsEditor } from './ValueLabelsEditor';
import { chartImage } from './chartImage';
import { Icon } from './Icon';
import { FilterControl, FilterProperties } from './FilterControl';
import { ReportsPage } from './ReportsPage';
import { UserProfile } from './UserProfile';
import { CommentsPanel } from './CommentsPanel';
import { DynamicSource, DynamicSourceConfig, DynamicSourcePreview } from './DynamicSource';
import { ConnectionsSettings } from './ConnectionsSettings';
import { TimezoneSelect } from './TimezoneSelect';
import { DatasetManager } from './DatasetManager';
import { chartColors, chartPalettes, randomChartColors } from './charts/palettes';

const Grid = WidthProvider(GridLayout);
const empty: Document = { charts: [], filters: [], datasets: [] };
function nameWithTime(name: string, date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${name} ${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function annotationName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return t('标注 {0}-{1} {2}:{3}', pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()));
}
function annotationFieldSettings(preview: any, roles: AnnotationRole[]) {
  const formats = { ...preview.field_formats };
  const schema = preview.schema.map((field: any, index: number) => {
    if (!roles[index]) return field;
    const name = field.source || field.name;
    formats[name] = { kind: 'text', format: 'number', decimals: 0, ...(roles[index] === 'label' ? formats[name]?.valueLabels ? { valueLabels: formats[name].valueLabels } : {} : { dateFormat: formats[name]?.dateFormat || 'MMM d' }) };
    return { ...field, type: roles[index] === 'label' ? 'string' : 'date' };
  });
  return { ...preview, schema, field_formats: formats };
}
function datasetDisplayName(source?: Dataset) {
  if (!source) return '';
  return source.data_as_of ? nameWithTime(source.name, new Date(source.data_as_of)) : source.name;
}
function navigateTo(path: string, replace = false) {
  if (window.location.pathname + window.location.search + window.location.hash !== path) window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}


function ChartTile({ tile, dataset, global: incomingFilters, showUpdatedAt, theme, highlightWeekends, annotations, published = false }: { annotations: Annotation[]; highlightWeekends?: boolean; published?: boolean; theme: { palette: string; colors?: string[]; locale?: 'en' | 'zh-CN' }; tile: Tile; dataset?: Dataset; global: Filter[]; showUpdatedAt: boolean }) {
  const filterKey = JSON.stringify(incomingFilters);
  const global = useMemo(() => JSON.parse(filterKey) as Filter[], [filterKey]);
  const { locale: defaultLocale } = useChartLanguage();
  const locale = theme.locale || defaultLocale;
  const t = (text: string, ...values: unknown[]) => translate(locale, text, values);
  const [result, setResult] = useState<{ rows: Record<string, unknown>[]; data_as_of?: string; config?: ChartConfig }>({ rows: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const config = tile.config;
  const hasField = (name?: string) => !!dataset?.schema.some(field => field.name === name);
  const configured = !!dataset && (config.type !== 'candlestick' || config.measures?.length === 4 && config.measures.every(hasField)) && (!['bar', 'line', 'area', 'mixed'].includes(config.type) || (config.dimensions || []).every(hasField)) && (config.type === 'table' || (hasField(config.measure) && (['kpi', 'gauge', 'histogram', 'boxplot'].includes(config.type) || hasField(config.dimension)) && (!['heatmap', 'sankey'].includes(config.type) || hasField(config.secondDimension)) && (config.type !== 'map' || !!config.mapGeoJSON)));
  const dataConfig = result.config ? Object.fromEntries((['dimension', 'dimensions', 'measure', 'measures', 'secondMeasure', 'secondDimension', 'legendField', 'aggregation', 'metricAggregations', 'expression'] as const).map(key => [key, result.config![key]])) : {};
  const displayConfig = useMemo(() => ({ ...tile.config, ...dataConfig, title: chartTitle({ ...tile.config, ...dataConfig }, dataset), ...theme, highlightWeekends, annotations: tile.config.showAnnotations && dataset?.schema.find(field => field.name === tile.config.dimension)?.type === 'date' ? annotations : [], locale, colors: theme.palette === 'random' ? randomChartColors(tile.id) : theme.colors, fieldFormats: dataset?.field_formats }), [tile.config, result.config, tile.id, theme, highlightWeekends, annotations, dataset?.schema, dataset?.field_formats, locale]);
  useEffect(() => setPage(0), [config.type, config.dimension, config.dimensions, config.measure, config.measures, config.secondMeasure, config.secondDimension, config.legendField, config.aggregation, config.metricAggregations, config.sortMeasure, config.expression, config.sort, config.xAxisSort, config.limit, global, pageSize]);
  useEffect(() => {
    if (!configured || !dataset) { setError(''); setResult({ rows: [] }); setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    const config = tile.config;
    const raw = ['scatter', 'histogram', 'boxplot', 'table', 'candlestick'].includes(config.type);
    const filters = global.filter(filter => (!filter.datasetId || filter.datasetId === dataset.id) && dataset.schema.some(field => field.name === filter.field)).filter(f => f.op === 'is_null' || (Array.isArray(f.value) ? f.value.every(v => v !== '') : f.value !== ''));
    api(`/datasets/${dataset.id}/view-query`, json({ ...(published ? { snapshot_id: dataset.snapshot_id } : {}), fields: dataset.schema.map(f => f.name), filters, limit: config.type === 'table' ? pageSize : config.limit || 1000, offset: config.type === 'table' ? page * pageSize : 0, dimension: ['kpi', 'gauge'].includes(config.type) ? undefined : config.dimension, dimensions: ['bar', 'line', 'area', 'mixed'].includes(config.type) ? config.dimensions : undefined, measure: config.measure, measures: ['bar', 'line', 'area', 'mixed', 'candlestick'].includes(config.type) ? config.measures : undefined, second_measure: ['bar', 'line', 'area', 'mixed', 'scatter'].includes(config.type) ? config.secondMeasure : undefined, second_dimension: ['bar', 'line', 'area', 'mixed'].includes(config.type) ? config.legendField || undefined : ['tree', 'treemap', 'sunburst', 'sankey', 'heatmap'].includes(config.type) ? config.secondDimension : undefined, chart_type: config.type, sort_measure: (config.measures || [config.measure, config.secondMeasure]).includes(config.sortMeasure) ? config.sortMeasure : undefined, ...(!raw ? { aggregation: config.aggregation || 'sum', metric_aggregations: Object.fromEntries(Object.entries(config.metricAggregations || {}).filter(([field]) => (config.measures || [config.measure, config.secondMeasure]).includes(field))), metric_expression: config.expression || undefined } : {}), sort: chartSort(config, dataset) }))
      .then(data => { if (active) setResult({ ...data, config }); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [config.type, config.dimension, config.dimensions, config.measure, config.measures, config.secondMeasure, config.secondDimension, config.legendField, config.aggregation, config.metricAggregations, config.sortMeasure, config.expression, config.sort, config.xAxisSort, config.limit, global, dataset, page, pageSize, configured, published]);
  if (!configured) return config.type === 'candlestick' ? <p className="tile-error">{t('请选择开盘、收盘、最低、最高四个数值字段')}</p> : null;
  return <>{error ? <div role="alert" className="tile-error">{error}</div> : loading && !result.rows.length ? <p className="tile-error">{t("加载中…")}</p> : result.rows.length || tile.config.type === 'table' ? <ChartView config={displayConfig} rows={result.rows} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} /> : <p className="tile-error">{t("没有符合筛选条件的数据")}</p>}{showUpdatedAt && result.data_as_of && <small className="data-time">{t("更新时间")} {new Date(result.data_as_of).toLocaleString(locale)}</small>}</>;
}

export default function App() {
  const { language } = useLanguage();
  const { chartLanguage } = useChartLanguage();
  const [doc, setDoc] = useState<Document>(empty), [selected, setSelected] = useState(''), [name, setName] = useState(() => nameWithTime(t('未命名报表')));
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
  const [datasetNumbers, setDatasetNumbers] = useState<Record<string, number>>({});
  const workspaceScroll = useRef<HTMLDivElement>(null);
  const [viewportRows, setViewportRows] = useState(6);
  const [chartsScrolling, setChartsScrolling] = useState(false);
  const scrollTimer = useRef<number>();
  const importDialog = useRef<HTMLDialogElement>(null);
  const datasetPicker = useRef<HTMLDetailsElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const sidebarDrag = useRef<{ side: 'left' | 'right'; x: number; width: number } | null>(null);
  const [showImport, setShowImport] = useState(false), [paste, setPaste] = useState(''), [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<'static' | 'dynamic'>('static');
  const [asAnnotation, setAsAnnotation] = useState(false);
  const [annotationOrder, setAnnotationOrder] = useState<AnnotationRole[]>(['start', 'end', 'label']);
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
  const [dynamicReady, setDynamicReady] = useState(false), [dynamicMounted, setDynamicMounted] = useState(true);
  const [sheets, setSheets] = useState<string[]>([]), [sheet, setSheet] = useState(''), [preview, setPreview] = useState<any>(null), [busy, setBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [publishedView, setPublishedView] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedTheme, setPublishedTheme] = useState<{ palette: string; colors?: string[]; locale?: 'en' | 'zh-CN' }>({ palette: 'modern' });
  const [commentChart, setCommentChart] = useState('');
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setCommentCounts({}); if (!id) return;
    let active = true;
    api(`/dashboards/${id}/comment-counts`).then(value => { if (active) setCommentCounts(value); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [id, publishedView]);
  const [panel, setPanel] = useState<'charts' | 'history'>('charts');
  const [showReports, setShowReports] = useState(true);
  const [reportAction, setReportAction] = useState<{ kind: 'new' } | { kind: 'delete'; report: SavedReport } | null>(null);
  const reportDialog = useRef<HTMLDialogElement>(null);
  const [reportBusy, setReportBusy] = useState(false), [reportError, setReportError] = useState('');
  useEffect(() => { if (reportAction) { setReportError(''); reportDialog.current?.showModal(); } }, [reportAction]);
  const [savedDatasets, setSavedDatasets] = useState<Dataset[]>([]), [activeDatasetId, setActiveDatasetId] = useState('');
  const grid = { ...gridFor(doc), rows: Math.max(viewportRows, Math.max(0, ...doc.charts.map(chart => chart.y + chart.h)) + (previewMode ? 0 : 2)) };
  const [insertion, setInsertion] = useState<{ charts: Tile[]; movingId: string; targetId?: string; side?: InsertSide } | null>(null);
  const insertionRef = useRef<typeof insertion>(null);
  const dragAnchor = useRef({ x: 0, y: 0 });
  const [deleted, setDeleted] = useState<{ chart: Tile; index: number; expiresAt: number; session: number } | null>(null);
  const [editingSource, setEditingSource] = useState(false), [editingField, setEditingField] = useState('');
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [copied, setCopied] = useState<Tile | null>(null), [pasteArmed, setPasteArmed] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null), pasteAt = useRef<{ x: number; y: number }>();
  const activeDataset = datasets.find(item => item.id === activeDatasetId);
  const [encoding, setEncoding] = useState('utf-8-sig'), [delimiter, setDelimiter] = useState('');
  const [hasHeader, setHasHeader] = useState(true), [datasetName, setDatasetName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<{ palette: string; colors?: string[]; locale?: 'en' | 'zh-CN' }>(() => {
    try { const value = JSON.parse(localStorage.getItem('mybi.chart-theme') || 'null'); if (value && [...chartPalettes.map(item => item.id), 'random', 'custom'].includes(value.palette)) return value; } catch {}
    return { palette: chartPalettes[0].id };
  });
  const updateTheme = (value: { palette: string; colors?: string[]; locale?: 'en' | 'zh-CN' }) => {
    try { localStorage.setItem('mybi.chart-theme', JSON.stringify(value)); setTheme(value); }
    catch { setMessage(t('\u65e0\u6cd5\u4fdd\u5b58\u8bbe\u7f6e\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u5b58\u50a8\u6743\u9650')); }
  };
  const editorPath = id ? '/reports/' + encodeURIComponent(id) : '/reports/new';
  const activePath = showSettings ? '/settings' : showReports ? '/reports' : panel === 'history' ? '/datasets' : editorPath;

  useEffect(() => {
    if (showImport) {
      setSourceKind('static');
      const roles = editingDataset?.annotation_fields;
      setAsAnnotation(!!roles && !!Object.keys(roles).length);
      setAnnotationOrder(roles && Object.keys(roles).length ? editingDataset!.schema.map(field => (Object.keys(roles) as AnnotationRole[]).find(role => roles[role] === field.name)!).filter(Boolean) : ['start', 'end', 'label']);
      setDynamicDraft(null); setDynamicReady(false); setDynamicMounted(true);
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
    setDatasetNumbers(previous => {
      const next = { ...previous };
      for (const id of importedIds) if (!(id in next)) next[id] = Object.keys(next).length + 1;
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [importedIds]);
  useEffect(() => {
    const viewport = workspaceScroll.current;
    const resize = () => { if (viewport?.clientHeight) setViewportRows(Math.max(5, Math.floor((viewport.clientHeight - 12) / 68))); };
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
    try { const saved = localStorage.getItem('data-workbench.default-decimals'); const value = saved === null ? 1 : Number(saved); return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1; }
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
  const tile = doc.charts.find(chart => chart.id === selected);
  const dataset = datasets.find(item => item.id === (tile?.datasetId || (importedIds.includes(activeDatasetId) ? activeDatasetId : importedIds[0])));
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
  const canvasTop = publishedView && doc.charts.length ? Math.min(...doc.charts.map(chart => chart.y)) : 0;
  const displayCharts = publishedView ? doc.charts.map(chart => ({ ...chart, y: chart.y - canvasTop })) : doc.charts;
  const displayColumns = grid.columns;
  const displayRows = publishedView ? Math.max(1, ...displayCharts.map(chart => chart.y + chart.h)) : grid.rows;
  const reportSchedule = doc.refreshSchedule || datasets.find(source => importedIds.includes(source.id) && source.dynamic?.schedule.enabled)?.dynamic?.schedule || { enabled: false, time: '06:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  const availableFilters = doc.charts.filter(chart => tile && filterMatchesChart(tile, chart, dataset));
  const filterIds = tile ? followedFilterIds(tile, doc.charts, dataset) : [];
  const change = (next: Document) => { if (publishedView) { setDoc(next); return; } history.current.push(doc); future.current = []; setDoc(next); setDirty(true); };
  const updateLayout = (layout: Layout[]) => {
    const charts = doc.charts.map(chart => {
      const position = layout.find(item => item.i === chart.id);
      return position && (position.x !== chart.x || position.y !== chart.y || position.w !== chart.w || position.h !== chart.h) ? { ...chart, x: position.x, y: position.y, w: position.w, h: position.h, ...(chart.config.type === 'filter' && (position.w !== chart.w || position.h !== chart.h) ? { config: { ...chart.config, filterAutoWidth: false } } : {}) } : chart;
    });
    if (charts.some((chart, index) => chart !== doc.charts[index])) change({ ...doc, charts });
  };
  const fitFilterWidth = (chartId: string, width: number) => {
    if (publishedView) return;
    const canvasWidth = canvasRef.current?.clientWidth;
    if (!canvasWidth) return;
    const w = Math.min(grid.columns, Math.max(3, Math.ceil((width + 8) / ((canvasWidth + 8) / grid.columns))));
    const currentChart = current.current.doc.charts.find(chart => chart.id === chartId);
    if (!currentChart?.config.filterAutoWidth || currentChart.w === w) return;
    setDoc(previous => {
      const chart = previous.charts.find(item => item.id === chartId);
      if (!chart?.config.filterAutoWidth || chart.w === w) return previous;
      const charts = previous.charts.map(item => item.id === chartId ? { ...item, w } : item);
      return { ...previous, charts: moveGridTile(charts, chartId, chart, grid.columns)! };
    });
    setDirty(true);
  };
  const previewInsertion = (movingId: string, event: MouseEvent) => {
    const touch = event as MouseEvent & { touches?: TouchList; changedTouches?: TouchList };
    const point = touch.touches?.[0] || touch.changedTouches?.[0] || event;
    let next: typeof insertion = null;
    for (const target of doc.charts) {
      if (target.id === movingId) continue;
      const rect = document.getElementById('chart-' + target.id)?.getBoundingClientRect();
      if (!rect || point.clientX < rect.left || point.clientX > rect.right || point.clientY < rect.top || point.clientY > rect.bottom) continue;
      const x = (point.clientX - rect.left) / rect.width, y = (point.clientY - rect.top) / rect.height;
      const sides: [InsertSide, number][] = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]];
      const [side, distance] = sides.sort((a, b) => a[1] - b[1])[0];
      if (distance > .3) break;
      if (insertionRef.current?.movingId === movingId && insertionRef.current.targetId === target.id && insertionRef.current.side === side) return insertionRef.current;
      const charts = insertGridTile(doc.charts, movingId, target.id, side, grid.columns);
      if (charts) next = { charts, movingId, targetId: target.id, side };
      break;
    }
    if (!next) {
      const canvas = canvasRef.current?.getBoundingClientRect();
      const moving = doc.charts.find(chart => chart.id === movingId);
      if (canvas && moving && point.clientX >= canvas.left && point.clientX <= canvas.right && point.clientY >= canvas.top) {
        const at = { x: Math.max(0, Math.min(grid.columns - moving.w, Math.round((point.clientX - dragAnchor.current.x - canvas.left) / ((canvas.width + 8) / grid.columns)))), y: Math.max(0, Math.round((point.clientY - dragAnchor.current.y - canvas.top) / 68)) };
        const previous = insertionRef.current;
        const last = previous?.charts.find(chart => chart.id === movingId);
        if (previous?.movingId === movingId && !previous.targetId && last?.x === at.x && last.y === at.y) return previous;
        const charts = moveGridTile(doc.charts, movingId, at, grid.columns);
        if (charts?.some(chart => { const original = doc.charts.find(item => item.id === chart.id)!; return chart.id !== movingId && (chart.x !== original.x || chart.y !== original.y); })) next = { charts, movingId };
      }
    }
    insertionRef.current = next; setInsertion(next);
    return next;
  };
  const patchTile = (next: Partial<Tile>) => { if (tile) change({ ...doc, charts: doc.charts.map(item => item.id === tile.id ? { ...item, ...next } : item) }); };
  const patchConfig = (next: Partial<ChartConfig>) => { if (tile) patchTile({ ...(!tile.datasetId && dataset && ['dimension', 'dimensions', 'measure', 'measures', 'secondDimension', 'secondMeasure', 'legendField'].some(field => field in next) ? { datasetId: dataset.id } : {}), config: { ...tile.config, ...next } }); };
  const selectDataset = (datasetId: string) => {
    const source = datasets.find(item => item.id === datasetId);
    if (!source) return;
    setActiveDatasetId(datasetId);
    if (!tile || tile.datasetId === datasetId) return;
    const dimensions = source.schema.filter(field => ['string', 'date'].includes(field.type));
    const dimension = tile.config.type === 'filter' && ['date-range', 'date-last'].includes(tile.config.filterStyle || '') ? dimensions.find(field => field.type === 'date' || /^(dt|date)$/i.test(field.name))?.name : dimensions[0]?.name;
    patchTile({ datasetId, filters: [], config: { ...tile.config, dimension, measure: source.schema.find(field => ['number', 'integer'].includes(field.type))?.name, dimensions: undefined, measures: undefined, mixedSeries: undefined, metricSeries: undefined, secondDimension: undefined, secondMeasure: undefined, legendField: undefined, expression: undefined, ...(tile.config.type === 'filter' ? { filterFields: dimensions.slice(0, 2).map(field => field.name), filterValues: {}, filterRange: ['', ''], filterRangeAuto: true } : {}) } });
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
    const fields = value.schema;
    let label = fields.findIndex((field: any) => /version|(?:^|_)ver(?:$|_)|label|标签|版本/i.test(field.name));
    if (label < 0) label = fields.findIndex((field: any) => field.type === 'string');
    if (label < 0) label = fields.length - 1;
    let start = fields.findIndex((field: any, index: number) => index !== label && /start|begin|开始|起始/i.test(field.name));
    if (start < 0) start = fields.findIndex((_: any, index: number) => index !== label);
    let end = fields.findIndex((field: any, index: number) => index !== label && index !== start && /end|finish|结束|截止/i.test(field.name));
    if (end < 0) end = fields.findIndex((_: any, index: number) => index !== label && index !== start);
    const roles: AnnotationRole[] = [];
    if (label >= 0) roles[label] = 'label';
    if (start >= 0) roles[start] = 'start';
    if (end >= 0) roles[end] = 'end';
    setAnnotationOrder(roles);
    return annotationFieldSettings(value, roles);
  };
  const previewDynamic = (source: DynamicSourceConfig, result: DynamicSourcePreview) => {
    const value = detectedPreview.current?.preview_id === result.preview_id ? detectedPreview.current : { ...result, field_formats: Object.fromEntries(Object.entries(result.field_formats).map(([field, format]: [string, any]) => [field, { ...format, rounding: defaultRounding, decimals: format.kind === 'decimal' || format.format === 'percent' ? defaultDecimals : 0 }])) };
    setDynamicDraft(source); setPaste(''); setFile(null); setSheets([]); setSheet(''); setMessage('');
    if (detectedPreview.current?.preview_id !== result.preview_id) setDatasetName(asAnnotation ? annotationName() : source.name);
    const prepared = detectedPreview.current?.preview_id === result.preview_id ? value : preparePreview(value);
    detectedPreview.current = prepared; setPreview(prepared);
  };
  const refresh = () => { refreshSavedDatasets(); api('/dashboards').then(setDashboards).catch(e => setMessage(e.message)); };

  const copyChart = async (chart: Tile) => {
    // ponytail: editable copies stay in this tab; the system clipboard carries only the portable PNG.
    const editable = !previewMode && !publishedView;
    if (editable) {
      setCopied(structuredClone(chart)); setPasteArmed(true); pasteAt.current = undefined;
      canvasRef.current?.focus({ preventScroll: true });
    }
    try {
      const element = document.getElementById('chart-' + chart.id);
      if (!element || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error(t("浏览器不支持图片剪贴板"));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': chartImage(element) })]);
      setMessage(t(editable ? "图片已复制；点击画布空白位置粘贴可编辑图表，或按 Ctrl+V" : "图片已复制"));
    } catch (error) { setMessage(t(editable ? "画布内已复制，可点击空白位置粘贴；图片复制失败：" : "图片复制失败：") + (error as Error).message); }
  };
  const pasteChart = (at?: { x: number; y: number }) => {
    if (!copied || previewMode) return;
    const target = at && { x: Math.max(0, Math.min(at.x, grid.columns - copied.w)), y: Math.max(0, at.y) };
    const pasteGrid = { ...grid, rows: Math.max(grid.rows, (target?.y || 0) + copied.h, Math.max(0, ...doc.charts.map(chart => chart.y + chart.h)) + copied.h) };
    const position = (target && findGridSpace(doc.charts, copied.w, copied.h, pasteGrid, target)) || findGridSpace(doc.charts, copied.w, copied.h, pasteGrid);
    if (!position) { setMessage(t("图表宽度超出画布，请调整图表宽度")); return; }
    const copy = { ...structuredClone(copied), id: crypto.randomUUID(), ...position };
    if (copy.config.type === 'filter') copy.config.title = nextFilterTitle(doc.charts);
    change({ ...doc, charts: [...doc.charts, copy] }); setSelected(copy.id); setActiveDatasetId(copy.datasetId); setPasteArmed(false); setMessage(t("已粘贴，可在右侧修改图表"));
  };
  useEffect(() => {
    const paste = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v' || !copied || previewMode || showImport || showSettings || showReports) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); pasteChart(pasteAt.current);
    };
    document.addEventListener('keydown', paste);
    return () => document.removeEventListener('keydown', paste);
  }, [copied, doc, previewMode, showImport, showSettings, showReports, grid.columns, grid.rows]);
  const deleteChart = (chart: Tile) => {
    const index = doc.charts.findIndex(item => item.id === chart.id);
    const remaining = doc.charts.filter(item => item.id !== chart.id);
    change({ ...doc, charts: remaining });
    const next = remaining[Math.min(index, remaining.length - 1)];
    setSelected(next?.id || '');
    if (next) setActiveDatasetId(next.datasetId);
    setDeleted({ chart, index, expiresAt: Date.now() + 3000, session: session.current });
  };
  useEffect(() => {
    const removeSelected = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.key !== 'Delete' || !tile || previewMode || showReports || showSettings || showImport || reportAction) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); deleteChart(tile);
    };
    document.addEventListener('keydown', removeSelected);
    return () => document.removeEventListener('keydown', removeSelected);
  }, [tile, doc, previewMode, showReports, showSettings, showImport, reportAction]);
  const restoreDeleted = () => {
    if (!deleted || deleted.session !== session.current || Date.now() >= deleted.expiresAt) { setDeleted(null); return; }
    if (doc.charts.some(item => item.id === deleted.chart.id)) { setDeleted(null); return; }
    const width = Math.min(deleted.chart.w, grid.columns);
    const restoreGrid = { ...grid, rows: Math.max(grid.rows, deleted.chart.y + deleted.chart.h, Math.max(0, ...doc.charts.map(chart => chart.y + chart.h)) + deleted.chart.h) };
    const target = { x: Math.max(0, Math.min(deleted.chart.x, grid.columns - width)), y: deleted.chart.y };
    const position = findGridSpace(doc.charts, width, deleted.chart.h, restoreGrid, target) || findGridSpace(doc.charts, width, deleted.chart.h, restoreGrid)!;
    const charts = [...doc.charts];
    charts.splice(deleted.index, 0, { ...deleted.chart, w: width, x: position.x, y: position.y });
    change({ ...doc, charts }); setSelected(deleted.chart.id); setActiveDatasetId(deleted.chart.datasetId); setDeleted(null);
  };
  useEffect(() => {
    if (!deleted) return;
    const timer = window.setTimeout(() => setDeleted(null), Math.max(0, deleted.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deleted]);
  useEffect(refresh, []);
  const addChart = (type: ChartType) => {
    const sourceId = importedIds.includes(activeDatasetId) ? activeDatasetId : importedIds[0] || activeDatasetId;
    const source = datasets.find(item => item.id === sourceId) || dataset;
    if (!source) { setEditingSource(false); setEditingField(''); setEditingDataset(null); setShowImport(true); return; }
    const newId = crypto.randomUUID();
    const w = type === 'filter' ? Math.min(grid.columns, Math.max(3, Math.ceil(188 / (((canvasRef.current?.clientWidth || 720) + 8) / grid.columns)))) : grid.columns, h = type === 'filter' ? 3 : Math.min(5, grid.rows), position = findGridSpace(doc.charts, w, h, grid) || { x: 0, y: Math.max(0, ...doc.charts.map(chart => chart.y + chart.h)) };
    change({ ...doc, charts: [...doc.charts, { id: newId, datasetId: source.id, config: { type, ...(type === 'filter' ? { filterStyle: 'dropdown' as const, filterAutoWidth: true, filterFields: source.schema.filter(field => ['string', 'date'].includes(field.type)).slice(0, 2).map(field => field.name) } : {}), title: type === 'filter' ? nextFilterTitle(doc.charts) : chartRegistry.find(c => c.id === type)?.label, dimension: source.schema.find(f => ['string', 'date'].includes(f.type))?.name, measure: source.schema.find(f => ['number', 'integer'].includes(f.type))?.name, ...(type === 'candlestick' ? { measures: source.schema.filter(f => ['number', 'integer'].includes(f.type)).slice(0, 4).map(f => f.name) } : {}), aggregation: 'sum', color: '#5969f4', legend: true }, filters: [], filterMode: 'global', ...position, w, h }] }); setSelected(newId);
  };
  const rememberDashboard = (value: string) => {
    try { localStorage.setItem('data-workbench.last-dashboard', value); } catch {}
  };
  const save = async (force = false) => {
    if (saving.current || publishedView || (!dirty && !force) || !name.trim()) return;
    saving.current = true; setIsSaving(true);
    const token = session.current, savedDoc = doc, savedName = name, savedDatasets = datasets;
    try {
      const body = { name, document: { ...doc, refreshSchedule: reportSchedule, datasets: datasets.filter(source => importedIds.includes(source.id)) }, version };
      const saved = await api(id ? `/dashboards/${id}` : '/dashboards', { ...json(body), method: id ? 'PUT' : 'POST' });
      if (session.current === token) { rememberDashboard(saved.id); if (!showReports && !showSettings && panel === 'charts') navigateTo('/reports/' + encodeURIComponent(saved.id), true); setSaveError(''); setId(saved.id); setVersion(saved.version); const unchanged = current.current.doc === savedDoc && current.current.name === savedName && current.current.datasets === savedDatasets; setDirty(!unchanged); if (unchanged) { clearDraft(saved.id); setRestoredDraft(false); } setMessage(unchanged ? t("已保存") : t("仍有新修改待保存")); setDashboards(items => [...items.filter(item => item.id !== saved.id), { id: saved.id, name: saved.name, owner: saved.owner, updated_at: saved.updated_at }]); }
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
    if (dirty && !discardConfirmed && !(useDraft && value === id) && !confirm(t("\u5f53\u524d\u4fee\u6539\u5c1a\u672a\u4fdd\u5b58\uff0c\u4ecd\u7136\u6253\u5f00\uff1f"))) { navigateTo(activePath, true); return; }
    const token = ++session.current; setDeleted(null);
    try {
      const item = await api(`/dashboards/${value}`);
      const draft = useDraft ? drafts[value] : undefined;
      if (draft?.document?.charts && draft.document.datasets) { item.document = draft.document; item.name = draft.name; }
      else if (useDraft) { setMessage(t('\u672c\u5730\u8349\u7a3f\u4e0d\u53ef\u7528')); return; }
      const ids = [...new Set<string>([...item.document.charts.map((chart: Tile) => chart.datasetId).filter(Boolean), ...(item.document.datasets || []).map((source: Dataset) => source.id)])];
      const sources = await Promise.allSettled(ids.map(sourceId => api('/datasets/' + sourceId)));
      if (session.current !== token) return;
      for (const source of sources) if (source.status === 'fulfilled') rememberDataset(source.value);
      if (draft) for (const source of draft.document.datasets) rememberDataset(source);
      setPublishedView(false); setPreviewMode(false); setCommentChart(''); rememberDashboard(item.id); navigateTo('/reports/' + encodeURIComponent(item.id) + (draft ? '?draft=1' : ''), replace); setShowReports(false); setDoc(item.document); setName(item.name); setId(item.id); setVersion(item.version); setDirty(!!draft); setRestoredDraft(!!draft); setImportedIds(draft?.importedIds || sources.flatMap((source, index) => source.status === 'fulfilled' ? [ids[index]] : [])); setSelected(''); setActiveDatasetId(draft?.activeDatasetId || item.document.charts[0]?.datasetId || ids[0] || ''); setShowSettings(false); setPanel('charts'); history.current = []; future.current = [];
    } catch (e) { if (session.current === token) { setMessage((e as Error).message); navigateTo(activePath, true); } }
  };
  const copyReport = async (reportId: string) => {
    if (reportBusy || saving.current) return;
    if (dirty && !confirm(t('\u5f53\u524d\u4fee\u6539\u5c1a\u672a\u4fdd\u5b58\uff0c\u4ecd\u7136\u6253\u5f00\uff1f'))) return;
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
    const token = ++session.current;
    try {
      const item = await api(`/dashboards/${reportId}/published`);
      if (session.current !== token) return;
      setDoc(item.document); setDatasets(item.document.datasets || []); setId(item.id); setName(item.name);
      setImportedIds((item.document.datasets || []).map((source: Dataset) => source.id));
      setDirty(false); setRestoredDraft(false); setPublishedTheme(item.theme); setPublishedView(true); setPreviewMode(true);
      setShowReports(false); setShowSettings(false); setPanel('charts'); setSelected(''); setCommentChart(''); setDeleted(null); setPasteArmed(false);
      insertionRef.current = null; setInsertion(null); navigateTo('/view/' + encodeURIComponent(reportId));
    } catch (error) { setMessage((error as Error).message); navigateTo(activePath, true); }
  };
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
      await api(`/dashboards/${saved.id}/publish`, json({ version: saved.version, theme: { ...theme, locale: getChartLocale() } }));
      setDashboards(items => items.map(item => item.id === saved.id ? { ...item, name: saved.name, updated_at: saved.updated_at } : item));
      if (tab) tab.location.replace('/view/' + encodeURIComponent(saved.id));
      setMessage(t(tab ? '\u5df2\u53d1\u5e03' : '\u5df2\u53d1\u5e03\uff0c\u8bf7\u5141\u8bb8\u6d4f\u89c8\u5668\u6253\u5f00\u65b0\u6807\u7b7e\u9875'));
    } catch (error) { tab?.close(); setMessage((error as Error).message); }
    finally { setPublishing(false); }
  };
  const resetReport = () => {
    ++session.current; history.current = []; future.current = []; setRestoredDraft(false); setPublishedView(false); setPreviewMode(false); setCommentChart('');
    setDoc({ charts: [], filters: [], datasets: [] }); setDatasets([]); setImportedIds([]); setDatasetNumbers({});
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
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    const view = path.match(/^\/view\/([^/]+)$/);
    if (view) { void openPublished(decodeURIComponent(view[1])); return; }
    const legacy = new URLSearchParams(window.location.hash.slice(1)).get('dashboard');
    if (legacy) { void open(legacy, true); return; }
    if (path === '/settings') { setPublishedView(false); setPreviewMode(false); setShowSettings(true); return; }
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
  const openFieldSettings = async () => {
    setEditingField(''); setEditingSource(false); setMessage('');
    if (!dataset) { setEditingDataset(null); setPreview(null); setShowImport(true); return; }
    setBusy(true);
    try {
      const source = await api('/datasets/' + dataset.id);
      const sample = await api(`/datasets/${dataset.id}/view-query`, json({ fields: source.schema.map((field: any) => field.name), limit: 1 }));

      const result = { schema: source.schema.map((field: any) => ({ ...field, source: field.name, name: field.display_name || field.name, type: field.type === 'boolean' ? 'string' : field.type === 'datetime' ? 'date' : field.type })), rows: sample.rows, field_formats: source.field_formats };
      setEditingDataset(source); setPaste(''); setFile(null); setSheets([]); setSheet(''); setHasHeader(true); setDelimiter('\t'); setEncoding('utf-8-sig'); setDatasetName(source.name);
      detectedPreview.current = result; setPreview(result); setShowImport(true);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const showDataSource = async () => {
    if (dynamicDraft && !editingDataset) { detectedPreview.current = preview; setEditingField(''); setPreview(null); return; }
    if (editingDataset?.dynamic) { setShowImport(false); setPanel('history'); setShowReports(false); setShowSettings(false); navigateTo('/datasets'); return; }
    setBusy(true); setMessage('');
    try {
      if (editingDataset && !editingSource) {
        const data = await api(`/datasets/${editingDataset.id}/source`);
        if (data.version !== editingDataset.version) throw new Error(t('\u6570\u636e\u96c6\u5df2\u88ab\u4fee\u6539\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u5b57\u6bb5\u914d\u7f6e\u540e\u518d\u8bd5'));
        setPaste(data.text);
      }
      detectedPreview.current = preview; setEditingField(''); setPreview(null); if (!editingDataset) setDynamicMounted(true);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const importRequest = async (confirmImport = false, selectedSheet = sheet) => {
    if (!confirmImport && editingDataset && !editingSource && detectedPreview.current) { setPreview(detectedPreview.current); return; }
    setBusy(true); setMessage('');
    let signature = '';
    try {
      let result: any;
      const annotationFields = asAnnotation && preview ? Object.fromEntries(annotationOrder.map((role, index) => [role, editingDataset && !editingSource ? preview.schema[index]?.source || preview.schema[index]?.name : preview.schema[index]?.name.trim()])) as AnnotationFields : {};
      if (confirmImport && asAnnotation && preview.schema.length !== 3) throw new Error(t('Annotation 必须包含开始日期、结束日期、标签三列'));
      const fieldOrder = preview ? [...preview.schema].sort((a: any, b: any) => asAnnotation ? 0 : Number(['number', 'integer'].includes(a.type)) - Number(['number', 'integer'].includes(b.type))).map((field: any) => field.source || field.name) : [];
      const overrides = preview ? Object.fromEntries(preview.schema.map((f: any) => [f.source || f.name, f.type])) : {};
      const renames = preview ? Object.fromEntries(preview.schema.map((f: any) => [f.source || f.name, editingDataset && editingSource ? f.source || f.name : f.name])) : {};
      const formats = preview ? Object.fromEntries(preview.schema.filter((f: any) => ['number', 'integer'].includes(f.type) || (['string', 'date'].includes(f.type) && (preview.field_formats?.[f.source || f.name]?.dateFormat || preview.field_formats?.[f.source || f.name]?.valueLabels))).map((f: any) => [editingDataset && editingSource ? f.source || f.name : f.name.trim(), { valueLabels: preview.field_formats?.[f.source || f.name]?.valueLabels, dateFormat: preview.field_formats?.[f.source || f.name]?.dateFormat, kind: preview.field_formats?.[f.source || f.name]?.kind || (f.type === 'integer' ? 'integer' : 'decimal'), format: preview.field_formats?.[f.source || f.name]?.format || 'number', rounding: preview.field_formats?.[f.source || f.name]?.rounding || defaultRounding, decimals: preview.field_formats?.[f.source || f.name]?.decimals ?? (f.type === 'integer' ? 0 : defaultDecimals) }])) : {};
      signature = JSON.stringify({ annotationFields, fieldOrder, overrides, renames, formats, datasetName, dynamicDraft, previewId: preview?.preview_id, paste: file ? undefined : paste, file: file && [file.name, file.size, file.lastModified], selectedSheet, encoding, delimiter, hasHeader, datasetId: editingDataset?.id, version: editingDataset?.version });
      const confirmConversion = confirmImport && reviewedImport.current === signature;
      if (confirmImport && dynamicDraft && !editingDataset) {
        result = await api('/sources', json({ ...dynamicDraft, annotation_fields: annotationFields, name: datasetName.trim(), preview_id: preview.preview_id, overrides, renames, formats, field_order: fieldOrder, confirm_conversion: confirmConversion }));
      } else if (confirmImport && editingDataset && !editingSource) {
        result = await api(`/datasets/${editingDataset.id}/fields`, { ...json({ name: datasetName.trim(), annotation_fields: annotationFields, version: editingDataset.version, types: overrides, display_names: renames, formats: Object.fromEntries(preview.schema.filter((field: any) => formats[field.name.trim()]).map((field: any) => [field.source || field.name, formats[field.name.trim()]])), field_order: fieldOrder, confirm_conversion: confirmConversion }), method: 'PATCH' });
      }
      else if (file) {
        const form = new FormData(); form.append('file', file); form.append('annotation_fields', JSON.stringify(annotationFields)); form.append('annotation_order', JSON.stringify([])); form.append('confirm_conversion', String(confirmConversion)); if (editingDataset) { form.append('dataset_id', editingDataset.id); form.append('version', String(editingDataset.version)); } form.append('name', confirmImport ? datasetName.trim() : file.name); if (selectedSheet) form.append('sheet', selectedSheet); form.append('preview', String(!confirmImport)); form.append('overrides', JSON.stringify(overrides)); form.append('renames', JSON.stringify(renames)); form.append('formats', JSON.stringify(formats)); form.append('encoding', encoding); form.append('delimiter', delimiter); form.append('has_header', String(hasHeader)); form.append('field_order', JSON.stringify(fieldOrder));
        result = await api('/imports/files', { method: 'POST', body: form });
        if (result.sheets) {
          setSheets(result.sheets);
          const first = selectedSheet || result.sheets[0];
          if (!first) throw new Error(t("工作簿没有可用工作表"));
          setSheet(first); form.set('sheet', first);
          result = await api('/imports/files', { method: 'POST', body: form });
        }
      }
      else result = await api('/imports/paste', json({ name: confirmImport ? datasetName.trim() : t("粘贴数据"), text: paste, annotation_fields: annotationFields, annotation_order: [], preview: !confirmImport, confirm_conversion: confirmConversion, dataset_id: editingDataset?.id, version: editingDataset?.version, overrides, renames, formats, delimiter: delimiter || undefined, has_header: hasHeader, field_order: fieldOrder }));
      if (!confirmImport) {
        result.field_formats = Object.fromEntries(Object.entries(result.field_formats).map(([field, format]: [string, any]) => [field, editingDataset?.field_formats?.[field] || { ...format, rounding: defaultRounding, decimals: format.kind === 'decimal' || format.format === 'percent' ? defaultDecimals : 0 }]));
        if (editingDataset) result.schema = result.schema.map((field: any) => ({ ...field, source: field.name, name: editingDataset.schema.find(original => original.name === field.name)?.display_name || field.name, type: editingDataset.schema.find(original => original.name === field.name)?.type || field.type }));
        if (file && selectedSheet) setSheet(selectedSheet);
        if (!preview) { const now = new Date(); const pad = (value: number) => String(value).padStart(2, '0'); setDatasetName(editingDataset?.name || (asAnnotation ? annotationName() : '') || file?.name || t("粘贴数据 {0}-{1} {2}:{3}", pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()))); }
        result = preparePreview(result); detectedPreview.current = result; setPreview(result);
        if (!editingDataset) { setDynamicDraft(null); setDynamicMounted(false); if (file) setPaste(''); }
      }
      else {
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
  return <div ref={appRef} className={`app-shell ${publishedView ? 'published-view' : ''} ${publishedView ? 'canvas-display' : ''} ${commentChart ? 'comments-open' : ''} ${showSettings ? "settings-open" : showReports ? "reports-open" : panel === "history" ? "datasets-open" : ""}`}>
    <aside className="rail">
      <button aria-label={t("历史数据集")} className={!showSettings && !showReports && panel === 'history' ? 'rail-active' : ''} onClick={() => { setShowSettings(false); setShowReports(false); setPanel('history'); navigateTo('/datasets'); refreshSavedDatasets(); }}><Icon name="datasets" /><span>{t("数据集")}</span></button>
      <button aria-label={t("报表")} className={!showSettings && (showReports || panel === 'charts') ? 'rail-active' : ''} onClick={() => { setShowSettings(false); setShowReports(true); navigateTo('/reports'); api('/dashboards').then(setDashboards).catch(error => setMessage(error.message)); }}><Icon name="report" /><span>{t("报表")}</span></button>
      <button className={showSettings ? 'rail-active rail-settings' : 'rail-settings'} aria-label={t("设置")} onClick={() => { setShowSettings(true); navigateTo('/settings'); }}><Icon name="settings" /><span>{t("设置")}</span></button>
    </aside>
    {showReports && !showSettings && <ReportsPage reports={dashboards} drafts={Object.keys(drafts)} onRestore={value => void open(value, false, true)} busy={isSaving || reportBusy || publishing} onPublish={value => void publish(value)} onView={value => void viewReport(value)} onEdit={value => void open(value)} onCopy={value => void copyReport(value)} onDelete={report => setReportAction({ kind: 'delete', report })} onNew={newReport} />}
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
    {panel === 'history' ? <DatasetManager datasets={savedDatasets} onSaved={acceptDataset} onConnect={() => { setEditingDataset(null); setPreview(null); setShowImport(true); }} onDeleted={value => { setSavedDatasets(items => items.filter(item => item.id !== value)); setDatasets(items => items.filter(item => item.id !== value)); setImportedIds(items => items.filter(item => item !== value)); }} /> : <main className="workspace">{restoredDraft && <div className="draft-notice" role="status"><span>{t('\u5df2\u52a0\u8f7d\u672a\u4fdd\u5b58\u5185\u5bb9\uff0c\u786e\u8ba4\u4f7f\u7528\u540e\u8bf7\u70b9\u51fb\u4fdd\u5b58')}</span><button onClick={() => void open(id)}>{t('\u6253\u5f00\u5df2\u4fdd\u5b58\u7248\u672c')}</button></div>}<div ref={workspaceScroll} className="workspace-scroll" onClick={event => { if (!pasteArmed && !(event.target as Element).closest('.chart-card')) { setSelected(''); setCommentChart(''); } }}>
      <div ref={canvasRef} tabIndex={0} className={`grid-surface ${pasteArmed ? 'paste-armed' : ''} ${!previewMode && tile && tile.config.type !== 'filter' ? 'chart-focused' : ''}`} data-testid="grid-surface" style={{ minHeight: Math.max(displayRows, ...(insertion?.charts.map(chart => chart.y + chart.h + (previewMode ? 0 : 2)) || [])) * 68 - 8 }} onClick={e => { if ((e.target as HTMLElement).closest('.chart-card')) return; const r = e.currentTarget.getBoundingClientRect(); const at = { x: Math.floor((e.clientX - r.left) / ((r.width + 8) / grid.columns)), y: Math.floor((e.clientY - r.top) / 68) }; pasteAt.current = at; e.currentTarget.focus({ preventScroll: true }); if (pasteArmed) pasteChart(at); }} onPaste={e => { if (copied && !previewMode) { e.preventDefault(); pasteChart(pasteAt.current); } }} onKeyDown={e => { if (e.key === 'Escape') setPasteArmed(false); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && tile && !previewMode) { e.preventDefault(); copyChart(tile); } }}>
      {!doc.charts.length && <div className="empty-canvas">{t("\u5148\u63a5\u5165\u6570\u636e\uff0c\u518d\u4ece\u5de6\u4fa7\u6dfb\u52a0\u4efb\u610f\u6570\u91cf\u7684\u56fe\u8868")}</div>}
      {!publishedView && !previewMode && doc.showGuides && <div className="grid-guides" aria-hidden="true">{[25, 50, 75].map(left => <span key={left} style={{ left: left + '%' }} />)}</div>}
      <Grid className="canvas multi-canvas" cols={displayColumns} rowHeight={60} margin={[8, 8]} containerPadding={[0, 0]} compactType={null} preventCollision={false} allowOverlap={true} style={{ minHeight: displayRows * 68 - 8 }} draggableHandle=".tile-drag-handle" draggableCancel=".tile-actions,button:not(.tile-drag-handle)" isDraggable={!previewMode && !publishedView} isResizable={!previewMode && !publishedView} resizeHandles={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']} layout={displayCharts.map(c => ({ i: c.id, x: c.x, y: c.y, w: c.w, h: c.h, minW: 3, minH: 3 }))} onDragStart={(_layout, _old, _item, _placeholder, event, node) => { const rect = node.getBoundingClientRect(); const touch = event as MouseEvent & { touches?: TouchList }; const point = touch.touches?.[0] || event; dragAnchor.current = { x: point.clientX - rect.left, y: point.clientY - rect.top }; insertionRef.current = null; setInsertion(null); }} onDrag={(_layout, _old, item, _placeholder, event) => { previewInsertion(item.i, event); }} onDragStop={(layout, _old, item, _placeholder, event) => { const next = previewInsertion(item.i, event); insertionRef.current = null; setInsertion(null); if (next) change({ ...doc, charts: next.charts.map(chart => { const original = doc.charts.find(item => item.id === chart.id)!; return chart.config.type === 'filter' && (chart.w !== original.w || chart.h !== original.h) ? { ...chart, config: { ...chart.config, filterAutoWidth: false } } : chart; }) }); else updateLayout(layout); }} onResizeStop={(_layout, _old, item) => {
        const chart = doc.charts.find(chart => chart.id === item.i);
        if (chart) change({ ...doc, charts: pushGridTiles(doc.charts, [{ ...chart, x: item.x, y: item.y, w: item.w, h: item.h, config: { ...chart.config, ...(chart.config.type === 'filter' ? { filterAutoWidth: false } : {}) } }]) });
      }}>
        {doc.charts.map(c => <article key={c.id} id={'chart-' + c.id} data-testid="chart-tile" className={`chart-card ${c.config.type === 'kpi' ? 'kpi-card' : ''} ${c.config.type !== 'filter' && c.config.description?.trim() ? 'chart-with-note' : ''} ${!publishedView && selected === c.id ? 'active-card' : ''}`} onPointerDownCapture={() => { if (publishedView) return; setSelected(c.id); setActiveDatasetId(c.datasetId); }} onClick={() => { if (publishedView) return; setCommentChart(''); setSelected(c.id); setActiveDatasetId(c.datasetId); }}><div className="card-head"><strong title={chartTitle(c.config, datasets.find(dataset => dataset.id === c.datasetId))}>{chartTitle(c.config, datasets.find(dataset => dataset.id === c.datasetId))}</strong>{!previewMode && <button className="tile-drag-handle" aria-label={t('\u62d6\u52a8\u7ec4\u4ef6')} title={t('\u6309\u4f4f\u62d6\u52a8\u7ec4\u4ef6')}>&#8943;</button>}<div className="tile-actions">{c.config.type !== 'filter' && <button className="comment-button" aria-label={t('\u8bc4\u8bba') + ' ' + (commentCounts[c.id] || 0)} onClick={event => { event.stopPropagation(); setSelected(c.id); setCommentChart(c.id); }}><Icon name="comment" /><span>{commentCounts[c.id] || 0}</span></button>}<button title={t("\u590d\u5236\u56fe\u8868")} aria-label={t("\u590d\u5236\u56fe\u8868")} onClick={e => { e.stopPropagation(); copyChart(c); }}><Icon name="copy" /></button>{!previewMode && <button className="remove-dataset remove-component" aria-label={t("\u5220\u9664\u56fe\u8868")} onClick={e => { e.stopPropagation(); deleteChart(c); }}><Icon name="remove" /></button>}</div></div>{c.config.type === 'filter' ? <FilterControl displayLocale={publishedView ? publishedTheme.locale : undefined} tile={c} onContentWidth={width => fitFilterWidth(c.id, width)} dataset={datasets.find(d => d.id === c.datasetId)} global={[]} onChange={(config, automatic) => { if (automatic) { setDoc(previous => ({ ...previous, charts: previous.charts.map(item => item.id === c.id ? { ...item, config: { ...item.config, ...config } } : item) })); if (!publishedView) setDirty(true); } else change({ ...doc, charts: doc.charts.map(item => item.id === c.id ? { ...item, config: { ...item.config, ...config } } : item) }); }} /> : <ChartTile annotations={annotations} highlightWeekends={doc.highlightWeekends} published={publishedView} theme={publishedView ? publishedTheme : theme} showUpdatedAt={showUpdatedAt} tile={c} dataset={datasets.find(d => d.id === c.datasetId)} global={canvasFilters.filter(filter => !!filter.sourceId && followedFilterIds(c, doc.charts, datasets.find(source => source.id === c.datasetId)).includes(filter.sourceId))} />}{c.config.type !== 'filter' && c.config.description?.trim() && <aside className="chart-note" role="note" aria-label={translate(publishedView ? publishedTheme.locale || getChartLocale() : getChartLocale(), '图表说明')}>{c.config.description}</aside>}</article>)}
      </Grid>
      {insertion && <div className="insertion-preview" aria-hidden="true">{insertion.charts.filter(chart => { const original = doc.charts.find(item => item.id === chart.id)!; return chart.id === insertion.movingId || chart.id === insertion.targetId || chart.x !== original.x || chart.y !== original.y || chart.w !== original.w || chart.h !== original.h; }).map(chart => <div key={chart.id} className={`insertion-slot ${chart.id === insertion.movingId ? 'insertion-moving' : ''}`} style={{ left: `calc((100% + 8px) * ${chart.x / grid.columns})`, top: chart.y * 68, width: `calc((100% + 8px) * ${chart.w / grid.columns} - 8px)`, height: chart.h * 68 - 8 }}>{chart.id === insertion.movingId && <span>{t('\u677e\u5f00\u4ee5\u63d2\u5165')}</span>}</div>)}</div>}
      </div></div><footer className="workspace-status"><div className="canvas-toolbar bottom-toolbar"><button title={t("撤销")} aria-label={t("撤销")} disabled={!history.current.length} onClick={() => { setDeleted(null); future.current.push(doc); setDoc(history.current.pop()!); setDirty(true); }}><Icon name="undo" /></button><button title={t("重做")} aria-label={t("重做")} disabled={!future.current.length} onClick={() => { setDeleted(null); history.current.push(doc); setDoc(future.current.pop()!); setDirty(true); }}><Icon name="redo" /></button></div><div className="footer-data-controls"><button className="import-button" disabled={busy} onClick={() => { setEditingDataset(null); setEditingSource(false); setEditingField(''); setPreview(null); setShowImport(true); }}>{t('\u63a5\u5165\u6570\u636e')}</button><div className="working-dataset"><details className="dataset-picker" ref={datasetPicker} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label={t('\u9009\u62e9\u6570\u636e\u96c6')} aria-disabled={!importedIds.length} tabIndex={importedIds.length ? 0 : -1} onClick={event => { if (!importedIds.length) event.preventDefault(); }} title={datasetDisplayName(dataset)}><span>{datasetDisplayName(dataset) || t('\u6682\u65e0\u6570\u636e\u96c6')}</span><img src="/import-icons/chevron-down.svg" alt="" /></summary><div className="dataset-options">{importedIds.map(value => <button key={value} aria-pressed={value === dataset?.id} title={datasetDisplayName(datasets.find(item => item.id === value))} onClick={() => { selectDataset(value); if (datasetPicker.current) datasetPicker.current.open = false; }}><span className="dataset-option-number">{datasetNumbers[value]}.</span><span className="dataset-option-name">{datasetDisplayName(datasets.find(item => item.id === value)) || value}</span></button>)}</div></details><button className="dataset-configure" title={t('\u5b57\u6bb5\u914d\u7f6e')} aria-label={t('\u5b57\u6bb5\u914d\u7f6e')} disabled={busy} onClick={() => void openFieldSettings()}><Icon name="settings" /></button><button className="remove-dataset" disabled={busy || !dataset} title={t('\u79fb\u9664\u5f53\u524d\u6570\u636e\u96c6')} aria-label={t('\u79fb\u9664\u5f53\u524d\u6570\u636e\u96c6')} onClick={() => { if (!dataset) return; const removed = dataset.id, remaining = importedIds.filter(value => value !== removed); setImportedIds(remaining); setDatasets(items => items.filter(item => item.id !== removed)); change({ ...doc, datasets: doc.datasets.filter(item => item.id !== removed), charts: doc.charts.map(chart => chart.datasetId === removed ? { ...chart, datasetId: '' } : chart) }); setActiveDatasetId(remaining[0] || ''); setSelected(''); }}><Icon name="close" /></button></div></div><div className="report-editor-actions">{saveError && <span role="alert">{t("保存失败")}<button onClick={() => setSaveError('')}>{t("重试")}</button></span>}<button className="primary" disabled={publishing || isSaving || !name.trim()} onClick={() => void publish()}>{publishing ? t('\u53d1\u5e03\u4e2d\u2026') : t('\u53d1\u5e03')}</button><button onClick={() => setPreviewMode(!previewMode)}>{previewMode ? t("编辑") : t("预览")}</button><button className="primary save-dashboard" disabled={isSaving || !dirty || !name.trim()} onClick={() => void save()}>{isSaving ? t("保存中…") : t("保存")}</button></div></footer></main>}
    <aside className="sidebar properties">{sidebarResizer('right')}<div className="property-body">{!commentChart && !tile && <fieldset className="axis-settings"><legend>{t('\u6574\u4f53\u8bbe\u7f6e')}</legend><label>{t('\u62a5\u8868\u6807\u9898')}<input className="report-name" aria-label={t("仪表板名称")} value={name} onChange={e => { setName(e.target.value); setDirty(true); }} /></label><label><input type="checkbox" checked={!!doc.highlightWeekends} onChange={event => change({ ...doc, highlightWeekends: event.target.checked })} />{t('\u9ad8\u4eae\u663e\u793a\u5468\u672b')}</label><label><input type="checkbox" checked={!!doc.showGuides} onChange={event => change({ ...doc, showGuides: event.target.checked })} />{t('显示 1/4、1/2、3/4 参考线')}</label></fieldset>}{!commentChart && !tile && <fieldset className="axis-settings report-refresh-settings"><legend>{t('每日定时查询')}</legend><label><input type="checkbox" checked={reportSchedule.enabled} onChange={event => change({ ...doc, refreshSchedule: { ...reportSchedule, enabled: event.target.checked } })} />{t('自动刷新报表数据集')}</label><label>{t('执行时间')}<input type="time" step={60} value={reportSchedule.time} disabled={!reportSchedule.enabled} onChange={event => { if (event.target.value) change({ ...doc, refreshSchedule: { ...reportSchedule, time: event.target.value } }); }} /></label><TimezoneSelect disabled={!reportSchedule.enabled} value={reportSchedule.timezone} onChange={timezone => change({ ...doc, refreshSchedule: { ...reportSchedule, timezone } })} /></fieldset>}{commentChart ? <CommentsPanel key={commentChart} reportId={id} chartId={commentChart} onClose={() => setCommentChart('')} onCount={count => setCommentCounts(previous => ({ ...previous, [commentChart]: count }))} /> : tile?.config.type === 'filter' ? <><h3>{t("筛选器配置")}</h3><FilterProperties config={tile.config} dataset={dataset} onChange={patchConfig} /></> : tile ? <><h3>{t("图表配置")}</h3><label><input type="checkbox" checked={tile.config.autoTitle !== false} onChange={event => patchConfig({ autoTitle: event.target.checked, title: chartTitle(tile.config, dataset) })} />{t("自动标题")}</label><label>{t("图表标题")}<input disabled={tile.config.autoTitle !== false} aria-label={t("图表标题")} value={chartTitle(tile.config, dataset)} onChange={e => patchConfig({ title: e.target.value })} /></label><label>{t('说明信息')}<textarea aria-label={t('说明信息')} rows={3} value={tile.config.description || ''} placeholder={t('填写后显示在图表底部')} onChange={event => patchConfig({ description: event.target.value })} /></label><label>{t("图表类型")}<select aria-label={t("图表类型")} value={tile.config.type} onChange={e => patchConfig({ type: e.target.value as ChartType })}>{chartRegistry.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><fieldset className="axis-settings"><legend>{t('跟随筛选器')}</legend>
      <label>{t('跟随方式')}<select aria-label={t('跟随方式')} value={tile.followFilterIds === undefined ? 'nearest' : tile.followFilterIds.length ? 'selected' : 'none'} onChange={event => patchTile({ followFilterIds: event.target.value === 'nearest' ? undefined : event.target.value === 'none' ? [] : availableFilters.slice(0, 1).map(filter => filter.id) })}>
        <option value="nearest">{t('上方最近的筛选器')}</option><option value="none">{t('不跟随')}</option><option value="selected" disabled={!availableFilters.length}>{t('指定筛选器')}</option>
      </select></label>
      {tile.followFilterIds === undefined && <small>{filterIds.length ? availableFilters.find(filter => filter.id === filterIds[0])?.config.title : t('上方没有匹配维度的筛选器，当前不跟随')}</small>}
      {tile.followFilterIds !== undefined && availableFilters.map(filter => <label key={filter.id}><input type="checkbox" checked={filterIds.includes(filter.id)} onChange={event => patchTile({ followFilterIds: event.target.checked ? [...filterIds, filter.id] : filterIds.filter(id => id !== filter.id) })} />{filter.config.title || t('筛选器')}</label>)}
    </fieldset>{tile.config.type === 'pie' && <label><input type="checkbox" checked={!!(tile.config.piePercent ?? tile.config.legendPercent)} onChange={event => patchConfig({ piePercent: event.target.checked, legendPercent: undefined, ...(event.target.checked ? { labels: true } : {}) })} />{t('数据标签显示百分比')}</label>}<FieldBindings key={tile.id} config={tile.config} fields={dataset?.schema || []} onChange={patchConfig} />{annotationSources.length > 0 && <><label><input type="checkbox" checked={!!tile.config.showAnnotations} onChange={event => patchConfig({ showAnnotations: event.target.checked })} />{t('显示 annotation')}</label>{tile.config.showAnnotations && <label>{t('Annotation 样式')}<select value={tile.config.annotationStyle || 'range'} onChange={event => patchConfig({ annotationStyle: event.target.value as ChartConfig['annotationStyle'] })}><option value="start">{t('开始日期竖线')}</option><option value="range">{t('日期区间')}</option></select></label>}{tile.config.showAnnotations && annotationError && <p role="alert" className="source-error">{annotationError}</p>}</>}<label>{t("Legend / 系列分组")}<select aria-label={t("Legend 字段")} disabled={!['bar', 'line', 'area', 'mixed', 'scatter'].includes(tile.config.type)} value={tile.config.legendField || ''} onChange={e => patchConfig({ legendField: e.target.value })}><option value="">{t("不按字段分组")}</option>{dataset?.schema.filter(field => ['string', 'date'].includes(field.type)).map(field => <option key={field.name} value={field.name}>{field.display_name || field.name}</option>)}</select></label><label>{t("聚合")}<select value={tile.config.aggregation} onChange={e => patchConfig({ aggregation: e.target.value as ChartConfig['aggregation'] })}>{(['sum', 'avg', 'count', 'min', 'max', 'count_distinct'] as const).map(a => <option key={a} value={a}>{t(({ sum: '求和', avg: '平均值', count: '计数', min: '最小值', max: '最大值', count_distinct: '去重计数' })[a])}</option>)}</select></label><label>{t("排序")}<select value={chartSort(tile.config, dataset)} onChange={e => patchConfig({ sort: e.target.value })}><option value="none">{t("原顺序")}</option><option value="desc">{t("指标降序")}</option><option value="asc">{t("指标升序")}</option></select></label>{(tile.config.measures || [tile.config.measure, tile.config.secondMeasure].filter(Boolean)).length > 1 && <label>{t('排序指标')}<select value={(tile.config.measures || [tile.config.measure, tile.config.secondMeasure]).includes(tile.config.sortMeasure) ? tile.config.sortMeasure : tile.config.measure} onChange={event => patchConfig({ sortMeasure: event.target.value })}>{(tile.config.measures || [tile.config.measure, tile.config.secondMeasure]).filter(Boolean).map(field => <option key={field} value={field}>{field}</option>)}</select></label>}<label>{t("Top N / 最大结果")}<input type="number" min={1} max={10000} value={tile.config.limit || 1000} onChange={e => patchConfig({ limit: Math.max(1, Math.min(10000, Number(e.target.value))) })} /></label>{['bar', 'line', 'area', 'mixed', 'waterfall', 'histogram', 'boxplot', 'heatmap', 'scatter'].includes(tile.config.type) && <label><input type="checkbox" checked={!!tile.config.axisHover} onChange={event => patchConfig({ axisHover: event.target.checked })} />{t('\u60ac\u505c\u6574\u5217 / \u6574\u884c\u663e\u793a\u6570\u503c')}</label>}{<label>{t('图例')}<select value={tile.config.legendAuto === false ? tile.config.legend ? 'show' : 'hide' : 'auto'} onChange={event => patchConfig({ legendAuto: event.target.value === 'auto', legend: event.target.value === 'show' })}><option value="auto">{t('自动')}</option><option value="show">{t('显示')}</option><option value="hide">{t('隐藏')}</option></select></label>}{(['labels', 'smooth' , 'stacked', 'horizontal', 'donut'] as const).map((key, i) => (tile.config.type === 'mixed' && (key === 'smooth' || key === 'stacked') || tile.config.type === 'candlestick' && ['smooth', 'stacked', 'horizontal', 'donut'].includes(key)) ? null : <label key={key}><input type="checkbox" checked={!!tile.config[key]} onChange={e => patchConfig({ [key]: e.target.checked })} />{[t("数据标签"), t("平滑线"), t("堆叠"), t("横向"), t("环形")][i]}</label>)}{tile.config.type === 'map' && <label>{t("地图 GeoJSON")}<input type="file" accept=".json,.geojson" onChange={async e => { try { const f = e.target.files?.[0]; if (f) patchConfig({ mapGeoJSON: JSON.parse(await f.text()) }); } catch { setMessage(t("无效 GeoJSON")); } }} /></label>}</> : <p>{t("选择图表以配置数据、样式和筛选器")}</p>}</div></aside>
    {deleted && deleted.session === session.current && <div className="delete-toast" data-testid="delete-toast" role="status"><span>{t("图表已删除")}</span><button onClick={restoreDeleted}>{t("撤销")}</button><small>{t("5 秒内可恢复")}</small></div>}

    {showSettings && <main className="settings-page" aria-label={t("设置")}>
      <header className="settings-heading"><h2>{t("设置")}</h2><button onClick={() => { setShowSettings(false); navigateTo(showReports ? '/reports' : panel === 'history' ? '/datasets' : editorPath); }}>{t("返回画布")}</button></header><UserProfile onMessage={setMessage} /><ConnectionsSettings onMessage={setMessage} /><section className="settings-card"><h3>{t('\u4e3b\u9898\u914d\u8272')}</h3><div className="chart-palette">
      <div className="chart-palette-options">{[...chartPalettes, { id: 'random', label: '\u968f\u673a', colors: randomChartColors('preview').slice(0, 6) }].map(palette => <button type="button" key={palette.id} aria-label={t(palette.label)} aria-pressed={theme.palette === palette.id} className={theme.palette === palette.id ? 'selected' : ''} onClick={() => updateTheme({ palette: palette.id })}><span className="chart-palette-name">{t(palette.label)}</span><span className="chart-palette-strip">{palette.colors.map(color => <span key={color} style={{ backgroundColor: color }} />)}</span></button>)}</div>
      <details className="chart-palette-custom"><summary>{t('\u81ea\u5b9a\u4e49\u914d\u8272')}</summary><div className="chart-palette-colors">{chartColors({ type: 'bar', ...theme }).slice(0, 6).map((color, index) => <input key={index} type="color" aria-label={t('\u914d\u8272') + ' ' + (index + 1)} value={color} onChange={event => { const colors = chartColors({ type: 'bar', ...theme }).slice(0, 6); colors[index] = event.target.value; updateTheme({ palette: 'custom', colors }); }} />)}</div></details>
      <p>{t('\u968f\u673a\u914d\u8272\u5728\u540c\u4e00\u7ec4\u4ef6\u5185\u6bcf 64 \u4e2a\u989c\u8272\u5faa\u73af\uff0c\u8fde\u7eed 64 \u4e2a\u4e0d\u91cd\u590d')}</p></div></section>
      <section className="settings-card">
      <h3>{t("数据格式")}</h3><label>{t("默认小数位")}<select aria-label={t("默认小数位")} value={defaultDecimals} onChange={e => { const value = Number(e.target.value); try { localStorage.setItem('data-workbench.default-decimals', String(value)); setDefaultDecimals(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }}>{Array.from({ length: 4 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {t("位")}</option>)}</select></label>
      <label>{t("截取逻辑")}<select aria-label={t("截取逻辑")} value={defaultRounding} onChange={e => { const value = e.target.value as 'halfExpand' | 'trunc'; try { localStorage.setItem('data-workbench.default-rounding', value); setDefaultRounding(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }}><option value="halfExpand">{t("四舍五入")}</option><option value="trunc">{t("截断")}</option></select></label>
      </section>
      <section className="settings-card"><h3>{t("报表显示")}</h3><label><span>{t("显示更新时间戳")}</span><input type="checkbox" aria-label={t("显示更新时间戳")} checked={showUpdatedAt} onChange={e => { const value = e.target.checked; try { localStorage.setItem('data-workbench.show-updated-at', String(value)); setShowUpdatedAt(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }} /></label></section>
      <section className="settings-card"><h3>{t("保存")}</h3>
        <label><span>{t("自动保存")}</span><input type="checkbox" aria-label={t("自动保存")} checked={autoSaveEnabled} onChange={e => { const value = e.target.checked; try { localStorage.setItem('data-workbench.autosave-enabled', String(value)); setAutoSaveEnabled(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }} /></label>
        <label><span>{t("自动保存间隔（分钟）")}</span><input type="number" aria-label={t("自动保存间隔（分钟）")} min={1} max={1440} step={1} value={autoSaveMinutes} onChange={e => { const value = e.target.valueAsNumber; if (!Number.isInteger(value) || value < 1 || value > 1440) return; try { localStorage.setItem('data-workbench.autosave-minutes', String(value)); setAutoSaveMinutes(value); } catch { setMessage(t("无法保存设置，请检查浏览器存储权限")); } }} /></label>
      </section>
      <section className="settings-card"><h3>{t('语言')}</h3>
        <label><span>{t('语言')}</span><select aria-label={t('语言')} value={language} onChange={e => { try { setLanguage(e.target.value as Language); } catch { setMessage(t('无法保存设置，请检查浏览器存储权限')); } }}>
          <option value="auto">{t('自动（跟随浏览器）')}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
        </select></label>
        <label><span>{t('图表显示语言（含格式）')}</span><select aria-label={t('图表显示语言（含格式）')} value={chartLanguage} onChange={event => { try { setChartLanguage(event.target.value as Language); } catch { setMessage(t('无法保存设置，请检查浏览器存储权限')); } }}>
          <option value="auto">{t('跟随界面语言')}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
        </select></label>
      </section>
    </main>}
    {showImport && <dialog ref={importDialog} className="import-dialog" aria-label={t("\u63a5\u5165\u6570\u636e")} onCancel={e => { e.preventDefault(); if (!busy) { setShowImport(false); setPreview(null); setEditingDataset(null); } }}><section className={`modal import-modal ${preview ? 'import-config' : ''}`} aria-busy={busy} onDragOver={e => { if (!preview && sourceKind === 'static' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }} onDrop={e => { e.preventDefault(); if (!preview && sourceKind === 'static' && !busy && e.dataTransfer.files.length) selectImportFile(e.dataTransfer.files[0]); }} onKeyDown={e => { if (e.key === 'Escape' && !busy) { setShowImport(false); setPreview(null); setEditingDataset(null); } }}>
      <div className="modal-head"><div className="import-heading"><h2>{preview ? t("字段配置与数据预览") : t("\u63a5\u5165\u6570\u636e")}</h2></div><button aria-label={t("取消导入")} disabled={busy} onClick={() => { setShowImport(false); setPreview(null); setEditingDataset(null); }}><img src="/import-icons/close.svg" alt="" /></button></div>
      {!preview && !editingDataset && <div className="source-tabs" role="tablist" aria-label={t('接入方式')} onKeyDown={event => {
        if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const kind = event.key === 'Home' ? 'static' : event.key === 'End' ? 'dynamic' : sourceKind === 'static' ? 'dynamic' : 'static';
        setSourceKind(kind); event.currentTarget.querySelector<HTMLButtonElement>('#source-tab-' + kind)?.focus();
      }}><button id="source-tab-static" role="tab" aria-selected={sourceKind === 'static'} aria-controls="source-panel" tabIndex={sourceKind === 'static' ? 0 : -1} disabled={busy} onClick={() => setSourceKind('static')}>{t('文件或粘贴')}</button><button id="source-tab-dynamic" role="tab" aria-selected={sourceKind === 'dynamic'} aria-controls="source-panel" tabIndex={sourceKind === 'dynamic' ? 0 : -1} disabled={busy} onClick={() => setSourceKind('dynamic')}>{t('动态数据集')}</button></div>}
      <div id="source-panel" role={!preview && !editingDataset ? 'tabpanel' : undefined} aria-labelledby={!preview && !editingDataset ? 'source-tab-' + sourceKind : undefined} className={`import-body ${sourceKind === 'dynamic' ? 'dynamic-import-body' : ''}`}>
      {dynamicMounted && !editingDataset && <div style={{ display: sourceKind === 'dynamic' && !preview ? undefined : 'none' }}><DynamicSource annotationOrder={[]} onSaved={acceptDataset} onBusy={setBusy} onReady={setDynamicReady} onPreview={previewDynamic} /></div>}
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
        <label className="dataset-name"><span className="dataset-number-badge" aria-label={t("预计数据集编号")}>{editingDataset ? datasetNumbers[editingDataset.id] : Object.keys(datasetNumbers).length + 1}</span>{t("数据集名称")}<input aria-label={t("数据集名称")} maxLength={255} disabled={busy} value={datasetName} onChange={e => setDatasetName(e.target.value)} /></label>

        {sheets.length > 0 && <label className="import-sheet">{t("工作表")}<select aria-label={t("工作表")} disabled={busy} value={sheet} onChange={e => importRequest(false, e.target.value)}>{sheets.map(value => <option key={value}>{value}</option>)}</select></label>}
        {editingField && editingDataset ? <ValueLabelsEditor dataset={editingDataset} field={editingField} names={preview.field_formats?.[editingField]?.valueLabels || {}} busy={busy} onChange={valueLabels => setPreview((previous: any) => ({ ...previous, field_formats: { ...previous.field_formats, [editingField]: { ...(previous.field_formats?.[editingField] || { kind: 'text', format: 'number', decimals: 0 }), valueLabels } } }))} /> : <FieldSettings onRemove={index => { if (asAnnotation) setAnnotationOrder(annotationOrder.filter((_, i) => i !== index)); setPreview((previous: any) => ({ ...previous, schema: previous.schema.filter((_: any, i: number) => i !== index) })); }} annotationRoles={asAnnotation ? annotationOrder : undefined} onAnnotationRole={(index, role) => { const next = [...annotationOrder], old = next[index], other = next.indexOf(role); next[index] = role; if (other >= 0) next[other] = old; setAnnotationOrder(next); setPreview((previous: any) => annotationFieldSettings(previous, next)); }} preserveOrder={asAnnotation} onEditValues={editingDataset ? setEditingField : undefined} typeIssues={preview.typeIssues} onReorder={schema => { if (asAnnotation) setAnnotationOrder(schema.map(field => annotationOrder[preview.schema.findIndex((item: any) => (item.source || item.name) === (field.source || field.name))])); setPreview((previous: any) => ({ ...previous, schema })); }} defaultDecimals={defaultDecimals} defaultRounding={defaultRounding} schema={preview.schema} rows={preview.rows || []} formats={preview.field_formats} busy={busy}
          onChange={(field, type, format) => setPreview((previous: any) => ({ ...previous, schema: previous.schema.map((item: any) => (item.source || item.name) === field ? { ...item, type } : item), field_formats: { ...previous.field_formats, [field]: format } }))}
          onRename={(index, name) => setPreview((previous: any) => ({ ...previous, schema: previous.schema.map((field: any, i: number) => i === index ? { ...field, source: field.source || field.name, name } : field) }))} />}
      </>}
      {message && (sourceKind === 'static' || preview) && (preview?.typeIssues ? <div key={toast.id} className="workbench-message" role="status">{message}</div> : <p className="import-error" role="alert">{message}</p>)}
      </div>
      {!preview && <AnnotationImport checked={asAnnotation} busy={busy} onChecked={setAsAnnotation} />}
      </div>
      <div className="modal-actions">{editingField && <button disabled={busy} onClick={() => setEditingField('')}>{t('\u8fd4\u56de\u5b57\u6bb5\u914d\u7f6e')}</button>}<button className="import-cancel" disabled={busy} onClick={() => { setShowImport(false); setPreview(null); setEditingDataset(null); }}>{t("取消")}</button>{preview && <><button disabled={busy} onClick={() => setPreview((previous: any) => ({ ...previous, schema: detectedPreview.current.schema, field_formats: detectedPreview.current.field_formats }))}>{t("重置")}</button><button disabled={busy} onClick={() => void showDataSource()}><img src="/import-icons/arrow-left.svg" alt="" />{t("数据源")}</button></>}<button className="primary" type={!preview && sourceKind === 'dynamic' ? 'submit' : 'button'} form={!preview && sourceKind === 'dynamic' ? 'dynamic-source-import' : undefined} disabled={busy || (preview ? !datasetName.trim() : sourceKind === 'dynamic' ? !dynamicReady : !file && !paste.trim())} onClick={() => { if (preview || sourceKind === 'static') void importRequest(!!preview); }}>{busy ? t("处理中…") : preview ? t("保存") : <>{t("字段配置")}<img src="/import-icons/arrow-right.svg" alt="" /></>}</button></div>
    </section></dialog>}

    {!showImport && message && <div key={toast.id} className="workbench-message" role="status">{message}</div>}
  </div>;
}
