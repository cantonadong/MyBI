import { useEffect, useState } from 'react';
import { api, json } from './dashboard';
import { getLocale, t, useLanguage } from './i18n';
import { SearchSelect } from './SearchSelect';
import { TimezoneSelect } from './TimezoneSelect';
import { Pagination } from './Pagination';
import { confirmAction } from './confirmAction';
import { formatUpdatedAt } from './dateTime';
import { executionError, queryDuration } from './DynamicSource';
import './connections-settings.css';

type Schedule = { enabled: boolean; time: string; timezone: string };
type Task = { id?: string; name: string; connection_id: string; mode: 'sql'; sql: string; schedule: Schedule; last_run_at?: string | null; duration_seconds?: number | null; row_count?: number | null; last_error?: string | null; running?: boolean };
const initial = (): Task => ({ name: '', connection_id: '', mode: 'sql', sql: '', schedule: { enabled: true, time: '00:00', timezone: 'UTC' } });
const body = (task: Task) => ({ name: task.name, connection_id: task.connection_id, mode: 'sql', sql: task.sql, schedule: task.schedule });

export function ScheduledQueries({ onMessage }: { onMessage: (text: string) => void }) {
  useLanguage();
  const [tasks, setTasks] = useState<Task[]>([]), [connections, setConnections] = useState<{ id: string; name: string; redshift: boolean }[]>([]);
  const [form, setForm] = useState<Task | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [requestedPage, setPage] = useState(0);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(tasks.length / 10) - 1));
  const reload = () => api('/scheduled-queries').then(setTasks).catch(error => setError(error.message));
  useEffect(() => { void reload(); api('/connections').then(setConnections).catch(error => setError(error.message)); }, []);
  const replace = (task: Task) => setTasks(previous => previous.some(item => item.id === task.id) ? previous.map(item => item.id === task.id ? task : item) : [...previous, task]);
  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(''); }
  };
  const save = () => act('save', async () => { replace(await api(form!.id ? `/scheduled-queries/${form!.id}` : '/scheduled-queries', { ...json(body(form!)), method: form!.id ? 'PUT' : 'POST' })); setForm(null); onMessage(t('已保存')); });
  const toggle = (task: Task) => act(task.id!, async () => replace(await api(`/scheduled-queries/${task.id}`, { ...json(body({ ...task, schedule: { ...task.schedule, enabled: !task.schedule.enabled } })), method: 'PUT' })));
  const run = (task: Task) => act(task.id!, async () => { setTasks(previous => previous.map(item => item.id === task.id ? { ...item, running: true } : item)); try { replace(await api(`/scheduled-queries/${task.id}/run`, json({}))); } finally { void reload(); } });
  const remove = async (task: Task) => { if (await confirmAction(t('确定删除定时查询“{0}”？', task.name))) await act(task.id!, async () => { await api(`/scheduled-queries/${task.id}`, { method: 'DELETE' }); setTasks(previous => previous.filter(item => item.id !== task.id)); }); };
  const status = (task: Task) => task.running ? t('执行中…') : task.last_error ? `${t('失败')} · ${executionError(task.last_error)}` : task.last_run_at ? t('成功 · {0} 行', task.row_count ?? 0) : t('未执行');
  const localTime = (schedule: Schedule) => schedule.timezone === 'UTC' ? new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(new Date().toISOString().slice(0, 10) + 'T' + schedule.time + ':00Z')) : '';
  const ready = !!(form && form.name.trim() && form.connection_id && form.sql.trim() && form.schedule.time);
  return <section id="settings-scheduled" className="settings-card scheduled-queries dynamic-source">
    <div className="scheduled-heading"><h3>{t('定时查询')}</h3>{!form && <button className="primary" onClick={() => { setForm(initial()); setError(''); }}>{t('新建')}</button>}</div>
    <p className="source-hint">{t('按计划执行 SQL，规则同动态数据集；仅记录执行时间、耗时和结果状态。')}</p>
    {form ? <fieldset disabled={!!busy}>
      <div className="connection-grid">
        <label>{t('名称')}<input value={form.name} maxLength={255} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>{t('已保存连接')}<SearchSelect label={t('已保存连接')} value={form.connection_id} options={connections.map(value => ({ value: value.id, label: `${value.name} · ${value.redshift ? 'Redshift' : 'PostgreSQL'}` }))} placeholder={t('选择已保存的连接')} onChange={connection_id => setForm({ ...form, connection_id })} /></label>
      </div>
      <label>SQL<textarea className="source-sql" rows={6} spellCheck={false} placeholder="SELECT ..." value={form.sql} onChange={event => setForm({ ...form, sql: event.target.value })} /></label>
      <div className="scheduled-time">
        <label><input type="checkbox" checked={form.schedule.enabled} onChange={event => setForm({ ...form, schedule: { ...form.schedule, enabled: event.target.checked } })} />{t('启用')}</label>
        <label>{t('执行时间')}<input type="time" step={60} value={form.schedule.time} onChange={event => { if (event.target.value) setForm({ ...form, schedule: { ...form.schedule, time: event.target.value } }); }} /></label>
        <TimezoneSelect value={form.schedule.timezone} onChange={timezone => setForm({ ...form, schedule: { ...form.schedule, timezone } })} />
      </div>
      {localTime(form.schedule) && <small>{t('本地执行时间：{0}', localTime(form.schedule))}</small>}
      <div className="source-actions"><button onClick={() => { setForm(null); setError(''); }}>{t('取消')}</button><button className="primary" disabled={!ready} onClick={() => void save()}>{busy === 'save' ? t('处理中…') : t('保存')}</button></div>
    </fieldset> : <>
      <table className="reports-table scheduled-table"><thead><tr><th>{t('名称')}</th><th>{t('执行时间')}</th><th>{t('启用')}</th><th>{t('上次执行')}</th><th>{t('查询耗时')}</th><th>{t('状态')}</th><th><span className="report-actions-heading">{t('操作')}</span></th></tr></thead><tbody>
        {tasks.length ? tasks.slice(page * 10, (page + 1) * 10).map(task => <tr key={task.id}>
          <td title={task.sql}>{task.name}</td>
          <td>{task.schedule.time} {task.schedule.timezone}</td>
          <td><input type="checkbox" aria-label={t('启用 {0}', task.name)} checked={task.schedule.enabled} disabled={!!busy || task.running} onChange={() => void toggle(task)} /></td>
          <td>{task.last_run_at ? formatUpdatedAt(task.last_run_at) : '—'}</td>
          <td>{queryDuration(task.duration_seconds)}</td>
          <td className={task.last_error ? 'source-error' : undefined} title={executionError(task.last_error) || undefined}>{status(task)}</td>
          <td><div className="report-actions"><button disabled={!!busy || task.running} onClick={() => void run(task)}>{busy === task.id ? t('执行中…') : t('执行')}</button><button disabled={!!busy} onClick={() => { setForm(task); setError(''); }}>{t('编辑')}</button><button className="report-delete" disabled={!!busy || task.running} onClick={() => void remove(task)}>{t('删除')}</button></div></td>
        </tr>) : <tr><td colSpan={7} className="reports-empty">{t('暂无定时查询')}</td></tr>}
      </tbody></table>
      <Pagination page={page} total={tasks.length} onChange={setPage} disabled={!!busy} />
    </>}
    {error && <p role="alert" className="source-error">{error}</p>}
  </section>;
}
