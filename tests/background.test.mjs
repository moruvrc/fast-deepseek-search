import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../dist/background.js',import.meta.url),'utf8');
function harness(tabs=[]){
  const events={};const store={};let openCount=0;const injected=[];
  const add=(name)=>({addListener:(fn)=>events[name]=fn});
  const browser={
    storage:{onChanged:add('storage'),local:{get:async key=>typeof key==='string'?{[key]:store[key]}:{...store},set:async payload=>Object.assign(store,structuredClone(payload))}},
    runtime:{onInstalled:add('installed'),onStartup:add('startup'),onMessage:add('message'),getURL:p=>`moz-extension://test/${p}`},
    sidebarAction:{getPanel:async()=>'',setPanel:async()=>{},open:async()=>{openCount++}},
    windows:{getAll:async()=>[],onCreated:add('created')},
    action:{onClicked:add('action'),setBadgeText:async()=>{},setTitle:async()=>{}},
    menus:{create:()=>{},onClicked:add('menu')},
    tabs:{query:async()=>tabs},
    scripting:{executeScript:async args=>{injected.push(args);}},
    permissions:{contains:async()=>true,onAdded:add('permsAdded'),onRemoved:add('permsRemoved')}
  };
  runInNewContext(code,{browser,URL,Date,Promise,Number,setTimeout,clearTimeout,crypto:{randomUUID:()=> 'b'.repeat(32)}});
  const send=(message,sender)=>events.message(message,sender);
  return {send,store,events,injected,getOpenCount:()=>openCount};
}
const user=(id=12)=>({tab:{windowId:id},url:'https://example.com/'});
const remote={url:'https://chat.deepseek.com/?askds_window=12'};
const job=(id='a'.repeat(32),text='пример текста')=>({type:'ENQUEUE',id,text});
test('idempotent enqueue & exact message content',async()=>{
 const h=harness();
 assert.equal((await h.send(job(),user())).ok,true);
 assert.equal((await h.send(job(),user())).duplicate,true);
 assert.equal(h.store.jobs.length,1);
 const result=await h.send({type:'PANEL_NEXT',windowId:12},remote);
 assert.equal(result.job.text,'пример текста');
 assert.equal((await h.send({type:'PANEL_NEXT',windowId:12},remote)).job,null);
});
test('strict state transitions and clearing sent content',async()=>{
 const h=harness();await h.send(job(),user());await h.send({type:'PANEL_NEXT',windowId:12},remote);
 assert.equal((await h.send({type:'PANEL_REPORT',windowId:12,id:'a'.repeat(32),status:'sent'},remote)).ok,false);
 for(const status of ['creating_chat','inserting','sending','sent']){
  assert.equal((await h.send({type:'PANEL_REPORT',windowId:12,id:'a'.repeat(32),status},remote)).ok,true);
 }
 assert.equal(h.store.jobs[0].text,'');
 assert.equal(h.store.jobs[0].status,'sent');
});
test('malicious sender cannot read queued text',async()=>{
 const h=harness();await h.send(job(),user());
 assert.equal((await h.send({type:'PANEL_NEXT',windowId:12},{...remote,tab:{windowId:12}})).ok,false);
 assert.equal((await h.send({type:'PANEL_NEXT',windowId:12},{url:'https://evil.example/'})).ok,false);
 assert.equal((await h.send({type:'PANEL_NEXT',windowId:999},remote)).job,null);
});
test('failed operation is manually retryable; uncertain operation is not',async()=>{
 const h=harness();await h.send(job(),user());await h.send({type:'PANEL_NEXT',windowId:12},remote);
 assert.equal((await h.send({type:'PANEL_REPORT',windowId:12,id:'a'.repeat(32),status:'failed',error:'Элемент не найден'},remote)).ok,true);
 assert.equal((await h.send({type:'RETRY_FAILED',windowId:12,id:'a'.repeat(32)},remote)).ok,true);
 const result=await h.send({type:'PANEL_NEXT',windowId:12},remote);assert.equal(result.job.text,'пример текста');
 for(const status of ['creating_chat','inserting','sending','uncertain']){
  assert.equal((await h.send({type:'PANEL_REPORT',windowId:12,id:'a'.repeat(32),status},remote)).ok,true);
 }
 assert.equal((await h.send({type:'RETRY_FAILED',windowId:12,id:'a'.repeat(32)},remote)).ok,false);
});
test('respects input limit & segregates window queues',async()=>{
 const h=harness();assert.equal((await h.send(job('a'.repeat(32),'x'.repeat(100001)),user())).ok,false);
 await h.send(job(),user());await h.send(job('b'.repeat(32),'второе окно'),user(14));
 assert.equal((await h.send({type:'PANEL_NEXT',windowId:14},{url:'https://chat.deepseek.com/'})).job.text,'второе окно');
 assert.equal((await h.send({type:'PANEL_NEXT',windowId:12},remote)).job.text,'пример текста');
});

test('uncertain warning can be dismissed without retrying or leaking text',async()=>{
 const h=harness();await h.send(job(),user());await h.send({type:'PANEL_NEXT',windowId:12},remote);
 for(const status of ['creating_chat','inserting','sending','uncertain']){
  assert.equal((await h.send({type:'PANEL_REPORT',windowId:12,id:'a'.repeat(32),status},remote)).ok,true);
 }
 assert.equal((await h.send({type:'DISMISS_UNCERTAIN',windowId:12,id:'a'.repeat(32)},remote)).ok,true);
 assert.equal(h.store.jobs[0].status,'cancelled');
 assert.equal(h.store.jobs[0].text,'');
 assert.equal((await h.send({type:'RETRY_FAILED',windowId:12,id:'a'.repeat(32)},remote)).ok,false);
});

test('context menu queues exactly the selected text',async()=>{
 const h=harness();
 h.events.menu({menuItemId:'moru-deepseek-send-selection',selectionText:'Все серии'}, {windowId:12});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.store.jobs?.[0]?.text,'Все серии');
 assert.equal(h.store.jobs?.[0]?.windowId,12);
 assert.equal(h.getOpenCount(),1);
});
test('existing tabs receive a content script without injecting into Firefox internals',async()=>{
 const h=harness([{id:1,url:'https://jut.su/code-geass/'},{id:2,url:'about:debugging'},{id:3,url:'https://chat.deepseek.com/'}]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.injected.map(i=>i.target.tabId),[1,3]);
 assert.ok(h.injected.every(i=>i.files[0]==='content.js'));
});

test('sidebar can diagnose missing site-wide permission',async()=>{
 const h=harness();
 const status=await h.send({type:'ACCESS_STATUS',windowId:12},remote);
 assert.equal(status.ok,true);
 assert.equal(status.granted,true);
 assert.equal((await h.send({type:'ACCESS_STATUS',windowId:12},user())).ok,false);
});
