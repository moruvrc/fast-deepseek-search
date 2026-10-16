"""Offline Chromium MV3 smoke test. Uses a simulated official-origin DeepSeek
page, NOT the real service. Checks extension load, selection, background, main-
world input, and message acknowledgement. Does not certify live deployment."""
import tempfile,time
from pathlib import Path
from playwright.sync_api import sync_playwright
EXT=Path(__file__).resolve().parents[1]/'releases'/'chrome'
HTML='''<!doctype html><html><head><title>DeepSeek test fixture</title></head><body><button id="new" aria-label="New chat">New chat</button><section id="messages"></section><div id="form" style="width:400px;height:80px"><textarea id="chat-input" placeholder="Message DeepSeek" style="width:350px;height:45px"></textarea><button id="send" aria-label="Send">Send</button></div>
<script>
window.__sent=[];
document.querySelector('#new').addEventListener('click',()=>{document.querySelector('#messages').replaceChildren();history.pushState(null,'','/');});
document.querySelector('#send').addEventListener('click',()=>{
 const v=document.querySelector('#chat-input').value;
 if(!v.trim())return;
 window.__sent.push(v);
 const node=document.createElement('div');node.className='ds-message';node.textContent=v;
 document.querySelector('#messages').append(node);
 document.querySelector('#chat-input').value='';
 history.pushState(null,'','/a/chat/s/abcd123');
});
</script></body></html>'''
with sync_playwright() as p:
 with tempfile.TemporaryDirectory(prefix='moru-chromium-') as profile:
  ctx=p.chromium.launch_persistent_context(profile,headless=False,executable_path='/usr/bin/chromium',args=['--no-sandbox',f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
  errors=[]
  try:
   ctx.route('https://chat.deepseek.com/**',lambda route:route.fulfill(status=200,body=HTML,content_type='text/html'))
   ctx.route('https://example.com/**',lambda route:route.fulfill(status=200,body='<html><body><p id="target" style="margin:90px">Проверка выделения и реальной передачи текста</p></body></html>',content_type='text/html'))
   sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker',timeout=10000)
   ext_id=sw.url.split('/')[2]
   print('EXTENSION',ext_id,'WORKER',sw.url)
   page=ctx.new_page();page.goto('https://example.com/test')
   page.wait_for_function('document.documentElement.getAttribute("data-askds-selection-installed") !== null',timeout=8000)
   box=page.evaluate('''()=>{const el=document.querySelector('#target');const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));return range.getBoundingClientRect().toJSON();}''')
   page.wait_for_timeout(300)
   x=max(9,min(box['right']-72+6,page.viewport_size['width']-81))+15
   y=box['bottom']+9+18
   page.mouse.click(x,y)
   ds=None
   for _ in range(70):
    arr=[pg for pg in ctx.pages if pg.url.startswith('https://chat.deepseek.com/')]
    if arr:ds=arr[0];break
    page.wait_for_timeout(200)
   assert ds,'DeepSeek companion tab not created'
   print('ENGINE',ds.url)
   ds.wait_for_function('window.__sent?.length===1',timeout=26000)
   sent=ds.evaluate('window.__sent')
   assert sent==['Проверка выделения и реальной передачи текста'],sent
   print('PASS: selection -> queue -> companion DeepSeek tab -> native input -> one send')
   panel=ctx.new_page();panel.goto(f'chrome-extension://{ext_id}/panel/index.html')
   panel.locator('#prompt').wait_for(timeout=6000)
   assert 'moru' in panel.title().lower()
   print('PASS: Chromium panel loads')
   # Test follow-up via extension panel and user messages in existing chat.
   panel.locator('#prompt').fill('Продолжение беседы')
   panel.locator('#send').click()
   ds.wait_for_function('window.__sent?.length===2',timeout=26000)
   assert ds.evaluate('window.__sent[1]')=='Продолжение беседы'
   print('PASS: follow-up sent to same official chat')
  finally:ctx.close()
