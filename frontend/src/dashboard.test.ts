import { describe, expect, it } from 'vitest';
import { effectiveFilters } from './dashboard';
describe('chart filter scope', () => {
  const global = [{ field: 'region', op: 'eq', value: 'North' }];
  const local = [{ field: 'amount', op: 'between', value: [1, 10] }];
  it('inherits canvas filters', () => expect(effectiveFilters('global', global, local)).toEqual(global));
  it('isolates local filters', () => expect(effectiveFilters('local', global, local)).toEqual(local));
  it('combines both scopes', () => expect(effectiveFilters('both', global, local)).toEqual([...global, ...local]));
  it('applies inherited filters only to matching dataset fields', () => expect(effectiveFilters('both', global, local, ['amount'])).toEqual(local));
});
