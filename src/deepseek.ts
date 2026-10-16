// DOM adapter running IN the official DeepSeek remote sidebar. No network API calls.
{
  const marker='askds_window';
  let windowId = Number(new URLSearchParams(location.search).get(marker));
  try {
    if (Number.isInteger(windowId) && windowId>0 && new URLSearchParams(location.search).has(marker)) {
      sessionStorage.setItem('__askds_panel_window_v1',String(windowId));
    } else windowId=Number(sessionStorage.getItem('__askds_panel_window_v1'));
  } catch { windowId=0; }
  if (windowId>0 && Number.isSafeInteger(windowId) && !document.documentElement.classList.contains('askds-sidebar')) {
    document.documentElement.classList.add('askds-sidebar');
    type Incoming = {id:string,text:string,followUp?:boolean};
    type Status = {id:string,status:string,error?:string,text?:string};
    let running=false;
    let frame=0;
    let statusBox: HTMLDivElement;
    let statusText: HTMLDivElement;
    let host: HTMLDivElement;
    let settingsCard: HTMLDivElement;
    let settingsOpen=false;

    const isVisible=(element:Element):boolean => {
      const e=element as HTMLElement;
      return !!(e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none');
    };
    // Event-driven readiness: changes to the DOM are observed immediately, with a
    // short condition check for client-side route changes that don't mutate DOM.
    const waitUntil=async <T>(test:()=>T|null|undefined|false, ms:number):Promise<T|null> => {
      try { const now=test(); if(now)return now; }catch { /* React may be updating */ }
      return new Promise(resolve=>{
        let settled=false;
        let pendingFrame=0;
        const finish=(value:T|null)=>{
          if(settled)return;
          settled=true;
          observer.disconnect();
          clearTimeout(timeout);
          clearInterval(routeCheck);
          if(pendingFrame)cancelAnimationFrame(pendingFrame);
          resolve(value);
        };
        const check=()=>{
          if(settled)return;
          try { const value=test();if(value)finish(value); }
          catch { /* DOM may be midway through a rerender */ }
        };
        const observer=new MutationObserver(()=>{
          if(settled||pendingFrame)return;
          pendingFrame=requestAnimationFrame(()=>{pendingFrame=0;check();});
        });
        observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-disabled','placeholder','class']});
        // URL changes via history.pushState may not cause a DOM mutation.
        const routeCheck=window.setInterval(check,160);
        const timeout=window.setTimeout(()=>finish(null),ms);
      });
    };
    const report=async(id:string,status:string,error?:string) => {
      const r=await browser.runtime.sendMessage({type:'PANEL_REPORT',windowId,id,status,error});
      if(!r?.ok)throw new Error(r?.error??'Не удалось сохранить состояние запроса.');
    };
    const editor=():HTMLTextAreaElement|HTMLElement|null => {
      const queries=['textarea#chat-input','textarea[placeholder*="Message DeepSeek"]','textarea[placeholder*="Сообщение"]','textarea[placeholder*="消息"]','textarea:not([disabled])','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'];
      for(const query of queries){
        for(const candidate of Array.from(document.querySelectorAll(query))){
          if(isVisible(candidate) && !(candidate as HTMLTextAreaElement).disabled && !candidate.closest('[data-askds-root]'))return candidate as HTMLTextAreaElement|HTMLElement;
        }
      }
      return null;
    };
    const valueOf=(e:HTMLTextAreaElement|HTMLElement):string => e instanceof HTMLTextAreaElement ? e.value : (e.innerText??e.textContent??'');
    const logIn=()=> !!document.querySelector('.ds-sign-in-form__main,.ds-sign-in-form-wrapper,.ds-auth-form-wrapper,input[autocomplete="current-password"],input[type="password"]') || /sign[_-]?in|login/i.test(location.pathname);
    const buttonLike=():HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"],[title],[aria-label],a')).filter(isVisible);
    const clickable=(node:HTMLElement):HTMLElement => node.closest('button,[role="button"],a') as HTMLElement ?? node;
    const findNewChat=():HTMLElement|null => {
      const pattern=/^(new\s*chat|start\s*new\s*chat|нов(ый|ая)\s*(чат|диалог)|新对话|开启新对话|新建对话|新建聊天|新增聊天)$/i;
      const buttons=buttonLike();
      // Only exact or short labels; never click a full chat transcript by substring.
      for(const el of buttons){
        for(const label of [el.getAttribute('aria-label'),el.getAttribute('title'),el.innerText?.trim()]) {
          if(label && label.length<55 && pattern.test(label.trim()))return clickable(el);
        }
      }
      for(const el of document.querySelectorAll<HTMLElement>('div,span')){
        if(!isVisible(el))continue;
        if(el.childElementCount>4)continue;
        const text=(el.textContent??'').trim();
        if(text.length<32 && pattern.test(text)){
          const ancestor=el.closest<HTMLElement>('button,[role="button"],a,[class*="cursor-pointer"]');
          if(ancestor && isVisible(ancestor))return ancestor;
        }
      }
      return null;
    };
    const inputScope=(e:HTMLElement):HTMLElement => {
      let scope:HTMLElement=e;
      for(let i=0;i<4;i++){
        const p=scope.parentElement;if(!p)break;
        const box=p.getBoundingClientRect();
        if(box.height>280||box.height<30||box.width<140)break;
        scope=p;
      }
      return scope;
    };
    const findSend=(e:HTMLElement):HTMLElement|null => {
      const scope=inputScope(e);
      const all=Array.from(scope.querySelectorAll<HTMLElement>('button,[role="button"],.ds-icon-button')).filter(el=>isVisible(el)&&el!==e);
      const disabled=(el:HTMLElement)=> (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled')==='true' || el.hasAttribute('data-disabled');
      const candidates=[...all,...buttonLike()].filter((value,index,arr)=>arr.indexOf(value)===index).filter(el=>!disabled(el));
      const textual=/^(send|отправить|发送|send message|submit)$/i;
      let answer=candidates.find(el=>[el.getAttribute('aria-label'),el.getAttribute('title'),el.innerText?.trim()].some(v=>v && v.length<30 && textual.test(v)));
      if(answer)return clickable(answer);
      answer=all.find(el=>el.matches('.ds-button._52c986b,.ds-icon-button._52c986b,.ds-button--circle._52c986b')&&!disabled(el));
      if(answer)return answer;
      // Structural fallback: the right-most enabled circular button close to input.
      const ebox=e.getBoundingClientRect();
      const local=all.filter(el=>{
        if(disabled(el))return false;
        const r=el.getBoundingClientRect();
        return r.width>=22&&r.width<=58&&r.height>=22&&r.height<=58&&r.left>=ebox.left+ebox.width*.45&&Math.abs(r.bottom-ebox.bottom)<95&&!!el.querySelector('svg');
      });
      local.sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right);
      return local.length===1?local[0]:null; // Ambiguous controls: never guess.
    };
    // A companion content script in the MAIN world inserts text using the
    // website's native setters, so React sees the same input as the user.
    const insertText=async(text:string):Promise<void> => {
      const id=crypto.randomUUID();
      const result=await new Promise<{ok:boolean;reason?:string}>((resolve,reject)=>{
        let closed=false;
        const done=(answer:{ok:boolean;reason?:string})=>{
          if(closed)return;closed=true;
          clearTimeout(timeout);window.removeEventListener('message',receive);
          resolve(answer);
        };
        const receive=(event:MessageEvent)=>{
          if(event.source!==window || event.origin!==location.origin)return;
          const data=event.data;
          if(data?.channel==='moru-deepseek-input-v1' && data?.kind==='insert-result' && data.id===id){
            done({ok:data.ok===true,reason:typeof data.reason==='string'?data.reason:undefined});
          }
        };
        const timeout=window.setTimeout(()=>{
          if(closed)return;closed=true;
          window.removeEventListener('message',receive);
          reject(new Error('Не удалось связаться с редактором DeepSeek. Обновите страницу в боковой панели.'));
        },3500);
        window.addEventListener('message',receive);
        window.postMessage({channel:'moru-deepseek-input-v1',kind:'insert',id,text},location.origin);
      });
      if(!result.ok)throw new Error(result.reason??'DeepSeek не принял текст в поле ввода.');
    };
    const threadRoute=()=>/^\/a\/chat\/s\/[^/]+/.test(location.pathname);
    // The editor can be replaced by React while submitting. Always observe the
    // CURRENT editor and messages, rather than trusting the old textarea node.
    const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
    const messagePrefix=(value:string)=>normalized(value).slice(0,Math.min(70,Math.max(1,normalized(value).length)));
    const matchingUserTurns=(text:string):number => {
      const prefix=messagePrefix(text);
      if(!prefix)return 0;
      const bubbles=document.querySelectorAll<HTMLElement>(
        '.ds-message,[data-role="user"],[data-message-role="user"],.message.user'
      );
      let count=0;
      for(const bubble of Array.from(bubbles)){
        if(bubble.matches('.ds-message')){
          if(bubble.querySelector('.ds-assistant-message-main-content,.ds-think-content'))continue;
        }
        const contents=normalized(bubble.innerText||bubble.textContent||'');
        // For long, collapsed messages DeepSeek may only display a prefix.
        if(contents.includes(prefix) || (prefix.length>=30 && contents.includes(prefix.slice(0,30))))count++;
      }
      return count;
    };
    // Fast path: '/' with an empty editor is already DeepSeek's new-chat screen.
    // Never waste up to 12s searching for a button we do not need to click.
    const onEmptyNewChatScreen=()=>{
      const e=editor();
      return location.pathname==='/' && !!e && !valueOf(e).trim();
    };
    const newChat=async():Promise<void> => {
      if(onEmptyNewChatScreen())return;
      const current=location.pathname;
      const newButton=await waitUntil(findNewChat,3500);
      if(!newButton){
        throw new Error('Кнопка «Новый чат» не найдена. Откройте новый чат в DeepSeek и нажмите «Повторить».');
      }
      newButton.click();
      const ready=await waitUntil(()=>{
        const e=editor();
        if(!e || valueOf(e).trim())return false;
        // A different route, or a return to DeepSeek's new-chat screen.
        if(current!==location.pathname)return e;
        if(onEmptyNewChatScreen() && current!=='/')return e;
        return false;
      },6000);
      if(!ready)throw new Error('Не удалось подтвердить создание нового чата. Проверьте DeepSeek.');
    };
    const transmit=async(job:Incoming) => {
      let stage:'pre'|'clicked'='pre';
      try{
        const ready=await waitUntil(editor,12000);
        if(!ready){throw new Error(logIn()?'Войдите в аккаунт DeepSeek в боковой панели.':'Редактор DeepSeek не загрузился. Проверьте соединение.');}
        await report(job.id,'creating_chat');
        note('Готовим новый чат…','progress');
        if(!job.followUp) await newChat();
        const e=await waitUntil(editor,6500);
        if(!e)throw new Error('После создания чата поле ввода не найдено.');
        await report(job.id,'inserting');
        note('Добавляем текст…','progress');
        await insertText(job.text);
        // Allow the framework to apply its input event and enable Send.
        const submit=await waitUntil(()=>{
          const live=editor();
          // Never click Send if the editor was cleared or reset by React.
          if(!live || normalized(valueOf(live))!==normalized(job.text))return null;
          return findSend(live);
        },4000);
        if(!submit)throw new Error('Не удалось однозначно определить кнопку отправки. Сообщение осталось в редакторе.');
        await report(job.id,'sending');
        note('Отправляем в DeepSeek…','progress');
        const oldURL=location.pathname;
        const previousUserTurns=matchingUserTurns(job.text);
        submit.click();stage='clicked';
        const acknowledged=await waitUntil(()=>{
          // Strong evidence: a newly rendered user turn matches the submitted text.
          if(matchingUserTurns(job.text)>previousUserTurns)return true;
          // Starting a conversation moves / to /a/chat/s/... in DeepSeek.
          // React may have destroyed the original editor, so re-query it.
          const liveEditor=editor();
          return oldURL==='/' && threadRoute() && !!liveEditor && !valueOf(liveEditor).trim();
        },7000);
        if(!acknowledged)throw new Error('Статус отправки неясен. Проверьте, появилось ли сообщение в чате. Повторная отправка отключена во избежание дублей.');
        await report(job.id,'sent');
        note('Сообщение отправлено в DeepSeek','success');
      }catch(error){
        const message=error instanceof Error?error.message:'Произошла ошибка при работе с DeepSeek.';
        try{await report(job.id,stage==='clicked'?'uncertain':'failed',message);}catch{ /* Do not blindly retry. */ }
        note(message,'error');
      }
    };
    const pump=async()=>{
      if(running)return;
      running=true;
      try{
        while(true){
          const result=await browser.runtime.sendMessage({type:'PANEL_NEXT',windowId});
          if(!result?.ok || !result.job)break;
          await transmit(result.job as Incoming);
        }
      }catch{note('Нет связи с расширением. Переоткройте боковую панель.','error');}
      finally{running=false;void updateStatus();}
    };
    const svg=(name:'gear'|'copy'|'retry'|'close')=>{
      const parts={
        gear:'<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.5 1.5m9.8 9.8 1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"/><circle cx="12" cy="12" r="5"/>',
        copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
        retry:'<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
        close:'<path d="M5 5 19 19M19 5 5 19"/>'};
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${parts[name]}</svg>`;
    };
    const newNode=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string):HTMLElementTagNameMap[K]=>{
      const e=document.createElement(tag);e.className=className;if(text)e.textContent=text;return e;
    };
    let shadow: ShadowRoot;
    function setup(){
      if(host)return;
      host=newNode('div','');host.setAttribute('data-askds-root','');host.id='askds-own-header';
      document.documentElement.appendChild(host);
      shadow=host.attachShadow({mode:'closed'});
      const style=document.createElement('style');style.textContent=`
        :host{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark;--line:#303540;--text:#f2f4f8}
        *{box-sizing:border-box}button{font:inherit;cursor:pointer}svg{width:18px;height:18px;display:block}
        .bar{height:51px;display:flex;align-items:center;justify-content:space-between;padding:0 13px;background:#151821;border-bottom:1px solid var(--line)}
        .brand{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:710;color:#f2f4f8;letter-spacing:-.25px;white-space:nowrap}
        .whale{width:25px;height:25px;display:grid;place-items:center;background:#243c71;border:1px solid #345695;color:#8db1ff;border-radius:9px}
        .whale svg{width:19px;height:19px}.right{display:flex;align-items:center;gap:6px}
        .icon{width:31px;height:31px;border:1px solid transparent;border-radius:8px;background:transparent;color:#aab4c7;display:grid;place-items:center}
        .icon:hover,.icon:focus-visible{background:#252c3a;border-color:#344057;color:#dce7ff;outline:none}
        .indicator{width:6px;height:6px;background:#497dff;border-radius:50%;box-shadow:0 0 0 3px #497dff20;margin-right:3px}
        .indicator.busy{animation:pulse 1s infinite alternate}@keyframes pulse{to{opacity:.35}}
        .status{display:none;padding:9px 12px;background:#1e2533;border-bottom:1px solid #334158;font-size:11px;line-height:1.5;color:#b8c8e4}
        .status.visible{display:block}.status.bad{background:#302329;color:#ffc5c3}
        .status-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.status button{display:flex;align-items:center;gap:4px;border:1px solid #44506a;border-radius:7px;background:#263247;color:#e2ebfd;font-size:11px;padding:5px 8px}.status svg{width:13px;height:13px}
        .settings{position:absolute;top:55px;right:9px;width:min(290px,calc(100vw - 18px));padding:15px;border-radius:14px;border:1px solid #384051;background:#1b202a;box-shadow:0 20px 48px #0009;color:#e6ecf8;display:none;z-index:5}
        .settings.open{display:block}.settings h2{font-size:14px;margin:0 0 6px}.settings p{font-size:11px;line-height:1.55;color:#94a0b6;margin:0 0 12px}
        .setting{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;padding:10px 0;border-top:1px solid #303746}
        .setting input{accent-color:#4d7cff;width:16px;height:16px}
        .settings .footer{border-top:1px solid #303746;margin-top:6px;padding-top:12px;font-size:11px;color:#8794ad}
        a{color:#8aafff} @media(prefers-reduced-motion:reduce){.indicator.busy{animation:none}}
      `;
      shadow.appendChild(style);
      const bar=newNode('div','bar');
      const brand=newNode('div','brand');
      const whale=newNode('span','whale');whale.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.4 11.3c3.5-2.8 6.2-2.8 9.7-.4 3.4-1.6 6.1-1.3 9.5.2-.6 5.8-4.6 9.1-10.1 8.5-5.7-.7-8.9-3.4-9.1-8.3Z"/><path d="M8 11c.5-2.6 2.1-4.5 3.6-5.6.2 2.1.9 3.5 2.1 4.4"/><circle cx="17.5" cy="12.8" r=".8" fill="currentColor" stroke="none"/></svg>';
      brand.append(whale,document.createTextNode("moru's deepseek"));
      const right=newNode('div','right');const dot=newNode('span','indicator');dot.title='Официальный DeepSeek';
      const gear=newNode('button','icon');gear.title="Настройки moru's deepseek";gear.setAttribute('aria-label',"Настройки moru's deepseek");gear.innerHTML=svg('gear');
      right.append(dot,gear);bar.append(brand,right);shadow.append(bar);
      statusBox=newNode('div','status');statusBox.setAttribute('role','status');statusText=newNode('div','');statusBox.append(statusText);shadow.append(statusBox);
      settingsCard=newNode('div','settings');settingsCard.setAttribute('role','dialog');settingsCard.setAttribute('aria-label','Настройки');
      const heading=newNode('h2','', 'Настройки');const info=newNode('p','','Официальный чат DeepSeek. Переписки остаются в вашем аккаунте.');
      settingsCard.append(heading,info);
      const items: [string,string][]=[['toolbar','Показывать кнопки выделения'],['animations','Плавные анимации'],['autoOpen','Пытаться открыть панель']];
      void browser.storage.local.get('settings').then(({settings}:any)=>{
        for(const [key,title] of items){
          const label=newNode('label','setting',title);
          const check=document.createElement('input');check.type='checkbox';check.checked=settings?.[key]!==false;
          check.addEventListener('change',()=>{void browser.storage.local.get('settings').then((result:any)=>browser.storage.local.set({settings:{toolbar:true,animations:true,autoOpen:true,...result.settings,[key]:check.checked}}));});
          label.append(check);settingsCard.append(label);
        }
      });
      const access=newNode('div','footer','Проверка разрешений на сайтах…');
      settingsCard.append(access);
      const updateAccess=async()=>{
        const result=await browser.runtime.sendMessage({type:'ACCESS_STATUS',windowId}).catch(()=>null);
        access.textContent=result?.ok ?
          result.granted ? '✓ Доступ к обычным сайтам разрешён' :
          'Доступ к сайтам выключен. Откройте about:addons → moru\'s deepseek → Разрешения и включите доступ ко всем сайтам.' :
          'Не удалось проверить доступ. Проверьте разрешения дополнения в about:addons.';
      };
      const footer=newNode('div','footer');footer.textContent='Версия 2.0.0 · Независимое расширение';settingsCard.append(footer);
      shadow.append(settingsCard);
      gear.addEventListener('click',()=>{settingsOpen=!settingsOpen;settingsCard.classList.toggle('open',settingsOpen);if(settingsOpen)void updateAccess();});
      document.addEventListener('keydown',e=>{if(e.key==='Escape'&&settingsOpen){settingsOpen=false;settingsCard.classList.remove('open');}},true);
    }
    function note(message:string,kind:'success'|'error'|'progress'){
      setup();statusBox.className=kind==='error'?'status visible bad':'status visible';statusText.textContent=message;
      // Persistent errors are never hidden until the user can see what happened.
      if(kind==='success')window.setTimeout(()=>{if(statusText.textContent===message)statusBox.className='status';},4100);
    }
    const copyText=async(text:string)=>{
      try{await navigator.clipboard.writeText(text);note('Текст скопирован.','success');}
      catch{note('Не удалось скопировать текст. Выделите его в панели вручную.','error');}
    };
    async function updateStatus(){
      if(!statusBox)return;
      const response=await browser.runtime.sendMessage({type:'PANEL_STATUS',windowId}).catch(()=>null);
      if(!response?.ok)return;
      const jobs=response.jobs as Status[];
      const uncertain=jobs.find(j=>j.status==='uncertain');
      const failed=jobs.find(j=>j.status==='failed');
      const pending=jobs.filter(j=>['queued','waiting_for_sidebar','waiting_for_chat','creating_chat','inserting','sending'].includes(j.status));
      const display=uncertain??failed;
      if(display){
        statusBox.className='status visible bad';
        statusText.textContent=display.error??'Не удалось отправить запрос.';
        const current=statusBox.querySelector('.status-actions');current?.remove();
        const actions=newNode('div','status-actions');
        const copy=newNode('button','');copy.innerHTML=svg('copy')+' Скопировать';copy.addEventListener('click',()=>void copyText(display.text??''));actions.append(copy);
        if(display.status==='failed'){
          const retry=newNode('button','');retry.innerHTML=svg('retry')+' Повторить';retry.addEventListener('click',async()=>{
            const r=await browser.runtime.sendMessage({type:'RETRY_FAILED',windowId,id:display.id});
            if(r?.ok){statusBox.className='status';void pump();}else note(r?.error??'Повтор не удался.','error');
          });actions.append(retry);
        }
        statusBox.append(actions);
        if(display.status==='uncertain'){
          const dismiss=newNode('button','');dismiss.innerHTML=svg('close')+' Скрыть';
          dismiss.addEventListener('click',async()=>{
            const r=await browser.runtime.sendMessage({type:'DISMISS_UNCERTAIN',windowId,id:display.id});
            if(r?.ok){statusBox.className='status';void updateStatus();}
            else note(r?.error??'Не удалось скрыть предупреждение.','error');
          });
          actions.append(dismiss);
        }
      }else if(pending.length){
        statusBox.className='status visible';statusText.textContent='Обработка запроса…';statusBox.querySelector('.status-actions')?.remove();
      }else if(statusBox.classList.contains('bad')){
        statusBox.className='status';statusBox.querySelector('.status-actions')?.remove();
      }
    }
    function enhance(){
      if(!document.body)return;
      const e=editor();
      document.querySelectorAll('[data-askds-composer]').forEach(el=>{if(el!==e?.parentElement)el.removeAttribute('data-askds-composer');});
      if(e){
        const area=inputScope(e);
        area.setAttribute('data-askds-composer','');
      }
      // Add a non-invasive copy control to code blocks lacking one.
      for(const pre of Array.from(document.querySelectorAll<HTMLElement>('pre'))){
        if(pre.hasAttribute('data-askds-copy') || !pre.querySelector('code'))continue;
        pre.setAttribute('data-askds-copy','');
        const existing=pre.querySelector('button');if(existing)continue;
        const button=document.createElement('button');button.className='askds-copy-code';button.type='button';button.textContent='Копировать';
        button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(pre.querySelector('code')?.textContent??'');button.textContent='Скопировано';setTimeout(()=>button.textContent='Копировать',1300);}catch{button.textContent='Не удалось';}});
        pre.appendChild(button);
      }
    }
    function scheduleEnhance(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;enhance();});}
    const start=()=>{
      setup();
      enhance();
      const mo=new MutationObserver(scheduleEnhance);
      mo.observe(document.body,{childList:true,subtree:true});
      window.addEventListener('resize',scheduleEnhance,{passive:true});
      browser.storage.onChanged.addListener((changes:any,area:string)=>{
        if(area==='local'&&changes.jobs){void pump();void updateStatus();}
      });
      // Only companion-tab builds mirror real visible DeepSeek messages to the
      // extension panel. No fictional assistant replies and no transcript DB.
      if(new URLSearchParams(location.search).has('askds_engine') ||
         sessionStorage.getItem('__askds_engine_mode')==='1'){
        try{sessionStorage.setItem('__askds_engine_mode','1');}catch{}
        let lastSnapshot='';let snapshotTimer=0;
        const snapshot=()=>{
          snapshotTimer=0;
          const nodes=Array.from(document.querySelectorAll<HTMLElement>('.ds-message,[data-message-role],.ds-assistant-message-main-content'));
          const messages:{role:'user'|'assistant',text:string}[]=[];
          for(const node of nodes.slice(-60)){
            const parent=node.closest('.ds-message,[data-message-role]');
            if(node.matches('.ds-assistant-message-main-content')&&parent&&parent!==node)continue;
            const role=node.matches('.ds-assistant-message-main-content')||node.querySelector('.ds-assistant-message-main-content,.ds-think-content')||node.getAttribute('data-message-role')==='assistant'?'assistant':'user';
            const text=(node.innerText||node.textContent||'').trim().slice(0,24000);
            if(!text||node.closest('[data-askds-root]'))continue;
            if(messages.length && messages[messages.length-1].role===role && messages[messages.length-1].text===text)continue;
            messages.push({role,text});
          }
          const value=JSON.stringify(messages.slice(-40));
          if(value!==lastSnapshot){lastSnapshot=value;void browser.runtime.sendMessage({type:'CHAT_SNAPSHOT',windowId,messages:messages.slice(-40)}).catch(()=>{});}
        };
        const scheduleSnapshot=()=>{if(snapshotTimer)return;snapshotTimer=window.setTimeout(snapshot,650);};
        const mirror=new MutationObserver(scheduleSnapshot);mirror.observe(document.body,{childList:true,subtree:true,characterData:true});
        scheduleSnapshot();window.setInterval(scheduleSnapshot,3000);
      }
      void pump();void updateStatus();
      window.setInterval(()=>{if(!running){void pump();void updateStatus();}},10_000);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
}
