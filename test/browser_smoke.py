"""Real PTY + optional real LLM browser checks. Server must be running."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    options={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('CHROMIUM_EXECUTABLE'): options['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
    browser=p.chromium.launch(**options)
    try:
        page=browser.new_page(viewport={'width':375,'height':812})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(os.environ.get('BASE_URL','http://127.0.0.1:18920'))
        if os.environ.get('TAILNET'): expect(page.locator('#exitStatus')).to_have_text('bash 接続中')
        else:
            origin=page.url.rstrip('/')
            r=page.request.post(origin+'/api/launch',headers={'Origin':origin,'Authorization':'Bearer '+(root/'.runtime/access-token').read_text().strip()},data={})
            assert r.status==200
            page.goto(r.json()['url']);page.reload()
        expect(page.locator('#exitStatus')).to_have_text('bash 接続中')
        rows=page.locator('.xterm-rows')
        assert page.locator('#confirm').count()==0
        page.locator('#commandInput').fill("export TEST_VALUE=ready; cd /tmp; printf 'VALUE:%s\\n' \"$TEST_VALUE\"")
        page.locator('#commandInput').press('Enter')
        expect(rows).to_contain_text('VALUE:ready')
        expect(page.locator('#cwd')).to_have_text('/tmp',timeout=5000)
        page.locator('#commandInput').fill("printf 'STILL:%s\\n' \"$TEST_VALUE\"");page.locator('#execute').click()
        expect(rows).to_contain_text('STILL:ready')
        # Type directly into the actual terminal, without the command editor.
        page.locator('.xterm-helper-textarea').focus()
        page.keyboard.type("printf 'DIRECT:%s\\n' ok");page.keyboard.press('Enter')
        expect(rows).to_contain_text('DIRECT:ok')
        page.locator('#commandInput').fill('read -p "Your answer: " answer; printf "REPLY:%s\\n" "$answer"');page.locator('#execute').click()
        page.locator('.xterm-helper-textarea').focus();page.keyboard.type('hello');page.keyboard.press('Enter')
        expect(rows).to_contain_text('REPLY:hello')
        page.locator('#commandInput').fill('top -d 1');page.locator('#execute').click()
        expect(rows).to_contain_text('Tasks:',timeout=10000)
        page.locator('.xterm-helper-textarea').focus();page.keyboard.type('q')
        page.locator('#commandInput').fill("printf 'RETURN:%s\\n' ok");page.locator('#execute').click()
        expect(rows).to_contain_text('RETURN:ok')
        # Optional AI must never be a prerequisite for the preceding operations.
        page.locator('#input').fill('今いるフォルダを表示して')
        expect(page.locator('#preview')).to_be_visible(timeout=60000)
        assert 'pwd' in page.locator('#commandInput').input_value()
        expect(page.locator('#execute')).to_be_enabled()
        for width,height in [(320,700),(375,812),(414,896),(768,900),(1280,900),(375,420)]:
            page.set_viewport_size({'width':width,'height':height})
            page.locator('#execute').scroll_into_view_if_needed()
            box=page.locator('#output').bounding_box()
            assert box['height']>20 and box['y']>=0 and box['y']+box['height']<=height,(width,height,box)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.set_viewport_size({'width':375,'height':812});page.locator('#input').scroll_into_view_if_needed()
        page.screenshot(path=str(root/'test-results/pty-mobile.png'))
        assert not errors,errors
        print('PASS direct Enter/button/terminal input, persistent cd/export, read interaction, optional live AI, 6 viewports',flush=True)
    finally:browser.close()
