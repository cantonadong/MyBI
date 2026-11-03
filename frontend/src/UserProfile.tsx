import { useEffect, useState } from 'react';
import { api, json } from './dashboard';
import { t } from './i18n';

export function UserProfile({ onMessage }: { onMessage: (message: string) => void }) {
  const [profile, setProfile] = useState({ display_name: '', email: '', avatar: '' });
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/profile').then(value => { if (active) { setProfile(value); setSaved(JSON.stringify(value)); setLoaded(true); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  return <section className="settings-card user-profile"><h3>{t('用户管理')}</h3><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { const value = await api('/profile', { ...json(profile), method: 'PUT' }); setProfile(value); setSaved(JSON.stringify(value)); onMessage(t('用户资料已保存')); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }}><fieldset disabled={!loaded || busy}>
    <div className="profile-avatar">{profile.avatar ? <img src={profile.avatar} alt={t('头像')} /> : <span>{profile.display_name.slice(0, 1).toUpperCase() || '?'}</span>}<label className="profile-upload">{t('上传头像')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { onMessage(t('请选择不超过 2 MB 的 PNG、JPEG 或 WebP 图片')); return; }
      const reader = new FileReader();
      reader.onload = () => setProfile(previous => ({ ...previous, avatar: String(reader.result) }));
      reader.onerror = () => onMessage(t('头像读取失败'));
      reader.readAsDataURL(file);
    }} /></label>{profile.avatar && <button type="button" onClick={() => setProfile(previous => ({ ...previous, avatar: '' }))}>{t('移除头像')}</button>}</div>
    <label>{t('显示名')}<input required maxLength={255} value={profile.display_name} onChange={event => setProfile({ ...profile, display_name: event.target.value })} /></label>
    <label>{t('邮箱')}<input type="email" maxLength={255} value={profile.email} onChange={event => setProfile({ ...profile, email: event.target.value })} /></label>
    <button className="primary" disabled={!profile.display_name.trim() || JSON.stringify(profile) === saved}>{busy ? t('保存中…') : t('保存')}</button>
  </fieldset>{error && <p role="alert">{error}</p>}</form></section>;
}
