import { t } from './i18n';

export function Pagination({ page, total, onChange, disabled = false }: { page: number; total: number; onChange: (page: number) => void; disabled?: boolean }) {
  return <div className="table-pagination"><button disabled={disabled || !page} onClick={() => onChange(page - 1)}>{t('上一页')}</button><span>{t('第 {0} / {1} 页', page + 1, Math.max(1, Math.ceil(total / 10)))}</span><button disabled={disabled || (page + 1) * 10 >= total} onClick={() => onChange(page + 1)}>{t('下一页')}</button></div>;
}
