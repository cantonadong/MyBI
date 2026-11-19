import { useEffect, useState } from 'react';
import { api, json } from './dashboard';
import { getLocale, t, useLanguage } from './i18n';
import { SearchSelect } from './SearchSelect';
import { TimezoneSelect } from './TimezoneSelect';
import { TimePicker } from './TimePicker';
import { Pagination } from './Pagination';
import { Icon } from './Icon';
import { confirmAction } from './confirmAction';
import { defaultScheduleTime, formatUpdatedAt, localTimeZone } from './dateTime';
import { executionError, queryDuration } from './DynamicSource';
import './connections-settings.css';

type Schedule = { enabled: boolean; time: string; timezone: string };
type RunState = { last_run_at?: string | null; started_at?: string | null; duration_seconds?: number | null; last_error?: string | null; running?: boolean };
type Task = RunState & { id?: string; local_id?: number; name: string; connection_id: string; mode: 'sql'; sql: string; schedule: Schedule };
// A report's daily refresh ("每日定时查询"), listed alongside standalone tasks with the report as its owner.
type ReportSchedule = RunState & { id: string; local_id: number; name: string; schedule: Schedule };
type Row = { kind: 'task'; task: Task } | { kind: 'report'; report: ReportSchedule };
const initial = (): Task => ({ name: '', connection_id: '', mode: 'sql', sql: '', schedule: { enabled: true, time: defaultScheduleTime(), timezone: localTimeZone() } });
const body = (task: Task) => ({ name: task.name, connection_id: task.connection_id, mode: 'sql', sql: task.sql, schedule: task.schedule });

// Enable/disable switch shown in the actions column.
function EnableSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: () => void }) {
  return <label className="toggle-switch" title={t(checked ? '已启用' : '已停用')}><input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} /><span aria-hidden="true" /></label>;
}

