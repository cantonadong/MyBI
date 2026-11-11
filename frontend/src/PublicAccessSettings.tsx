import { useEffect, useState } from 'react';
import { api, json } from './dashboard';
import { t } from './i18n';

export function PublicAccessSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const [value, setValue] = useState({ enabled: false, port: 8001, base_url: '', running: false, listening_port: 8001, error: '', public_ip: '', access_url: '' });
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/public-access').then(result => { if (active) { setValue(result); setLoaded(true); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  return <section id="settings-public-access" className="settings-card public-access-settings"><h3>{t('报表对外访问')}</h3><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { setValue(await api('/public-access', { ...json({ enabled: value.enabled, port: value.port, base_url: value.base_url }), method: 'PUT' })); onMessage(t('对外访问设置已保存')); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }}><fieldset disabled={!loaded || busy}>
    <label><span>{t('启用只读服务')}</span><input type="checkbox" checked={value.enabled} onChange={event => setValue({ ...value, enabled: event.target.checked })} /></label>
    <label><span>{t('监听端口')}</span><input type="number" required min={1} max={65535} step={1} value={Number.isNaN(value.port) ? '' : value.port} onChange={event => setValue({ ...value, port: event.target.valueAsNumber })} /></label>
    <label><span>{t('公网 IP（自动识别）')}</span><span>{value.public_ip || t('暂未识别到公网 IP')}</span><button type="button" onClick={async () => {
      setBusy(true); setError('');
      try { const result = await api('/public-access?refresh_ip=true'); setValue(previous => ({ ...previous, public_ip: result.public_ip, access_url: result.access_url, running: result.running, listening_port: result.listening_port })); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }}>{t('重新识别')}</button></label>
    <label><span>{t('域名（可选）')}</span><input type="text" maxLength={2048} placeholder="example.com" value={value.base_url} onChange={event => setValue({ ...value, base_url: event.target.value })} /></label>
    <p>{t('域名留空时自动使用公网 IP 和监听端口。HTTP 域名未指定端口时使用监听端口；HTTPS 需自行配置反向代理和证书。')}</p>
    <p>{t('当前分享地址')}：{value.access_url || t('暂未识别到公网 IP')}</p>
    <p>{t('公网 IP 访问需要防火墙放行；有路由器时还需端口转发。仅允许查看已发布报表。')}</p>
    <button className="primary">{busy ? t('保存中…') : t('保存')}</button>
  </fieldset><p role="status">{t(value.running ? '只读服务运行中' : '只读服务未运行')}{value.running && ` · 0.0.0.0:${value.listening_port}`}</p>{(error || value.error) && <p role="alert">{error || value.error}</p>}</form></section>;
}

export async function copyPublicReportLink(reportId: string) {
  const settings = await api('/public-access');
  if (!settings.enabled || !settings.running) throw new Error(t('请先在设置中启用只读服务'));
  if (!settings.access_url) throw new Error(t('公网 IP 识别失败，请在设置中重新识别或填写域名'));
  const link = settings.access_url + '/view/' + encodeURIComponent(reportId);
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(link); return; }
  const input = document.createElement('textarea');
  input.value = link; input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.appendChild(input);
  try { input.select(); if (!document.execCommand('copy')) throw new Error(t('复制链接失败')); }
  finally { input.remove(); }
}
