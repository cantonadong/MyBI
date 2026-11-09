import { getChartLocale, getLocale } from './i18n';
export type FieldFormat = { kind: 'integer' | 'decimal' | 'text'; format: 'number' | 'percent'; decimals: number; rounding?: 'halfExpand' | 'trunc'; dateFormat?: string; valueLabels?: Record<string, string> };
export type FieldFormats = Record<string, FieldFormat>;
export const dateFormats = ['yyyy-MM-dd', 'MMM d', 'MMM d, yyyy', 'yyMMdd', 'yyyyMMdd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd', 'yyyy-MM'];
const numberFormats = new Map<string, Intl.NumberFormat>();

export function parseCategoryOrder(text: string): Map<string, number> {
  const entries = text.match(/"(?:[^"]|"")*"|[^\r\n\t,，;；、]+/g) || [];
  const names = [...new Set(entries.map(value => value.trim().replace(/^"(.*)"$/s, '$1').replace(/""/g, '"').trim()).filter(Boolean))];
  return new Map(names.map((name, index) => [name, index]));
}

export function metricFormat(config: { type?: string; aggregation?: string; metricAggregations?: Record<string, string>; fieldFormats?: FieldFormats }, field: string): FieldFormat | undefined {
  if (['count', 'count_distinct'].includes(config.metricAggregations?.[field] || config.aggregation || '') && !['table', 'scatter', 'boxplot', 'histogram', 'candlestick'].includes(config.type || '')) return { kind: 'integer', format: 'number', decimals: 0 };
  return config.fieldFormats?.[field];
}

export function formatChartField(value: unknown, format?: FieldFormat, locale = getChartLocale()): string {
  return formatField(value, format, locale);
}

export function formatField(value: unknown, format?: FieldFormat, locale = getLocale()): string {
  const label = format?.valueLabels?.[JSON.stringify(value)];
  if (label?.trim()) return label.trim();
  if (value === null || value === undefined) return 'NULL';
  if (format?.dateFormat && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isNaN(date.getTime())) {
      const parts: Record<string, string> = { yyyy: value.slice(0, 4), yy: value.slice(2, 4), MM: value.slice(5, 7), dd: value.slice(8, 10), d: String(date.getUTCDate()), MMM: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date) };
      return format.dateFormat.replace(/yyyy|MMM|yy|MM|dd|d/g, token => parts[token]);
    }
  }
  if (typeof value !== 'number' || format?.kind === 'text') return String(value);
  if (!Number.isFinite(value)) return '—';
  const decimals = format?.kind === 'integer' ? 0 : format ? Math.max(1, Math.min(4, format.decimals)) : Number.isInteger(value) ? 0 : 1;
  const style = format?.format === 'percent' ? 'percent' : 'decimal', roundingMode = format?.rounding || 'halfExpand', key = locale + style + decimals + roundingMode;
  const options: Intl.NumberFormatOptions & { roundingMode: string } = { style, minimumFractionDigits: decimals, maximumFractionDigits: decimals, roundingMode };
  if (!numberFormats.has(key)) numberFormats.set(key, new Intl.NumberFormat(locale, options));
  return numberFormats.get(key)!.format(value);
}
