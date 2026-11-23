"""Two-step paste import, transposed preview, cascading formats and persistence."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def main():
    url = os.environ['WORKBENCH_TEST_URL']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('WORKBENCH_BROWSER_CHANNEL', 'msedge'))
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.goto(url)
        page.get_by_role('button', name='＋ 导入数据', exact=True).click()
        page.get_by_label('粘贴数据').fill('count\tprice\trate\tday\n' + '\n'.join(['1,026\t12.30\t12.3%\t2026-10-28'] * 6))
        expect(page.get_by_role('button', name='确认导入', exact=True)).to_have_count(0)
        page.get_by_role('button', name='下一步', exact=True).click()
        expect(page.get_by_role('heading', name='字段配置与数据预览')).to_be_visible()
        expect(page.get_by_label('粘贴数据')).to_have_count(0)
        table = page.locator('.field-settings-table')
        expect(table.locator('tbody tr')).to_have_count(4)
        expect(table.locator('thead th')).to_have_count(9)
        expect(table.locator('tr[data-field="count"] .field-sample')).to_have_count(5)
        expect(page.get_by_label('count 数值类型')).to_have_value('integer')
        expect(page.get_by_label('count 小数位数')).to_have_count(0)
        expect(page.get_by_label('price 数值类型')).to_have_value('decimal')
        expect(page.get_by_label('price 小数位数')).to_have_value('2')
        expect(page.get_by_label('rate 数值类型')).to_have_value('percent')
        expect(page.get_by_label('rate 小数位数')).to_have_value('1')
        assert page.get_by_label('rate 小数位数').locator('option').all_text_contents() == ['0', '1', '2']
        page.get_by_label('rate 小数位数').select_option('2')
        expect(table.locator('tr[data-field="rate"] .field-sample').first).to_have_text('12.30%')
        page.get_by_label('列名 3').fill('增长率')
        page.get_by_role('button', name='上一步', exact=True).click()
        expect(page.get_by_label('粘贴数据')).to_be_visible()
        page.get_by_role('button', name='下一步', exact=True).click()
        expect(page.get_by_label('rate 数值类型')).to_have_value('percent')
        page.get_by_label('rate 小数位数').select_option('2')
        page.get_by_label('列名 3').fill('增长率')
        page.screenshot(path=str(Path(__file__).with_name('import-settings-tested.png')))
        page.get_by_role('button', name='确认导入', exact=True).click()
        expect(page.get_by_role('dialog', name='导入数据')).to_have_count(0)
        page.get_by_test_id('active-dataset').click()
        expect(page.get_by_label('增长率 数值类型')).to_have_value('percent')
        expect(page.get_by_label('增长率 小数位数')).to_have_value('2')
        dataset = page.request.get(url + '/api/datasets/latest').json()
        assert dataset['row_count'] == 6
        rows = page.request.post(url + f"/api/datasets/{dataset['id']}/view-query", data={'fields': ['count', '增长率'], 'limit': 1}).json()['rows']
        assert rows[0]['count'] == 1026
        assert abs(rows[0]['增长率'] - .123) < 1e-12
        browser.close()
        print('PASS: separate steps; aligned field/sample rows; inferred integer/decimal/percent and precision; back navigation; rename; persisted format and raw values')


if __name__ == '__main__':
    main()
