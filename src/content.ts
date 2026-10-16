// Isolated, Shadow-DOM-only selection UI for ordinary pages.
{
  // The DOM survives a temporary add-on reload. Do not let a stale marker from
  // an earlier version permanently disable the toolbar on already-open pages.
  const root = document.documentElement;
  const BUILD = '2.0.0';
  const marker = 'data-askds-selection-installed';
  if (root && !root.classList.contains('askds-sidebar') && root.getAttribute(marker) !== BUILD) {
    root.querySelector('#askds-extension-host')?.remove();
    root.setAttribute(marker, BUILD);
    type Snap = { text: string; rect: DOMRect; owner: Element | null };
    let chosen: Snap | null = null;
    let mode: 'closed' | 'toolbar' | 'preview' = 'closed';
    let suppressCurrentSelection = false;
    let restoreFocus: Element | null = null;
    let scheduled = 0;
    let toastTimer = 0;
    let enabled = true;
    let animate = true;

    const host = document.createElement('div');
    host.id = 'askds-extension-host';
    Object.assign(host.style, {position:'fixed', inset:'0', width:'100vw', height:'100vh', zIndex:'2147483647', pointerEvents:'none', overflow:'visible'});
    (document.documentElement || document.body).appendChild(host);
    const shadow = host.attachShadow({mode:'closed'});
    const css = document.createElement('style');
    css.textContent = `
      :host{all:initial;display:block;color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      *,*::before,*::after{box-sizing:border-box}button,textarea{font:inherit}
      .toolbar,.preview,.toast{position:fixed;pointer-events:auto;background:#191c24;color:#f2f4f8;border:1px solid #333a49;box-shadow:0 12px 36px #0007,0 2px 7px #0005}
      .toolbar{display:flex;align-items:center;padding:3px;gap:2px;border-radius:11px;min-height:36px;opacity:0;transform:translateY(5px) scale(.97);transition:opacity .16s,transform .16s}
      .toolbar.visible{opacity:1;transform:translateY(0) scale(1)}
      button{cursor:pointer;user-select:none;-webkit-user-select:none}
      .tool{width:31px;height:29px;display:grid;place-items:center;background:transparent;border:0;border-radius:8px;color:#cbd4eb;transition:background .15s,color .15s}
      .tool:hover,.tool:focus-visible{background:#29364f;color:#7fa8ff;outline:none}.tool:active{transform:scale(.95)}
      svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}
      .split{width:1px;height:18px;background:#343b49}
      .preview{width:min(370px,calc(100vw - 18px));max-height:calc(100vh - 18px);display:flex;flex-direction:column;overflow:hidden;border-radius:16px;opacity:0;transform:translateY(8px) scale(.985);transition:opacity .18s,transform .18s}
      .preview.visible{opacity:1;transform:translateY(0) scale(1)}
      .preview-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px 11px;border-bottom:1px solid #303540;flex-shrink:0}
      .brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:680;letter-spacing:-.15px}
      .mark{display:grid;place-items:center;width:23px;height:23px;border-radius:8px;background:#1d315e;color:#77a5ff}
      .close{border:0;background:transparent;border-radius:7px;color:#98a2b7;font-size:21px;line-height:1;padding:1px 6px}.close:hover,.close:focus-visible{background:#29313e;color:white;outline:none}
      .preview-scroll{padding:14px 15px 12px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;min-height:0}
      .label{color:#939cad;display:block;font-size:11px;font-weight:650;letter-spacing:.035em;margin:0 0 7px}
      textarea{display:block;width:100%;min-height:70px;max-height:25vh;background:#11151d;border:1px solid #30394b;color:#edf2ff;border-radius:10px;resize:none;line-height:1.5;padding:10px 11px;outline:0;font-size:12.5px;overflow-y:auto}
      textarea:focus{border-color:#648dff;box-shadow:0 0 0 2px #4d7cff2b}textarea::placeholder{color:#788298}
      .selection-label{margin-top:15px;display:flex;justify-content:space-between;gap:8px}
      .count{color:#69758b;font-size:11px;font-weight:400;letter-spacing:0}
      .excerpt{font-size:12.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;color:#c4ccdb;background:#11151d;border:1px solid #283040;border-radius:10px;padding:10px 11px;max-height:min(38vh,260px);overflow-y:auto;scrollbar-width:thin}
      .actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:11px 15px 13px;border-top:1px solid #303540;flex-shrink:0}
      .btn{border:1px solid #374052;border-radius:9px;min-height:33px;padding:0 14px;background:#242a35;color:#c8cfdb;font-size:12px;font-weight:600}
      .btn:hover,.btn:focus-visible{background:#303747;outline:none}.btn.primary{border-color:#4d7cff;background:#4d7cff;color:white;box-shadow:0 2px 9px #304fa02e}
      .btn.primary:hover,.btn.primary:focus-visible{background:#648dff}
      .toast{width:min(360px,calc(100vw - 24px));bottom:18px;right:16px;border-radius:12px;padding:13px 15px;font-size:12px;line-height:1.55;white-space:pre-line;opacity:0;transform:translateY(7px);transition:opacity .2s,transform .2s}
      .toast.visible{opacity:1;transform:translateY(0)}.toast strong{color:#a9c2ff}
      :host(.no-motion) .toolbar,:host(.no-motion) .preview,:host(.no-motion) .toast{transition:none}
      @media(prefers-reduced-motion:reduce){.toolbar,.preview,.toast,.tool{transition:none!important}}
    `;
    shadow.appendChild(css);
    const tool = document.createElement('div'); tool.className = 'toolbar'; tool.setAttribute('role','toolbar'); tool.setAttribute('aria-label','Действия с выделенным текстом');
    const send = document.createElement('button'); send.className='tool'; send.type='button';send.title='Отправить в DeepSeek';send.setAttribute('aria-label','Отправить в DeepSeek');
    send.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 12.5 20 4l-5.5 16-3.1-6.9L4 12.5Z"/><path d="m11.4 13.1 4.9-5.3"/></svg>';
    const split=document.createElement('span');split.className='split';
    const edit=document.createElement('button'); edit.className='tool';edit.type='button';edit.title='Добавить инструкцию';edit.setAttribute('aria-label','Добавить инструкцию');
    edit.innerHTML='<svg viewBox="0 0 24 24"><path d="m4 20 4.5-1L20 7.5 16.5 4 5 15.5 4 20Z"/><path d="m14.6 5.9 3.5 3.5"/></svg>';
    tool.append(send,split,edit);shadow.appendChild(tool);

    const preview=document.createElement('section');preview.className='preview';preview.setAttribute('role','dialog');preview.setAttribute('aria-label',"moru's deepseek: подготовка запроса");
    const top=document.createElement('header');top.className='preview-head';
    const brand=document.createElement('div');brand.className='brand';brand.innerHTML='<span class="mark"><svg viewBox="0 0 24 24"><path d="M3 11c3-2 5-2 8 0 3-2 6-2 10 0-1 7-7 10-13 7-3-1-4-4-5-7Z"/><path d="M17 12h.01"/></svg></span>moru\'s deepseek';
    const exit=document.createElement('button');exit.className='close';exit.type='button';exit.textContent='×';exit.setAttribute('aria-label','Закрыть');
    top.append(brand,exit);
    const scroll=document.createElement('div');scroll.className='preview-scroll';
    const label=document.createElement('label');label.className='label';label.textContent='ВАША ИНСТРУКЦИЯ';
    const prompt=document.createElement('textarea');prompt.rows=2;prompt.placeholder='Что сделать с выделенным текстом?';prompt.setAttribute('aria-label','Что сделать с выделенным текстом?');
    const label2=document.createElement('div');label2.className='label selection-label';
    const t=document.createElement('span');t.textContent='ВЫДЕЛЕННЫЙ ТЕКСТ';
    const count=document.createElement('span');count.className='count';label2.append(t,count);
    const excerpt=document.createElement('div');excerpt.className='excerpt';excerpt.setAttribute('aria-label','Выделенный текст, только чтение');
    scroll.append(label,prompt,label2,excerpt);
    const actions=document.createElement('footer');actions.className='actions';
    const cancel=document.createElement('button');cancel.className='btn';cancel.textContent='Отмена';cancel.type='button';
    const submit=document.createElement('button');submit.className='btn primary';submit.textContent='Отправить';submit.type='button';
    actions.append(cancel,submit);preview.append(top,scroll,actions);shadow.append(preview);
    const toast=document.createElement('div');toast.className='toast';toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');shadow.append(toast);
    tool.style.display='none';preview.style.display='none';toast.style.display='none';

    const showToast=(message:string) => {
      window.clearTimeout(toastTimer);toast.textContent=message;toast.style.display='block';
      requestAnimationFrame(()=>toast.classList.add('visible'));
      toastTimer=window.setTimeout(()=>{toast.classList.remove('visible');window.setTimeout(()=>toast.style.display='none',200);},6600);
    };
    const hide = () => { mode='closed';chosen=null;tool.classList.remove('visible');tool.style.display='none';preview.classList.remove('visible');preview.style.display='none'; };
    const clamp = (n:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,n));
    const locate=(el:HTMLElement,rect:DOMRect,width:number,height:number) => {
      const vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
      const x=clamp(rect.right-width+6,9,Math.max(9,vw-width-9));
      let y=rect.bottom+9;
      if (y+height>vh-9) y=rect.top-height-9;
      el.style.left=`${x}px`;el.style.top=`${clamp(y,9,Math.max(9,vh-height-9))}px`;
    };
    // Never capture passwords or rich editors. Deep DOM selections can include
    // an ancestor outside an editable region, so check both endpoints too.
    const isSensitive=(element:Element|null):boolean => {
      if (!element) return false;
      const field=element.closest('input,textarea,select,[contenteditable], [role="textbox"]');
      if (!field) return false;
      if (field instanceof HTMLInputElement) return !['text','search'].includes(field.type);
      if (field instanceof HTMLTextAreaElement) return false;
      return field.matches('select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
    };
    const elementFor=(node:Node|null):Element|null => node instanceof Element?node:node?.parentElement??null;
    const onScreen=(r:DOMRect):boolean => r.width>=0 && r.height>=0 && r.bottom>=0 && r.top<=innerHeight && r.right>=0 && r.left<=innerWidth;
    let lastRoot:ShadowRoot|null=null;
    const snapshot=():Snap|null => {
      // Textareas and inputs don't expose their selection with getSelection().
      // The active element may be nested in an open ShadowRoot.
      const active=lastRoot?.activeElement??document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        if (isSensitive(active)) return null;
        const start=active.selectionStart,end=active.selectionEnd;
        if (start===null || end===null || end<=start) return null;
        const text=active.value.slice(start,end);
        if (!text.trim()) return null;
        const rect=active.getBoundingClientRect();
        return onScreen(rect)?{text,rect,owner:active}:null;
      }
      const shadowSelection=(lastRoot as any)?.getSelection?.() as Selection|undefined;
      const selection=shadowSelection && !shadowSelection.isCollapsed?shadowSelection:window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
      const text=selection.toString();if(!text.trim())return null;
      const range=selection.getRangeAt(selection.rangeCount-1);
      const owner=elementFor(range.commonAncestorContainer);
      if(isSensitive(owner) || isSensitive(elementFor(range.startContainer)) || isSensitive(elementFor(range.endContainer)))return null;
      const rects=Array.from(range.getClientRects()).filter(r=>r.width>0 && r.height>0);
      // In a long multi-line selection the last rect can be offscreen.
      const rect=[...rects].reverse().find(onScreen)??range.getBoundingClientRect();
      if(!rect || !onScreen(rect))return null;
      return {text,rect,owner};
    };
    const showTool=(s:Snap) => {
      chosen=s;mode='toolbar';preview.style.display='none';tool.style.display='flex';
      locate(tool,s.rect,72,36);
      requestAnimationFrame(()=>tool.classList.add('visible'));
    };
    const sync = () => {
      scheduled=0;
      if(!enabled || mode==='preview')return;
      const s=snapshot();
      if(!s){suppressCurrentSelection=false;if(mode==='toolbar')hide();return;}
      if(suppressCurrentSelection)return;
      if(mode==='toolbar' && chosen?.text===s.text){ chosen=s;locate(tool,s.rect,72,36);return; }
      showTool(s);
    };
    const schedule=() => {if(scheduled || mode==='preview')return;scheduled=requestAnimationFrame(sync);};
    // Capture phase on window handles pages that intercept document events.
    // Reselect after the browser finishes processing pointer and keyboard input.
    const inputComplete=(event:Event) => {
      const origin=event.composedPath()[0];
      if(origin instanceof Node){const nodeRoot=origin.getRootNode();lastRoot=nodeRoot instanceof ShadowRoot?nodeRoot:null;}
      schedule();
      window.setTimeout(schedule,0);
      window.setTimeout(schedule,65);
    };
    const openPreview=() => {
      if(!chosen)return;
      restoreFocus=document.activeElement;
      excerpt.textContent=chosen.text;count.textContent=`${chosen.text.length.toLocaleString('ru-RU')} симв.`;
      prompt.value='';prompt.style.height='';mode='preview';tool.style.display='none';
      preview.style.display='flex';
      locate(preview,chosen.rect,Math.min(370,innerWidth-18),Math.min(425,innerHeight-18));
      requestAnimationFrame(()=>{preview.classList.add('visible');prompt.focus();});
    };
    const closePreview=() => {
      hide();if(restoreFocus instanceof HTMLElement)restoreFocus.focus({preventScroll:true});restoreFocus=null;
    };
    const dispatch=async(text:string) => {
      if(!text.length)return;
      suppressCurrentSelection=true;
      hide();
      const id=(crypto.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`);
      try{
        const result=await browser.runtime.sendMessage({type:'ENQUEUE',id,text});
        if(!result?.ok){showToast(result?.error??'Не удалось сохранить запрос.');return;}
        if(!result.opened)showToast("Запрос сохранён. Откройте moru's deepseek кнопкой расширения на панели Firefox. Отправка продолжится автоматически.");
      }catch{showToast('Не удалось передать запрос расширению. Проверьте его состояние.');}
    };
    send.addEventListener('pointerdown',e=>e.preventDefault());
    edit.addEventListener('pointerdown',e=>e.preventDefault());
    send.addEventListener('click',()=>{if(chosen)void dispatch(chosen.text);});
    edit.addEventListener('click',openPreview);
    exit.addEventListener('click',closePreview);cancel.addEventListener('click',closePreview);
    submit.addEventListener('click',()=>{if(!chosen)return;const instruction=prompt.value.trim();void dispatch(instruction?`${instruction}\n\n${chosen.text}`:chosen.text);});
    prompt.addEventListener('input',()=>{prompt.style.height='0px';prompt.style.height=Math.min(prompt.scrollHeight,innerHeight*.25)+'px';});
    prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();submit.click();}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && mode==='preview'){e.preventDefault();closePreview();}else if(e.key==='Escape'&&mode==='toolbar'){hide();}},true);
    document.addEventListener('pointerdown',e=>{
      if(!e.composedPath().includes(host))suppressCurrentSelection=false;
      if(mode==='preview' && !e.composedPath().includes(host))closePreview();
      if(mode==='toolbar' && !e.composedPath().includes(host)) {
        // A new selection may be underway. Recheck after pointerup.
        tool.classList.remove('visible');
      }
    },true);
    document.addEventListener('selectionchange',schedule,{passive:true,capture:true});
    window.addEventListener('mouseup',inputComplete,{passive:true,capture:true});
    window.addEventListener('pointerup',inputComplete,{passive:true,capture:true});
    window.addEventListener('touchend',inputComplete,{passive:true,capture:true});
    window.addEventListener('keyup',e=>{suppressCurrentSelection=false;inputComplete(e);},{passive:true,capture:true});
    window.addEventListener('focusin',inputComplete,{passive:true,capture:true});
    window.addEventListener('scroll',()=>{if(mode==='toolbar')schedule();},{passive:true,capture:true});
    window.addEventListener('resize',()=>{if(mode==='preview'&&chosen)locate(preview,chosen.rect,Math.min(370,innerWidth-18),Math.min(425,innerHeight-18));else schedule();},{passive:true});
    void browser.storage.local.get('settings').then((data:any)=>{
      enabled=data.settings?.toolbar!==false;animate=data.settings?.animations!==false;
      if(!animate)host.classList.add('no-motion');
    }).catch(()=>undefined);
    browser.storage.onChanged.addListener((changes:any,area:string)=>{
      if(area!=='local'||!changes.settings)return;
      const s=changes.settings.newValue;
      enabled=s?.toolbar!==false;animate=s?.animations!==false;
      host.classList.toggle('no-motion',!animate);if(!enabled)hide();
    });
  }
}
