import { SavedReport } from './dashboard';
import { t, useLanguage } from './i18n';
import { Icon } from './Icon';

export function ReportsPage({ reports, drafts, busy, onEdit, onPublish, onView, onRestore, onDelete, onCopy, onNew }: { reports: SavedReport[]; drafts: string[]; busy: boolean; onEdit: (id: string) => void; onCopy: (id: string) => void; onPublish: (id: string) => void; onView: (id: string) => void; onRestore: (id: string) => void; onDelete: (report: SavedReport) => void; onNew: () => void }) {
  const { locale } = useLanguage();
  return <main className="reports-page" aria-label={t('报表页')}>
    <header className="reports-heading"><h2>{t('报表页')}</h2><button className="primary" disabled={busy} onClick={onNew}>{t('新建报表')}</button></header>
    <table className="reports-table"><thead><tr><th>{t('名称')}</th><th>{t('\u62a5\u8868 ID')}</th><th>{t('时间')}</th><th>Owner</th><th>{t('状态')}</th><th>{t('操作')}</th></tr></thead><tbody>
      {reports.length ? reports.map(report => <tr key={report.id}><td><button className="report-name" disabled={busy} onClick={() => onEdit(report.id)}>{report.name}</button></td><td className="report-id">{report.id}</td><td>{report.updated_at ? new Date(report.updated_at).toLocaleString(locale) : '—'}</td><td>{report.owner || '—'}</td><td>{drafts.includes(report.id) ? <a href={'/reports/' + encodeURIComponent(report.id) + '?draft=1'} onClick={event => { event.preventDefault(); if (!busy) onRestore(report.id); }} aria-disabled={busy}>{t('有未保存内容')}</a> : '—'}</td><td>
        <div className="report-actions"><button disabled={busy} onClick={() => onPublish(report.id)}><Icon name="publish" />{t('\u53d1\u5e03')}</button><button disabled={busy} onClick={() => onView(report.id)}><Icon name="view" />{t('\u67e5\u770b')}</button><button disabled={busy} onClick={() => onEdit(report.id)}><Icon name="edit" />{t('编辑')}</button><button disabled={busy} onClick={() => onCopy(report.id)}><Icon name="copy" />{t('\u590d\u5236')}</button><button className="report-delete" disabled={busy} onClick={() => onDelete(report)}><Icon name="delete" />{t('删除')}</button></div>
      </td></tr>) : <tr><td colSpan={6} className="reports-empty">{t('暂无已保存的报表')}</td></tr>}
    </tbody></table>
  </main>;
}
