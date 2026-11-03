from io import BytesIO
from fastapi.testclient import TestClient
from openpyxl import Workbook
import xlwt
from datetime import date
from app.main import app

client = TestClient(app)

def test_field_formats_respect_selected_type_and_persist_without_mutating_values():
    text = 'name\tcount\trate\n' + '\n'.join(f'row{i}\t{i}\t{0.1234 if i == 11 else 1}' for i in range(12))
    dataset = client.post('/api/imports/paste', json={'name': 'field formats', 'text': text, 'overrides': {'rate': 'number'}}).json()
    assert dataset['field_formats']['count'] == {'kind': 'integer', 'format': 'number', 'decimals': 0}
    assert dataset['field_formats']['rate'] == {'kind': 'decimal', 'format': 'number', 'decimals': 0}
    assert dataset['field_formats']['name']['kind'] == 'text'
    path = f"/api/datasets/{dataset['id']}/field-format"
    changed = client.patch(path, json={'field': 'rate', 'format': 'percent', 'decimals': 1, 'version': dataset['version']})
    assert changed.status_code == 200, changed.text
    loaded = client.get(f"/api/datasets/{dataset['id']}").json()
    assert loaded['version'] == dataset['version'] + 1
    assert loaded['field_formats']['rate'] == {'kind': 'decimal', 'format': 'percent', 'decimals': 1}
    assert loaded['field_formats']['count'] == dataset['field_formats']['count']
    rows = client.post(f"/api/datasets/{dataset['id']}/view-query", json={'fields': ['rate'], 'offset': 11, 'limit': 1}).json()['rows']
    assert rows == [{'rate': 0.1234}]
    assert client.patch(path, json={'field': 'rate', 'format': 'number', 'decimals': 2, 'version': dataset['version']}).status_code == 409
    for patch in [{'field': 'missing'}, {'field': 'name'}, {'decimals': -1}, {'decimals': 9}, {'decimals': 1.5}, {'format': 'javascript'}]:
        body = {'field': 'rate', 'format': 'number', 'decimals': 1, 'version': loaded['version'], **patch}
        assert client.patch(path, json=body).status_code == 422
    assert client.get(f"/api/datasets/{dataset['id']}").json()['field_formats']['rate']['format'] == 'percent'

def test_import_origin_survives_reload_and_preview_returns_100_rows_all_columns():
    dataset = client.post('/api/imports/paste', json={'name': 'pasted', 'text': 'x\ty\tz\n' + '\n'.join(f'{i}\t{i+1}\t{i+2}' for i in range(120))}).json()
    loaded = client.get('/api/datasets/' + dataset['id']).json()
    assert loaded['import_method'] == 'paste'
    assert loaded['filename'] is None
    rows = client.post(f"/api/datasets/{dataset['id']}/view-query", json={'fields': ['x', 'y', 'z'], 'limit': 100}).json()['rows']
    assert len(rows) == 100
    assert rows[99] == {'x': 99, 'y': 100, 'z': 101}
    upload = client.post('/api/imports/files', data={'name': 'renamed'}, files={'file': ('original.csv', b'x,y\nA,1', 'text/csv')}).json()
    loaded = client.get('/api/datasets/' + upload['id']).json()
    assert loaded['import_method'] == 'upload'
    assert loaded['filename'] == 'original.csv'

def test_latest_dataset_returns_most_recent_successful_import():
    first = client.post('/api/imports/paste', json={'name': 'older import', 'text': 'x,y\nA,1'}).json()
    last = client.post('/api/imports/paste', json={'name': 'latest import', 'text': 'x,y\nB,2'}).json()
    response = client.get('/api/datasets/latest')
    assert response.status_code == 200
    assert response.json()['id'] == last['id']
    assert response.json()['id'] != first['id']

