import { expect, it } from 'vitest';
import { optionFor } from './options';

it.each([false, true])('joins consecutive annotation dates and preserves real gaps (descending: %s)', descending => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ day: `2026-10-${String(index + 9).padStart(2, '0')}`, amount: index + 1 }));
  if (descending) rows.reverse();
  const option = optionFor({ type: 'line', dimension: 'day', measure: 'amount', annotations: [
    { label: 'A', start: '2026-10-09', end: '2026-10-10' },
    { label: 'B', start: '2026-10-11', end: '2026-10-11' },
    { label: 'C', start: '2026-10-13', end: null },
  ] }, rows);
  const series = option.series.at(-1);
  const api = { coord: ([value]: number[]) => [value * 100, 0] };
  const rendered = series.data.map((_: unknown, dataIndex: number) => series.renderItem({ dataIndex, coordSys: { x: 0, y: 40, width: 500, height: 150 } }, api));
  const [left, right] = descending ? [rendered[1], rendered[2]] : [rendered[0], rendered[1]];
  expect(left.children[0].shape.x + left.children[0].shape.width).toBe(right.children[0].shape.x);
  expect(left.children[1].shape.y).toBe(right.children[1].shape.y);
  const gapLeft = descending ? rendered[0] : rendered[1], gapRight = descending ? rendered[1] : rendered[2];
  expect(gapLeft.children[0].shape.x + gapLeft.children[0].shape.width).toBeLessThan(gapRight.children[0].shape.x);
});
