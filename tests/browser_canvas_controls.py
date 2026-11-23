"""Check aligned canvas edges, multiple measures, and all eight resize handles."""
import os
from playwright.sync_api import sync_playwright, expect


def main():
    url = os.getenv('WORKBENCH_TEST_URL', 'http://127.0.0.1:8000')
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1700, 'height': 1100})
        page.on('dialog', lambda dialog: dialog.accept())
        response = page.request.post(url + '/api/imports/paste', data={'name': 'Canvas controls acceptance', 'text': 'month\tsales\tprofit\torders\nJan\t10\t3\t2\nJan\t20\t7\t4'})
        assert response.ok, response.text()
        dataset = response.json()
        page.goto(url)
        page.get_by_role('button', name='＋ 柱状图', exact=True).click()
        page.get_by_role('button', name='添加指标', exact=True).click()
        with page.expect_response(lambda r: '/view-query' in r.url and r.request.post_data_json.get('measures') == ['sales', 'profit', 'orders']) as query:
            page.get_by_role('button', name='添加指标', exact=True).click()
        assert query.value.ok, query.value.text()
        assert query.value.json()['rows'] == [{'month': 'Jan', 'sales': 30, 'profit': 10, 'orders': 6}]
        expect(page.get_by_label('Y 轴指标 3')).to_have_value('orders')
        assert page.get_by_text('第二维度', exact=True).count() == 0
        tile = page.get_by_test_id('chart-tile')
        filters = page.locator('section.global-filters').bounding_box()
        assert abs(tile.bounding_box()['x'] - filters['x']) < 1
        # A full-width chart must also align at the right boundary.
        chart = {'id': 'resize-chart', 'datasetId': dataset['id'], 'config': {'type': 'bar', 'dimension': 'month', 'measure': 'sales'}, 'x': 0, 'y': 0, 'w': 12, 'h': 5, 'filters': [], 'filterMode': 'global'}
        saved = page.request.post(url + '/api/dashboards', data={'name': 'Canvas resize acceptance', 'document': {'charts': [chart], 'filters': [], 'datasets': [dataset]}, 'version': 1})
        assert saved.ok, saved.text()
        item = saved.json()
        page.reload()
        page.get_by_label('打开仪表板').select_option(item['id'])
        expect(tile).to_have_count(1)
        box = tile.bounding_box()
        assert abs(box['x'] + box['width'] - filters['x'] - filters['width']) < 1
        chart.update(x=2, y=2, w=6)
        updated = page.request.put(url + '/api/dashboards/' + item['id'], data={'name': item['name'], 'document': {'charts': [chart], 'filters': [], 'datasets': [dataset]}, 'version': item['version']})
        assert updated.ok, updated.text()
        for axis in ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']:
            page.reload()
            page.get_by_label('打开仪表板').select_option(item['id'])
            expect(tile.locator('.react-resizable-handle')).to_have_count(8)
            before = tile.bounding_box()
            handle = tile.locator('.react-resizable-handle-' + axis).bounding_box()
            x, y = handle['x'] + handle['width'] / 2, handle['y'] + handle['height'] / 2
            dx = -85 if 'w' in axis else 85 if 'e' in axis else 0
            dy = -68 if 'n' in axis else 68 if 's' in axis else 0
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + dx, y + dy, steps=12)
            page.mouse.up()
            page.wait_for_function('before => { const r=document.querySelector("[data-testid=chart-tile]").getBoundingClientRect(); return r.width > before.width + 10 || r.height > before.height + 10; }', arg=before)
        browser.close()
        print('PASS: aligned left/right edges; three aggregated measures; all eight resize directions')


if __name__ == '__main__':
    main()
