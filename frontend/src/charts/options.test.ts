import { describe, expect, it } from 'vitest';
import { optionFor } from './options';
import { chartRegistry } from './registry';
const rows = [{ region: 'A', target: 'B', amount: 10, profit: 3 }, { region: 'A', target: 'C', amount: 20, profit: 5 }];
describe('chart adapters', () => {
  it('separates a small bar value from a ratio without moving labels in other categories', () => {
    const option = optionFor({ type: 'mixed', dimension: 'day', measure: 'users', measures: ['users', 'ratio'], metricSeries: [{ type: 'bar', axis: 'left' }, { type: 'line', axis: 'right' }], labels: true, labelDensity: 'all' }, [{ day: 'Oct 20', users: 40, ratio: .001 }]);
    const bar = { seriesIndex: 0, dataIndex: 0, text: '40', labelRect: { x: 100, y: 210, width: 18, height: 14 } };
    const ratio = { seriesIndex: 1, dataIndex: 0, text: '0.1%', labelRect: { x: 95, y: 208, width: 32, height: 14 } };
    expect(option.series[0].labelLayout(bar).y).toBeUndefined();
    const moved = option.series[1].labelLayout(ratio);
    expect(moved.hideOverlap).toBe(false);
    expect(moved.y + ratio.labelRect.height + 4 <= bar.labelRect.y || moved.y >= bar.labelRect.y + bar.labelRect.height + 4).toBe(true);
    expect(option.series[1].labelLayout({ ...ratio, dataIndex: 1, labelRect: { ...ratio.labelRect, x: 300 } }).y).toBeUndefined();
    expect(option.series[0].labelLayout(bar).y).toBeUndefined();
    expect(option.series.map((series: any) => series.data)).toEqual([[40], [.001]]);
  });
  it('separates horizontal labels along the value axis', () => {
    const option = optionFor({ type: 'bar', horizontal: true, dimension: 'region', measure: 'amount', labels: true, labelDensity: 'all' }, rows);
    const label = { seriesIndex: 0, dataIndex: 0, text: '40', labelRect: { x: 100, y: 80, width: 20, height: 14 } };
    option.series[0].labelLayout(label);
    const moved = option.series[0].labelLayout({ ...label, dataIndex: 1 });
    expect(moved.x + 24 <= 100 || moved.x >= 124).toBe(true);
    expect(moved.y).toBe(80);
  });
  it('keeps missing numeric categories distinct from zero', () => {
    const option = optionFor({ type: 'bar', dimension: 'ratio', measure: 'amount', fieldFormats: { ratio: { kind: 'decimal', format: 'percent', decimals: 2 } } }, [{ ratio: null, amount: 1 }, { ratio: 0, amount: 2 }]);
    expect(option.xAxis.data.map(option.xAxis.axisLabel.formatter)).toEqual(['NULL', '0.00%']);
    expect(option.series[0].tooltip.formatter({ name: option.xAxis.data[0], value: 1, seriesName: 'amount' })).toContain('NULL');
  });
  it('keeps histogram boundary precision and frequency units', () => {
    const option = optionFor({ type: 'histogram', measure: 'ratio', fieldFormats: { ratio: { kind: 'decimal', format: 'percent', decimals: 2 } } }, [{ __bin: .001, __count: 4 }, { __bin: .004, __count: 5 }]);
    expect(option.xAxis.data.map(option.xAxis.axisLabel.formatter)).toEqual(['0.10%', '0.40%']);
    expect(option.series[0].tooltip.valueFormatter(4)).toBe('4');
  });
  it('formats derived counts as counts instead of percentages', () => {
    for (const aggregation of ['count', 'count_distinct'] as const) {
      const option = optionFor({ type: 'bar', dimension: 'region', measure: 'ratio', aggregation, labels: true, fieldFormats: { ratio: { kind: 'decimal', format: 'percent', decimals: 2 } } }, [{ region: 'A', ratio: 3 }]);
      expect(option.yAxis.axisLabel.formatter(3)).toBe('3');
      expect(option.series[0].label.formatter({ value: 3, dataIndex: 0 })).toBe('3');
      expect(option.series[0].tooltip.valueFormatter(3)).toBe('3');
    }
  });
  it('formats tooltip category names and all scatter dimensions using their own fields', () => {
    const fieldFormats = { x: { kind: 'decimal' as const, format: 'percent' as const, decimals: 2 }, y: { kind: 'decimal' as const, format: 'percent' as const, decimals: 1 }, size: { kind: 'integer' as const, format: 'number' as const, decimals: 0 } };
    const bar = optionFor({ type: 'bar', dimension: 'x', measure: 'y', fieldFormats }, [{ x: .12, y: .34 }]);
    expect(bar.series[0].tooltip.formatter({ name: '0.12', value: .34, seriesName: 'y' })).toContain('12.00%');
    const scatter = optionFor({ type: 'scatter', dimension: 'x', measure: 'y', secondMeasure: 'size', fieldFormats }, [{ x: .12, y: .34, size: 7 }]);
    const tooltip = scatter.series[0].tooltip.formatter({ value: [.12, .34, 7] });
    expect(tooltip).toContain('x: 12.00%');
    expect(tooltip).toContain('y: 34.0%');
    expect(tooltip).toContain('size: 7');
  });
  it('uses each metric format for labels and tooltips, not one shared chart format', () => {
    const option = optionFor({ type: 'bar', dimension: 'region', measure: 'amount', measures: ['amount', 'profit'], labels: true, fieldFormats: { amount: { kind: 'decimal', format: 'percent', decimals: 1 }, profit: { kind: 'integer', format: 'number', decimals: 0 } } }, rows);
    expect(option.series[0].label.formatter({ value: .1234, dataIndex: 0 })).toBe('12.3%');
    expect(option.series[1].label.formatter({ value: 3, dataIndex: 0 })).toBe('3');
    expect(option.series[0].tooltip.valueFormatter(.1234)).toBe('12.3%');
    expect(option.series[1].tooltip.valueFormatter(3)).toBe('3');
    expect(option.yAxis.axisLabel.formatter(.1234)).toBe('12.3%');
  });
  it('shows fewer labels in a narrow chart without removing data', () => {
    const observations = Array.from({ length: 30 }, (_, i) => ({ region: String(i), amount: 1000 + i }));
    const config = { type: 'bar' as const, dimension: 'region', measure: 'amount', labels: true };
    const narrow = optionFor(config, observations, 'map', { width: 300, height: 300 });
    const wide = optionFor(config, observations, 'map', { width: 1200, height: 300 });
    const visible = (option: any) => observations.filter((row, i) => option.series[0].label.formatter({ value: row.amount, dataIndex: i })).length;
    expect(visible(narrow)).toBeLessThan(visible(wide));
    expect(narrow.series[0].data).toHaveLength(30);
    expect(wide.series[0].data).toHaveLength(30);
  });
  it('renders more than two metrics with legend grouping', () => {
    const result = optionFor({ type: 'line', dimension: 'month', measure: 'sales', measures: ['sales', 'profit', 'orders'], legendField: 'region' }, [
      { month: 'Jan', region: 'A', sales: 10, profit: 3, orders: 2 },
      { month: 'Feb', region: 'A', sales: 20, profit: 7, orders: 4 },
    ]);
    expect(result.series.map((series: any) => [series.name, series.data])).toEqual([
      ['A · sales', [10, 20]], ['A · profit', [3, 7]], ['A · orders', [2, 4]],
    ]);
  });
  it('maps X, Y and legend categories into aligned series', () => {
    const option = optionFor({ type: 'bar', dimension: 'month', measure: 'sales', legendField: 'region' }, [
      { month: 'Jan', region: 'North', sales: 10 },
      { month: 'Jan', region: 'South', sales: 20 },
      { month: 'Feb', region: 'North', sales: 30 },
    ]);
    expect(option.xAxis.data).toEqual(['Jan', 'Feb']);
    expect(option.series.map((series: any) => ({ name: series.name, data: series.data }))).toEqual([
      { name: 'North', data: [10, 30] }, { name: 'South', data: [20, null] },
    ]);
  });
  for (const { id } of chartRegistry.filter(c => !['table', 'kpi', 'map'].includes(c.id))) {
    it(`builds ${id} with its own series`, () => {
      const result = optionFor({ type: id, dimension: 'region', measure: 'amount', secondDimension: 'target', secondMeasure: 'profit' }, rows);
      const expected = { area: 'line', mixed: 'bar', waterfall: 'custom', histogram: 'bar' }[id as string] || id;
      expect(result.series.some((s: any) => s.type === expected)).toBe(true);
    });
  }
  it('computes boxplot quartiles from observations', () => {
    const result = optionFor({ type: 'boxplot', dimension: 'region', measure: 'amount' }, [1, 2, 3, 4, 5].map(amount => ({ region: 'A', amount })));
    expect(result.series[0].data).toEqual([[1, 2, 3, 4, 5]]);
  });
  it('preserves histogram observation counts', () => {
    expect(optionFor({ type: 'histogram', measure: 'amount' }, rows).series[0].data.reduce((a: number, b: number) => a + b, 0)).toBe(2);
  });
  it('rejects cyclic Sankey inputs', () => {
    expect(() => optionFor({ type: 'sankey', dimension: 'region', secondDimension: 'target', measure: 'amount' }, [{ region: 'A', target: 'B', amount: 1 }, { region: 'B', target: 'A', amount: 1 }])).toThrow('循环');
  });
  it('draws waterfall spans crossing zero at their actual endpoints', () => {
    const series = optionFor({ type: 'waterfall', dimension: 'region', measure: 'amount' }, [{ region: 'A', amount: 10 }, { region: 'B', amount: -20 }]).series[0];
    expect(series.data).toEqual([[0, 0, 10], [1, 10, -10]]);
  });
});

