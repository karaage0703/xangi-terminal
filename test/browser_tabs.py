import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parent.parent
(root / 'test-results').mkdir(exist_ok=True)
origin = os.environ.get('TERMINAL_TEST_URL', 'http://127.0.0.1:18927')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE'), args=['--no-sandbox'])
    try:
        for width, height in [(1440, 900), (375, 812), (375, 420)]:
            page = browser.new_page(viewport={'width': width, 'height': height}, extra_http_headers={'Tailscale-User-Login': 'owner@example.test'})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(origin)
            expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
            def command(text):
                page.locator('#output').click()
                page.keyboard.type(text)
                page.keyboard.press('Enter')
            command("export TAB_VALUE=first; printf '\\nFIRST_READY\\n'")
            expect(page.locator('.xterm-rows')).to_contain_text('FIRST_READY')
            if width < 800:
                page.locator('#composerView').click()
            page.locator('#commandInput').fill('echo draft-first')
            page.locator('#newTerminal').click()
            expect(page.locator('[role=tab]')).to_have_count(2)
            expect(page.locator('#commandInput')).to_have_value('')
            expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
            if width < 800:
                page.locator('#terminalView').click()
            command("printf '\\nSECOND:%s\\n' \"$TAB_VALUE\"")
            expect(page.locator('.xterm-rows')).to_contain_text('SECOND:')
            assert 'SECOND:first' not in page.locator('.xterm-rows').inner_text()
            # A delayed command must complete while this tab is not displayed.
            command("sleep 1; printf '\\nBACKGROUND_FINISHED\\n'")
            page.locator('[role=tab]').first.click()
            expect(page.locator('[role=tab]').first).to_have_attribute('aria-selected', 'true')
            expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
            expect(page.locator('#commandInput')).to_have_value('echo draft-first')
            command("printf '\\nBACK:%s\\n' \"$TAB_VALUE\"")
            expect(page.locator('.xterm-rows')).to_contain_text('BACK:first')
            page.wait_for_timeout(1100)
            page.locator('[role=tab]').nth(1).click()
            expect(page.locator('.xterm-rows')).to_contain_text('BACKGROUND_FINISHED')
            # Eight tabs remain reachable without widening the page.
            for count in range(3, 9):
                page.locator('#newTerminal').click()
                expect(page.locator('[role=tab]')).to_have_count(count)
                expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
            expect(page.locator('#newTerminal')).to_be_disabled()
            page.locator('[role=tab]').last.focus()
            page.keyboard.press('Home')
            expect(page.locator('[role=tab]').first).to_be_focused()
            page.keyboard.press('Enter')
            expect(page.locator('[role=tab]').first).to_have_attribute('aria-selected', 'true')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            expect(page.locator('#newTerminal')).to_be_in_viewport()
            page.screenshot(path=str(root / f'test-results/tabs-{width}-{height}.png'))
            # Closing a background tab keeps the current terminal and frees a slot.
            page.locator('.closeTab').nth(1).click()
            expect(page.locator('[role=tab]')).to_have_count(7)
            expect(page.locator('#newTerminal')).to_be_enabled()
            page.locator('.closeTab').first.click()
            expect(page.locator('[role=tab]')).to_have_count(6)
            expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
            assert not errors, errors
            page.request.post(origin + '/api/logout', headers={'Origin': origin}, data={})
            page.close()
        print('PASS desktop/mobile/short viewport: independent tabs, drafts, background command, eight tabs, keyboard navigation, close active/background')
    finally:
        browser.close()
