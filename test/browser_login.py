from pathlib import Path
import os
from playwright.sync_api import sync_playwright,expect
root = Path(__file__).resolve().parent.parent
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE'),args=['--no-sandbox'])
 try:
  context=b.new_context(extra_http_headers={'Tailscale-User-Login':'owner@example.test'},viewport={'width':375,'height':812})
  page=context.new_page()
  checked=[]
  def check_pending(route):
   expect(page.locator('#connecting')).to_have_text('接続を確認中…')
   assert page.locator('#alternativeLogin').count()==0
   assert page.locator('#loginForm').count()==0
   assert page.locator('#login h1, #login .eyebrow, footer').count()==0
   assert 'やりたいことから' not in page.content()
   assert page.locator('#tailnetLogin, #logout, #loginOptions').count()==0
   checked.append(True)
   route.continue_()
  page.route('**/api/info',check_pending,times=1)
  page.goto('http://127.0.0.1:18923')
  expect(page.locator('#exitStatus')).to_have_text('bash 接続中')
  assert checked
  page.reload();expect(page.locator('#exitStatus')).to_have_text('bash 接続中')
  context.close()
  context=b.new_context();page=context.new_page()
  response=context.request.post('http://127.0.0.1:18923/api/launch',headers={'Origin':'http://127.0.0.1:18923','Authorization':'Bearer workspace-test-token-123456789012345'},data={})
  assert response.status==200
  page.goto(response.json()['url']);expect(page.locator('#exitStatus')).to_have_text('bash 接続中');assert '#' not in page.url
  context.close()
  context=b.new_context(extra_http_headers={'Tailscale-User-Login':'other@example.test'});page=context.new_page();page.goto('http://127.0.0.1:18923')
  expect(page.locator('#connecting')).to_contain_text('xangiの拡張一覧から開き直してください');expect(page.locator('#workspace')).not_to_be_visible();context.close()
  print('PASS owner auto login, no logout or manual connection screen, local single-use link + fragment removal, non-owner denied')
 finally:b.close()
