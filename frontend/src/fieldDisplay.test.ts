import { describe, expect, it } from 'vitest';
import { formatField, metricFormat } from './fieldDisplay';

describe('shared field display', () => {
  it('rounds or truncates decimals and percentages, including negative values', () => {
    const format = { kind: 'decimal' as const, format: 'number' as const, decimals: 1 };
    expect(formatField(1.25, format)).toBe('1.3');
    expect(formatField(-1.29, { ...format, rounding: 'trunc' })).toBe('-1.2');
    expect(formatField(.1299, { ...format, format: 'percent', rounding: 'trunc' })).toBe('12.9%');
    expect(formatField(.1299, { ...format, format: 'percent' })).toBe('13.0%');
  });
  it('uses count units for derived count KPIs', () => {
    const config = { measure: 'rate', aggregation: 'count' as const, fieldFormats: { rate: { kind: 'decimal' as const, format: 'percent' as const, decimals: 2 } } };
    expect(formatField(3, metricFormat(config, 'rate'))).toBe('3');
  });
  it('formats decimals and percentages without mutating values', () => {
    const value = .1234;
    expect(formatField(value, { kind: 'decimal', format: 'percent', decimals: 1 })).toBe('12.3%');
    expect(formatField(value, { kind: 'decimal', format: 'number', decimals: 1 })).toBe('0.1');
    expect(formatField(1234, { kind: 'integer', format: 'number', decimals: 0 })).toBe('1,234');
    expect(value).toBe(.1234);
  });
  it('preserves null, text identifiers, dates and booleans', () => {
    expect(formatField(null)).toBe('NULL');
    expect(formatField('00123', { kind: 'text', format: 'number', decimals: 1 })).toBe('00123');
    expect(formatField('2026-10-23')).toBe('2026-10-23');
    expect(formatField(false)).toBe('false');
  });
});
