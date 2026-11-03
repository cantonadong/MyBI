"""Smoke-test every chart with a real API and browser renderer."""
import json
import os
from playwright.sync_api import sync_playwright, expect

def main():
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        url = os.getenv('WORKBENCH_TEST_URL', 'http://127.0.0.1:8000')
        response = page.request.post(url + '/api/imports/paste', data={'name': 'Catalog test', 'text': 'region\ttarget\tamount\tprofit\tx\nA\tB\t10\t3\t1\nA\tC\t20\t5\t2\nB\tC\t30\t8\t3'})
        assert response.ok, response.text()
        dataset_id = response.json()['id']
        page.goto(url)
        expect(page.get_by_test_id('active-dataset')).to_contain_text('Catalog test')
        page.get_by_role('button', name='＋ 柱状图', exact=True).click()
        page.get_by_label('图表数据集', exact=True).select_option(dataset_id)
        page.get_by_label('X 轴', exact=True).select_option('region')
        page.get_by_label('Y 轴', exact=True).select_option('amount')
        page.get_by_role('button', name='添加指标', exact=True).click()
        types = ['bar', 'line', 'area', 'mixed', 'pie', 'radar', 'funnel', 'gauge', 'waterfall', 'heatmap', 'histogram', 'boxplot', 'tree', 'treemap', 'sunburst', 'sankey', 'kpi', 'table', 'scatter', 'map']
        for kind in types:
            page.get_by_label('图表类型').select_option(kind)
            if kind == 'heatmap': page.get_by_label('Y 轴', exact=True).select_option('target')
            if kind == 'sankey': page.get_by_label('目标节点', exact=True).select_option('target')
            if kind in ['tree', 'treemap', 'sunburst']: page.get_by_label('下一级分类（可选）', exact=True).select_option('target')
            if kind == 'scatter': page.get_by_label('X 轴', exact=True).select_option('x')
            if kind == 'map':
                page.get_by_label('X 轴', exact=True).select_option('region')
                geo = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'name': 'A'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}}]}
                page.get_by_label('地图 GeoJSON').set_input_files({'name': 'map.geojson', 'mimeType': 'application/json', 'buffer': json.dumps(geo).encode()})
            expect(page.get_by_text('加载中…', exact=True)).to_have_count(0)
            expect(page.locator('.tile-error')).to_have_count(0)
            if kind == 'table': expect(page.locator('.table-scroll table')).to_be_visible()
            elif kind == 'kpi': expect(page.locator('.metric')).to_have_text('60')
            else: expect(page.locator('.chart-view canvas').first).to_be_visible()
            assert not errors, (kind, errors)
            print('PASS:', kind)
        page.screenshot(path='tests/catalog-tested.png', full_page=True)
        browser.close()

if __name__ == '__main__': main()