export function ScheduledQueries({ onMessage, onOpenReport }: { onMessage: (text: string) => void; onOpenReport: (reportId: string) => void }) {
  useLanguage();
  const [tasks, setTasks] = useState<Task[]>([]), [reports, setReports] = useState<ReportSchedule[]>([]), [connections, setConnections] = useState<{ id: string; name: string; redshift: boolean }[]>([]);
  const [form, setForm] = useState<Task | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [requestedPage, setPage] = useState(0);
  const [now, setNow] = useState(Date.now());
  const rows: Row[] = [...tasks.map(task => ({ kind: 'task' as const, task })), ...reports.map(report => ({ kind: 'report' as const, report }))];
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(rows.length / 10) - 1));
  const reload = () => Promise.all([api('/scheduled-queries').then(setTasks), api('/scheduled-queries/reports').then(setReports)]).catch(error => setError(error.message));
  useEffect(() => { void reload(); api('/connections').then(setConnections).catch(error => setError(error.message)); }, []);
  // Runs execute on the server in the background; while any is running, tick the elapsed time and poll for the result.
  const running = tasks.some(task => task.running) || reports.some(report => report.running);
  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void reload(), 2000);
    return () => { window.clearInterval(tick); window.clearInterval(poll); };
  }, [running]);
  const replace = (task: Task) => setTasks(previous => previous.some(item => item.id === task.id) ? previous.map(item => item.id === task.id ? task : item) : [...previous, task]);
  const replaceReport = (report: ReportSchedule | null) => { if (report) setReports(previous => previous.map(item => item.id === report.id ? report : item)); };
  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(''); }
  };
  const save = () => act('save', async () => { replace(await api(form!.id ? `/scheduled-queries/${form!.id}` : '/scheduled-queries', { ...json(body(form!)), method: form!.id ? 'PUT' : 'POST' })); setForm(null); onMessage(t('已保存')); });
  const toggle = (task: Task) => act(task.id!, async () => replace(await api(`/scheduled-queries/${task.id}`, { ...json(body({ ...task, schedule: { ...task.schedule, enabled: !task.schedule.enabled } })), method: 'PUT' })));
  const toggleReport = (report: ReportSchedule) => act(report.id, async () => replaceReport(await api(`/scheduled-queries/reports/${report.id}/enabled`, { ...json({ enabled: !report.schedule.enabled }), method: 'PUT' })));
  const run = (task: Task) => act(task.id!, async () => { replace(await api(`/scheduled-queries/${task.id}/run`, json({}))); setNow(Date.now()); });
  const runReport = (report: ReportSchedule) => act(report.id, async () => { replaceReport(await api(`/scheduled-queries/reports/${report.id}/run`, json({}))); setNow(Date.now()); });
  const remove = async (task: Task) => { if (await confirmAction(t('确定删除定时任务“{0}”？', task.name))) await act(task.id!, async () => { await api(`/scheduled-queries/${task.id}`, { method: 'DELETE' }); setTasks(previous => previous.filter(item => item.id !== task.id)); }); };
  const status = (item: RunState) => item.running ? t('执行中…') : item.last_error ? `${t('失败')} · ${executionError(item.last_error)}` : item.last_run_at ? t('成功') : t('未执行');
  const elapsed = (item: RunState) => item.running && item.started_at ? queryDuration(Math.max(0, (now - new Date(item.started_at).getTime()) / 1000)) : queryDuration(item.duration_seconds);
  const localTime = (schedule: Schedule) => schedule.timezone === 'UTC' ? new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(new Date(new Date().toISOString().slice(0, 10) + 'T' + schedule.time + ':00Z')) : '';
  const ready = !!(form && form.name.trim() && form.connection_id && form.sql.trim() && form.schedule.time);
  const cells = (schedule: Schedule, item: RunState) => <>
    <td>{schedule.time} · {schedule.timezone}</td>
    <td title={item.last_run_at ? formatUpdatedAt(item.last_run_at) : undefined}>{item.last_run_at ? formatUpdatedAt(item.last_run_at) : '—'}</td>
    <td>{elapsed(item)}</td>
    <td className={item.last_error && !item.running ? 'source-error' : undefined} title={executionError(item.last_error) || undefined}>{status(item)}</td>
  </>;
  return <section className="scheduled-queries dynamic-source">
    <header className="reports-heading"><h2>{t('定时任务')}</h2>{!form && <button className="primary" onClick={() => { setForm(initial()); setError(''); }}>{t('新建')}</button>}</header>
    {form ? <div className="settings-card scheduled-form"><fieldset disabled={!!busy}>
      <div className="connection-grid">
        <label>{t('名称')}<input value={form.name} maxLength={255} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>{t('连接名称')}<SearchSelect label={t('连接名称')} value={form.connection_id} options={connections.map(value => ({ value: value.id, label: `${value.name} · ${value.redshift ? 'Redshift' : 'PostgreSQL'}` }))} placeholder={t('选择已保存的连接')} onChange={connection_id => setForm({ ...form, connection_id })} /></label>
      </div>
      <label>SQL<textarea className="source-sql" rows={6} spellCheck={false} placeholder="SELECT ..." value={form.sql} onChange={event => setForm({ ...form, sql: event.target.value })} /></label>
      <div className="scheduled-time">
        <label><input type="checkbox" checked={form.schedule.enabled} onChange={event => setForm({ ...form, schedule: { ...form.schedule, enabled: event.target.checked } })} />{t('启用')}</label>
        <label>{t('执行时间')}<TimePicker label={t('执行时间')} value={form.schedule.time} onChange={time => setForm({ ...form, schedule: { ...form.schedule, time } })} /></label>
        <TimezoneSelect value={form.schedule.timezone} onChange={timezone => setForm({ ...form, schedule: { ...form.schedule, timezone } })} />
      </div>
      {localTime(form.schedule) && <small>{t('本地执行时间：{0}', localTime(form.schedule))}</small>}
      <div className="source-actions"><button onClick={() => { setForm(null); setError(''); }}>{t('取消')}</button><button className="primary" disabled={!ready} onClick={() => void save()}>{busy === 'save' ? t('处理中…') : t('保存')}</button></div>
    </fieldset></div> : <>
      <table className="reports-table scheduled-table"><thead><tr><th>{t('名称')}</th><th>ID</th><th>{t('所属')}</th><th>{t('执行时间')}</th><th>{t('上次执行')}</th><th>{t('查询耗时')}</th><th>{t('状态')}</th><th><span className="report-actions-heading">{t('操作')}</span></th></tr></thead><tbody>
        {rows.length ? rows.slice(page * 10, (page + 1) * 10).map(row => row.kind === 'task' ? <tr key={'task-' + row.task.id}>
          <td><button className="report-name" title={row.task.sql} disabled={!!busy} onClick={() => { setForm(row.task); setError(''); }}>{row.task.name}</button></td>
          <td className="report-id">{row.task.local_id ?? '—'}</td>
          <td>—</td>
          {cells(row.task.schedule, row.task)}
          <td><div className="report-actions"><EnableSwitch label={t('启用 {0}', row.task.name)} checked={row.task.schedule.enabled} disabled={!!busy} onChange={() => void toggle(row.task)} /><button disabled={!!busy || row.task.running} onClick={() => void run(row.task)}><Icon name="run" />{row.task.running ? t('执行中…') : t('执行')}</button><button disabled={!!busy} onClick={() => { setForm(row.task); setError(''); }}><Icon name="edit" />{t('编辑')}</button><button className="report-delete" disabled={!!busy || row.task.running} onClick={() => void remove(row.task)}><Icon name="delete" />{t('删除')}</button></div></td>
        </tr> : <tr key={'report-' + row.report.id}>
          <td>{t('报表定时刷新')}</td>
          <td className="report-id">{row.report.local_id}</td>
          <td><button className="report-name" disabled={!!busy} onClick={() => onOpenReport(row.report.id)}>{row.report.name}</button></td>
          {cells(row.report.schedule, row.report)}
          <td><div className="report-actions"><EnableSwitch label={t('启用 {0}', row.report.name)} checked={row.report.schedule.enabled} disabled={!!busy} onChange={() => void toggleReport(row.report)} /><button disabled={!!busy || row.report.running} onClick={() => void runReport(row.report)}><Icon name="run" />{row.report.running ? t('执行中…') : t('执行')}</button><button disabled={!!busy} onClick={() => onOpenReport(row.report.id)}><Icon name="edit" />{t('编辑')}</button><button className="report-delete" disabled title={t('请在报表的“每日定时查询”中关闭')}><Icon name="delete" />{t('删除')}</button></div></td>
        </tr>) : <tr><td colSpan={8} className="reports-empty">{t('暂无定时任务')}</td></tr>}
      </tbody></table>
      <Pagination page={page} total={rows.length} onChange={setPage} disabled={!!busy} />
    </>}
    {error && <p role="alert" className="source-error">{error}</p>}
  </section>;
}
