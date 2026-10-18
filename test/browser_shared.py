import os
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox'])
 contexts=[b.new_context(viewport={'width':w,'height':900},extra_http_headers={'Tailscale-User-Login':'owner@example.test'}) for w in [390,1440]]
 pages=[c.new_page() for c in contexts]
 for page in pages:
  page.goto('http://127.0.0.1:18924/')
  expect(page.locator('#workspace')).to_be_visible()
 first,second=pages
 first.locator('#backendOpen').click();expect(first.locator('#backendSelect')).to_be_enabled()
 first.locator('#backendSelect').select_option('xangi:terminal');expect(first.locator('#backendSelect')).to_be_enabled()
 first.locator('#showExplanation').uncheck();expect(first.locator('#showExplanation')).to_be_enabled()
 second.locator('#backendOpen').click()
 expect(second.locator('#backendSelect')).to_have_value('xangi:terminal')
 expect(second.locator('#showExplanation')).not_to_be_checked()
 second.locator('#showExplanation').check();expect(second.locator('#showExplanation')).to_be_enabled()
 expect(first.locator('#showExplanation')).to_be_checked(timeout=10000)
 second.reload();expect(second.locator('#workspace')).to_be_visible()
 second.locator('#backendOpen').click();expect(second.locator('#backendSelect')).to_have_value('xangi:terminal')
 expect(second.locator('#showExplanation')).to_be_checked()
 print('PASS independent browser contexts share agent and display preferences in both directions and after reload')
 b.close()
