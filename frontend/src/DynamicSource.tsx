import { useEffect, useRef, useState } from 'react';
import { api, Dataset, json } from './dashboard';
import { getLocale, t, useLanguage } from './i18n';
import { SearchSelect } from './SearchSelect';
import { TimezoneSelect } from './TimezoneSelect';

export function queryDuration(seconds?: number | null): string {
  if (seconds == null) return '—';
  const [divisor, unit] = seconds >= 86400 ? [86400, '天'] : seconds >= 3600 ? [3600, '小时'] : seconds >= 60 ? [60, '分钟'] : [1, '秒'];
  return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(seconds / Number(divisor))} ${t(String(unit))}`;
}

export function executionError(value?: string | null): string {
  if (!value) return '';
  try { const error = JSON.parse(value); return typeof error === 'object' && error.message ? error.code === 'source_validation_failed' ? t(error.message) : `${t('数据库查询失败')}：${error.message}` : t(value); } catch { return t(value); }
}

export type DynamicSourceConfig = {
  name: string; connection_id: string; mode: string; sql: string; schema_name: string; object_name: string;
  schedule: { enabled: boolean; time: string; timezone: string }; version?: number;
};
type Source = DynamicSourceConfig;
export type DynamicSourcePreview = { schema: { name: string; type: string }[]; rows: Record<string, unknown>[]; row_count: number; duration_seconds: number; field_formats: Record<string, unknown>; preview_id: string };
type DatabaseObject = { schema_name: string; object_name: string; kind: string };
const objectKey = (value: DatabaseObject) => JSON.stringify([value.schema_name, value.object_name, value.kind]);
const initial = (): Source => ({ name: '', connection_id: '', mode: 'sql', sql: '', schema_name: '', object_name: '', schedule: { enabled: false, time: '06:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } });

export function DynamicSource({ dataset, onSaved, onBusy, onPreview, onReady, annotationOrder = [] }: { annotationOrder?: string[]; dataset?: Dataset; onSaved: (value: Dataset) => void; onBusy?: (busy: boolean) => void; onPreview?: (source: Source, preview: DynamicSourcePreview) => void; onReady?: (ready: boolean) => void }) {
  const { locale } = useLanguage();
  const [source, setSource] = useState<Source>(initial);
  const [busy, setBusy] = useState(!!dataset), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [validation, setValidation] = useState<{ schema: { name: string; type: string }[]; rows: Record<string, unknown>[]; row_count: number; duration_seconds: number } | null>(null);
  const [changed, setChanged] = useState(false);
  const [failedDuration, setFailedDuration] = useState<number | null>(null);
  const [connections, setConnections] = useState<{ id: string; name: string; redshift: boolean }[]>([]);
  const [connectionError, setConnectionError] = useState('');
  const [objects, setObjects] = useState<DatabaseObject[]>([]);
  const [objectKind, setObjectKind] = useState('all'), [objectSearch, setObjectSearch] = useState('');
  const [loadingObjects, setLoadingObjects] = useState(false), [objectError, setObjectError] = useState('');
  const [loadingConnections, setLoadingConnections] = useState(true);
  const previews = useRef(new Map<string, DynamicSourcePreview>());
  const [lastObjectKind, setLastObjectKind] = useState('table');
  const queryKey = JSON.stringify([annotationOrder, source.connection_id, source.mode, source.mode === 'sql' ? source.sql : [source.schema_name, source.object_name]]);
  const dispose = (value: DynamicSourcePreview) => { void api(`/sources/previews/${value.preview_id}`, { method: 'DELETE' }).catch(() => {}); };
  useEffect(() => () => { previews.current.forEach(dispose); previews.current.clear(); }, []);
  useEffect(() => { if (onPreview) setValidation(previews.current.get(queryKey) || null); }, [queryKey]);
  useEffect(() => {
    let active = true;
    api('/connections').then(value => { if (active) setConnections(value); })
      .catch(error => { if (active) setConnectionError(error.message); })
      .finally(() => { if (active) setLoadingConnections(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (source.mode === 'sql' || !source.connection_id) return;
    let active = true;
    setLoadingObjects(true); setObjectError(''); setObjects([]);
    const timer = window.setTimeout(() => {
      api(`/connections/${encodeURIComponent(source.connection_id)}/objects?kind=${objectKind}&search=${encodeURIComponent(objectSearch)}`)
        .then(value => { if (active) setObjects(value); })
        .catch(error => { if (active) setObjectError(error.message); })
        .finally(() => { if (active) setLoadingObjects(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source.connection_id, source.mode === 'sql', objectKind, objectSearch]);
  useEffect(() => {
    if (!dataset) return;
    let active = true;
    api(`/datasets/${dataset.id}/dynamic`).then(value => { if (active) setSource(value); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [dataset?.id]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); }, [notice]);
  const change = (patch: Partial<Source>) => { setSource(value => ({ ...value, ...patch })); setChanged(true); if (!onPreview) setValidation(null); setError(''); setNotice(''); setFailedDuration(null); };
  const run = async (action: 'validate' | 'save' | 'refresh' | 'cache' | 'preview') => {
    setBusy(true); onBusy?.(true); setError(''); setNotice(''); setFailedDuration(null);
    try {
      if (onPreview && (action === 'validate' || action === 'preview')) {
        let value = previews.current.get(queryKey);
        if (!value || action === 'validate') {
          const result = await api('/sources/preview', json({ ...source, annotation_order: annotationOrder }));
          if (value) dispose(value);
          value = result as DynamicSourcePreview; previews.current.set(queryKey, value);
        }
        setValidation(value);
        if (action === 'preview') {
          previews.current.forEach((unused, key) => { if (key !== queryKey) { dispose(unused); previews.current.delete(key); } });
          setSource(previous => source.mode === 'sql' ? { ...previous, schema_name: '', object_name: '' } : { ...previous, sql: '' });
          onPreview({ ...source, name: source.name || connections.find(connection => connection.id === source.connection_id)?.name || '' }, value);
        }
      } else if (action === 'validate') {
        const value = await api(dataset ? `/datasets/${dataset.id}/dynamic/validate` : '/sources/validate', json({ ...source, annotation_order: annotationOrder }));
        setValidation(value);
      } else if (action === 'refresh' || action === 'cache') {
        const value = await api(`/datasets/${dataset!.id}/refresh?force=${action === 'refresh'}`, json({}));
        onSaved(value); setNotice(t(value.cache_hit ? '已使用今日缓存' : '数据集已刷新')); setSource(previous => ({ ...previous, version: value.version }));
      } else {
        const value = await api(dataset ? `/datasets/${dataset.id}/dynamic` : '/sources', { ...json({ ...source, annotation_order: annotationOrder }), method: dataset ? 'PUT' : 'POST' });
        setSource(previous => ({ ...previous, version: value.version })); setChanged(false); onSaved(value); setNotice(t('已保存'));
      }
    } catch (error) { setError((error as Error).message); setFailedDuration((error as { detail?: { duration_seconds?: number } }).detail?.duration_seconds ?? null); }
    finally { setBusy(false); onBusy?.(false); }
  };
  useEffect(() => { setValidation(null); }, [JSON.stringify(annotationOrder)]);
  const ready = !!(connections.some(connection => connection.id === source.connection_id) && (source.mode === 'sql' ? source.sql.trim() : source.schema_name && source.object_name));
  useEffect(() => { onReady?.(ready && !busy); }, [ready, source.name, busy, onReady]);
  const selectedObject = source.mode !== 'sql' && source.object_name ? { schema_name: source.schema_name, object_name: source.object_name, kind: source.mode } : null;
  const objectOptions = selectedObject && !objects.some(value => objectKey(value) === objectKey(selectedObject)) ? [selectedObject, ...objects] : objects;
  const Wrapper = onPreview ? 'form' : 'div';
  return <Wrapper className="dynamic-source" id={onPreview ? 'dynamic-source-import' : undefined} onSubmit={event => { event.preventDefault(); if (onPreview && ready && !busy) void run('preview'); }}>
    <p className="source-hint">{t('使用只读 PostgreSQL 或 Redshift 账号。查询、缓存和定时任务均由服务端执行。')}</p>
    <fieldset disabled={busy}>
      <div className="connection-grid query-source">
        <label>{t('查询方式')}<select value={source.mode === 'sql' ? 'sql' : 'object'} onChange={event => { setObjectSearch(''); if (source.mode !== 'sql') setLastObjectKind(source.mode); change({ mode: event.target.value === 'sql' ? 'sql' : lastObjectKind }); }}><option value="sql">SQL</option><option value="object">{t('对象')}</option></select></label>
      <label>{t('已保存连接')}<SearchSelect label={t('已保存连接')} value={source.connection_id} loading={loadingConnections} options={connections.map(connection => ({ value: connection.id, label: `${connection.name} · ${connection.redshift ? 'Redshift' : 'PostgreSQL'}` }))} placeholder={t('选择已保存的连接')} onChange={value => { setObjects([]); setObjectSearch(''); change({ connection_id: value, schema_name: '', object_name: '' }); }} /></label>
      </div>
      {!loadingConnections && !connections.length && !connectionError && <p className="source-hint">{t('请先在设置的连接关联中保存连接。')}</p>}
      {connectionError && <p role="alert" className="source-error">{connectionError}</p>}
      <div className="connection-grid query-source">
        {!onPreview && <label>{t('数据集名称')}<input value={source.name} maxLength={255} onChange={event => change({ name: event.target.value })} /></label>}
        {source.mode !== 'sql' && <label>{t('对象类型')}<select value={objectKind} onChange={event => { const kind = event.target.value; setObjectKind(kind); setObjects([]); if (kind !== 'all' && kind !== source.mode) change({ schema_name: '', object_name: '' }); }}><option value="all">{t('全部')}</option><option value="table">{t('表')}</option><option value="view">{t('视图')}</option><option value="materialized_view">{t('物化视图')}</option></select></label>}
      </div>
      {source.mode !== 'sql' && <>
        <label>{t('对象名称')}<SearchSelect label={t('对象名称')} value={selectedObject ? objectKey(selectedObject) : ''} options={objectOptions.map(value => ({ value: objectKey(value), label: `${value.schema_name}.${value.object_name} · ${value.kind === 'table' ? t('表') : value.kind === 'view' ? t('视图') : t('物化视图')}` }))} loading={loadingObjects} disabled={!source.connection_id} placeholder={t('搜索并选择对象')} onSearch={setObjectSearch} onChange={key => { const value = objectOptions.find(item => objectKey(item) === key); if (value) change({ schema_name: value.schema_name, object_name: value.object_name, mode: value.kind }); else change({ schema_name: '', object_name: '' }); }} /></label>
        {selectedObject && <p className="source-hint">SELECT * FROM {`"${source.schema_name.replaceAll('"', '""')}"."${source.object_name.replaceAll('"', '""')}"`}</p>}
        {objectError && <p role="alert" className="source-error">{objectError}</p>}
      </>}
      {source.mode === 'sql' && <label>SQL<textarea className="source-sql" rows={6} value={source.sql} spellCheck={false} placeholder="SELECT ..." onChange={event => change({ sql: event.target.value })} /></label>}
      <div className="source-schedule"><label><input type="checkbox" checked={source.schedule.enabled} onChange={event => change({ schedule: { ...source.schedule, enabled: event.target.checked } })} />{t('每日定时查询')}</label><label>{t('执行时间')}<input type="time" value={source.schedule.time} onChange={event => change({ schedule: { ...source.schedule, time: event.target.value } })} /></label><TimezoneSelect value={source.schedule.timezone} onChange={timezone => change({ schedule: { ...source.schedule, timezone } })} /></div>
      <p className="source-hint">{t('按所选时区每天缓存一份；强制刷新替换当天缓存，历史快照保留。')}</p>
    </fieldset>
    <div className="source-actions"><button type="button" disabled={busy || !ready} onClick={() => void run('validate')}>{t('验证查询')}</button>{!onPreview && <button type="button" className="primary" disabled={busy || !ready || !source.name.trim()} onClick={() => void run('save')}>{busy ? t('处理中…') : t('保存')}</button>}{dataset && <><button type="button" disabled={busy || changed} onClick={() => void run('cache')}>{t('获取今日数据')}</button><button type="button" disabled={busy || changed} onClick={() => void run('refresh')}>{t('强制刷新')}</button></>}</div>
    {changed && dataset && <p className="source-hint">{t('请先保存连接或任务修改，再刷新数据。')}</p>}
    {error && <p role="alert" className="source-error">{error}</p>}
    {failedDuration != null && <p>{t('查询耗时')} {queryDuration(failedDuration)}</p>}
    {notice && <p role="status" className="source-notice">{notice}</p>}
    {validation && <section className="source-validation"><p>{t('验证成功')} · {validation.row_count.toLocaleString(locale)} {t('行')} · {t('查询耗时')} {queryDuration(validation.duration_seconds)}</p></section>}
    {dataset?.dynamic && <dl className="source-status"><dt>{t('上次查询耗时')}</dt><dd>{queryDuration(dataset.dynamic.duration_seconds)}</dd><dt>{t('上次执行')}</dt><dd>{dataset.dynamic.last_run_at ? new Date(dataset.dynamic.last_run_at).toLocaleString(locale) : '—'}</dd><dt>{t('下次执行')}</dt><dd>{dataset.dynamic.next_run_at ? new Date(dataset.dynamic.next_run_at).toLocaleString(locale) : '—'}</dd>{dataset.dynamic.last_error && <><dt>{t('最近错误')}</dt><dd className="source-error">{executionError(dataset.dynamic.last_error)}</dd></>}</dl>}
  </Wrapper>;
}
