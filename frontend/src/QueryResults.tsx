import { useEffect, useRef, useState } from 'react';
import { api, Dataset, json } from './dashboard';
import { formatUpdatedAt } from './dateTime';
import { formatField } from './fieldDisplay';
import { Icon } from './Icon';
import { Pagination } from './Pagination';
import { t } from './i18n';

export function QueryResults({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    setBusy(true); setError(''); setRows([]);
    api(`/datasets/${dataset.id}/view-query`, json({ snapshot_id: dataset.snapshot_id, fields: dataset.schema.map(field => field.name), limit: 10, offset: page * 10 }))
      .then(value => { if (active) setRows(value.rows); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [dataset.id, dataset.snapshot_id, page]);
  return <dialog ref={dialog} className="dataset-details" aria-label={dataset.name} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-head"><h2>{dataset.name}</h2><button className="remove-dataset" aria-label={t('关闭')} onClick={onClose}><Icon name="close" /></button></div>
    <div className="dataset-details-body"><p>{t('结果更新时间')} · {formatUpdatedAt(dataset.data_as_of)}</p>
      {error && <p role="alert">{error}</p>}{busy && <p role="status">{t('加载中…')}</p>}
      <div className="source-result-scroll"><table><thead><tr>{dataset.schema.map(field => <th key={field.name}>{field.display_name || field.name}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{dataset.schema.map(field => <td key={field.name}>{formatField(row[field.name], dataset.field_formats?.[field.name])}</td>)}</tr>)}</tbody></table></div>
      <Pagination total={dataset.row_count} page={page} onChange={setPage} />
    </div>
  </dialog>;
}
