// In-browser port of the backend view-query (backend/app/api/datasets.py: view_query) for the exported
// interactive HTML page. Rows arrive pre-typed by /datasets/{id}/export-rows (numbers as numbers, dates as
// YYYY-MM-DD strings), so this only filters, groups, aggregates, orders and pages. Keep both in step.
type Value = string | number | boolean | null;
type Filter = { field: string; op: string; value?: unknown };
export type OfflineRequest = {
  fields: string[]; filters?: Filter[]; limit?: number | null; offset?: number; dimension?: string | null; dimensions?: string[];
  measure?: string | null; aggregation?: string | null; metric_aggregations?: Record<string, string>; sort_measure?: string | null;
  sort?: string; measures?: string[]; second_measure?: string | null; second_dimension?: string | null; chart_type?: string | null;
  metric_expression?: string | null; distinct?: boolean;
};
export type OfflineData = { columns: string[]; rows: Value[][] };

const dateOf = (value: Value) => {
  if (value === null || value === undefined) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match ? match[1] : null;
};
const same = (a: unknown, b: unknown) => a === b || (a !== null && b !== null && a !== undefined && b !== undefined && String(a) === String(b));
const compare = (a: Value, b: Value) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
// DuckDB default ordering: NULLS LAST in both directions.
const ordered = (a: Value, b: Value, direction: string) => a === null || b === null ? (a === null ? (b === null ? 0 : 1) : -1) : (direction === 'desc' ? -compare(a, b) : compare(a, b));

function predicate(filter: Filter, index: number, type: string): (row: Value[]) => boolean {
  const { op, value } = filter;
  if ((op === 'between' || op === 'date_between') && Array.isArray(value) && value.length === 2) {
    if (op === 'date_between' || type === 'date') {
      const [low, high] = value.map(item => dateOf(item as Value));
      return row => { const day = dateOf(row[index]); return day !== null && low !== null && high !== null && day >= low && day <= high; };
    }
    const [low, high] = value.map(Number);
    return row => row[index] !== null && Number(row[index]) >= low && Number(row[index]) <= high;
  }
  if (op === 'eq') return row => same(row[index], value);
  if (op === 'contains') return row => row[index] !== null && String(row[index]).toLowerCase().includes(String(value).toLowerCase());
  if (op === 'in' && Array.isArray(value)) {
    const nulls = value.includes(null), values = value.filter(item => item !== null).map(String);
    return row => row[index] === null ? nulls : values.includes(String(row[index]));
  }
  if (op === 'is_null') return row => row[index] === null;
  throw new Error('Unsupported filter');
}

// Arithmetic over [field] references, numbers, + - * / and parentheses; division by zero yields null (NULLIF).
function compileExpression(expression: string, column: (name: string) => number): (row: Value[]) => number | null {
  const tokens = expression.match(/\[[^\]]+\]|\d+(?:\.\d+)?|[-+*/()]|\S/g) || [];
  let position = 0;
  const peek = () => tokens[position];
  type Node = (row: Value[]) => number | null;
  const primary = (): Node => {
    const token = tokens[position++];
    if (token === undefined) throw new Error('Invalid arithmetic expression');
    if (token === '(') { const inner = sum(); if (tokens[position++] !== ')') throw new Error('Invalid arithmetic expression'); return inner; }
    if (token === '-' || token === '+') { const operand = primary(); return token === '-' ? row => { const value = operand(row); return value === null ? null : -value; } : operand; }
    if (/^\d/.test(token)) { const number = Number(token); return () => number; }
    if (token.startsWith('[')) { const index = column(token.slice(1, -1)); return row => row[index] === null ? null : Number(row[index]); }
    throw new Error('Only [field] references, numbers, + - * / and parentheses are allowed');
  };
  const product = (): Node => {
    let left = primary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[position++], right = primary(), l = left;
      left = op === '*' ? row => { const a = l(row), b = right(row); return a === null || b === null ? null : a * b; } : row => { const a = l(row), b = right(row); return a === null || b === null || b === 0 ? null : a / b; };
    }
    return left;
  };
  const sum = (): Node => {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[position++], right = product(), l = left;
      left = row => { const a = l(row), b = right(row); return a === null || b === null ? null : op === '+' ? a + b : a - b; };
    }
    return left;
  };
  const result = sum();
  if (position !== tokens.length) throw new Error('Invalid arithmetic expression');
  return result;
}

function aggregate(method: string, values: (number | Value)[]): Value {
  const present = values.filter(value => value !== null && value !== undefined);
  if (method === 'count') return present.length;
  if (method === 'count_distinct') return new Set(present.map(value => typeof value + ':' + String(value))).size;
  if (!present.length) return null;
  if (method === 'min') return present.reduce((a, b) => compare(a as Value, b as Value) <= 0 ? a : b) as Value;
  if (method === 'max') return present.reduce((a, b) => compare(a as Value, b as Value) >= 0 ? a : b) as Value;
  const total = present.reduce((sum: number, value) => sum + Number(value), 0);
  return method === 'avg' ? total / present.length : total;
}

