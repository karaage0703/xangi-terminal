import os
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox'])
 for width,height in [(375,812),(390,844),(390,430),(1440,1000)]:
  page=b.new_page(viewport={'width':width,'height':height},extra_http_headers={'Tailscale-User-Login':'owner@example.test'})
  page.goto('http://127.0.0.1:18924/');expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
  if width<800:
   page.locator('#output').click();expect(page.locator('.xterm-helper-textarea')).to_be_focused()
   page.keyboard.type('printf MOBILE_DIRECT');page.keyboard.press('Enter');expect(page.locator('.xterm-rows')).to_contain_text('MOBILE_DIRECT')
   page.locator('#composerView').click();expect(page.locator('section.terminal')).to_be_hidden()
  page.locator('#input').fill('今の場所');page.locator('#refresh').click();expect(page.locator('#commandInput')).to_have_value('pwd')
  page.locator('#commandInput').fill('printf MOBILE_COMMAND')
  page.locator('#execute').click()
  expect(page.locator('section.terminal')).to_be_visible();expect(page.locator('.xterm-rows')).to_contain_text('MOBILE_COMMAND')
  if width<800:
   page.locator('#composerView').click();expect(page.locator('#input')).to_have_value('今の場所')
   assert page.locator('#terminalFocus').count()==0
   command=page.locator('#commandInput').bounding_box();run=page.locator('#execute').bounding_box()
   assert run['y'] >= command['y']+command['height']
   page.locator('#input').scroll_into_view_if_needed()
   expect(page.locator('#input')).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  page.screenshot(path=f'/tmp/terminal-mobile-input-{width}-{height}.png')
  page.close()
 # Simulate iOS: keyboard reduces visualViewport but not the layout viewport.
 page=b.new_page(viewport={'width':390,'height':844},extra_http_headers={'Tailscale-User-Login':'owner@example.test'})
 page.goto('http://127.0.0.1:18924/');expect(page.locator('#exitStatus')).to_have_text('接続済み · bash')
 page.evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:360});visualViewport.dispatchEvent(new Event('resize'))")
 expect(page.locator('.workbar')).to_be_hidden()
 expect(page.locator('header')).to_be_hidden()
 page.wait_for_timeout(150)
 output=page.locator('#output').bounding_box()
 assert output['height'] >= 200, output
 assert page.evaluate('innerHeight') == 844
 assert page.locator('.xterm-rows > div').count() >= 10
 for selector in ['#clear','#reconnect','#cancel','.terminalKeys']:
  box=page.locator(selector).bounding_box()
  assert box and box['y']+box['height'] <= 360, (selector,box)
 page.locator('#output').click();page.keyboard.type('printf COMPACT_OK');page.keyboard.press('Enter')
 expect(page.locator('.xterm-rows')).to_contain_text('COMPACT_OK')
 page.screenshot(path='/tmp/terminal-compact-keyboard.png')
 print(f"PASS visual viewport 360/layout viewport 844: output {output['height']}px, {page.locator('.xterm-rows > div').count()} rows")
 page.evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:844});visualViewport.dispatchEvent(new Event('resize'))")
 expect(page.locator('.workbar')).to_be_visible()
 page.close()
 b.close()
 print('PASS mobile full/short viewport and desktop: direct terminal input, natural conversion, execution and return with input retained')
