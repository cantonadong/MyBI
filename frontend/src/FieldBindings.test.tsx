import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldBindings } from './FieldBindings';

const fields = [{ name: 'month', type: 'string' }, { name: 'sales', type: 'number' }, { name: 'profit', type: 'number' }, { name: 'orders', type: 'number' }];
afterEach(cleanup);
describe('chart field roles', () => {
  it('shows aliases while keeping original field keys in bindings', () => {
    const change = vi.fn();
    render(<FieldBindings config={{ type: 'bar' }} fields={[{ name: 'month', display_name: '月份', type: 'string' }, { name: 'sales', display_name: '销售额', type: 'number' }]} onChange={change} />);
    expect(within(screen.getByLabelText('X 轴')).getByRole('option', { name: '月份' })).toHaveValue('month');
    expect(within(screen.getByLabelText('Y 轴')).getByRole('option', { name: '销售额' })).toHaveValue('sales');
    fireEvent.change(screen.getByLabelText('Y 轴'), { target: { value: 'sales' } });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ measure: 'sales' }));
  });
  it('restricts every dimension and metric to its field types', () => {
    const typed = [...fields, { name: 'day', type: 'date' }, { name: 'count', type: 'integer' }, { name: 'flag', type: 'boolean' }];
    const { rerender } = render(<FieldBindings config={{ type: 'bar' }} fields={typed} onChange={() => {}} />);
    const values = (label: string) => within(screen.getByLabelText(label)).getAllByRole('option').map(option => option.textContent);
    expect(values('X 轴')).toEqual(['请选择', 'month', 'day']);
    expect(values('Y 轴')).toEqual(['请选择', 'sales', 'profit', 'orders', 'count']);
    rerender(<FieldBindings config={{ type: 'heatmap' }} fields={typed} onChange={() => {}} />);
    expect(values('Y 轴')).toEqual(['请选择', 'month', 'day']);
    expect(values('颜色数值')).toEqual(['请选择', 'sales', 'profit', 'orders', 'count']);
    rerender(<FieldBindings config={{ type: 'scatter' }} fields={typed} onChange={() => {}} />);
    expect(values('气泡大小（可选）')).toEqual(['请选择', 'sales', 'profit', 'orders', 'count']);
  });
  it('does not revive old Y metrics after changing a single-metric chart', () => {
    const change = vi.fn();
    render(<FieldBindings config={{ type: 'pie', measure: 'sales', measures: ['sales', 'profit'] }} fields={fields} onChange={change} />);
    fireEvent.change(screen.getByLabelText('Y 轴'), { target: { value: 'orders' } });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ measure: 'orders', measures: undefined }));
  });
  it('lets the primary metric be removed and promotes the remaining metric', () => {
    const change = vi.fn();
    render(<FieldBindings config={{ type: 'bar', measure: 'sales', measures: ['sales', 'profit'] }} fields={fields} onChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: '删除指标 1' }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ measure: 'profit', measures: ['profit'] }));
  });
  it('clears the last metric without silently choosing another field', () => {
    const change = vi.fn();
    render(<FieldBindings config={{ type: 'bar', measure: 'sales' }} fields={fields} onChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: '删除指标 1' }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ measure: undefined, measures: [] }));
  });
  it('offers multiple Y metrics without a confusing second dimension', () => {
    const change = vi.fn();
    render(<FieldBindings config={{ type: 'bar', dimension: 'month', measure: 'sales' }} fields={fields} onChange={change} />);
    expect(screen.queryByText(/第二维度/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加指标' }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ measures: ['sales', 'profit'], measure: 'sales' }));
  });
  it('labels the extra category by its actual heatmap purpose', () => {
    render(<FieldBindings config={{ type: 'heatmap' }} fields={fields} onChange={() => {}} />);
    expect(screen.getByLabelText('Y 轴')).toBeInTheDocument();
    expect(screen.getByLabelText('颜色数值')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加指标' })).not.toBeInTheDocument();
  });
});
