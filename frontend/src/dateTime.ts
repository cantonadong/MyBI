export function formatUpdatedAt(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value), today = new Date();
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (number: number) => String(number).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) return time;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}
