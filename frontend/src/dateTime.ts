import { translate } from './i18n';

// Default schedule timezone: the viewer's current system timezone (e.g. Pacific/Auckland, UTC+13 in daylight time).
export function localTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
// Default schedule time: 00:00 UTC expressed in the viewer's timezone (UTC+13 → 13:00).
export function defaultScheduleTime(): string {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return `${String(midnight.getHours()).padStart(2, '0')}:${String(midnight.getMinutes()).padStart(2, '0')}`;
}
export function formatUpdatedAt(value?: string | null, weekLocale?: string): string {
  if (!value) return '—';
  const date = new Date(value), today = new Date();
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (number: number) => String(number).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (weekLocale) {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7);
    const lastMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    if (date >= lastMonday && date < nextMonday) {
      const weekday = new Intl.DateTimeFormat(weekLocale, { weekday: 'short' }).format(date);
      return `${date < monday ? translate(weekLocale, '上{0}', [weekday]) : weekday} ${time}`;
    }
  }
  if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) return time;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}
