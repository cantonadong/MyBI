import { t } from './i18n';
import type { AnnotationFields } from './dashboard';

export type AnnotationRole = keyof AnnotationFields;

export function AnnotationImport({ checked, busy, onChecked, merge, onMerge }: { merge: boolean; onMerge: (value: boolean) => void; checked: boolean; busy: boolean; onChecked: (value: boolean) => void }) {
  return <div className="annotation-import">
    <label><input type="checkbox" checked={checked} disabled={busy} onChange={event => onChecked(event.target.checked)} />{t('作为 Annotation')}</label>
    {checked && <label><input type="checkbox" checked={merge} disabled={busy} onChange={event => onMerge(event.target.checked)} />{t('自动合并相邻区间')}</label>}{checked && <p className="source-hint">{t('设置标签、开始日期、结束日期及可选 comment；多余列保存时舍弃，日期允许 NULL。')}</p>}
  </div>;
}
