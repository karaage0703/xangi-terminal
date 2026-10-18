import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parent.parent
(root/'test-results').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),args=['--no-sandbox'])
    try:
        page=browser.new_page(viewport={'width':375,'height':812})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:18922')
        origin=page.url.rstrip('/')
        r=page.request.post(origin+'/api/launch',headers={'Origin':origin,'Authorization':'Bearer '+'workspace-test-token-123456789012345'},data={})
        assert r.status==200
        page.goto(r.json()['url']);page.reload()
        expect(page.locator('#exitStatus')).to_have_text('bash 接続中')
        page.locator('#commandInput').fill("export WORKSPACE_VALUE=kept; printf 'SET:%s\\n' ok");page.locator('#commandInput').press('Enter')
        expect(page.locator('.xterm-rows')).to_contain_text('SET:ok')
        page.locator('#gitOpen').click();expect(page.locator('#gitSummary')).to_contain_text(subprocess.check_output(['git','branch','--show-current'],cwd=root,text=True).strip())
        expect(page.locator('#gitFiles')).to_be_visible();page.locator('#gitClose').click()
        page.locator('#addWorkspace').click();page.locator('#workspacePath').fill('/tmp');page.locator('#workspaceForm .primary').click()
        expect(page.locator('#cwd')).to_have_text('/tmp')
        expect(page.locator('#gitOpen')).to_have_text('Git管理外',timeout=15000)
        page.locator('#commandInput').fill('printf "EMPTY:%s\\n" "$WORKSPACE_VALUE"');page.locator('#commandInput').press('Enter')
        expect(page.locator('.xterm-rows')).to_contain_text('EMPTY:')
        page.locator('#workspaceSelect').select_option('default')
        expect(page.locator('#cwd')).to_have_text(str(root))
        page.locator('#commandInput').fill('printf "BACK:%s\\n" "$WORKSPACE_VALUE"');page.locator('#commandInput').press('Enter')
        expect(page.locator('.xterm-rows')).to_contain_text('BACK:kept')
        for width,height in [(320,700),(375,812),(414,896),(1280,900),(375,420)]:
            page.set_viewport_size({'width':width,'height':height})
            for _ in range(50):
                if page.evaluate('Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-height")) - innerHeight) < 1'): break
                page.wait_for_timeout(20)
            else: raise AssertionError('viewport resize did not settle')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            box=page.locator('#output').bounding_box();assert box['height']>=36 and box['y']+box['height']<=height
            page.locator('#gitOpen').click();expect(page.locator('#gitClose')).to_be_in_viewport();page.locator('#gitClose').click()
        page.set_viewport_size({'width':375,'height':812});page.screenshot(path=str(Path(__file__).resolve().parent.parent/'test-results/workspaces-mobile.png'))
        assert not errors, errors
        page.locator('#logout').click()
        print('PASS workspace switch/back preserves export, Git diff/non-repo, 5 viewport sizes, logout')
    finally: browser.close()
