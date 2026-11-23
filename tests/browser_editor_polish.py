"""End-to-end checks for data inspection, properties, and native PNG clipboard."""
import os
from playwright.sync_api import sync_playwright, expect


def main():
    url = os.getenv('WORKBENCH_TEST_URL', 'http://127.0.0.1:8000')
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1700, 'height': 1100}, permissions=['clipboard-read', 'clipboard-write'])
        page = context.new_page()
        page.on('dialog', lambda dialog: dialog.accept())
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        columns = ['category', 'sales', 'profit'] + [f'extra_{i}' for i in range(30)]
        text = '\t'.join(columns) + '\n' + '\n'.join('\t'.join([f'row_{i}', str(i + 1), str(i + 2)] + ['wide value'] * 30) for i in range(120))
        imported = page.request.post(url + '/api/imports/paste', data={'name': 'Preview 120 rows', 'text': text})
        assert imported.ok, imported.text()
        page.goto(url)
        summary = page.get_by_test_id('active-dataset')
        expect(summary).to_contain_text('粘贴')
        expect(summary).to_contain_text('33 列')
        expect(summary).to_contain_text('120 行')
        summary.click()
        dialog = page.get_by_role('dialog', name='数据预览')
        expect(dialog.locator('tbody tr')).to_have_count(10)
        expect(dialog.locator('thead th')).to_have_count(33)
        expect(dialog.locator('tbody tr').last).to_contain_text('row_9')
        assert dialog.locator('.dataset-table-scroll').evaluate('e => e.scrollWidth > e.clientWidth')
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)
        page.get_by_role('button', name='＋ 柱状图', exact=True).click()
        page.get_by_label('图表标题', exact=True).fill('First chart')
        page.get_by_role('button', name='＋ 折线图', exact=True).click()
        page.get_by_label('图表标题', exact=True).fill('Second chart')
        first = page.get_by_test_id('chart-tile').nth(0)
        first.locator('.card-head strong').click()
        expect(page.get_by_label('图表标题', exact=True)).to_have_value('First chart')
        labels = page.locator('.property-body').evaluate('e => [...e.querySelectorAll("input:not([type=checkbox]), select")].slice(0,5).map(x => x.getAttribute("aria-label") || x.closest("label").childNodes[0].textContent)')
        assert labels == ['图表数据集', '图表标题', '图表类型', 'X 轴', 'Y 轴'], labels
        expect(first.get_by_text('继承画布筛选', exact=True)).to_have_count(0)
        expect(first.locator('.data-time')).to_contain_text('更新时间')
        assert '最多' not in first.inner_text()
        for axis in ['n', 's', 'e', 'w']:
            handle = first.locator('.react-resizable-handle-' + axis)
            assert handle.evaluate('e => getComputedStyle(e, "::after").display') == 'none'
            assert handle.evaluate('e => getComputedStyle(e).transform') == 'none'
            edge = handle.bounding_box()
            card = first.bounding_box()
            assert edge['width'] > card['width'] - 40 if axis in ['n', 's'] else edge['height'] > card['height'] - 40
        page.get_by_role('button', name='添加指标', exact=True).click()
        expect(page.get_by_label('Y 轴指标 2')).to_have_value('profit')
        page.get_by_role('button', name='删除指标 1', exact=True).click()
        expect(page.get_by_label('Y 轴', exact=True)).to_have_value('profit')
        page.get_by_text('设置', exact=True).click()
        page.get_by_label('显示更新时间', exact=True).uncheck()
        expect(first.locator('.data-time')).to_have_count(0)
        page.get_by_label('显示更新时间', exact=True).check()
        expect(first.locator('.chart-view canvas')).to_be_visible()
        first.get_by_role('button', name='复制图表', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('图片已复制')
        expect(page.get_by_test_id('chart-tile')).to_have_count(2)
        dimensions = page.evaluate('''async () => {
          const items = await navigator.clipboard.read();
          const blob = await items.find(item => item.types.includes('image/png')).getType('image/png');
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height;
          const ctx=canvas.getContext('2d'); ctx.drawImage(bitmap,0,0);
          const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let colored=0; for(let i=0;i<pixels.length;i+=4) if(pixels[i+3]>0 && Math.min(pixels[i],pixels[i+1],pixels[i+2])<200) colored++;
          const borderWhite = [[0,Math.floor(canvas.height/2)],[canvas.width-1,Math.floor(canvas.height/2)],[Math.floor(canvas.width/2),0],[Math.floor(canvas.width/2),canvas.height-1],[0,0]].every(([x,y])=>[...ctx.getImageData(x,y,1,1).data].every(v=>v===255));
          const borderColors=[[0,Math.floor(canvas.height/2)],[canvas.width-1,Math.floor(canvas.height/2)],[Math.floor(canvas.width/2),0],[Math.floor(canvas.width/2),canvas.height-1],[0,0]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);
          return {width:bitmap.width,height:bitmap.height,colored,borderWhite,borderColors};
        }''')
        box = first.bounding_box()
        assert abs(dimensions['width'] / dimensions['height'] - box['width'] / box['height']) < .01, (dimensions, box)
        assert dimensions['colored'] > 500, dimensions
        assert dimensions['borderWhite'], dimensions
        # The actual OS clipboard supplies PNG to a separate receiving page.
        receiver = context.new_page()
        receiver.goto(url)
        receiver.evaluate('''() => { document.body.innerHTML='<div contenteditable="true" id="receiver">Paste here</div>'; window.received=[]; document.addEventListener('paste', e => { window.received=[...e.clipboardData.items].map(i=>i.type); }); }''')
        receiver.locator('#receiver').click()
        receiver.keyboard.press('Control+v')
        receiver.wait_for_function('window.received.includes("image/png")')
        receiver.close()
        page.bring_to_front()
        surface = page.get_by_test_id('grid-surface').bounding_box()
        page.mouse.click(surface['x'] + 25, surface['y'] + 6 * 68 + 20)
        expect(page.get_by_test_id('chart-tile')).to_have_count(3)
        expect(page.get_by_label('图表标题', exact=True)).to_have_value('First chart')
        page.get_by_label('图表标题', exact=True).fill('Editable pasted chart')
        page.get_by_label('显示更新时间', exact=True).uncheck()
        expect(page.get_by_test_id('chart-tile').nth(2).locator('.data-time')).to_have_count(0)
        expect(first.locator('strong')).to_have_text('First chart')
        expect(page.get_by_test_id('chart-tile').nth(2).locator('strong')).to_have_text('Editable pasted chart')
        page.get_by_test_id('grid-surface').focus()
        page.keyboard.press('Control+v')
        expect(page.get_by_role('status')).to_contain_text('空间不足')
        expect(page.get_by_test_id('chart-tile')).to_have_count(3)
        surface = page.get_by_test_id('grid-surface').bounding_box()
        page.mouse.click(surface['x'] + (surface['width'] + 8) / 2 + 25, surface['y'] + 6 * 68 + 20)
        page.keyboard.press('Control+v')
        expect(page.get_by_test_id('chart-tile')).to_have_count(4)
        with page.expect_response(lambda r: r.url.endswith('/api/dashboards') and r.request.method == 'POST') as saved:
            page.get_by_role('button', name='保存仪表板', exact=True).click()
        placed = saved.value.json()['document']['charts']
        assert [(c['x'], c['y']) for c in placed[2:]] == [(0, 6), (6, 6)]
        expect(page.get_by_role('status')).to_have_text('已保存')
        expect(page.get_by_label('打开仪表板')).not_to_have_value('')
        saved_id = page.get_by_label('打开仪表板').input_value()
        page.reload()
        expect(page.get_by_label('打开仪表板').locator(f'option[value="{saved_id}"]')).to_have_count(1)
        page.get_by_label('打开仪表板').select_option(saved_id)
        expect(page.get_by_test_id('chart-tile')).to_have_count(4)
        expect(summary).to_contain_text('粘贴')
        expect(first.locator('.data-time')).to_contain_text('更新时间')
        expect(page.get_by_test_id('chart-tile').nth(2).locator('.data-time')).to_have_count(0)
        page.get_by_label('图表类型', exact=True).select_option('table')
        table = first.locator('.table-scroll')
        expect(table.locator('tbody tr')).to_have_count(20)
        table.evaluate('''e => { [...e.querySelectorAll('tbody tr')].forEach((row, r) => [...row.cells].forEach((cell,c) => { cell.style.minWidth='120px'; cell.style.backgroundColor = r>=8 && c>=3 ? '#00ff00' : '#ff0000'; })); e.scrollTop=500; e.scrollLeft=600; }''')
        assert table.evaluate('e => e.scrollTop>300 && e.scrollLeft>500')
        point = table.bounding_box()
        card = first.bounding_box()
        first.get_by_role('button', name='复制图表', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('图片已复制')
        color = page.evaluate('''async p => {
          const items=await navigator.clipboard.read(); const blob=await items[0].getType('image/png'); const bitmap=await createImageBitmap(blob);
          const canvas=document.createElement('canvas'); canvas.width=bitmap.width;canvas.height=bitmap.height; const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
          return [...ctx.getImageData(Math.round(p.x*bitmap.width/p.width),Math.round(p.y*bitmap.height/p.height),1,1).data];
        }''', {'x': point['x']-card['x']+10, 'y': point['y']-card['y']+40, 'width': card['width'], 'height': card['height']})
        assert color == [0, 255, 0, 255], color
        page.evaluate("() => { navigator.clipboard.write = async () => { throw new DOMException('Clipboard denied', 'NotAllowedError'); }; }")
        first.get_by_role('button', name='复制图表', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('图片复制失败')
        expect(page.get_by_role('status')).to_contain_text('画布内已复制')
        expect(page.get_by_test_id('chart-tile')).to_have_count(4)
        assert not errors, errors
        page.screenshot(path='tests/editor-polish-tested.png', full_page=True)
        browser.close()
        print('PASS: 10 rows/all columns; ordered properties; remove metrics; settings; PNG clipboard and image paste; editable canvas paste; save/reopen')


if __name__ == '__main__':
    main()
