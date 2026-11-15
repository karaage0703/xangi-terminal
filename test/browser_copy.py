"""Copy output with real xterm, PTY and clipboard in an isolated browser fixture."""
import json
import os
import re
import socket
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parent.parent
results = root / 'test-results'
results.mkdir(exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
with (results / 'copy-server.log').open('w') as log:
    server = subprocess.Popen(['node', 'test/fixture.mjs'], cwd=root,
                              env={**os.environ, 'PORT': str(port)}, stdout=log, stderr=log)
    try:
        for attempt in range(100):
            with socket.socket() as sock:
                if sock.connect_ex(('127.0.0.1', port)) == 0:
                    break
            assert server.poll() is None, 'fixture exited'
            time.sleep(.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox'])
            try:
                for width, height in [(320, 568), (390, 844), (390, 360), (1440, 900)]:
                    context = browser.new_context(viewport={'width': width, 'height': height},
                        has_touch=width < 800, permissions=['clipboard-read', 'clipboard-write'],
                        extra_http_headers={'Tailscale-User-Login': 'owner@example.test'})
                    page = context.new_page()
                    # Expose the actual module-local terminal only in this test response.
                    page.route('**/app.js', lambda route: route.fulfill(
                        response=(response := route.fetch()),
                        body=response.text() + '\nwindow.copyTestTerminal = () => term;'))
                    errors, frames = [], []
                    page.on('pageerror', lambda e: errors.append(str(e)))
                    page.on('websocket', lambda ws: ws.on('framesent', lambda data: frames.append(json.loads(data))))
                    page.goto(f'http://127.0.0.1:{port}')
                    expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
                    page.locator('#output').click()
                    page.keyboard.type('printf COPY_PTY_OK')
                    page.keyboard.press('Enter')
                    expect(page.locator('.xterm-rows')).to_contain_text('COPY_PTY_OK')
                    page.get_by_role('button', name='出力をコピー', exact=True).click(timeout=3000)
                    expect(page.locator('#copyText')).to_have_value(re.compile('COPY_PTY_OK'))
                    page.locator('#copyClose').click()
                    # Synthetic ANSI + soft wrap + blank line + literal markup, after real PTY smoke.
                    text = '日本語 ' + 'long-token-' * 30 + ' end'
                    payload = '\x1b[31m' + text + '\x1b[0m\r\n\r\n<script>literal</script>\r\n' + '\r\n'.join(f'row-{i}' for i in range(60))
                    page.evaluate('(value) => new Promise(resolve => { const terminal = window.copyTestTerminal(); terminal.reset(); terminal.write(value, resolve); })', payload)
                    expected = text + '\n\n<script>literal</script>\n' + '\n'.join(f'row-{i}' for i in range(60))
                    before = len([f for f in frames if f.get('type') == 'input'])
                    page.locator('#copyOutput').click()
                    expect(page.locator('#copyText')).to_have_value(expected)
                    assert page.locator('#copyText').get_attribute('readonly') is not None
                    page.locator('#copyAll').click()
                    expect(page.locator('#copyStatus')).to_contain_text('コピーしました')
                    assert page.evaluate('navigator.clipboard.readText()') == expected
                    # Manual partial selection remains possible.
                    page.locator('#copyText').evaluate('(el) => {el.focus(); el.setSelectionRange(0, 3)}')
                    assert page.locator('#copyText').evaluate('(el) => el.value.slice(el.selectionStart, el.selectionEnd)') == '日本語'
                    # Missing API and permission denial both retain text and select it for native copy.
                    for api in ['undefined', "{writeText: () => Promise.reject(new Error('denied'))}"]:
                        page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:" + api + "})")
                        page.locator('#copyAll').click()
                        expect(page.locator('#copyStatus')).to_contain_text('長押し')
                        assert page.locator('#copyText').evaluate('(el) => el.selectionEnd - el.selectionStart') == len(expected)
                        expect(page.locator('#copyText')).to_have_value(expected)
                    assert len([f for f in frames if f.get('type') == 'input']) == before
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.screenshot(path=str(results / f'copy-{width}-{height}.png'))
                    page.locator('#copyClose').click()
                    expect(page.locator('#copyText')).to_have_value('')
                    expect(page.locator('#copyOutput')).to_be_focused()
                    boxes = [b.bounding_box() for b in page.locator('.terminalToolbar button').all()]
                    assert len({round(b['y']) for b in boxes}) == 1, boxes
                    assert all(b['x'] >= 0 and b['x'] + b['width'] <= width for b in boxes), boxes
                    page.screenshot(path=str(results / f'copy-toolbar-{width}-{height}.png'))
                    # Empty buffer and closing by Escape.
                    page.evaluate('window.copyTestTerminal().reset()')
                    page.locator('#copyOutput').click()
                    expect(page.locator('#copyAll')).to_be_disabled()
                    page.keyboard.press('Escape')
                    expect(page.locator('#copyDialog')).not_to_be_visible()
                    # Pending clipboard rejection must not affect a later dialog.
                    page.evaluate("(v) => new Promise(r => window.copyTestTerminal().write(v, r))", 'old snapshot')
                    page.locator('#copyOutput').click()
                    page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:()=>new Promise((resolve,reject)=>window.rejectCopy=reject)}})")
                    page.locator('#copyAll').click()
                    page.locator('#copyClose').click()
                    page.evaluate("(v) => new Promise(r => window.copyTestTerminal().write(v, r))", ' new output')
                    page.locator('#copyOutput').click()
                    page.evaluate("window.rejectCopy(new Error('denied'))")
                    expect(page.locator('#copyStatus')).to_have_text('')
                    expect(page.locator('#copyAll')).to_be_enabled()
                    expect(page.locator('#copyText')).to_have_value('old snapshot new output')
                    page.evaluate("(v) => new Promise(r => window.copyTestTerminal().write(v, r))", ' later')
                    expect(page.locator('#copyText')).to_have_value('old snapshot new output')
                    page.locator('#copyClose').click()
                    # Switching terminal cannot expose the previous terminal's snapshot.
                    page.locator('#newTerminal').click()
                    expect(page.locator('[role=tab]')).to_have_count(2)
                    expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
                    page.locator('#copyOutput').click()
                    assert 'old snapshot' not in page.locator('#copyText').input_value()
                    page.locator('#copyClose').click()
                    assert not errors, errors
                    context.close()
                print('PASS 4 viewports: PTY output, clipboard, ANSI stripping, soft wraps, scrollback, Japanese, blank lines, literal markup, partial selection, denial/missing API, no PTY input, empty buffer, cleanup and layout')
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
