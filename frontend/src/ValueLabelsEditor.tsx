import { Pagination } from './Pagination';
import { useEffect, useState } from 'react';
import { api, Dataset, json } from './dashboard';
import { t } from './i18n';

export function ValueLabelsEditor({ dataset, field, names, busy, onChange }: { dataset: Dataset; field: string; names: Record<string, string>; busy: boolean; onChange: (names: Record<string, string>) => void }) {
  const [requestedPage, setPage] = useState(0);
  const [groups, setGroups] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(groups.length / 10) - 1));
  useEffect(() => {
    setPage(0);
    let active = true;
    setLoading(true); setError(''); setGroups([]);
    const load = async () => {
      const values: unknown[] = [];
      for (let offset = 0; active; offset += 10000) {
        const result = await api(`/datasets/${dataset.id}/view-query`, json({ fields: [field], distinct: true, limit: 10000, offset }));
        if (!active) return;
        values.push(...result.rows.map((row: Record<string, unknown>) => row[field]));
        if (result.rows.length < 10000) break;
      }
      if (active) setGroups(values);
    };
    load().catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dataset.id, dataset.version, field]);
  return <section className="value-labels-editor"><header><h3>{t('值与显示名称')} · {field}</h3></header>
    {loading && <p>{t('加载中…')}</p>}{error && <p role="alert">{error}</p>}
    <div className="value-labels-list">
    {groups.slice(page * 10, (page + 1) * 10).map(group => {
      const key = JSON.stringify(group);
      const original = group == null ? 'NULL' : String(group);
      return <label key={key}><span title={original}>{original}</span><input disabled={busy} aria-label={t('{0} 的显示名称', original)} placeholder={original} value={names[key] || ''} onChange={event => {
        const next = { ...names };
        if (event.target.value) next[key] = event.target.value; else delete next[key];
        onChange(next);
      }} /></label>;
    })}
    </div><Pagination page={page} total={groups.length} onChange={setPage} disabled={busy || loading} />
  </section>;
}
