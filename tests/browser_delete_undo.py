"""Deletion toast restores only its chart for five seconds; toolbar undo remains available."""
import os
from playwright.sync_api import sync_playwright, expect


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1700, 'height': 1100})
        url = os.getenv('WORKBENCH_TEST_URL', 'http://127.0.0.1:8000')
        page.request.post(url + '/api/imports/paste', data={'name': 'Delete undo check', 'text': 'region\tamount\nNorth\t10'})
        page.goto(url)
        expect(page.get_by_test_id('active-dataset')).to_contain_text('Delete undo check')
        page.get_by_role('button', name='＋ 柱状图', exact=True).click()
        page.get_by_role('button', name='＋ 折线图', exact=True).click()
        tiles = page.get_by_test_id('chart-tile')
        first_id = tiles.nth(0).get_attribute('id')
        page.clock.install()
        tiles.nth(0).get_by_role('button', name='删除图表').click()
        toast = page.get_by_test_id('delete-toast')
        expect(tiles).to_have_count(1)
        expect(toast).to_contain_text('图表已删除')
        # Changes made after deletion must not be undone along with the deleted chart.
        page.get_by_label('图表标题', exact=True).fill('Keep this edit')
        page.clock.run_for(4900)
        toast.get_by_role('button', name='撤销').click()
        expect(tiles).to_have_count(2)
        assert tiles.nth(0).get_attribute('id') == first_id
        expect(tiles.nth(1).locator('strong')).to_have_text('Keep this edit')
        expect(toast).to_have_count(0)
        tiles.nth(0).get_by_role('button', name='删除图表').click()
        page.clock.run_for(5000)
        expect(toast).to_have_count(0)
        expect(tiles).to_have_count(1)
        page.get_by_role('button', name='撤销', exact=True).click()
        expect(tiles).to_have_count(2)
        # Rapid deletions replace the toast; the previous timer cannot hide the new one.
        tiles.nth(0).get_by_role('button', name='删除图表').click()
        page.clock.run_for(4500)
        tiles.nth(0).get_by_role('button', name='删除图表').click()
        page.clock.run_for(600)
        expect(toast).to_be_visible()
        toast.get_by_role('button', name='撤销').click()
        expect(tiles).to_have_count(1)
        page.clock.run_for(5000)
        expect(toast).to_have_count(0)
        browser.close()
        print('PASS: toast restores only deleted chart at 4.9s; expires at 5s; toolbar undo; rapid-delete timer reset')


if __name__ == '__main__':
    main()