def test_aggregates_multiple_metrics_with_legend():
    dataset = client.post('/api/imports/paste', json={'name': 'multi metrics', 'text': 'month\tregion\tsales\tprofit\torders\nJan\tA\t10\t3\t2\nJan\tA\t20\t7\t4'}).json()
    result = client.post(f"/api/datasets/{dataset['id']}/view-query", json={'fields': ['month', 'region', 'sales', 'profit', 'orders'], 'dimension': 'month', 'second_dimension': 'region', 'measure': 'sales', 'measures': ['sales', 'profit', 'orders'], 'aggregation': 'sum'})
    assert result.status_code == 200
    assert result.json()['rows'] == [{'month': 'Jan', 'region': 'A', 'sales': 30, 'profit': 10, 'orders': 6}]

def test_preview_type_override_and_global_local_queries():
    body = {'name': 'scope', 'text': 'region\tamount\nNorth\t10\nNorth\t20\nSouth\t50', 'preview': True}
    assert client.post('/api/imports/paste', json=body).json()['row_count'] == 3
    dataset = client.post('/api/imports/paste', json={**body, 'preview': False}).json()
    path = f"/api/datasets/{dataset['id']}/view-query"
    base = {'fields': ['region', 'amount'], 'dimension': 'region', 'measure': 'amount', 'aggregation': 'sum'}
    global_filter = {'field': 'region', 'op': 'eq', 'value': 'North'}
    local_filter = {'field': 'amount', 'op': 'between', 'value': [15, 60]}
    assert client.post(path, json={**base, 'filters': [global_filter]}).json()['rows'] == [{'region': 'North', 'amount': 30}]
    assert client.post(path, json={**base, 'filters': [global_filter, local_filter]}).json()['rows'] == [{'region': 'North', 'amount': 20}]
    assert sorted(row['amount'] for row in client.post(path, json={**base, 'filters': [local_filter]}).json()['rows']) == [20, 50]

