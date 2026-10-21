"""Run against an isolated terminal server with the test Tailnet identity."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parent.parent
(root / 'test-results').mkdir(exist_ok=True)
origin = os.environ.get('TERMINAL_TEST_URL', 'http://127.0.0.1:18935')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox'])
    try:
        for width, height in [(320,568),(390,844),(390,360),(1440,900)]:
            context = browser.new_context(viewport={'width':width,'height':height}, permissions=['clipboard-read','clipboard-write'], extra_http_headers={'Tailscale-User-Login':'owner@example.test'})
            page=context.new_page(); errors=[]; frames=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('websocket',lambda ws:ws.on('framesent',lambda data:frames.append(data)))
            page.goto(origin); expect(page.locator('#paste')).to_be_enabled()
            def inputs():
                import json
                return [json.loads(f)['data'] for f in frames if json.loads(f).get('type')=='input']
            # Real browser clipboard, actual xterm and PTY. Newline never reaches PTY.
            page.evaluate("navigator.clipboard.writeText('echo PASTE_OK\\n')")
            page.locator('#paste').click()
            expect(page.locator('.xterm-rows')).to_contain_text('echo PASTE_OK')
            assert all('\r' not in v and '\n' not in v for v in inputs()), inputs()
            page.get_by_role('button',name='Enter',exact=True).click()
            page.wait_for_function("() => document.querySelector('.xterm-rows').textContent.split('PASTE_OK').length >= 3")
            # Reject multiline, controls, empty and oversized input without any PTY write.
            for value in ['echo first\necho second','echo x\x1b[201~\recho y','','a'*16001]:
                before=len(inputs());page.evaluate('(v)=>navigator.clipboard.writeText(v)',value)
                page.locator('#paste').click();expect(page.locator('#pasteDialog')).to_be_visible()
                assert len(inputs())==before
                page.locator('#pasteClose').click()
            # Permission denial uses a native editable field; cancel sends nothing.
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>Promise.reject(new Error('denied'))}})")
            before=len(inputs());page.locator('#paste').click();expect(page.locator('#pasteError')).to_contain_text('直接読み取れません')
            page.locator('#pasteInput').fill('echo MANUAL_OK\n');page.locator('#pasteInsert').click()
            expect(page.locator('#pasteDialog')).not_to_be_visible();assert len(inputs())==before+1
            assert '\r' not in inputs()[-1] and '\n' not in inputs()[-1]
            page.get_by_role('button',name='Enter',exact=True).click()
            # Missing API and cancellation.
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})")
            before=len(inputs());page.locator('#paste').click();page.locator('#pasteInput').fill('do not send');page.locator('#pasteClose').click();assert len(inputs())==before
            # Clipboard read completing after a tab change must not target the new shell.
            page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>new Promise(r=>window.resolvePaste=r)}})")
            page.locator('#paste').click();page.locator('#newTerminal').click();expect(page.locator('[role=tab]')).to_have_count(2);expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
            before=len(inputs());page.evaluate("resolvePaste('echo WRONG_TAB')")
            expect(page.locator('#pasteError')).to_contain_text('接続先が変わりました');assert len(inputs())==before
            page.locator('#pasteClose').click()
            boxes=[b.bounding_box() for b in page.locator('.terminalKeys button').all()]
            assert len({round(b['y']) for b in boxes})==1, boxes
            assert all(b['height']>=44 for b in boxes) if width<800 else True
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(root/f'test-results/paste-{width}-{height}.png'))
            assert not errors,errors
            context.close()
        print('PASS 4 viewports: real clipboard → PTY, Enter-only execution, multiline/control/empty/size guards, denial/missing API, manual paste/cancel, tab change, single-row controls')
    finally:
        browser.close()
