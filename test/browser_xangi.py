from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_EXECUTABLE']} if os.environ.get('CHROMIUM_EXECUTABLE') else {}))
    for width,height in [(390,844),(1440,1000)]:
        page=browser.new_page(viewport={'width':width,'height':height},extra_http_headers={'Tailscale-User-Login':'owner@example.test'})
        page.goto('http://127.0.0.1:18922')
        expect(page.locator('#workspace')).to_be_visible()
        expect(page.locator('#workspaceSelect option[value="xangi:registered"]')).to_have_text('xangi登録フォルダ')
        assert not page.locator('#workspaceDialog').is_visible()
        page.locator('#workspaceSelect').select_option('xangi:registered')
        expect(page.locator('#workspaceSelect option:checked')).to_have_text('xangi登録フォルダ')
        expect(page.locator('#cwd')).to_have_text('/tmp')
        page.locator('#workspaceSelect').select_option('default')
        expect(page.locator('#cwd')).to_have_text(str(Path(__file__).resolve().parent.parent))
        page.locator('#workspaceSelect').select_option(label='xangi登録フォルダ')
        expect(page.locator('#cwd')).to_have_text('/tmp')
        assert page.locator('#agentPanel').count()==0
        page.locator('#backendOpen').click()
        expect(page.locator('#backendSelect')).to_have_value('xangi:codex')
        expect(page.locator('#backendSelect option')).to_have_count(1)
        expect(page.locator('#modelSelect')).to_have_value('fixture-model')
        page.locator('#effortSelect').select_option('high')
        page.locator('#backendClose').click()
        page.reload()
        expect(page.locator('#workspace')).to_be_visible()
        expect(page.locator('#backendOpen')).to_have_text('設定')
        page.locator('#backendOpen').click()
        expect(page.locator('#effortSelect')).to_have_value('high')
        expect(page.locator('#modelSelect option')).to_have_count(2)
        page.locator('#modelSelect').select_option('fixture-model')
        expect(page.locator('#modelSelect')).to_have_value('fixture-model')
        page.locator('#backendClose').click()
        requests=[]
        page.on('request',lambda r: requests.append(r.post_data_json) if r.url.endswith('/api/suggest') else None)
        page.locator('#input').dispatch_event('compositionstart')
        page.locator('#input').fill('現在のフォルダを')
        page.wait_for_timeout(550)
        assert len(requests)==0
        page.locator('#input').fill('現在のフォルダを表示')
        page.locator('#input').dispatch_event('compositionend')
        expect(page.locator('#commandInput')).to_have_value('pwd')
        expect(page.locator('#preview')).not_to_be_visible()
        assert len(requests)==1 and requests[0]['mode']=='natural'
        assert requests[0]['backend']=='xangi:codex'
        assert requests[0]['text']=='現在のフォルダを表示'
        page.locator('#commandInput').fill('pwd')
        page.locator('#explain').click()
        expect(page.locator('#evidence')).to_contain_text('ツールで確認')
        expect(page.locator('#explanation')).to_have_text('xangiで確認')
        expect(page.locator('#simulationBadge')).to_have_text('実行済み（AI報告）')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('section.terminal').bounding_box()['height'] >=160
        Path('test-results').mkdir(exist_ok=True)
        page.screenshot(path=f'test-results/xangi-{width}.png')
        page.close()
    browser.close()
print('PASS registered workspace, backend selection/model, reload retention, mobile/desktop')
