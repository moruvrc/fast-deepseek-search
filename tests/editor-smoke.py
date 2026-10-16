"""Real-browser DOM integration tests with about:blank and mocked extension APIs.

The page is a local simulation, not a live authenticated DeepSeek session.
The sandbox cannot navigate to websites, so the target origin and postMessage
target are adapted only in this test harness, not in production code.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BRIDGE=(ROOT/'dist/deepseek-editor-main.js').read_text().replace("location.hostname !== 'chat.deepseek.com'", 'false')
ADAPTER=(ROOT/'dist/deepseek.js').read_text().replace("location.pathname === '/' && !!e", "(location.pathname === '/' || location.pathname === 'blank') && !!e")
TEXT='Текст из статьи для DeepSeek\nВторая строка'
HTML="""<!doctype html><html><head></head><body><main>
<section id='messages'></section><textarea id='chat-input' placeholder='Message DeepSeek'></textarea>
<button id='send' aria-label='Send'>Send</button></main></body></html>"""
MOCK="""() => {
 window.__reports=[];
 window.__sent=[];
 window.__jobs=[{id:'a'.repeat(32),text:'Текст из статьи для DeepSeek\\nВторая строка'}];
 window.browser={runtime:{sendMessage:async message=>{
   if(message.type==='PANEL_NEXT')return {ok:true,job:window.__jobs.shift()||null};
   if(message.type==='PANEL_REPORT'){
     window.__reports.push({status:message.status,error:message.error});return {ok:true};
   }
   if(message.type==='PANEL_STATUS')return {ok:true,jobs:[]};
   return {ok:true};
 }},storage:{local:{get:async()=>({settings:{}}),set:async()=>{}},onChanged:{addListener:()=>{}}}};
}"""

def setup(page, mode):
    page.goto('about:blank?askds_window=12')
    page.set_content(HTML)
    if mode == 'rich':
        page.evaluate('''()=>{
         const t=document.querySelector('#chat-input');
         const d=document.createElement('div'); d.setAttribute('contenteditable','true');
         d.setAttribute('role','textbox'); d.id='rich';
         d.style.cssText='min-width:240px;min-height:60px;display:block';
         t.replaceWith(d);
        }''')
    page.evaluate("Object.defineProperty(window,'sessionStorage',{configurable:true,value:{setItem(){},getItem(){return null;}}})")
    page.evaluate("Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=> '11111111-1111-4111-8111-111111111111'})")
    page.evaluate(MOCK)
    if mode=='react':
        page.evaluate('''()=>{
          const t=document.querySelector('#chat-input');
          const base=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
          let tracker=t.value;
          Object.defineProperty(t,'value',{
            configurable:true,get(){return base.get.call(this);},
            set(v){tracker=v;base.set.call(this,v);}
          });
          t.addEventListener('input',()=>{
            if(t.value!==tracker){tracker=t.value;window.__reactText=t.value;}
            else {base.set.call(t,window.__reactText||'');}
          });
        }''')
    if mode=='rejected':
        page.evaluate('''()=>{
          const t=document.querySelector('#chat-input');
          t.addEventListener('input',()=>{t.value='';});
        }''')
    if mode=='draft':
        page.evaluate("document.querySelector('#chat-input').value='Мой незавершённый ввод'")
    page.evaluate('''mode=>{
      document.querySelector('#send').addEventListener('click',()=>{
        const e=document.querySelector('#chat-input,#rich');
        const v=e.tagName==='TEXTAREA'?e.value:e.innerText;
        window.__sent.push(v);
        if(mode==='no-proof')return;
        const next=e.cloneNode(false);next.id=e.id;
        e.replaceWith(next);
        const bubble=document.createElement('div');
        bubble.className='ds-message';
        bubble.textContent=v;
        document.querySelector('#messages').append(bubble);
      });
    }''',mode)
    # Main-world bridge script and isolated adapter share same DOM, but no extension network calls.
    page.add_script_tag(content=BRIDGE.replace(', location.origin);', ', "*");'))
    page.add_script_tag(content=ADAPTER.replace(', location.origin);', ', "*");'))

def run():
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
      for mode,expect,clicks in [('plain','sent',1),('react','sent',1),('rich','sent',1),('no-proof','uncertain',1),('rejected','failed',0),('draft','failed',0)]:
        page=browser.new_page()
        setup(page,mode)
        try:
          page.wait_for_function('status=>window.__reports.some(r=>r.status===status)',arg=expect,timeout=14500)
          sent=page.evaluate('window.__sent')
          states=page.evaluate('window.__reports')
          assert len(sent)==clicks,(mode,sent,states)
          if clicks: assert sent[0]==TEXT,(mode,sent,states)
          if mode=='react':
            assert page.evaluate('window.__reactText')==TEXT
          print('PASS',mode,expect,'send clicks:',len(sent))
        except Exception:
          print('DEBUG',mode,page.evaluate('({r:window.__reports,s:window.__sent,react:window.__reactText,editor:document.querySelector("textarea")?.value,markup:document.querySelector("main")?.innerHTML})'))
          raise
        finally:
          page.close()
    finally:
      browser.close()
if __name__=='__main__':run()
