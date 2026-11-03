import { useEffect, useRef, useState } from 'react';
import { api, json } from './dashboard';
import { getLocale, t } from './i18n';
import { Icon } from './Icon';

type Comment = { id: string; author: string; avatar: string; content: string; created_at: string; can_edit: boolean };
export function CommentsPanel({ reportId, chartId, onClose, onCount }: { reportId: string; chartId: string; onClose: () => void; onCount: (count: number) => void }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState('');
  const [editContent, setEditContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);
  const path = `/dashboards/${reportId}/charts/${chartId}/comments`;
  useEffect(() => {
    if (!reportId) { setLoading(false); return; }
    let active = true;
    api(path).then(value => { if (active) { setItems(value); onCount(value.length); } }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, reportId]);
  return <div className="comments-panel"><header><h3>{t('评论')}</h3><button aria-label={t('关闭评论')} onClick={onClose}><Icon name="close" /></button></header>
    <form onSubmit={async event => {
      event.preventDefault(); if (!content.trim() || busy) return;
      setBusy(true); setError('');
      try { await api(path, json({ content })); setContent(''); const value = await api(path); setItems(value); onCount(value.length); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }}><textarea aria-label={t('评论内容')} placeholder={t('写下评论…')} maxLength={5000} value={content} disabled={busy} onChange={event => setContent(event.target.value)} /><button className="primary" disabled={!reportId || busy || loading || !content.trim()}>{busy ? t('发送中…') : t('发表评论')}</button></form>
    {!reportId && <p>{t('请先保存报表再发表评论')}</p>}{error && <p role="alert">{error}</p>}
    <div className={`comments-list ${scrolling ? 'is-scrolling' : ''}`} onScroll={() => { setScrolling(true); window.clearTimeout(scrollTimer.current); scrollTimer.current = window.setTimeout(() => setScrolling(false), 800); }}>{loading ? <p>{t('加载中…')}</p> : !items.length ? <p>{t('暂无评论')}</p> : items.map(item => <article key={item.id} className={`comment ${item.can_edit ? 'comment-own' : 'comment-other'}`}><div className="comment-author" title={item.author} aria-label={item.author}>{item.avatar ? <img src={item.avatar} alt={item.author} /> : <span className="comment-avatar">{item.author.slice(0, 1)}</span>}</div><div className={`comment-bubble ${item.can_edit ? 'own-comment' : ''}`} title={new Date(item.created_at).toLocaleString(getLocale())}>{editing === item.id ? <textarea autoFocus aria-label={t('\u4fee\u6539\u8bc4\u8bba')} maxLength={5000} value={editContent} disabled={busy} onChange={event => setEditContent(event.target.value)} onKeyDown={async event => {
      if (event.key === 'Escape') { setEditing(''); return; }
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (busy || !editContent.trim()) return;
      setBusy(true); setError('');
      try { await api(path + '/' + item.id, { ...json({ content: editContent }), method: 'PUT' }); setItems(previous => previous.map(comment => comment.id === item.id ? { ...comment, content: editContent.trim() } : comment)); setEditing(''); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }} /> : <>{item.content}{item.can_edit && <span className="comment-actions"><button className="comment-edit" disabled={busy} onClick={() => { setEditing(item.id); setEditContent(item.content); }}>{t('\u4fee\u6539')}</button><button className="comment-delete" disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true); setError('');
      try { await api(path + '/' + item.id, { method: 'DELETE' }); const remaining = items.filter(comment => comment.id !== item.id); setItems(remaining); onCount(remaining.length); }
      catch (error) { setError((error as Error).message); }
      finally { setBusy(false); }
    }}>{t('\u5220\u9664')}</button></span>}</>}</div></article>)}</div>
  </div>;
}
