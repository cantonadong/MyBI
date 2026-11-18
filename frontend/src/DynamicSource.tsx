import { useEffect, useRef, useState } from 'react';
import { api, Dataset, json } from './dashboard';
import { t, useLanguage } from './i18n';
import { SearchSelect } from './SearchSelect';
import { formatUpdatedAt } from './dateTime';

export function queryDuration(seconds?: number | null): string {
  if (seconds == null) return '—';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
  return `${hours ? `${hours}h` : ''}${hours || minutes ? `${minutes}m` : ''}${total % 60}s`;
}

export function executionError(value?: string | null): string {
  if (!value) return '';
  try { const error = JSON.parse(value); return typeof error === 'object' && error.message ? error.code === 'source_validation_failed' ? t(error.message) : `${t('数据库查询失败')}：${error.message}` : t(value); } catch { return t(value); }
}

export type DynamicSourceConfig = {
  name: string; connection_id: string; database?: string; mode: string; sql: string; schema_name: string; object_name: string;
  schedule: { enabled: boolean; time: string; timezone: string }; version?: number;
  duration_seconds?: number | null; last_run_at?: string | null;
  field_settings?: { renames?: Record<string, string> };
};
type Source = DynamicSourceConfig;
export type DynamicSourcePreview = { schema: { name: string; type: string }[]; rows: Record<string, unknown>[]; row_count: number; duration_seconds: number; queried_at?: string; field_formats: Record<string, unknown>; preview_id: string };
export type DynamicSourceCache = { source?: DynamicSourceConfig; previews: Map<string, DynamicSourcePreview> };
type DatabaseObject = { database_name: string; schema_name: string; object_name: string; kind: string };
const objectKey = (value: DatabaseObject) => JSON.stringify([value.database_name, value.schema_name, value.object_name, value.kind]);
const initial = (): Source => ({ name: '', connection_id: '', mode: 'sql', sql: '', schema_name: '', object_name: '', schedule: { enabled: false, time: '06:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } });

export function DynamicSource({ dataset, onBusy, onPreview, onReady, onQuerying, cache, onExistingPreview, annotationOrder = [], active = true }: { cache?: DynamicSourceCache; onExistingPreview?: () => void; onQuerying?: (querying: boolean) => void; active?: boolean; annotationOrder?: string[]; dataset?: Dataset; onBusy?: (busy: boolean) => void; onPreview: (source: Source, preview: DynamicSourcePreview) => void; onReady?: (ready: boolean) => void }) {
  const { locale } = useLanguage();
  const [source, setSource] = useState<Source>(() => !dataset && cache?.source || initial());
  const [busy, setBusy] = useState(!!dataset), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [validation, setValidation] = useState<{ schema: { name: string; type: string }[]; rows: Record<string, unknown>[]; row_count: number; duration_seconds: number; queried_at?: string } | null>(null);
  const [changed, setChanged] = useState(false);
  const [queryStarted, setQueryStarted] = useState<number | null>(null), [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (queryStarted == null) return;
    const timer = window.setInterval(() => setElapsed((performance.now() - queryStarted) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [queryStarted]);
  const [failedDuration, setFailedDuration] = useState<number | null>(null);
  const [connections, setConnections] = useState<{ id: string; name: string; redshift: boolean; database: string }[]>([]);
  const [connectionError, setConnectionError] = useState('');
  const [objects, setObjects] = useState<DatabaseObject[]>([]);
  const [objectKind, setObjectKind] = useState('all'), [objectSearch, setObjectSearch] = useState('');
  const [loadingObjects, setLoadingObjects] = useState(false), [objectError, setObjectError] = useState('');
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [refreshingObjects, setRefreshingObjects] = useState(false), [catalogVersion, setCatalogVersion] = useState(0);
  const [initializingObjects, setInitializingObjects] = useState(false);
  const localPreviews = useRef(new Map<string, DynamicSourcePreview>());
  const previews = cache?.previews || localPreviews.current;
  const requestController = useRef<AbortController | null>(null);
  const queryStatus = useRef(onQuerying); queryStatus.current = onQuerying;
  const busyStatus = useRef(onBusy); busyStatus.current = onBusy;
  useEffect(() => { if (!dataset && cache) cache.source = source; }, [source, cache, dataset?.id]);
  const [lastObjectKind, setLastObjectKind] = useState('table');
  const queryKey = JSON.stringify([dataset?.id || '', annotationOrder, source.connection_id, source.database || '', source.mode, source.mode === 'sql' ? source.sql : [source.schema_name, source.object_name]]);
  const dispose = (value: DynamicSourcePreview) => { void api(`/sources/previews/${value.preview_id}`, { method: 'DELETE' }).catch(() => {}); };
  useEffect(() => () => {
    requestController.current?.abort();
    requestController.current = null;
    queryStatus.current?.(false); busyStatus.current?.(false);
    if (!cache) { previews.forEach(dispose); previews.clear(); }
  }, []);
  useEffect(() => { setValidation(previews.get(queryKey) || null); }, [queryKey]);
  useEffect(() => {
    let active = true;
    api('/connections').then(value => { if (active) setConnections(value); })
      .catch(error => { if (active) setConnectionError(error.message); })
      .finally(() => { if (active) setLoadingConnections(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (active && !dataset && !source.connection_id && connections.length) setSource(previous => ({ ...previous, connection_id: connections[0].id, database: connections[0].database }));
  }, [active, dataset?.id, source.connection_id, connections]);
  useEffect(() => {
    if (!active || source.mode === 'sql' || !source.connection_id) return;
    let activeRequest = true;
    setInitializingObjects(true); setConnectionError('');
    api(`/connections/${encodeURIComponent(source.connection_id)}/objects/initialize`, json({}))
      .then(() => { if (activeRequest) setCatalogVersion(value => value + 1); })
      .catch(error => { if (activeRequest) setConnectionError(error.message); })
      .finally(() => { if (activeRequest) setInitializingObjects(false); });
    return () => { activeRequest = false; };
  }, [active, source.mode === 'sql', source.connection_id]);
  useEffect(() => {
    if (source.mode === 'sql' || !source.connection_id || !objectSearch.trim()) {
      setObjects([]); setObjectError(''); setLoadingObjects(false);
      return;
    }
    let active = true;
    setLoadingObjects(true); setObjectError(''); setObjects([]);
    const timer = window.setTimeout(() => {
      api(`/connections/${encodeURIComponent(source.connection_id)}/objects?kind=${objectKind}&search=${encodeURIComponent(objectSearch)}`)
        .then(value => { if (active) setObjects(value); })
        .catch(error => { if (active) setObjectError(error.message); })
        .finally(() => { if (active) setLoadingObjects(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source.connection_id, source.mode === 'sql', objectKind, objectSearch, catalogVersion]);
  useEffect(() => {
    if (!dataset) return;
    let active = true;
    api(`/datasets/${dataset.id}/dynamic`).then(value => { if (active) setSource(value); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [dataset?.id]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); }, [notice]);
  const change = (patch: Partial<Source>) => { setSource(value => ({ ...value, ...patch })); setChanged(true); setError(''); setNotice(''); setFailedDuration(null); };
  const refreshObjects = async () => {
    setRefreshingObjects(true); setConnectionError(''); setNotice('');
    try {
      await api(`/connections/${encodeURIComponent(source.connection_id)}/objects/refresh`, json({}));
      setCatalogVersion(value => value + 1); setNotice(t('对象信息已刷新'));
    } catch (error) { setConnectionError((error as Error).message); }
    finally { setRefreshingObjects(false); }
  };
  const run = async (action: 'validate' | 'preview') => {
    if (action === 'preview' && onPreview && previews.has(queryKey)) { onPreview({ ...source, name: source.name || connections.find(connection => connection.id === source.connection_id)?.name || '' }, previews.get(queryKey)!); return; }
    if (action === 'preview' && dataset && !changed && !previews.has(queryKey) && onExistingPreview) { onExistingPreview(); return; }
    const controller = new AbortController();
    requestController.current = controller;
    onQuerying?.(true);
    setBusy(true); onBusy?.(true); setError(''); setNotice(''); setFailedDuration(null);
    setElapsed(0); setQueryStarted(performance.now());
    try {
      {
        const previous = previews.get(queryKey);
        const value = { ...await api('/sources/preview' + (dataset ? '?dataset_id=' + encodeURIComponent(dataset.id) : ''), { ...json({ ...source, annotation_order: annotationOrder }), signal: controller.signal }), queried_at: new Date().toISOString() } as DynamicSourcePreview;
        if (controller.signal.aborted) { if (previous !== value) dispose(value); return; }
        if (previous && previous !== value) dispose(previous);
        previews.set(queryKey, value);
        setValidation(value);
        if (action === 'preview') {
          setSource(previous => source.mode === 'sql' ? { ...previous, schema_name: '', object_name: '' } : { ...previous, sql: '' });
          onPreview({ ...source, name: source.name || connections.find(connection => connection.id === source.connection_id)?.name || '' }, value);
        }
      }
    } catch (error) { if (controller.signal.aborted) return; setError((error as Error).message); setFailedDuration((error as { detail?: { duration_seconds?: number } }).detail?.duration_seconds ?? null); }
    finally { if (requestController.current === controller) { requestController.current = null; onQuerying?.(false); if (!controller.signal.aborted) { setQueryStarted(null); setBusy(false); onBusy?.(false); } } }
  };
  const ready = !!(connections.some(connection => connection.id === source.connection_id) && (source.mode === 'sql' ? source.sql.trim() : source.schema_name && source.object_name));
  useEffect(() => { onReady?.(ready && !busy); }, [ready, source.name, busy, onReady]);
  const selectedObject = source.mode !== 'sql' && source.object_name ? { database_name: source.database || connections.find(value => value.id === source.connection_id)?.database || '', schema_name: source.schema_name, object_name: source.object_name, kind: source.mode } : null;
  const objectOptions = selectedObject && !objects.some(value => objectKey(value) === objectKey(selectedObject)) ? [selectedObject, ...objects] : objects;
  const lastDuration = validation?.duration_seconds ?? source.duration_seconds ?? dataset?.dynamic?.duration_seconds;
  const lastRun = validation?.queried_at || source.last_run_at || dataset?.dynamic?.last_run_at;
  return <form className="dynamic-source" id="dynamic-source-import" onSubmit={event => { event.preventDefault(); if (ready && !busy) void run('preview'); }}>
    <fieldset disabled={busy}>
      <div className="connection-grid query-source source-query-connection">
        <label>{t('查询方式')}<SearchSelect label={t('查询方式')} value={source.mode === 'sql' ? 'sql' : 'object'} options={[{ value: 'sql', label: 'SQL' }, { value: 'object', label: t('对象') }]} onChange={value => { setObjectSearch(''); if (source.mode !== 'sql') setLastObjectKind(source.mode); change({ mode: value === 'sql' ? 'sql' : lastObjectKind }); }} /></label>
      <label>{t('已保存连接')}<span className="connection-picker"><SearchSelect label={t('已保存连接')} value={source.connection_id} loading={loadingConnections} disabled={refreshingObjects} options={connections.map(connection => ({ value: connection.id, label: `${connection.name} · ${connection.redshift ? 'Redshift' : 'PostgreSQL'}` }))} placeholder={t('选择已保存的连接')} onChange={value => { setObjects([]); setObjectSearch(''); change({ connection_id: value, database: '', schema_name: '', object_name: '' }); }} /><button type="button" disabled={!source.connection_id || refreshingObjects || initializingObjects} onClick={() => void refreshObjects()}>{t(refreshingObjects || initializingObjects ? '刷新中…' : '刷新')}</button></span></label>
      </div>
      {!loadingConnections && !connections.length && !connectionError && <p className="source-hint">{t('请先在设置的连接关联中保存连接。')}</p>}
      {connectionError && <p role="alert" className="source-error">{connectionError}</p>}
      <div className="connection-grid query-source">
        {source.mode !== 'sql' && <label>{t('对象类型')}<select value={objectKind} onChange={event => { const kind = event.target.value; setObjectKind(kind); setObjects([]); if (kind !== 'all' && kind !== source.mode) change({ schema_name: '', object_name: '' }); }}><option value="all">{t('全部')}</option><option value="table">{t('表')}</option><option value="view">{t('视图')}</option><option value="materialized_view">{t('物化视图')}</option></select></label>}
      </div>
      {source.mode !== 'sql' && <>
        <label className="source-object-name">{t('对象名称')}<SearchSelect label={t('对象名称')} value={selectedObject ? objectKey(selectedObject) : ''} options={objectOptions.map(value => ({ value: objectKey(value), label: `${value.database_name}.${value.schema_name}.${value.object_name} · ${value.kind === 'table' ? t('表') : value.kind === 'view' ? t('视图') : t('物化视图')}` }))} loading={loadingObjects || initializingObjects} disabled={!source.connection_id} placeholder={t('搜索并选择对象')} onSearch={setObjectSearch} onChange={key => { const value = objectOptions.find(item => objectKey(item) === key); if (value) change({ database: value.database_name, schema_name: value.schema_name, object_name: value.object_name, mode: value.kind }); else change({ schema_name: '', object_name: '' }); }} /></label>
        {selectedObject && <p className="source-hint">SELECT * FROM {`"${source.schema_name.replaceAll('"', '""')}"."${source.object_name.replaceAll('"', '""')}"`}</p>}
        {objectError && <p role="alert" className="source-error">{objectError}</p>}
      </>}
      {source.mode === 'sql' && <label>SQL<textarea className="source-sql" rows={6} value={source.sql} spellCheck={false} placeholder="SELECT ..." onChange={event => change({ sql: event.target.value })} /></label>}
    </fieldset>
    <div className="source-actions"><button type="button" disabled={busy || !ready} onClick={() => void run('validate')}>{t(dataset && (validation || source.duration_seconds != null || dataset.dynamic?.duration_seconds != null) ? '更新' : '查询')}</button>{(queryStarted != null || failedDuration != null || lastDuration != null) && <span className="source-query-progress" role="status">{queryStarted != null ? <>{t('查询耗时')} {queryDuration(elapsed)}</> : failedDuration != null ? <>{t('查询耗时')} {queryDuration(failedDuration)}</> : <><span className="query-stat"><span>{t('上次查询耗时')}</span><strong>{queryDuration(lastDuration)}</strong></span>{lastRun && <span className="query-stat"><span>{t('上次执行')}</span><strong>{formatUpdatedAt(lastRun)}</strong></span>}</>}</span>}</div>
    {error && <p role="alert" className="source-error">{error}</p>}
    {notice && <p role="status" className="source-notice">{notice}</p>}
  </form>;
}
