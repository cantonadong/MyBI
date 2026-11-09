import { t } from './i18n';
import type { AnnotationFields } from './dashboard';

export type AnnotationRole = keyof AnnotationFields;

export function AnnotationImport({ checked, busy, onChecked }: { checked: boolean; busy: boolean; onChecked: (value: boolean) => void }) {
  return <div className="annotation-import">
    <label><input type="checkbox" checked={checked} disabled={busy} onChange={event => onChecked(event.target.checked)} />{t('作为 Annotation')}</label>
    {checked && <p className="source-hint">{t('在字段配置中设置 Annotation 字段与顺序；日期允许 NULL，表示无边界。')}</p>}
  </div>;
}
