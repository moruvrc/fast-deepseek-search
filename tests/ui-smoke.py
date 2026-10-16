"""Optional UI smoke checks with Python Playwright and locally installed Chromium.
Run: python tests/ui-smoke.py (no external requests or DeepSeek credentials).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=(ROOT/'dist/content.js').read_text()
MOCK_BROWSER='''() => { window.__sent=[]; window.browser={ runtime:{sendMessage:async m=>{window.__sent.push(m);return {ok:true,opened:false}}},storage:{local:{get:async()=>({settings:{toolbar:true,animations:true}})},onChanged:{addListener:()=>{}}}} }'''

def setup(page):
    page.set_content('<style>body{font:16px system-ui;padding:100px;background:#f8f9fb}</style><p id="a" style="width:390px">Полиморфизм позволяет использовать единый интерфейс для различных реализаций.</p>')
    page.evaluate(MOCK_BROWSER)
    page.add_script_tag(content=SCRIPT)
    rect=page.evaluate('''() => { const r=document.createRange();r.selectNodeContents(document.querySelector('#a'));const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));return Array.from(r.getClientRects()).at(-1).toJSON();}''')
    page.wait_for_timeout(270)
    return rect

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        for width in [280,320,360,420,500,580]:
            page=browser.new_page(viewport={'width':width,'height':560})
            r=setup(page)
            x=max(9,min(r['right']-72+6,width-72-9));y=r['bottom']+9
            page.mouse.click(x+15,y+18)
            page.wait_for_timeout(80)
            sent=page.evaluate('window.__sent')
            assert len(sent)==1,('direct send failed',width,sent)
            assert sent[0]['text']=='Полиморфизм позволяет использовать единый интерфейс для различных реализаций.'
            page.close()
        page=browser.new_page(viewport={'width':580,'height':560})
        r=setup(page);x=max(9,min(r['right']-72+6,580-72-9));y=r['bottom']+9
        page.mouse.click(x+51,y+18);page.wait_for_timeout(100)
        page.keyboard.type('Объясни простыми словами')
        page.mouse.click(348,300);page.wait_for_timeout(70)
        sent=page.evaluate('window.__sent')
        assert len(sent)==1
        assert sent[0]['text']=='Объясни простыми словами\n\nПолиморфизм позволяет использовать единый интерфейс для различных реализаций.'
        page.close()
        print('UI smoke passed: selection at 6 widths and prompt composition.')
    finally: browser.close()