it('renders the same metric as independent bar and line series', () => {
  const option = optionFor({ type: 'mixed', dimension: 'region', measure: 'amount', measures: ['amount', 'amount'], metricSeries: [{ type: 'bar', axis: 'left' }, { type: 'line', axis: 'right' }] }, rows);
  expect(option.series.map((series: any) => series.type)).toEqual(['bar', 'line']);
  expect(option.series.map((series: any) => series.yAxisIndex)).toEqual([0, 1]);
  expect(option.series[0].data).toEqual(option.series[1].data);
  expect(option.series[0].name).not.toBe(option.series[1].name);
});
it('applies scatter label visibility, density and units', () => {
  const option = optionFor({ type: 'scatter', dimension: 'profit', measure: 'amount', labels: true, labelDensity: '1', labelUnit: 'k' }, rows);
  expect(option.series[0].label.show).toBe(true);
  expect(option.series[0].label.formatter({ value: [1000, 2000], dataIndex: 0 })).toBe('1.0K, 2.0K');
  expect(option.series[0].label.formatter({ value: [1000, 2000], dataIndex: 1 })).toBe('');
});

it('highlights weekend dates without changing weekday labels or source values', () => {
  const dates = [{ day: '2026-10-02', amount: 1 }, { day: '2026-10-03', amount: 2 }, { day: '2026-10-04', amount: 3 }];
  const option = optionFor({ type: 'bar', dimension: 'day', measure: 'amount', highlightWeekends: true }, dates);
  expect(option.xAxis.axisLabel.formatter('2026-10-02')).toBe('2026-10-02');
  expect(option.xAxis.axisLabel.formatter('2026-10-03')).toBe('2026-10-03');
  expect(option.xAxis.axisLabel.formatter('2026-10-04')).toBe('2026-10-04');
  expect(option.xAxis.splitArea.areaStyle.color).toEqual(['transparent', 'rgba(34, 197, 94, 0.06)', 'rgba(34, 197, 94, 0.06)']);
  expect(option.series[0].data).toEqual([1, 2, 3]);
});
