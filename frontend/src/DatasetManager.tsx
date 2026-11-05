import { useEffect, useRef, useState } from 'react';
import { api, Dataset } from './dashboard';
import { t, useLanguage } from './i18n';
import { DynamicSource, executionError, queryDuration } from './DynamicSource';

type ManagedFile = { name: string; bytes: number; date?: string; duration_seconds?: number };

function DatasetDetails({ dataset, onSaved, onClose }: { dataset: Dataset; onSaved: (value: Dataset) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<ManagedFile[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const reload = () => api(`/datasets/${dataset.id}/files`).then(value => setFiles(value.files)).catch(error => setError(error.message));
  useEffect(() => { dialog.current?.showModal(); void reload(); }, [dataset.id]);
  const removeCache = async (file: ManagedFile) => {
    if (!confirm(t('确定删除缓存文件“{0}”？历史快照和报表不受影响。', file.name))) return;
    setBusy(true); setError('');
    try { await api(`/datasets/${dataset.id}/cache/${file.date}`, { method: 'DELETE' }); await reload(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="dataset-details" aria-label={t('数据集管理')} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className="modal-head"><h2>{dataset.name}</h2><button disabled={busy} onClick={onClose}>{t('关闭')}</button></div><div className="dataset-details-body">
    {dataset.dynamic && <DynamicSource dataset={dataset} onBusy={setBusy} onSaved={value => { onSaved(value); void reload(); }} />}
    <h3>{t('物理文件')}</h3><p className="source-hint">{`datasets/${dataset.id}/`}</p>
    {error && <p role="alert" className="source-error">{error}</p>}
    <div className="source-result-scroll"><table className="managed-files"><thead><tr><th>{t('文件名')}</th><th>{t('大小')}</th><th>{t('查询耗时')}</th><th>{t('操作')}</th></tr></thead><tbody>{files.map(file => <tr key={file.name}><td>{file.name}</td><td>{(file.bytes / 1024).toFixed(1)} KB</td><td>{queryDuration(file.duration_seconds)}</td><td>{file.date && file.name.endsWith('.parquet') && <button disabled={busy} onClick={() => void removeCache(file)}>{t('删除缓存')}</button>}</td></tr>)}</tbody></table></div>
  </div></dialog>;
}

export function DatasetManager({ datasets, onSaved, onDeleted, onConnect, onLoad }: { datasets: Dataset[]; onSaved: (value: Dataset) => void; onDeleted: (id: string) => void; onConnect: () => void; onLoad: (value: Dataset) => void }) {
  const { locale } = useLanguage();
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dataset = datasets.find(value => value.id === selected);
  const remove = async (value: Dataset) => {
    if (!confirm(t('确定删除数据集“{0}”及其物理文件？此操作无法撤销。', value.name))) return;
    setBusy(true); setError('');
    try { await api(`/datasets/${value.id}`, { method: 'DELETE' }); onDeleted(value.id); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="workspace dataset-management"><header className="reports-heading"><h2>{t('数据集管理')}</h2><button className="primary" onClick={onConnect}>{t('接入数据')}</button></header>
    {error && <p role="alert" className="source-error">{error}</p>}
    <div className="dataset-management-scroll"><table className="reports-table"><thead><tr><th>{t('名称')}</th><th>{t('类型')}</th><th>{t('行数')}</th><th>{t('上次查询耗时')}</th><th>{t('更新时间')}</th><th>{t('操作')}</th></tr></thead><tbody>{datasets.map(value => <tr key={value.id}><td><strong>{value.name}</strong><small className="resource-id">{value.id}</small>{value.dynamic?.last_error && <small className="source-error">{executionError(value.dynamic.last_error)}</small>}</td><td>{t(value.dynamic ? '动态数据集' : '静态数据集')}</td><td>{value.row_count.toLocaleString(locale)}</td><td>{queryDuration(value.dynamic?.duration_seconds)}</td><td>{value.data_as_of ? new Date(value.data_as_of).toLocaleString(locale) : '—'}</td><td><div className="report-actions"><button disabled={busy} onClick={() => onLoad(value)}>{t('调取')}</button><button disabled={busy} onClick={() => setSelected(value.id)}>{t('管理')}</button><button disabled={busy} onClick={() => void remove(value)}>{t('删除')}</button></div></td></tr>)}</tbody></table>{!datasets.length && <p>{t('暂无数据集')}</p>}</div>
    {dataset && <DatasetDetails dataset={dataset} onSaved={onSaved} onClose={() => setSelected('')} />}
  </main>;
}
