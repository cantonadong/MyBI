import { useEffect, useState } from 'react';
import { api, json } from './dashboard';
import { t, useLanguage } from './i18n';
import { SearchSelect } from './SearchSelect';
import './connections-settings.css';

type Connection = { id?: string; name: string; host: string; port: number; database: string; user: string; tls: boolean; trust_server_certificate: boolean; redshift: boolean; has_password?: boolean; version?: number; password?: string };
const initial = (): Connection => ({ name: '', host: '', port: 5432, database: '', user: '', password: '', tls: true, trust_server_certificate: false, redshift: false });

export function ConnectionsSettings({ onMessage }: { onMessage: (text: string) => void }) {
  useLanguage();
  const [connections, setConnections] = useState<Connection[]>([]), [form, setForm] = useState<Connection>(initial);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/connections').then(value => { if (active) setConnections(value); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  const change = (patch: Partial<Connection>) => { setForm(value => ({ ...value, ...patch })); setError(''); };
  const ready = !!(form.name.trim() && form.host.trim() && form.database.trim() && form.user.trim() && Number.isInteger(form.port) && form.port > 0 && form.port <= 65535);
  const run = async (action: 'save' | 'check' | 'delete' | 'import') => {
    if (action === 'delete' && !window.confirm(t('确定删除连接“{0}”？', form.name))) return;
    setBusy(true); setError('');
    try {
      if (action === 'check') {
        await api('/connections/check', json(form)); onMessage(t('连接成功'));
      } else if (action === 'delete') {
        await api(`/connections/${form.id}`, { method: 'DELETE' });
        setConnections(previous => previous.filter(value => value.id !== form.id)); setForm(initial()); onMessage(t('连接已删除'));
      } else if (action === 'import') {
        const result = await api('/connections/import-myquery', json({}));
        setConnections(await api('/connections')); onMessage(t('已导入 {0} 个连接', result.imported));
      } else {
        const value = await api(form.id ? `/connections/${form.id}` : '/connections', { ...json(form), method: form.id ? 'PUT' : 'POST' });
        setConnections(previous => [...previous.filter(item => item.id !== value.id), value]); setForm({ ...value, password: undefined }); onMessage(t('已保存'));
      }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="settings-card connections-settings dynamic-source">
    <h3>{t('连接关联')}</h3>
    <fieldset disabled={busy}>
      <label>{t('已保存连接')}<SearchSelect label={t('已保存连接')} value={form.id || ''} options={connections.map(value => ({ value: value.id!, label: `${value.name} · ${value.redshift ? 'Redshift' : 'PostgreSQL'}` }))} placeholder={t('选择已保存的连接')} onChange={id => { const value = connections.find(item => item.id === id); setForm(value ? { ...value, password: undefined } : initial()); setError(''); }} /></label>
      <div className="connection-grid">
        <label>{t('连接名称')}<input value={form.name} maxLength={128} onChange={event => change({ name: event.target.value })} /></label>
        <label>{t('数据库类型')}<select value={form.redshift ? 'redshift' : 'postgresql'} onChange={event => { const redshift = event.target.value === 'redshift'; change({ redshift, port: form.port === 5432 || form.port === 5439 ? redshift ? 5439 : 5432 : form.port }); }}><option value="postgresql">PostgreSQL</option><option value="redshift">Redshift</option></select></label>
        <label>{t('主机')}<input value={form.host} autoComplete="off" onChange={event => change({ host: event.target.value })} /></label>
        <label>{t('端口')}<input type="number" min={1} max={65535} value={Number.isNaN(form.port) ? '' : form.port} onChange={event => change({ port: event.target.valueAsNumber })} /></label>
        <label>{t('数据库')}<input value={form.database} onChange={event => change({ database: event.target.value })} /></label>
        <label>{t('用户名')}<input value={form.user} autoComplete="off" onChange={event => change({ user: event.target.value })} /></label>
        <label>{t('密码')}<input type="password" autoComplete="new-password" value={form.password ?? ''} placeholder={form.id ? t('留空保留已保存的密码') : ''} onChange={event => change({ password: event.target.value || (form.id ? undefined : '') })} /></label>
      </div>
      <div className="connection-checks"><label><input type="checkbox" checked={form.tls} onChange={event => change({ tls: event.target.checked })} />TLS</label><label><input type="checkbox" disabled={!form.tls} checked={form.trust_server_certificate} onChange={event => change({ trust_server_certificate: event.target.checked })} />{t('信任服务器证书')}</label>{form.id && <label><input type="checkbox" checked={form.password === ''} onChange={event => change({ password: event.target.checked ? '' : undefined })} />{t('清除已保存的密码')}</label>}</div>
      <div className="source-actions"><button onClick={() => { setForm(initial()); setError(''); }}>{t('新建')}</button><button className="primary" disabled={!ready} onClick={() => void run('save')}>{t('保存')}</button><button disabled={!ready} onClick={() => void run('check')}>{t('测试连接')}</button><button disabled={!form.id} onClick={() => void run('delete')}>{t('删除')}</button><button onClick={() => void run('import')}>{t('导入 MyQuery 连接')}</button></div>
    </fieldset>
    {error && <p role="alert" className="source-error">{error}</p>}
  </section>;
}
