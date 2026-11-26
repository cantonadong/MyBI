import type { ReactNode } from 'react';
import { t } from './i18n';
import type { AnnotationFields } from './dashboard';

export type AnnotationRole = keyof AnnotationFields;

export function AnnotationImport({ checked, busy, onChecked, merge, onMerge, children }: { children?: ReactNode; merge: boolean; onMerge: (value: boolean) => void; checked: boolean; busy: boolean; onChecked: (value: boolean) => void }) {
  return <div className="annotation-import">
    <label><input type="checkbox" checked={checked} disabled={busy} onChange={event => onChecked(event.target.checked)} />{t('作为标注')}</label>
    {checked && <label><input type="checkbox" checked={merge} disabled={busy} onChange={event => onMerge(event.target.checked)} />{t('自动合并相邻区间')}</label>}
    {children}
  </div>;
}
