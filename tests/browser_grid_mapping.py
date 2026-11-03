"""History menu, X/Y/legend mapping, and finite grid snapping acceptance check."""
import os
from playwright.sync_api import sync_playwright, expect

def main():
    url = os.getenv('WORKBENCH_TEST_URL', 'http://127.0.0.1:8000')
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1700, 'height': 1100})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        data = page.request.post(url + '/api/imports/paste', data={'name': 'Grid mapping acceptance', 'text': 'month\tregion\tsales\nJan\tNorth\t10\nJan\tSouth\t20\nFeb\tNorth\t30'})
        assert data.ok, data.text()
        dataset = data.json()
        page.goto(url)
        expect(page.get_by_test_id('active-dataset')).to_contain_text(dataset['name'])
        expect(page.locator('.left-panel > .field')).to_have_count(0)
        page.get_by_role('button', name='历史数据集', exact=True).click()
        expect(page.get_by_test_id('recent-dataset')).to_have_count(1)
        expect(page.get_by_test_id('recent-dataset')).to_contain_text(dataset['name'])
        page.get_by_test_id('recent-dataset').click()
        expect(page.get_by_test_id('recent-dataset')).to_have_count(0)
        page.get_by_role('button', name='＋ 柱状图', exact=True).click()
        page.get_by_label('X 轴', exact=True).select_option('month')
        page.get_by_label('Y 轴', exact=True).select_option('sales')
        with page.expect_response(lambda response: '/view-query' in response.url and response.request.post_data_json.get('second_dimension') == 'region') as pending:
            page.get_by_label('Legend 字段', exact=True).select_option('region')
        assert pending.value.ok, pending.value.text()
        assert sorted((r['month'], r['region'], r['sales']) for r in pending.value.json()['rows']) == [('Feb', 'North', 30), ('Jan', 'North', 10), ('Jan', 'South', 20)]
        page.get_by_label('网格列数 M').fill('10'); page.get_by_label('网格列数 M').press('Tab')
        page.get_by_label('网格行数 N').fill('12'); page.get_by_label('网格行数 N').press('Tab')
        expect(page.get_by_test_id('grid-guide')).to_have_count(0)
        tile = page.get_by_test_id('chart-tile')
        header = tile.locator('.card-head').bounding_box()
        surface = page.get_by_test_id('grid-surface').bounding_box()
        filters = page.locator('section.global-filters').bounding_box()
        box = tile.bounding_box()
        assert abs(box['x'] - filters['x']) < 1, (box, filters)
        assert abs(surface['x'] + surface['width'] - filters['x'] - filters['width']) < 1
        pitch = (surface['width'] + 8) / 10
        target = {'x': surface['x'] + pitch, 'y': surface['y'] + 68}
        page.mouse.move(header['x'] + 65, header['y'] + 15)
        page.mouse.down(); page.mouse.move(header['x'] + 65 + pitch + 9, header['y'] + 15 + 68 + 9, steps=12); page.mouse.up()
        page.wait_for_function('(target) => { const r=document.querySelector("[data-testid=chart-tile]").getBoundingClientRect(); return Math.abs(r.x-target.x)<2 && Math.abs(r.y-target.y)<2; }', arg=target)
        page.get_by_label('仪表板名称').fill('网格与字段映射验收')
        with page.expect_response(lambda response: response.url.endswith('/api/dashboards') and response.request.method == 'POST') as saved:
            page.get_by_role('button', name='保存仪表板', exact=True).click()
        item = saved.value.json(); chart = item['document']['charts'][0]
        assert item['document']['grid'] == {'columns': 10, 'rows': 12}
        assert (chart['x'], chart['y'], chart['w'], chart['h']) == (1, 1, 6, 5)
        assert chart['config']['legendField'] == 'region'
        page.reload()
        expect(page.get_by_label('打开仪表板').locator(f'option[value="{item["id"]}"]')).to_have_count(1)
        page.get_by_label('打开仪表板').select_option(item['id'])
        expect(page.get_by_label('网格列数 M')).to_have_value('10')
        expect(page.get_by_label('网格行数 N')).to_have_value('12')
        expect(page.get_by_label('X 轴', exact=True)).to_have_value('month')
        expect(page.get_by_label('Y 轴', exact=True)).to_have_value('sales')
        expect(page.get_by_label('Legend 字段', exact=True)).to_have_value('region')
        expect(page.get_by_text('加载中…', exact=True)).to_have_count(0)
        expect(page.locator('.chart-view canvas').first).to_be_visible()
        page.screenshot(path='tests/grid-mapping-tested.png', full_page=True)
        assert not errors, errors
        browser.close()
        print('PASS: latest-only history -> retrieve -> X/Y/legend aggregation -> 10x12 grid -> exact snap -> save/reopen')

if __name__ == '__main__': main()
