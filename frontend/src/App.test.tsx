import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

vi.mock("./charts/ChartView", () => ({ ChartView: () => <div aria-label="chart" /> }));

describe("App", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('blocks select-all outside text inputs while preserving input editing', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
    render(<App />);
    const outside = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    const inside = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    screen.getByLabelText('仪表板名称').dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
  });
  it('shows only the latest dataset in its own history menu', async () => {
    const latest = { id: 'latest', name: 'Recent import', row_count: 2, schema: [{ name: 'x', type: 'string' }, { name: 'y', type: 'number' }] };
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.endsWith('/datasets/latest') || url.endsWith('/datasets/latest-id') ? latest : [] })));
    const { container } = render(<App />);
    expect(container.querySelectorAll('.left-panel > .field')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '历史数据集' }));
    const recent = await screen.findByRole('button', { name: /Recent import/ });
    expect(screen.getAllByTestId('recent-dataset')).toHaveLength(1);
    fireEvent.click(recent);
    await screen.findByRole('button', { name: '柱状图' });
    expect(screen.queryByTestId('recent-dataset')).not.toBeInTheDocument();
  });
  it("renders the data workbench shell", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Data Workbench" })).toBeInTheDocument();
  });
  it('moves to a separate configuration step and submits numeric format settings', async () => {
    const preview = { schema: [{ name: 'rate', type: 'number' }], rows: [{ rate: .123 }], row_count: 1, field_formats: { rate: { kind: 'decimal', format: 'percent', decimals: 1 } } };
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/imports/paste')) {
        const body = JSON.parse(String(options?.body));
        return { ok: true, json: async () => body.preview ? preview : { ...preview, id: 'imported', name: 'Imported', version: 1 } };
      }
      return { ok: true, json: async () => [] };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByRole('heading', { name: '字段配置与数据预览' });
    expect(screen.queryByLabelText('粘贴数据')).not.toBeInTheDocument();
    expect(screen.getByLabelText('rate 数值类型')).toHaveValue('percent');
    expect(screen.getByLabelText('rate 小数位数')).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('rate 小数位数'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByLabelText('粘贴数据')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByLabelText('rate 数值类型');
    fireEvent.change(screen.getByLabelText('rate 小数位数'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导入数据' })).not.toBeInTheDocument());
    const requests = fetcher.mock.calls.filter(call => call[0].endsWith('/imports/paste')).map(call => JSON.parse(String(call[1]?.body)));
    expect(requests.at(-1)).toMatchObject({ preview: false, formats: { rate: { format: 'percent', decimals: 2 } } });
  });
  it('lets a workbook choose another worksheet when the first one has no data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (!url.endsWith('/imports/files')) return { ok: true, json: async () => [] };
      const sheet = (options?.body as FormData).get('sheet');
      if (!sheet) return { ok: true, json: async () => ({ sheets: ['Empty', 'Data'] }) };
      if (sheet === 'Empty') return { ok: false, json: async () => ({ detail: 'No data rows' }) };
      return { ok: true, json: async () => ({ schema: [{ name: 'value', type: 'integer' }], rows: [{ value: 1 }], row_count: 1 }) };
    }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '导入数据' }));
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [new File(['book'], 'book.xlsx')] } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No data rows');
    fireEvent.change(screen.getByLabelText('工作表'), { target: { value: 'Data' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByLabelText('value 数值类型');
    expect(screen.getByLabelText('工作表')).toHaveValue('Data');
  });
  it('chooses compatible default fields even when the first column is numeric', async () => {
    const data = { id: 'latest', name: 'Types', row_count: 1, schema: [{ name: 'count', type: 'integer' }, { name: 'category', type: 'string' }, { name: 'day', type: 'date' }] };
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.endsWith('/datasets/latest') ? data : url.endsWith('/view-query') ? { rows: [] } : [] })));
    render(<App />);
    await screen.findByTestId('active-dataset');
    fireEvent.click(screen.getByRole('button', { name: '柱状图' }));
    expect(screen.getByLabelText('X 轴')).toHaveValue('category');
    expect(screen.getByLabelText('Y 轴')).toHaveValue('count');
    expect(screen.getByLabelText('Legend 字段').querySelector('option[value="count"]')).toBeNull();
  });
  it('keeps edits made while saving marked as unsaved', async () => {
    let finish!: (response: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const fetcher = vi.fn((_url: string, options?: RequestInit) => options?.method === 'POST' ? pending : Promise.resolve({ ok: true, json: async () => options?.method === 'PUT' ? { id: 'saved', name: 'Second', version: 2 } : [] }));
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    fireEvent.change(screen.getByLabelText('仪表板名称'), { target: { value: 'First' } });
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true), { timeout: 2000 });
    fireEvent.change(screen.getByLabelText('仪表板名称'), { target: { value: 'Second' } });
    await act(async () => finish({ ok: true, json: async () => ({ id: 'saved', version: 1 }) }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PUT' && JSON.parse(String(options.body)).name === 'Second')).toBe(true), { timeout: 2000 });
  });
  it('copies a saved report with a new ID and enters its editor', async () => {
    localStorage.clear(); window.history.replaceState(null, '', '/reports');
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const source = { id: 'original-id', name: 'Original', version: 3, document: { charts: [], datasets: [], filters: [], highlightWeekends: true } };
    const copied = { ...source, id: 'copied-id', name: 'Original\uff08\u526f\u672c\uff09', version: 1 };
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      const result = url.endsWith('/dashboards/original-id') ? source : url.endsWith('/dashboards/copied-id') ? copied : url.endsWith('/dashboards') ? options?.method === 'POST' ? copied : [source] : [];
      return { ok: true, json: async () => result };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    expect(await screen.findByText('original-id')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '\u590d\u5236' }));
    await waitFor(() => expect(window.location.pathname).toBe('/reports/copied-id'));
    const request = fetcher.mock.calls.find(([url, options]) => url.endsWith('/dashboards') && options?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ document: source.document, version: 1 });
    expect(screen.getByLabelText('\u4eea\u8868\u677f\u540d\u79f0')).toHaveValue(copied.name);
    localStorage.clear(); window.history.replaceState(null, '', '/');
  });
});
