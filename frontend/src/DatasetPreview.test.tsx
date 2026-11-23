import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { FieldSettings } from './DatasetPreview';
import App from './App';
vi.mock('./charts/ChartView', () => ({ ChartView: () => <div /> }));
const dataset = { id: 'd', name: 'Data', version: 1, row_count: 30, schema: [{ name: 'rate', type: 'number' }, { name: 'name', type: 'string' }], field_formats: { rate: { kind: 'decimal', format: 'number', decimals: 1 } } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
it('shows a saved percentage format on integer storage as the percent subtype', () => {
  render(<FieldSettings schema={[{ name: 'ratio', type: 'integer' }]} rows={[{ ratio: 1 }]} formats={{ ratio: { kind: 'integer', format: 'percent', decimals: 2 } }} onChange={() => {}} />);
  expect(screen.getByLabelText('ratio 数值类型')).toHaveValue('percent');
  expect(screen.getByLabelText('ratio 小数位数')).toHaveValue('2');
  expect(screen.getByText('100.00%')).toBeInTheDocument();
});

async function setup(fail = false) {
  localStorage.clear(); window.history.replaceState(null, '', '/reports/r');
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    let result: unknown = [];
    if (url.endsWith('/dashboards/r')) result = { id: 'r', name: 'Report', version: 1, document: { charts: [], filters: [], datasets: [dataset] } };
    if (url.endsWith('/datasets/d')) result = dataset;
    if (url.endsWith('/source')) result = { version: 1, text: 'rate\tname\n0.1234\t12' };
    if (url.endsWith('/view-query')) result = { rows: [{ rate: .1234, name: '12' }] };
    if (options?.method === 'PATCH') return { ok: !fail, json: async () => fail ? { detail: 'Save failed' } : { ...dataset, version: 2 } };
    return { ok: true, json: async () => result };
  });
  vi.stubGlobal('fetch', fetcher); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '\u5b57\u6bb5\u914d\u7f6e' }));
  await screen.findByLabelText('rate \u5b57\u6bb5\u7c7b\u578b');
  return { fetcher, dialog: screen.getByRole('dialog') };
}
it('stages field edits and saves through the original fields endpoint', async () => {
  const { fetcher, dialog } = await setup();
  fireEvent.change(screen.getByLabelText('rate \u6570\u503c\u7c7b\u578b'), { target: { value: 'percent' } });
  expect(fetcher.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: '\u4fdd\u5b58' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const patch = fetcher.mock.calls.find(call => call[1]?.method === 'PATCH')!;
  expect(patch[0]).toBe('/api/datasets/d/fields');
  expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ version: 1, formats: { rate: { format: 'percent', decimals: 1 } } });
});
it('keeps the same dialog and pending formats across source navigation', async () => {
  const { dialog } = await setup();
  fireEvent.change(screen.getByLabelText('rate \u6570\u503c\u7c7b\u578b'), { target: { value: 'percent' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '\u6570\u636e\u6e90' }));
  await screen.findByLabelText('\u7c98\u8d34\u6570\u636e');
  fireEvent.click(within(dialog).getByRole('button', { name: '\u5b57\u6bb5\u914d\u7f6e' }));
  expect(await screen.findByLabelText('rate \u6570\u503c\u7c7b\u578b')).toHaveValue('percent');
  expect(screen.getByRole('dialog')).toBe(dialog);
});
it.each(['cancel', 'escape'])('discards pending edits on %s', async action => {
  const { fetcher, dialog } = await setup();
  fireEvent.change(screen.getByLabelText('rate \u6570\u503c\u7c7b\u578b'), { target: { value: 'percent' } });
  if (action === 'escape') fireEvent(dialog, new Event('cancel', { cancelable: true }));
  else fireEvent.click(within(dialog).getByRole('button', { name: '\u53d6\u6d88' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetcher.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(0);
});
it('retains pending changes after a failed save', async () => {
  const { dialog } = await setup(true);
  fireEvent.change(screen.getByLabelText('rate \u6570\u503c\u7c7b\u578b'), { target: { value: 'percent' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '\u4fdd\u5b58' }));
  await screen.findByText('Save failed');
  expect(screen.getByLabelText('rate \u6570\u503c\u7c7b\u578b')).toHaveValue('percent');
  expect(screen.getByRole('dialog')).toBe(dialog);
});
