import { describe, expect, it } from 'vitest';
import { findGridSpace, gridFor, canUseGrid } from './dashboard';
import type { Tile } from './dashboard';

const tile = { id: 'a', x: 0, y: 0, w: 6, h: 5 } as Tile;
describe('finite canvas grid', () => {
  it('keeps old dashboards on a compatible grid', () => {
    expect(gridFor({ charts: [tile], filters: [], datasets: [] })).toEqual({ columns: 12, rows: 20 });
  });
  it('finds a free rectangle without moving existing charts', () => {
    expect(findGridSpace([tile], 6, 5, { columns: 12, rows: 10 })).toEqual({ x: 6, y: 0 });
    expect(tile).toMatchObject({ x: 0, y: 0 });
  });
  it('rejects a full grid and shrinking across an existing chart', () => {
    expect(findGridSpace([tile], 6, 5, { columns: 6, rows: 5 })).toBeNull();
    expect(canUseGrid([tile], { columns: 4, rows: 5 })).toBe(false);
  });
});
it('places a pasted chart at the clicked cell without overlapping or escaping the canvas', () => {
  const occupied = [{ x: 0, y: 0, w: 6, h: 5 }] as Tile[];
  expect(findGridSpace(occupied, 6, 5, { columns: 12, rows: 20 }, { x: 6, y: 2 })).toEqual({ x: 6, y: 2 });
  expect(findGridSpace(occupied, 6, 5, { columns: 12, rows: 20 }, { x: 1, y: 2 })).toBeNull();
  expect(findGridSpace(occupied, 6, 5, { columns: 12, rows: 20 }, { x: 7, y: 16 })).toBeNull();
});
