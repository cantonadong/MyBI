import { describe, expect, it } from 'vitest';
import { effectiveFilters, followedFilterIds, nextFilterTitle, type Dataset, type Tile } from './dashboard';

describe('canvas filter following', () => {
  const dataset: Dataset = { id: 'data', name: 'Data', row_count: 0, schema: [{ name: 'region', type: 'string' }, { name: 'day', type: 'date' }] };
  const tile = (id: string, y: number, type: 'bar' | 'filter' = 'bar'): Tile => ({ id, y, x: 0, w: 4, h: 2, datasetId: 'data', config: { type, dimension: 'region' }, filterMode: 'global', filters: [] });
  const a = tile('a', 0, 'filter'), b = tile('b', 10, 'filter');
  it('groups charts under the nearest filter and updates after moving', () => {
    const chart = tile('chart', 5);
    expect(followedFilterIds(chart, [a, b, chart], dataset)).toEqual(['a']);
    expect(followedFilterIds({ ...chart, y: 15 }, [a, b], dataset)).toEqual(['b']);
    expect(followedFilterIds({ ...chart, followFilterIds: ['b'] }, [a, b], dataset)).toEqual(['b']);
    expect(followedFilterIds({ ...chart, followFilterIds: [] }, [a, b], dataset)).toEqual([]);
  });
  it('does not fall back to earlier filters when the nearest dimension does not match', () => {
    const mismatch = { ...b, config: { ...b.config, dimension: 'day' } };
    const chart = tile('chart', 15);
    expect(followedFilterIds(chart, [a, mismatch], dataset)).toEqual([]);
    expect(followedFilterIds({ ...chart, followFilterIds: ['b'] }, [a, mismatch], dataset)).toEqual([]);
    expect(followedFilterIds(chart, [a, { ...b, datasetId: 'other' }], dataset)).toEqual([]);
  });
  it('numbers newly added and copied filters after the highest existing suffix', () => {
    expect(nextFilterTitle([])).toMatch(/ 1$/);
    expect(nextFilterTitle([{ ...a, config: { ...a.config, title: 'Filter 8' } }, b])).toMatch(/ 9$/);
  });
});
describe('chart filter scope', () => {
  const global = [{ field: 'region', op: 'eq', value: 'North' }];
  const local = [{ field: 'amount', op: 'between', value: [1, 10] }];
  it('inherits canvas filters', () => expect(effectiveFilters('global', global, local)).toEqual(global));
  it('isolates local filters', () => expect(effectiveFilters('local', global, local)).toEqual(local));
  it('combines both scopes', () => expect(effectiveFilters('both', global, local)).toEqual([...global, ...local]));
  it('applies inherited filters only to matching dataset fields', () => expect(effectiveFilters('both', global, local, ['amount'])).toEqual(local));
});
