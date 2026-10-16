"""Offline Chromium smoke tests of selection UI across page structures.

Not a Firefox or authenticated DeepSeek end-to-end test.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=(ROOT/'dist/content.js').read_text()
MOCK='''() => {
  window.__sent=[];
  window.browser={
    runtime:{sendMessage:async m=>{window.__sent.push(m);return {ok:true,opened:true}}},
    storage:{local:{get:async()=>({settings:{toolbar:true,animations:true}})},onChanged:{addListener:()=>{}}}
  }
}'''

def rect_and_select(page,js):
    rect=page.evaluate(js)
    page.wait_for_timeout(180)
    return rect

def click_toolbar(page,r,offset=15):
    # The toolbar is always 72 x 36, clamped into the viewport.
    size=page.viewport_size or {'width':650,'height':520}
    x=max(9,min(r['right']-72+6,size['width']-72-9))
    y=r['bottom']+9
    if y+36>size['height']-9:y=r['top']-36-9
    y=max(9,min(y,size['height']-36-9))
    page.mouse.click(x+offset,y+18)
    page.wait_for_timeout(90)

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        # A large article with site JS intercepting propagation.
        p=browser.new_page(viewport={'width':650,'height':520})
        p.set_content('<main id="page"><p id="target">Выделение на разных страницах и сайтах работает одинаково.</p></main>')
        p.evaluate(MOCK)
        p.evaluate('''() => document.addEventListener('mouseup',e=>e.stopImmediatePropagation(),true)''')
        p.add_script_tag(content=SCRIPT)
        r=rect_and_select(p,'''() => {const a=document.querySelector('#target'),r=document.createRange();r.selectNodeContents(a);getSelection().removeAllRanges();getSelection().addRange(r);a.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return r.getBoundingClientRect().toJSON();}''')
        click_toolbar(p,r)
        assert len(p.evaluate('window.__sent'))==1,'stopPropagation page should submit exactly once'
        p.wait_for_timeout(190)
        assert p.evaluate('window.__sent.length')==1, 'toolbar should not automatically resend'
        p.close()

        # An open page from the previous release must be reinitialized.
        p=browser.new_page(viewport={'width':650,'height':520})
        p.set_content('<html data-askds-selection-installed="1.4.0"><body><div id="askds-extension-host"></div><p id="target">Последняя версия должна запускаться на старой вкладке.</p></body></html>')
        p.evaluate(MOCK)
        p.add_script_tag(content=SCRIPT)
        assert p.evaluate('document.documentElement.getAttribute("data-askds-selection-installed")')=='2.0.0'
        p.add_script_tag(content=SCRIPT)
        assert p.evaluate('document.querySelectorAll("#askds-extension-host").length')==1
        r=rect_and_select(p,'''() => {let r=document.createRange();r.selectNodeContents(document.querySelector('#target'));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));return r.getBoundingClientRect().toJSON();}''')
        click_toolbar(p,r)
        assert len(p.evaluate('window.__sent'))==1,'reinjecting should not duplicate handlers'
        p.close()

        # Selected substring inside a text input.
        p=browser.new_page(viewport={'width':650,'height':520})
        p.set_content('<textarea id="edit" style="position:absolute;left:40px;top:40px;width:300px;height:60px">Этот текст можно выделить в форме</textarea>')
        p.evaluate(MOCK)
        p.add_script_tag(content=SCRIPT)
        r=rect_and_select(p,'''() => {const t=document.querySelector('textarea');t.focus();t.setSelectionRange(5,10);document.dispatchEvent(new Event('selectionchange'));return t.getBoundingClientRect().toJSON()}''')
        click_toolbar(p,r)
        assert p.evaluate('window.__sent[0]?.text')=='текст',p.evaluate('window.__sent')
        p.close()

        # Open Shadow DOM uses the same floating action on ordinary selections.
        p=browser.new_page(viewport={'width':650,'height':520})
        p.set_content('<div id="root" style="margin:80px"></div>')
        p.evaluate('''() => {const shadow=document.querySelector('#root').attachShadow({mode:'open'});shadow.innerHTML='<p id="inside">Текст внутри открытого теневого дерева.</p>'; }''')
        p.evaluate(MOCK)
        p.add_script_tag(content=SCRIPT)
        r=rect_and_select(p,'''() => {const el=document.querySelector('#root').shadowRoot.querySelector('#inside');const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true}));return r.getBoundingClientRect().toJSON()}''')
        click_toolbar(p,r)
        assert p.evaluate('window.__sent[0]?.text')=='Текст внутри открытого теневого дерева.',p.evaluate('window.__sent')
        p.close()

        # Separate frame context: same content script is injected per frame by
        # Firefox's all_frames + match_origin_as_fallback declaration.
        p=browser.new_page(viewport={'width':650,'height':520})
        p.set_content('<iframe id="frame" srcdoc="<p id=\'target\'>Текст внутри встроенной страницы.</p>" style="width:450px;height:230px"></iframe>')
        f=p.frame_locator('#frame')
        f.locator('p').wait_for()
        iframe=p.locator('#frame').element_handle().content_frame()
        iframe.evaluate(MOCK)
        iframe.evaluate(SCRIPT)
        r=iframe.evaluate('''() => {const r=document.createRange();r.selectNodeContents(document.querySelector('#target'));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));return r.getBoundingClientRect().toJSON()}''')
        p.wait_for_timeout(180)
        # viewport coordinates inside iframe plus iframe's position
        ib=p.locator('#frame').bounding_box()
        p.mouse.click(ib['x']+max(9,r['right']-72+6)+15,ib['y']+r['bottom']+9+18)
        p.wait_for_timeout(100)
        assert iframe.evaluate('window.__sent[0]?.text')=='Текст внутри встроенной страницы.'
        p.close()
        print('PASS site compatibility: intercepted events, reloads, reinjection, textarea, Shadow DOM, iframe.')
    finally:
        browser.close()
