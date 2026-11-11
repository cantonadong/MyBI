import { formatUpdatedAt } from './dateTime';
import { useEffect, useRef, useState } from 'react';
import { api, Dataset } from './dashboard';
import { t, useLanguage } from './i18n';
import { DynamicSource, executionError, queryDuration } from './DynamicSource';
import { Pagination } from './Pagination';
import { Icon } from './Icon';

type ManagedFile = { name: string; bytes: number; date?: string; duration_seconds?: number };

function DatasetDetails({ dataset, onSaved, onClose }: { dataset: Dataset; onSaved: (value: Dataset) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<ManagedFile[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [filePage, setFilePage] = useState(0);
  const [pendingFile, setPendingFile] = useState<ManagedFile | null>(null);
  const page = Math.min(filePage, Math.max(0, Math.ceil(files.length / 10) - 1));
  const reload = () => api(`/datasets/${dataset.id}/files`).then(value => setFiles(value.files)).catch(error => setError(error.message));
  useEffect(() => { dialog.current?.showModal(); void reload(); }, [dataset.id]);
  const removeCache = async (file: ManagedFile) => {
    setBusy(true); setError('');
    try { await api(`/datasets/${dataset.id}/cache/${file.date}`, { method: 'DELETE' }); setPendingFile(null); await reload(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="dataset-details" aria-label={t('数据集管理')} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className="modal-head"><h2>{dataset.name}</h2><button disabled={busy} onClick={onClose}>{t('关闭')}</button></div><div className="dataset-details-body">
    {dataset.dynamic && <DynamicSource dataset={dataset} onBusy={setBusy} onSaved={value => { onSaved(value); void reload(); }} />}
    <h3>{t('物理文件')}</h3><p className="source-hint">{`datasets/${dataset.id}/`}</p>
    {error && <p role="alert" className="source-error">{error}</p>}
    <div className="source-result-scroll"><table className="managed-files"><thead><tr><th>{t('文件名')}</th><th>{t('大小')}</th><th>{t('查询耗时')}</th><th>{t('操作')}</th></tr></thead><tbody>{files.slice(page * 10, (page + 1) * 10).map(file => <tr key={file.name}><td>{file.name}</td><td>{(file.bytes / 1024).toFixed(1)} KB</td><td>{queryDuration(file.duration_seconds)}</td><td>{file.date && file.name.endsWith('.parquet') && <button disabled={busy} onClick={() => setPendingFile(file)}>{t('删除缓存')}</button>}</td></tr>)}</tbody></table></div><Pagination page={page} total={files.length} onChange={setFilePage} disabled={busy} />
    {pendingFile && <div className="cache-confirmation"><p>{t('确定删除缓存文件“{0}”？历史快照和报表不受影响。', pendingFile.name)}</p><div className="modal-actions"><button disabled={busy} onClick={() => setPendingFile(null)}>{t('取消')}</button><button className="primary" disabled={busy} onClick={() => void removeCache(pendingFile)}>{t('确认')}</button></div></div>}
  </div></dialog>;
}

type Reference = { report_id: string; report_name: string; chart_id?: string; chart_title: string };

function DatasetReferences({ dataset, deleting, onDeleted, onClose }: { dataset: Dataset; deleting: boolean; onDeleted: (id: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [references, setReferences] = useState<Reference[]>([]), [page, setPage] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    api(`/datasets/${dataset.id}/references`).then(value => { if (active) setReferences(value); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dataset.id]);
  const remove = async () => {
    setBusy(true); setError('');
    try { await api(`/datasets/${dataset.id}?confirm_references=true`, { method: 'DELETE' }); onDeleted(dataset.id); onClose(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="dataset-details report-confirmation" aria-label={t(deleting ? '删除数据集' : '查看引用')} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-head"><h2>{t(deleting ? '删除数据集' : '查看引用')} · {dataset.name}</h2><button disabled={busy} onClick={onClose}>{t('关闭')}</button></div>
    <div className="dataset-details-body">{deleting && <p>{t('确定删除数据集“{0}”及其物理文件？此操作无法撤销。', dataset.name)}</p>}
      {loading ? <p>{t('加载中…')}</p> : <>{references.length > 0 ? <>{deleting && <p>{t('以下报表仍在引用此数据集，删除后相关图表可能无法加载数据。')}</p>}<div className="source-result-scroll"><table><thead><tr><th>{t('报表')}</th><th>{t('图表标题')}</th></tr></thead><tbody>{references.slice(page * 10, (page + 1) * 10).map((value, index) => <tr key={`${value.report_id}-${value.chart_id}-${index}`}><td>{value.report_name}</td><td>{value.chart_title || '—'}</td></tr>)}</tbody></table></div><Pagination page={page} total={references.length} onChange={setPage} disabled={busy} /></> : !error && <p>{t('暂无引用')}</p>}</>}
      {error && <p role="alert" className="source-error">{error}</p>}
      {deleting && <div className="modal-actions"><button disabled={busy} onClick={onClose}>{t('取消')}</button><button className="primary" disabled={loading || busy || !!error} onClick={() => void remove()}>{t(busy ? '处理中…' : '确认')}</button></div>}
    </div>
  </dialog>;
}

export function DatasetManager({ datasets, onSaved, onDeleted, onConnect, onView, onMessage }: { onMessage: (text: string) => void; onView: (value: Dataset) => void; datasets: Dataset[]; onSaved: (value: Dataset) => void; onDeleted: (id: string) => void; onConnect: () => void }) {
  useLanguage();
  const [selected, setSelected] = useState('');
  const [requestedPage, setPage] = useState(0), [action, setAction] = useState<{ dataset: Dataset; deleting: boolean } | null>(null);
  const ordered = [...datasets].sort((a, b) => new Date(b.updated_at || b.data_as_of || 0).getTime() - new Date(a.updated_at || a.data_as_of || 0).getTime());
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(datasets.length / 10) - 1));
  const dataset = datasets.find(value => value.id === selected);
  const copyId = async (id: string) => {
    try { await navigator.clipboard.writeText(id); onMessage(t('ID 已复制')); }
    catch { onMessage(t('复制 ID 失败')); }
  };
  return <main className="workspace dataset-management"><header className="reports-heading"><h2>{t('数据集管理')}</h2><button className="import-button square-add-button" title={t("接入数据")} aria-label={t("接入数据")} onClick={onConnect}>+</button></header>
    <div className="dataset-management-scroll"><table className="reports-table"><thead><tr><th>{t('名称')}</th><th>ID</th><th>{t('类型')}</th><th>{t('更新时间')}</th><th>{t('Owner')}</th><th>{t('状态')}</th><th aria-label={t('操作')} /></tr></thead><tbody>{ordered.slice(page * 10, (page + 1) * 10).map(value => <tr key={value.id}><td><strong>{value.name}</strong></td><td className="report-id" title={value.storage_path}><div className="resource-id-cell"><span>{value.fingerprint || value.id}</span><button className="resource-id-copy" title={t('复制 ID')} aria-label={t('复制 ID')} onClick={() => void copyId(value.fingerprint || value.id)}><Icon name="copy" /></button></div></td><td>{t(value.dynamic ? '动态' : '静态')}</td><td title={formatUpdatedAt(value.updated_at)}>{formatUpdatedAt(value.updated_at)}</td><td>{value.owner || '—'}</td><td title={value.dynamic?.last_error ? executionError(value.dynamic.last_error) : undefined} className={value.dynamic?.last_error ? 'source-error' : undefined}>{t(value.dynamic?.refreshing ? '刷新中…' : value.dynamic?.last_error ? '失败' : '正常')}</td><td><div className="report-actions"><button onClick={() => onView(value)}>{t("查看")}</button><button onClick={() => setSelected(value.id)}>{t('管理')}</button><button onClick={() => setAction({ dataset: value, deleting: false })}>{t('查看引用')}</button><button onClick={() => setAction({ dataset: value, deleting: true })}>{t('删除')}</button></div></td></tr>)}</tbody></table>{!datasets.length && <p>{t('暂无数据集')}</p>}<Pagination page={page} total={datasets.length} onChange={setPage} /></div>

    {dataset && <DatasetDetails dataset={dataset} onSaved={onSaved} onClose={() => setSelected('')} />}
    {action && <DatasetReferences dataset={action.dataset} deleting={action.deleting} onDeleted={onDeleted} onClose={() => setAction(null)} />}
  </main>;
}
