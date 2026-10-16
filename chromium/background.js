// Chromium Manifest V3 companion bridge. The official site runs in a regular
// DeepSeek tab; extensions cannot iframe it into an extension Side Panel.
// Unsents survive worker suspension. Snapshots are memory-only and ephemeral.
'use strict';
const MAX_TEXT=100000, MAX_JOBS=25;
const ACTIVE=new Set(['waiting_for_chat','creating_chat','inserting','sending']);
const WAITING=new Set(['queued','waiting_for_sidebar']);
const DEFAULTS={toolbar:true,animations:true,autoOpen:true};
let serial=Promise.resolve();
const lock=(fn)=>{ const next=serial.then(fn,fn);serial=next.catch(()=>{});return next; };
const engineTabs=new Map();
const previews=new Map();
const normWindow=(n)=>Number.isInteger(n)&&n>=0;
const isEngine=(sender,w)=>normWindow(w)&&sender.tab?.id===engineTabs.get(w)&&sender.tab.url?.startsWith('https://chat.deepseek.com/');
const isPanel=(sender)=>!sender.tab && !!sender.url?.startsWith(chrome.runtime.getURL('panel/'));
const error=(str)=>({ok:false,error:str});
const jobs=async()=>(await chrome.storage.local.get('jobs')).jobs||[];
const store=async(arr)=>chrome.storage.local.set({jobs:arr});
async function restore(){
  const saved=(await chrome.storage.local.get('engineTabs')).engineTabs||{};
  for(const [key,id] of Object.entries(saved))if(Number.isInteger(id)){
    try{const tab=await chrome.tabs.get(id);if(tab.url?.startsWith('https://chat.deepseek.com/'))engineTabs.set(Number(key),id);}catch{}
  }
}
const initialized=restore();
async function persistEngines(){await chrome.storage.local.set({engineTabs:Object.fromEntries(engineTabs)});}
async function ensureEngine(windowId){
  await initialized;
  const existing=engineTabs.get(windowId);
  if(existing){try{const tab=await chrome.tabs.get(existing);if(tab.url?.startsWith('https://chat.deepseek.com/'))return existing;}catch{}engineTabs.delete(windowId);}
  const tab=await chrome.tabs.create({windowId,url:`https://chat.deepseek.com/?askds_window=${windowId}&askds_engine=1`,active:false});
  engineTabs.set(windowId,tab.id);await persistEngines();return tab.id;
}
async function openEngine(windowId){const id=await ensureEngine(windowId);await chrome.tabs.update(id,{active:true});return id;}
function sidePanelOpen(windowId){
  // Invoke immediately, before any await, to retain the user's activation.
  if(chrome.sidePanel?.open){return chrome.sidePanel.open({windowId}).then(()=>true,()=>false);}
  return Promise.resolve(false);
}
async function openPanelPage(){const url=chrome.runtime.getURL('panel/index.html');const found=await chrome.tabs.query({url});
  if(found[0]?.id){await chrome.tabs.update(found[0].id,{active:true});return;}
  await chrome.tabs.create({url,active:true});
}
async function enqueue(id,text,windowId,followUp,openPromise){
  const response=await lock(async()=>{
    let arr=await jobs();if(arr.some(j=>j.id===id))return {ok:true,duplicate:true};
    arr=arr.filter(j=>j.text||Date.now()-j.updated<60000);
    if(arr.length>=MAX_JOBS)return error('Очередь заполнена. Дождитесь обработки запросов.');
    const now=Date.now();arr.push({id,text,windowId,followUp:!!followUp,status:'queued',created:now,updated:now});
    await store(arr);return {ok:true};
  });
  if(response.ok){void ensureEngine(windowId).catch(()=>{});}
  return {...response,opened:openPromise?await openPromise:false};
}
async function next(w){return lock(async()=>{
  const arr=await jobs();let changed=false;
  for(const j of arr)if(j.windowId===w&&ACTIVE.has(j.status)&&Date.now()-j.updated>240000){j.status='uncertain';j.error='Выполнение прервалось. Проверьте официальный чат перед повтором.';j.updated=Date.now();changed=true;}
  if(changed)await store(arr);
  if(arr.some(j=>j.windowId===w&&ACTIVE.has(j.status)))return {ok:true,job:null};
  const j=arr.find(j=>j.windowId===w&&WAITING.has(j.status));
  if(!j)return {ok:true,job:null};j.status='waiting_for_chat';j.updated=Date.now();await store(arr);
  return {ok:true,job:{id:j.id,text:j.text,followUp:j.followUp}};
});}
async function report(msg){return lock(async()=>{
  const arr=await jobs(),j=arr.find(x=>x.id===msg.id&&x.windowId===msg.windowId);
  if(!j)return error('Запрос не найден.');
  const allowed={waiting_for_chat:['creating_chat','failed','uncertain'],creating_chat:['inserting','failed','uncertain'],inserting:['sending','failed','uncertain'],sending:['sent','failed','uncertain']};
  if(!allowed[j.status]?.includes(msg.status))return error('Неверный переход запроса.');
  j.status=msg.status;j.updated=Date.now();j.error=typeof msg.error==='string'?msg.error.slice(0,300):undefined;
  if(j.status==='sent')j.text='';
  await store(arr.filter(x=>x.text||Date.now()-x.updated<60000));return {ok:true};
});}
async function handle(msg,sender){
  if(!msg||typeof msg!=='object')return error('Некорректная команда.');
  if(msg.type==='ENQUEUE'&&sender.tab&&normWindow(sender.tab.windowId)){
    if(typeof msg.id!=='string'||!/^[a-zA-Z0-9-]{12,80}$/.test(msg.id)||typeof msg.text!=='string'||!msg.text.trim()||msg.text.length>MAX_TEXT)return error('Некорректный текст или ID запроса.');
    return enqueue(msg.id,msg.text,sender.tab.windowId,false,sidePanelOpen(sender.tab.windowId));
  }
  if(['PANEL_NEXT','PANEL_REPORT','CHAT_SNAPSHOT','PANEL_STATUS','ACCESS_STATUS'].includes(msg.type)&&isEngine(sender,msg.windowId)){
    if(msg.type==='PANEL_NEXT')return next(msg.windowId);
    if(msg.type==='PANEL_REPORT')return report(msg);
    if(msg.type==='ACCESS_STATUS')return {ok:true,granted:true};
    if(msg.type==='PANEL_STATUS')return {ok:true,jobs:(await jobs()).filter(j=>j.windowId===msg.windowId&&j.status!=='sent')};
    if(msg.type==='CHAT_SNAPSHOT'){
      if(!Array.isArray(msg.messages))return error('Неверный снимок чата.');
      const messages=msg.messages.slice(-40).filter(m=>['user','assistant'].includes(m.role)&&typeof m.text==='string').map(m=>({role:m.role,text:m.text.slice(0,24000)}));
      previews.set(msg.windowId,{messages,seen:Date.now()});return {ok:true};
    }
  }
  if(isPanel(sender)){
    const w=normWindow(msg.windowId)?msg.windowId:null;
    if(msg.type==='WINDOW'){
      const win=await chrome.windows.getCurrent().catch(()=>chrome.windows.getLastFocused());return {ok:true,windowId:win.id};
    }
    if(msg.type==='STATUS'&&w!==null){const arr=await jobs();return {ok:true,jobs:arr.filter(j=>j.windowId===w&&j.status!=='sent').map(j=>({id:j.id,text:j.text,status:j.status,error:j.error})),engineTab:engineTabs.get(w)??null,preview:previews.get(w)??null};}
    if(msg.type==='CONNECT'&&w!==null){return {ok:true,tabId:await ensureEngine(w)};}
    if(msg.type==='OPEN_ENGINE'&&w!==null){return {ok:true,tabId:await openEngine(w)};}
    if(msg.type==='FOLLOWUP'&&w!==null){const txt=msg.text;
      if(typeof txt!=='string'||!txt.trim()||txt.length>MAX_TEXT)return error('Введите сообщение до 100 000 символов.');
      return enqueue(crypto.randomUUID(),txt,w,true,null);
    }
    if(msg.type==='RETRY_FAILED'&&w!==null)return lock(async()=>{const arr=await jobs();const j=arr.find(x=>x.id===msg.id&&x.windowId===w);
      if(!j||j.status!=='failed')return error('Повторять можно только до нажатия отправки.');
      j.status='queued';j.error=undefined;j.updated=Date.now();await store(arr);return {ok:true};});
    if(msg.type==='DISMISS_UNCERTAIN'&&w!==null)return lock(async()=>{const arr=await jobs();const j=arr.find(x=>x.id===msg.id&&x.windowId===w);
      if(!j||j.status!=='uncertain')return error('Запрос не найден.');j.status='cancelled';j.text='';j.error=undefined;j.updated=Date.now();await store(arr);return {ok:true};});
    if(msg.type==='SET_SETTINGS'){const settings={...DEFAULTS,...(await chrome.storage.local.get('settings')).settings};
      for(const k of Object.keys(DEFAULTS))if(typeof msg.settings?.[k]==='boolean')settings[k]=msg.settings[k];await chrome.storage.local.set({settings});return {ok:true};}
  }
  return error('Команда не разрешена для этого источника.');
}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{Promise.resolve().then(()=>handle(msg,sender)).then(sendResponse,e=>sendResponse(error(e?.message||'Ошибка расширения.')));return true;});
chrome.action.onClicked.addListener(tab=>{
  const win=tab.windowId;
  if(chrome.sidePanel?.open){void sidePanelOpen(win).then(opened=>{if(!opened)void openPanelPage();});}
  else void openPanelPage();
});
chrome.runtime.onInstalled.addListener(()=>{try{chrome.contextMenus.create({id:'moru-selection',title:'Отправить в moru\'s deepseek',contexts:['selection']});}catch{}});
chrome.contextMenus.onClicked.addListener((info,tab)=>{
  if(info.menuItemId!=='moru-selection'||!tab||!normWindow(tab.windowId)||!info.selectionText?.trim())return;
  const promise=sidePanelOpen(tab.windowId);
  void enqueue(crypto.randomUUID(),info.selectionText,tab.windowId,false,promise);
});
chrome.tabs.onRemoved.addListener(id=>{for(const [w,tab] of engineTabs)if(tab===id){engineTabs.delete(w);previews.delete(w);void persistEngines();}});
chrome.windows.onRemoved.addListener(id=>{engineTabs.delete(id);previews.delete(id);void persistEngines();});
