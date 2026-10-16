'use strict';
(async()=>{
  const $=(id)=>document.getElementById(id), request=(data)=>chrome.runtime.sendMessage(data);
  const status=$('engineState'),dot=$('dot'),queue=$('queue'),messages=$('messages'),welcome=$('welcome'),area=$('conversation'),field=$('prompt');
  let windowId=null,lastRendered='',lastError='',busy=false;
  try{const result=await request({type:'WINDOW'});if(!result?.ok)throw new Error(result?.error);windowId=result.windowId;}catch(e){status.textContent='Ошибка связи с расширением';return;}
  const send=(type,extra={})=>request({type,windowId,...extra});
  const connect=()=>send('OPEN_ENGINE').catch(e=>{queue.hidden=false;queue.textContent=e.message;});
  $('connect').addEventListener('click',connect);$('openTab').addEventListener('click',connect);
  $('send').addEventListener('click',async()=>{const text=field.value;if(!text.trim()||busy)return;busy=true;$('send').disabled=true;
    try{const r=await send('FOLLOWUP',{text});if(!r.ok)throw new Error(r.error);field.value='';void update();}
    catch(e){queue.hidden=false;queue.textContent=e.message||'Не удалось добавить сообщение.';}
    finally{busy=false;$('send').disabled=false;}
  });
  field.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('send').click();}});
  $('settingsBtn').addEventListener('click',()=>{$('options').hidden=!$('options').hidden;});
  $('closeSettings').addEventListener('click',()=>{$('options').hidden=true;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$('options').hidden=true;});
  const initial=await chrome.storage.local.get('settings');
  for(const control of document.querySelectorAll('[data-setting]')){
    control.checked=initial.settings?.[control.dataset.setting]!==false;
    control.addEventListener('change',()=>void send('SET_SETTINGS',{settings:{[control.dataset.setting]:control.checked}}));
  }
  async function update(){
    let r;try{r=await send('STATUS');if(!r.ok)throw new Error(r.error);}catch{status.textContent='Отключено. Проверьте расширение.';return;}
    const connected=Number.isInteger(r.engineTab);dot.classList.toggle('ok',connected);status.textContent=connected?'Связанная вкладка DeepSeek создана':'DeepSeek ещё не открыт';
    const recent=r.preview?.messages||[];
    const serialized=JSON.stringify(recent);
    if(serialized!==lastRendered){const atBottom=area.scrollTop+area.clientHeight>=area.scrollHeight-70;
      lastRendered=serialized;messages.replaceChildren();welcome.hidden=recent.length>0;
      for(const m of recent){const el=document.createElement('div');el.className=`message ${m.role}`;
        const label=document.createElement('small');label.textContent=m.role==='assistant'?'DEEPSEEK':'ВЫ';
        const body=document.createElement('div');body.textContent=m.text;el.append(label,body);messages.append(el);
      }
      if(atBottom)area.scrollTop=area.scrollHeight;
    }
    const arr=r.jobs||[],err=arr.find(j=>j.status==='failed'||j.status==='uncertain');
    const pending=arr.filter(j=>['queued','waiting_for_sidebar','waiting_for_chat','creating_chat','inserting','sending'].includes(j.status));
    const key=JSON.stringify({err,pending:pending.length});
    if(key!==lastError){lastError=key;queue.replaceChildren();queue.hidden=!err&&!pending.length;queue.classList.toggle('good',!err);
      if(err){const title=document.createElement('div');title.textContent=err.error||'Запрос не отправлен.';queue.append(title);
        const copy=document.createElement('button');copy.textContent='Копировать';copy.onclick=()=>navigator.clipboard.writeText(err.text||'').catch(()=>{});queue.append(copy);
        const retry=document.createElement('button');retry.textContent=err.status==='failed'?'Повторить':'Скрыть';
        retry.onclick=()=>void send(err.status==='failed'?'RETRY_FAILED':'DISMISS_UNCERTAIN',{id:err.id}).then(update);queue.append(retry);
      }else if(pending.length){queue.textContent=`В очереди или на отправке: ${pending.length}. Если DeepSeek ждёт входа, нажми «Открыть».`;}
    }
  }
  await update();setInterval(update,1400);
})();
