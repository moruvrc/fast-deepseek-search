import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../chromium/background.js',import.meta.url),'utf8');
function harness(){
 const db={}, tabs=new Map(), callbacks={}, snap=[];
 let id=50;let opened=0;
 const event=(key)=>({addListener(fn){callbacks[key]=fn;}});
 const chrome={
  runtime:{getURL(x){return 'chrome-extension://testing/'+x},onMessage:event('message'),onInstalled:event('installed')},
  storage:{local:{async get(key){if(typeof key==='string')return {[key]:db[key]};return {...db}},async set(v){Object.assign(db,v);}}},
  tabs:{async get(n){if(!tabs.has(n))throw Error('No tab');return tabs.get(n)},async create(opts){const t={id:id++,url:opts.url,windowId:opts.windowId};tabs.set(t.id,t);return t;},async update(n,v){const t=tabs.get(n);Object.assign(t,v);return t;},async query(){return [...tabs.values()]},onRemoved:event('tabsRemoved')},
  windows:{async getCurrent(){return {id:5}},async getLastFocused(){return {id:5}},onRemoved:event('windowRemoved')},
  action:{onClicked:event('action')},sidePanel:{open(){opened++;return Promise.resolve()}},
  contextMenus:{create(){},onClicked:event('menu')}
 };
 vm.runInNewContext(src,{chrome,crypto:{randomUUID:()=>String(++id).padStart(12,'0')},Date,Promise,Map,Set,console}, {filename:'chromium/background.js'});
 const call=(msg,sender)=>new Promise(resolve=>{const ok=callbacks.message(msg,sender,resolve);assert.equal(ok,true)});
 const origin={tab:{id:3,windowId:5,url:'https://example.com/a'}};
 const panel={url:'chrome-extension://testing/panel/index.html'};
 const engine=()=>({tab:{id:db.engineTabs['5'],windowId:5,url:'https://chat.deepseek.com/'}});
 return {chrome,call,origin,panel,engine,db,tabs,getOpened:()=>opened};
}
test('Chrome: exact selection, idempotence, companion creation',async()=>{
 const h=harness();const txt='A  B\nЗдорово';const m={type:'ENQUEUE',id:'123456789012',text:txt};
 assert.equal((await h.call(m,h.origin)).ok,true);
 assert.equal((await h.call(m,h.origin)).duplicate,true);
 assert.equal(h.db.jobs.length,1);assert.equal(h.db.jobs[0].text,txt);assert.equal(h.getOpened(),2);
 assert.ok(h.db.engineTabs['5']);
 const next=await h.call({type:'PANEL_NEXT',windowId:5},h.engine());assert.equal(next.job.text,txt);assert.equal(next.job.followUp,false);
});
test('Chrome: valid state transitions, sent content purged, nonengine denied',async()=>{
 const h=harness();await h.call({type:'ENQUEUE',id:'aaaaaaaaaaaa',text:'Hello'},h.origin);
 assert.equal((await h.call({type:'PANEL_NEXT',windowId:5},{tab:{id:123,url:'https://evil.test'}})).ok,false);
 await h.call({type:'PANEL_NEXT',windowId:5},h.engine());
 for(const state of ['creating_chat','inserting','sending','sent'])assert.equal((await h.call({type:'PANEL_REPORT',id:'aaaaaaaaaaaa',windowId:5,status:state},h.engine())).ok,true,state);
 assert.equal(h.db.jobs[0].text,'');
 assert.equal((await h.call({type:'PANEL_NEXT',windowId:5},h.engine())).job,null);
});
test('Chrome: panel follow-up, failure, manual retry, uncertainty dismissal',async()=>{
 const h=harness();const f=await h.call({type:'FOLLOWUP',windowId:5,text:'Next prompt'},h.panel);
 assert.equal(f.ok,true);const n=await h.call({type:'PANEL_NEXT',windowId:5},h.engine());assert.equal(n.job.followUp,true);
 assert.equal((await h.call({type:'PANEL_REPORT',id:n.job.id,windowId:5,status:'failed',error:'Not inserted'},h.engine())).ok,true);
 assert.equal((await h.call({type:'RETRY_FAILED',id:n.job.id,windowId:5},h.panel)).ok,true);
 await h.call({type:'PANEL_NEXT',windowId:5},h.engine());
 assert.equal((await h.call({type:'PANEL_REPORT',id:n.job.id,windowId:5,status:'uncertain'},h.engine())).ok,true);
 assert.equal((await h.call({type:'RETRY_FAILED',id:n.job.id,windowId:5},h.panel)).ok,false);
 assert.equal((await h.call({type:'DISMISS_UNCERTAIN',id:n.job.id,windowId:5},h.panel)).ok,true);
 assert.equal(h.db.jobs[0].text,'');
});
test('Chrome: only selected engine receives and forwards chat snapshot',async()=>{
 const h=harness();await h.call({type:'ENQUEUE',id:'bbbbbbbbbbbb',text:'S'},h.origin);
 const mockSnapshot={type:'CHAT_SNAPSHOT',windowId:5,messages:[{role:'assistant',text:'Actual DOM content'}]};
 assert.equal((await h.call(mockSnapshot,{tab:{id:777,url:'https://chat.deepseek.com'}})).ok,false);
 assert.equal((await h.call(mockSnapshot,h.engine())).ok,true);
 const status=await h.call({type:'STATUS',windowId:5},h.panel);
 assert.equal(status.preview.messages[0].text,'Actual DOM content');
 assert.equal((await h.call({type:'STATUS',windowId:5},h.origin)).ok,false);
});
