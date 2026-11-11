import { formatUpdatedAt } from './dateTime';
import { SavedReport } from './dashboard';
import { t, useLanguage } from './i18n';
import { Icon } from './Icon';
import { useState } from 'react';
import { Pagination } from './Pagination';

export function ReportsPage({ reports, drafts, busy, onEdit, onShare, onPublish, onView, onRestore, onDelete, onCopy, onNew }: { reports: SavedReport[]; drafts: string[]; busy: boolean; onEdit: (id: string) => void; onCopy: (id: string) => void; onShare: (id: string) => void; onPublish: (id: string) => void; onView: (id: string) => void; onRestore: (id: string) => void; onDelete: (report: SavedReport) => void; onNew: () => void }) {
  useLanguage();
  const [requestedPage, setPage] = useState(0);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(reports.length / 10) - 1));
  return <main className="reports-page" aria-label={t('报表页')}>
    <header className="reports-heading"><h2>{t('报表页')}</h2><button className="primary" disabled={busy} onClick={onNew}>{t('新建报表')}</button></header>
    <table className="reports-table"><thead><tr><th>{t('名称')}</th><th>ID</th><th>{t('页面')}</th><th>{t('更新时间')}</th><th>{t('Owner')}</th><th>{t('状态')}</th><th aria-label={t('操作')} /></tr></thead><tbody>
      {reports.length ? reports.slice(page * 10, (page + 1) * 10).map(report => <tr key={report.id}><td><button className="report-name" disabled={busy} onClick={() => onEdit(report.id)}>{report.name}</button></td><td className="report-id" title={report.storage_path}>{report.fingerprint || report.id}</td><td>{report.pages ?? 1}</td><td title={formatUpdatedAt(report.updated_at)}>{formatUpdatedAt(report.updated_at)}</td><td>{report.owner || '—'}</td><td>{drafts.includes(report.id) ? <a href={'/reports/' + encodeURIComponent(report.id) + '?draft=1'} onClick={event => { event.preventDefault(); if (!busy) onRestore(report.id); }} aria-disabled={busy}>{t('有未保存内容')}</a> : t(report.published ? '已发布' : '未发布')}</td><td>
        <div className="report-actions"><button disabled={busy || !report.published} onClick={() => onShare(report.id)}>{t('\u590d\u5236\u94fe\u63a5')}</button><button disabled={busy} onClick={() => onPublish(report.id)}><Icon name="publish" />{t('\u53d1\u5e03')}</button><button disabled={busy} onClick={() => onView(report.id)}><Icon name="view" />{t('\u67e5\u770b')}</button><button disabled={busy} onClick={() => onEdit(report.id)}><Icon name="edit" />{t('编辑')}</button><button disabled={busy} onClick={() => onCopy(report.id)}><Icon name="copy" />{t('\u590d\u5236')}</button><button className="report-delete" disabled={busy} onClick={() => onDelete(report)}><Icon name="delete" />{t('删除')}</button></div>
      </td></tr>) : <tr><td colSpan={7} className="reports-empty">{t('暂无已保存的报表')}</td></tr>}
    </tbody></table>
    <Pagination page={page} total={reports.length} onChange={setPage} disabled={busy} />
  </main>;
}