def test_xlsx_sheet_selection_and_embedded_tab():
    workbook = Workbook()
    workbook.active.title = 'First'
    workbook.active.append(['name', 'value'])
    workbook.active.append(['A\tB', 12])
    workbook.create_sheet('Second').append(['header'])
    buffer = BytesIO(); workbook.save(buffer)
    files = {'file': ('book.xlsx', buffer.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
    assert client.post('/api/imports/files', data={'name': 'book', 'preview': 'true'}, files=files).json()['sheets'] == ['First', 'Second']
    result = client.post('/api/imports/files', data={'name': 'book', 'sheet': 'First', 'preview': 'true'}, files=files)
    assert result.status_code == 201
    assert result.json()['rows'] == [{'name': 'A\tB', 'value': 12}]

def test_xls_import_real_workbook():
    workbook = xlwt.Workbook(); sheet = workbook.add_sheet('Data')
    for r, values in enumerate([['name', 'amount'], ['A', 7]]):
        for c, value in enumerate(values): sheet.write(r, c, value)
    buffer = BytesIO(); workbook.save(buffer)
    result = client.post('/api/imports/files', data={'name': 'xls'}, files={'file': ('data.xls', buffer.getvalue(), 'application/vnd.ms-excel')})
    assert result.status_code == 201
    assert result.json()['row_count'] == 1

def test_bad_import_does_not_publish_dataset():
    before = len(client.get('/api/datasets').json())
    assert client.post('/api/imports/paste', json={'name': 'bad', 'text': 'a,b\n1,2,3'}).status_code == 422
    assert len(client.get('/api/datasets').json()) == before

def test_second_measure_uses_full_dataset_and_pagination():
    dataset = client.post('/api/imports/paste', json={'name': 'multiple', 'text': 'region\tamount\tprofit\nA\t10\t2\nA\t20\t5\nB\t30\t6'}).json()
    path = f"/api/datasets/{dataset['id']}/view-query"
    result = client.post(path, json={'fields': ['region', 'amount', 'profit'], 'dimension': 'region', 'measure': 'amount', 'second_measure': 'profit', 'aggregation': 'sum', 'sort': 'asc'}).json()
    assert result['rows'][0] == {'region': 'A', 'amount': 30, 'profit': 7}
    page = client.post(path, json={'fields': ['region', 'amount'], 'offset': 2, 'limit': 1}).json()
    assert page['rows'] == [{'region': 'B', 'amount': 30}]

def test_boxplot_is_aggregated_on_server():
    dataset = client.post('/api/imports/paste', json={'name': 'stats', 'text': 'region\tamount\n' + '\n'.join(f'A\t{i}' for i in range(1, 102))}).json()
    result = client.post(f"/api/datasets/{dataset['id']}/view-query", json={'fields': ['region', 'amount'], 'dimension': 'region', 'measure': 'amount', 'chart_type': 'boxplot', 'limit': 1}).json()
    assert result['rows'][0]['__box'] == [1, 26, 51, 76, 101]

def test_excel_types_and_formula_without_cache():
    workbook = Workbook(); sheet = workbook.active
    sheet.append(['day', 'enabled', 'note']); sheet.append([date(2026, 10, 23), True, '00123'])
    buffer = BytesIO(); workbook.save(buffer)
    result = client.post('/api/imports/files', data={'name': 'typed', 'sheet': sheet.title, 'preview': 'true'}, files={'file': ('typed.xlsx', buffer.getvalue())})
    assert result.json()['schema'] == [{'name': 'day', 'type': 'date'}, {'name': 'enabled', 'type': 'string'}, {'name': 'note', 'type': 'string'}]
    assert result.json()['rows'][0]['note'] == '00123'
    sheet['C2'] = '=1+1'; buffer = BytesIO(); workbook.save(buffer)
    result = client.post('/api/imports/files', data={'name': 'formula', 'sheet': sheet.title, 'preview': 'true'}, files={'file': ('formula.xlsx', buffer.getvalue())})
    assert result.status_code == 422
    assert 'cached' in result.json()['detail']

def test_rename_types_and_combined_filters():
    dataset = client.post('/api/imports/paste', json={'name': 'typed', 'text': 'code\tday\tenabled\tamount\n001\t2026-10-23\ttrue\t0\n002\t2026-10-24\tfalse\t0.1234', 'renames': {'amount': 'ratio'}, 'overrides': {'amount': 'number'}}).json()
    assert dataset['schema'] == [{'name': 'code', 'type': 'string'}, {'name': 'day', 'type': 'date'}, {'name': 'enabled', 'type': 'string'}, {'name': 'ratio', 'type': 'number'}]
    response = client.post(f"/api/datasets/{dataset['id']}/view-query", json={'fields': ['code', 'ratio'], 'filters': [{'field': 'day', 'op': 'between', 'value': ['2026-10-23', '2026-10-24']}, {'field': 'code', 'op': 'in', 'value': ['002', '003']}, {'field': 'code', 'op': 'contains', 'value': '00'}]})
    assert response.json()['rows'] == [{'code': '002', 'ratio': .1234}]

def test_histogram_counts_full_dataset_and_expression():
    dataset = client.post('/api/imports/paste', json={'name': 'hist', 'text': 'x\ty\n' + '\n'.join(f'{i}\t2' for i in range(100))}).json()
    path = f"/api/datasets/{dataset['id']}/view-query"
    histogram = client.post(path, json={'fields': ['x'], 'measure': 'x', 'chart_type': 'histogram'}).json()
    assert sum(row['__count'] for row in histogram['rows']) == 100
    expression = client.post(path, json={'fields': ['x'], 'measure': 'x', 'aggregation': 'sum', 'metric_expression': '[x] / [y]'}).json()
    assert expression['rows'] == [{'x': 2475}]

def test_histogram_retains_empty_intervals():
    dataset = client.post('/api/imports/paste', json={'name': 'gaps', 'text': 'x\n0\n0\n0\n0\n10'}).json()
    rows = client.post(f"/api/datasets/{dataset['id']}/view-query", json={'fields': ['x'], 'measure': 'x', 'chart_type': 'histogram'}).json()['rows']
    assert [row['__count'] for row in rows] == [4, 0, 1]
