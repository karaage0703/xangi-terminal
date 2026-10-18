"""IME and stale suggestion checks for the direct-execution UI."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':375,'height':812});frames=[]
        page.on('websocket',lambda ws:ws.on('framesent',lambda frame:frames.append(frame)))
        page.goto(os.environ.get('BASE_URL','http://127.0.0.1:18920'))
        origin=page.url.rstrip('/')
        r=page.request.post(origin+'/api/launch',headers={'Origin':origin,'Authorization':'Bearer '+(root/'.runtime/access-token').read_text().strip()},data={})
        assert r.status==200
        page.goto(r.json()['url']);page.reload()
        expect(page.locator('#exitStatus')).to_have_text('bash 接続中')
        calls=[];held=[]
        def proposal(route):
            data=route.request.post_data_json;calls.append(data)
            if data['text']=='fail': route.fulfill(status=502,json={'error':'AI unavailable'})
            elif data['text']=='old': held.append(route)
            else: route.fulfill(json={'command':'printf new','explanation':data['text'],'simulation':'new','effects':'標準出力'})
        page.route('**/api/suggest',proposal)
        page.locator('#input').fill('old');expect(page.locator('#status')).to_have_text('候補を更新中…')
        page.locator('#input').fill('new');page.wait_for_timeout(500)
        held.pop().fulfill(json={'command':'printf old','explanation':'old','simulation':'old','effects':''})
        expect(page.locator('#commandInput')).to_have_value('printf new')
        expect(page.locator('#input')).to_have_value('new')
        before=len(calls)
        page.locator('#commandInput').fill('printf manual');page.wait_for_timeout(500)
        assert len(calls)==before
        expect(page.locator('#execute')).to_be_enabled()
        # Composition Enter in the command editor must not send bytes to the shell.
        page.locator('#commandInput').dispatch_event('compositionstart')
        page.locator('#commandInput').fill('日本語変換中')
        sent=sum('"type":"input"' in str(x) for x in frames)
        page.locator('#commandInput').press('Enter');page.wait_for_timeout(200)
        assert sum('"type":"input"' in str(x) for x in frames)==sent
        page.locator('#commandInput').dispatch_event('compositionend')
        # Natural-language IME also waits until committed.
        page.locator('#input').dispatch_event('compositionstart');page.locator('#input').fill('変換中')
        page.wait_for_timeout(600);assert len(calls)==before
        page.locator('#input').dispatch_event('compositionend');expect(page.locator('#preview')).to_be_visible()
        page.locator('#input').fill('fail');expect(page.locator('#error')).to_have_text('AI unavailable')
        page.locator('#commandInput').fill("printf 'OFFLINE:%s\\n' works");page.locator('#commandInput').press('Enter')
        expect(page.locator('.xterm-rows')).to_contain_text('OFFLINE:works')
        assert page.locator('#confirm').count()==0
        print('PASS stale responses, manual commands require no AI/approval, IME Enter protected')
    finally:browser.close()
