import { afterEach, expect, it, vi } from 'vitest';
import { formatUpdatedAt } from './dateTime';

afterEach(() => { vi.useRealTimers(); });

it('shows local minutes today and the full date on other days', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 12, 0));
  expect(formatUpdatedAt(new Date(2026, 10, 11, 8, 5).toISOString())).toBe('08:05');
  expect(formatUpdatedAt(new Date(2026, 10, 10, 8, 5).toISOString())).toBe('2026-11-10 08:05');
});