function quantile(values: number[], q: number) {
  const position = (values.length - 1) * q, low = Math.floor(position), high = Math.ceil(position);
  return values[low] + (values[high] - values[low]) * (position - low);
}

export function offlineViewQuery(data: OfflineData, types: Record<string, string>, request: OfflineRequest, snapshot: { snapshot_id?: string; data_as_of?: string }) {
  const column = (name: string) => {
    const index = data.columns.indexOf(name);
    if (index < 0) throw new Error('Unknown field');
    return index;
  };
  const tests = (request.filters || []).map(filter => predicate(filter, column(filter.field), types[filter.field]));
  // Each surviving row keeps its source position: DuckDB's row_number() OVER () ordering (first appearance).
  const source = data.rows.filter(row => tests.every(test => test(row)));
  const limit = request.limit ?? null, offset = request.offset || 0;
  const page = <T,>(items: T[]) => items.slice(offset, limit === null ? undefined : offset + limit);
  const respond = (rows: Record<string, unknown>[], legend_order: Value[] = []) => ({ ...snapshot, is_sampled: false, scope: { limit }, columns: request.fields, rows, legend_order });
  const record = (row: Value[]) => Object.fromEntries(request.fields.map(name => [name, row[column(name)]]));
  const chart = request.chart_type || null;
  const sortMeasure = request.sort_measure || request.measure || null;
  const sorting = (request.sort === 'asc' || request.sort === 'desc') && !!sortMeasure && sortMeasure in types && chart !== 'boxplot';

  if (chart === 'histogram') {
    if (!request.measure) throw new Error('Histogram requires a numeric measure');
    const index = column(request.measure);
    const values = source.map(row => row[index]).filter((value): value is number => value !== null).map(Number);
    if (!values.length) return respond([]);
    const lo = Math.min(...values), hi = Math.max(...values), n = Math.min(100, Math.max(1, Math.ceil(Math.sqrt(values.length))));
    const width = hi === lo ? 1 : (hi - lo) / n, counts = new Array(n).fill(0);
    for (const value of values) counts[Math.min(n - 1, Math.floor((value - lo) / width))]++;
    return respond(page(counts.map((count, i) => ({ __bin: lo + i * width, __count: count }))));
  }
  if (chart === 'date-range') {
    const index = column(request.fields[0]);
    const days = source.map(row => dateOf(row[index])).filter((day): day is string => day !== null).sort();
    return respond([{ __start: days[0] ?? null, __end: days[days.length - 1] ?? null }]);
  }

  type Group = { key: string; first: number; rows: Value[][]; output: Record<string, unknown> };
  const groupBy = (names: string[]) => {
    const indexes = names.map(column), groups = new Map<string, Group>();
    source.forEach((row, position) => {
      const key = JSON.stringify(indexes.map(index => row[index]));
      let group = groups.get(key);
      if (!group) { group = { key, first: position, rows: [], output: Object.fromEntries(names.map((name, i) => [name, row[indexes[i]]])) }; groups.set(key, group); }
      group.rows.push(row);
    });
    return [...groups.values()];
  };
  const byFirst = (a: Group, b: Group) => a.first - b.first;

  if (chart === 'boxplot') {
    if (!request.dimension || !request.measure) throw new Error('Boxplot requires a dimension and numeric measure');
    const index = column(request.measure);
    const groups = groupBy([request.dimension]).sort(byFirst);
    return respond(page(groups.map(group => {
      const values = group.rows.map(row => row[index]).filter((value): value is number => value !== null).map(Number).sort((a, b) => a - b);
      return { ...group.output, __box: values.length ? [0, 0.25, 0.5, 0.75, 1].map(q => quantile(values, q)) : null };
    })));
  }
  if (chart === 'candlestick') {
    const measures = request.measures || [];
    if (!request.dimension || measures.length !== 4) throw new Error('蜡烛图需要四个不同的数值字段');
    const [open, close, low, high] = measures.map(column);
    const groups = groupBy([request.dimension]);
    const rows = groups.map(group => ({ group, row: { ...group.output, [measures[0]]: group.rows[0][open], [measures[1]]: group.rows[group.rows.length - 1][close], [measures[2]]: aggregate('min', group.rows.map(row => row[low])), [measures[3]]: aggregate('max', group.rows.map(row => row[high])) } as Record<string, Value> }));
    rows.sort((a, b) => sorting ? ordered(a.row[sortMeasure!], b.row[sortMeasure!], request.sort!) || a.group.first - b.group.first : a.group.first - b.group.first);
    return respond(page(rows.map(item => item.row)));
  }

  if (request.aggregation) {
    const methods = new Set(['sum', 'avg', 'count', 'min', 'max', 'count_distinct']);
    const methodFor = (field: string) => request.metric_aggregations?.[field] || request.aggregation!;
    if (!request.measure || !methods.has(request.aggregation) || Object.values(request.metric_aggregations || {}).some(method => !methods.has(method))) throw new Error('Invalid aggregation');
    const axis = request.dimensions?.length ? request.dimensions : request.dimension ? [request.dimension] : [];
    const dimensions = [...new Set([...axis, ...(request.second_dimension ? [request.second_dimension] : [])])];
    const metric = request.metric_expression ? compileExpression(request.metric_expression, column) : (() => { const index = column(request.measure!); return (row: Value[]) => row[index]; })();
    const extra = [...new Set([...(request.measures || []), request.second_measure].filter((field): field is string => !!field && field !== request.measure))];
    const valueOf = (field: string) => field === request.measure ? metric : (() => { const index = column(field); return (row: Value[]) => row[index]; })();
    const groups = dimensions.length ? groupBy(dimensions) : [{ key: '', first: 0, rows: source, output: {} } as Group];
    const results = groups.map(group => {
      const row: Record<string, Value> = { ...(group.output as Record<string, Value>), [request.measure!]: aggregate(methodFor(request.measure!), group.rows.map(metric)) };
      for (const field of extra) row[field] = aggregate(methodFor(field), group.rows.map(valueOf(field)));
      return { group, row };
    });
    const series = request.second_dimension && ['bar', 'line', 'area', 'mixed'].includes(chart || '');
    // Stacked/legend charts order axis categories by their total across all legend values.
    const totals = new Map<string, number | null>();
    if (sorting && series && axis.length) {
      const key = (row: Record<string, Value>) => JSON.stringify(axis.map(name => row[name]));
      for (const { row } of results) {
        const previous = totals.get(key(row)) ?? null, value = row[sortMeasure!];
        totals.set(key(row), value === null || value === undefined ? previous : (previous ?? 0) + Number(value));
      }
    }
    const sortValue = (item: { row: Record<string, Value> }) => series && axis.length && totals.size ? totals.get(JSON.stringify(axis.map(name => item.row[name]))) ?? null : item.row[sortMeasure!];
    results.sort((a, b) => sorting ? ordered(sortValue(a), sortValue(b), request.sort!) || a.group.first - b.group.first : a.group.first - b.group.first);
    let kept = results;
    const topPerSeries = limit !== null && axis.length && request.second_dimension && !axis.includes(request.second_dimension);
    if (topPerSeries) {
      // QUALIFY ROW_NUMBER() OVER (PARTITION BY legend ORDER BY measure/first appearance) <= limit
      const ranked = [...results].sort((a, b) => sorting ? ordered(a.row[sortMeasure!], b.row[sortMeasure!], request.sort!) || a.group.first - b.group.first : a.group.first - b.group.first);
      const counts = new Map<string, number>(), allowed = new Set<typeof results[number]>();
      for (const item of ranked) {
        const legend = JSON.stringify(item.row[request.second_dimension!]), count = (counts.get(legend) || 0) + 1;
        counts.set(legend, count);
        if (count <= limit!) allowed.add(item);
      }
      kept = results.filter(item => allowed.has(item)).slice(offset);
    } else kept = page(results);
    const legend: Value[] = [];
    if (series) {
      const first = new Map<string, { value: Value; position: number }>();
      for (const { group, row } of results) {
        const value = row[request.second_dimension!], key = JSON.stringify(value), seen = first.get(key);
        if (!seen || group.first < seen.position) first.set(key, { value, position: group.first });
      }
      const keptValues = new Set(kept.map(item => JSON.stringify(item.row[request.second_dimension!])));
      legend.push(...[...first.entries()].filter(([key]) => keptValues.has(key)).sort((a, b) => a[1].position - b[1].position).map(([, item]) => item.value));
    }
    return respond(kept.map(item => item.row), legend);
  }

  if (request.distinct) {
    return respond(page(groupBy(request.fields).sort((a, b) => sorting && request.fields.includes(sortMeasure!) ? ordered(a.output[sortMeasure!] as Value, b.output[sortMeasure!] as Value, request.sort!) || a.first - b.first : a.first - b.first).map(group => group.output)));
  }
  const rows = source.map((row, position) => ({ row, position }));
  if (sorting) { const index = column(sortMeasure!); rows.sort((a, b) => ordered(a.row[index], b.row[index], request.sort!) || a.position - b.position); }
  return respond(page(rows).map(item => record(item.row)));
}
