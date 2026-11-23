"""Verify CSV, XLS and XLSX upload/preview/confirmation through the user interface."""
from io import BytesIO
import os
from openpyxl import Workbook
import xlwt
from playwright.sync_api import sync_playwright, expect

def main():
    xlsx = Workbook(); xlsx.active.title = 'Sales'; xlsx.active.append(['region', 'amount']); xlsx.active.append(['North', 12]); xlsx.create_sheet('Other').append(['header'])
    xlsx_bytes = BytesIO(); xlsx.save(xlsx_bytes)
    xls = xlwt.Workbook(); sheet = xls.add_sheet('Sales')
    for r, row in enumerate([['region', 'amount'], ['North', 12]]):
        for c, value in enumerate(row): sheet.write(r, c, value)
    xls_bytes = BytesIO(); xls.save(xls_bytes)
    cases = [('csv', b'region,amount\nNorth,12'), ('xls', xls_bytes.getvalue()), ('xlsx', xlsx_bytes.getvalue())]
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True, channel=os.getenv('WORKBENCH_BROWSER_CHANNEL') or None)
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.goto(os.getenv('WORKBENCH_TEST_URL', 'http://127.0.0.1:8000'))
        for suffix, data in cases:
            page.get_by_role('button', name='＋ 导入数据', exact=True).click()
            page.get_by_label('选择文件').set_input_files({'name': f'browser-import.{suffix}', 'mimeType': 'application/octet-stream', 'buffer': data})
            page.get_by_role('button', name='下一步', exact=True).click()
            expect(page.get_by_role('heading', name='字段配置与数据预览')).to_be_visible()
            expect(page.get_by_label('选择文件')).to_have_count(0)
            if suffix != 'csv':
                expect(page.get_by_label('工作表')).to_be_visible()
                page.get_by_label('工作表').select_option('Sales')
            expect(page.get_by_label('amount 数值类型')).to_have_value('integer')
            expect(page.get_by_role('dialog').locator('tbody tr')).to_have_count(2)
            page.get_by_role('button', name='确认导入', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            expect(page.get_by_test_id('active-dataset')).to_contain_text(f'browser-import.{suffix}')
            expect(page.get_by_test_id('active-dataset')).to_contain_text('上传')
            expect(page.get_by_test_id('active-dataset')).to_contain_text('2 列 · 1 行')
            page.get_by_test_id('active-dataset').click()
            preview = page.get_by_role('dialog', name='数据预览')
            expect(preview.locator('tbody tr')).to_have_count(2)
            expect(preview.locator('tbody')).to_contain_text('North')
            page.get_by_role('button', name='关闭数据预览').click()
            print('PASS:', suffix, 'upload, preview, confirm')
        browser.close()

if __name__ == '__main__': main()
