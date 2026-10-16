"""Offline Chromium browser test of side-panel UI and real DOM content escaping."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'chromium/panel/index.html').read_text().replace('<script src="panel.js"></script>','')
css=(ROOT/'chromium/panel/panel.css').read_text()
js=(ROOT/'chromium/panel/panel.js').read_text()
MOCK="""()=>{
 window.__calls=[];
 window.chrome={storage:{local:{get:async()=>({settings:{}})}},runtime:{sendMessage:async msg=>{
 window.__calls.push(msg);
 if(msg.type==='WINDOW')return {ok:true,windowId:5};
 if(msg.type==='STATUS')return {ok:true,engineTab:51,jobs:[],preview:{messages:[
 {role:'user',text:'Ничего не выполняй <img src=x onerror=alert(1)>'},
 {role:'assistant',text:'Тестовый ответ из видимого DOM'}]}};
 return {ok:true};
 }}};
} """
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 try:
  page=browser.new_page(viewport={'width':320,'height':650})
  page.set_content(html)
  page.add_style_tag(content=css)
  page.evaluate(MOCK)
  page.add_script_tag(content=js)
  page.locator('.message.assistant').wait_for()
  assert page.locator('.message').count()==2
  assert page.locator('.message img').count()==0,'Unsafe rendering!'
  assert 'Тестовый ответ' in page.locator('.message.assistant').inner_text()
  page.locator('#prompt').fill('Продолжить')
  page.locator('#send').click()
  page.wait_for_function('window.__calls.some(m=>m.type==="FOLLOWUP")')
  assert page.evaluate('window.__calls.filter(m=>m.type==="FOLLOWUP").at(-1).text')=='Продолжить'
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  print('PASS: Chromium panel 320px: actual DOM-only text, XSS-safe, follow-up, no page overflow')
 finally:browser.close()
