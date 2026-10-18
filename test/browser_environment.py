from pathlib import Path
import os
from playwright.sync_api import sync_playwright,expect
root = Path(__file__).resolve().parent.parent
(root/'test-results').mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),args=['--no-sandbox'])
 try:
  page=b.new_page(viewport={'width':375,'height':812});page.goto('http://127.0.0.1:18922')
  origin=page.url.rstrip('/')
  r=page.request.post(origin+'/api/launch',headers={'Origin':origin,'Authorization':'Bearer '+'workspace-test-token-123456789012345'},data={})
  assert r.status==200
  page.goto(r.json()['url']);page.reload()
  expect(page.locator('#exitStatus')).to_have_text('bash 接続中')
  for w,h in [(320,700),(375,812),(1280,900),(375,420)]:
   page.set_viewport_size({'width':w,'height':h});page.locator('#input').focus()
   for _ in range(50):
    if page.evaluate('Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-height")) - innerHeight) < 1'): break
    page.wait_for_timeout(20)
   else: raise AssertionError('viewport resize did not settle')
   m=page.locator('#input').evaluate('(e)=>({left:e.getBoundingClientRect().left,pane:e.closest(".composer").getBoundingClientRect().left,offset:getComputedStyle(e).outlineOffset})')
   assert m['left']>m['pane'] and m['offset']=='-2px',m
   terminal=page.locator('section.terminal').bounding_box();layout=page.locator('.layout').bounding_box()
   assert terminal['height']/layout['height']>=.59 if w<800 else terminal['width']/layout['width']>.6
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.set_viewport_size({'width':375,'height':812})
  page.locator('#input').fill('今のフォルダ');expect(page.locator('#simulationBadge')).to_have_text('予測',timeout=10000)
  expect(page.locator('#simulationNote')).to_contain_text('実環境での確認は行っていません')
  page.locator('#input').focus();page.screenshot(path=str(root/'test-results/environment-mobile.png'))
  page.locator('#logout').click();print('PASS focus inset, terminal proportions, four viewports, text-only backend prediction')
 finally:b.close()
