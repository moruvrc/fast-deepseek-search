"""Offline test of the official-page -> Chromium sidebar DOM mirror."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/'releases/chrome/deepseek.js').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=b.new_page();page.goto('about:blank?askds_window=5&askds_engine=1')
  page.set_content('<html><body><textarea id="chat-input"> </textarea><button aria-label="Send">Send</button><main id="feed"></main></body></html>')
  page.evaluate("Object.defineProperty(window,'sessionStorage',{configurable:true,value:{setItem(){},getItem(){return null;}}})")
  page.evaluate('''()=>{window.__events=[];window.browser={runtime:{sendMessage:async m=>{window.__events.push(m);return {ok:true,jobs:[],job:null,granted:true}}},storage:{local:{get:async()=>({settings:{}})},onChanged:{addListener:()=>{}}}};}''')
  page.add_script_tag(content=JS)
  page.evaluate('''()=>{
    const user=document.createElement('div');user.className='ds-message';user.textContent='Original user message';
    const ai=document.createElement('div');ai.className='ds-message';const body=document.createElement('section');body.className='ds-assistant-message-main-content';body.textContent='Answer from the fixture';ai.append(body);
    document.querySelector('#feed').append(user,ai);
  }''')
  page.wait_for_function('window.__events.some(m=>m.type==="CHAT_SNAPSHOT"&&m.messages?.length===2)',timeout=7500)
  mirrored=page.evaluate('window.__events.filter(m=>m.type==="CHAT_SNAPSHOT").at(-1).messages')
  assert mirrored==[{'role':'user','text':'Original user message'},{'role':'assistant','text':'Answer from the fixture'}],mirrored
  print('PASS: Chromium panel receives only observed DOM text and role labels')
  page.close()
 finally:b.close()
