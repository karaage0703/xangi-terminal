"""Preview requests during conversion, empty input and visible result/error."""
import os
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox'])
    try:
        for width,height in [(390,844),(1440,1000)]:
            page=browser.new_page(viewport={'width':width,'height':height},extra_http_headers={'Tailscale-User-Login':'owner@example.test'})
            page.goto('http://127.0.0.1:18924')
            expect(page.locator('#workspace')).to_be_visible()
            calls=[];held=[]
            def reply(route):
                data=route.request.post_data_json;calls.append(data)
                if data['mode']=='natural': held.append(route)
                elif data['text']=='fail': route.fulfill(status=502,json={'error':'確認に失敗しました'})
                else: route.fulfill(json={'command':data['text'],'explanation':'現在の場所','simulation':'/example','effects':'表示のみ','previewKind':'executed'})
            page.route('**/api/suggest',reply)
            page.locator('#explain').click()
            expect(page.locator('#error')).to_contain_text('確認するコマンドを入力')
            assert not calls
            page.locator('#input').fill('現在の場所')
            expect(page.locator('#status')).to_have_text('候補を更新中…')
            page.locator('#explain').click()
            expect(page.locator('#explain')).to_have_text('候補生成後に確認します…')
            assert len(calls)==1
            held.pop().fulfill(json={'command':'pwd','explanation':'候補','simulation':'','effects':''})
            expect(page.locator('#simulation')).to_have_text('/example')
            expect(page.locator('#explain')).to_be_enabled()
            assert [(c['mode'],c['text']) for c in calls]==[('natural','現在の場所'),('command','pwd')]
            assert page.locator('#preview details').get_attribute('open') is not None
            pane=page.locator('.composer').bounding_box();result=page.locator('#preview summary').bounding_box()
            assert pane['y'] <= result['y'] < pane['y']+pane['height']
            page.locator('#commandInput').fill('fail');page.locator('#explain').click()
            expect(page.locator('#error')).to_have_text('確認に失敗しました')
            pane=page.locator('.composer').bounding_box();err=page.locator('#error').bounding_box()
            assert pane['y'] <= err['y'] < pane['y']+pane['height']
            page.close()
        print('PASS empty command feedback, queued preview retains candidate, result/error scrolled into view: mobile and desktop')
    finally:browser.close()
