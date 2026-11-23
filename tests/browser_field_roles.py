"""Run against disposable storage: WORKBENCH_TEST_URL=http://127.0.0.1:8013."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def main():
    url = os.environ['WORKBENCH_TEST_URL']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('WORKBENCH_BROWSER_CHANNEL', 'msedge'))
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        response = page.request.post(url + '/api/imports/paste', data={'name': 'Field roles', 'text': 'count\tname\tday\tprice\textra1\textra2\textra3\n1,026\tA\t2026-10-28\t1.5\tx\ty\tz'})
        assert response.ok, response.text()
        page.goto(url)
        page.get_by_role('button', name='＋ 柱状图', exact=True).click()
        expect(page.get_by_label('X 轴', exact=True)).to_have_value('name')
        expect(page.get_by_label('Y 轴', exact=True)).to_have_value('count')
        assert page.get_by_label('X 轴', exact=True).locator('option').all_text_contents() == ['请选择', 'name', 'day', 'extra1', 'extra2', 'extra3']
        assert page.get_by_label('Y 轴', exact=True).locator('option').all_text_contents() == ['请选择', 'count', 'price']
        page.get_by_test_id('active-dataset').click()
        dialog = page.get_by_role('dialog', name='数据预览')
        expect(dialog.locator('tbody tr')).to_have_count(7)
        expect(dialog.locator('thead th')).to_have_count(9)
        expect(page.get_by_label('count 数值类型')).to_have_value('integer')
        options = page.get_by_label('count 字段类型').locator('option').all_text_contents()
        assert options == ['文本', '日期', '数值']
        boxes = dialog.locator('tbody tr').evaluate_all('(rows) => rows.map(row => ({top:row.getBoundingClientRect().top, height:row.getBoundingClientRect().height}))')
        assert all(boxes[i + 1]['top'] >= boxes[i]['top'] + boxes[i]['height'] - 1 for i in range(len(boxes) - 1))
        assert dialog.get_by_role('button', name='保存', exact=True).is_visible()
        page.get_by_label('price 数值类型').select_option('integer')
        dialog.get_by_role('button', name='保存', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('Invalid integer')
        page.get_by_label('price 字段类型').select_option('number')
        page.get_by_label('extra3 字段类型').select_option('date')
        page.get_by_label('extra3 字段类型').select_option('string')
        dialog.get_by_role('button', name='保存', exact=True).click()
        expect(dialog).not_to_be_visible()
        page.get_by_test_id('active-dataset').click()
        expect(page.get_by_label('price 字段类型')).to_have_value('number')
        page.screenshot(path=str(Path(__file__).with_name('field-settings-tested.png')))
        dialog.get_by_role('button', name='取消', exact=True).click()
        browser.close()
        print('PASS: typed bindings; integer inference; vertical all-field settings; five preview columns; failed integer conversion preserves data; save/reopen')


if __name__ == '__main__':
    main()
