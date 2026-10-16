{
  const connect = document.getElementById('connect') as HTMLButtonElement;
  const notice = document.getElementById('notice') as HTMLParagraphElement;
  connect.addEventListener('click', async () => {
    connect.disabled=true;connect.textContent='Подключаем…';
    try {
      const current=await browser.windows.getCurrent();
      if(!Number.isInteger(current.id))throw new Error('Окно не найдено.');
      await browser.sidebarAction.setPanel({windowId:current.id,panel:`https://chat.deepseek.com/?askds_window=${current.id}`});
    } catch {
      connect.disabled=false;connect.textContent='Попробовать снова ↗';
      notice.textContent='Firefox не разрешил открыть официальный сайт в Sidebar. Проверьте настройки или ограничения сети.';
    }
  });
  const pane=document.getElementById('options') as HTMLElement;
  const show=(value:boolean)=>pane.hidden=!value;
  document.getElementById('settings')?.addEventListener('click',()=>show(pane.hidden));
  document.getElementById('close')?.addEventListener('click',()=>show(false));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')show(false);});
  void browser.storage.local.get('settings').then(({settings}:any)=>{
    for(const input of document.querySelectorAll<HTMLInputElement>('[data-setting]')){
      input.checked=settings?.[input.dataset.setting!]!==false;
      input.addEventListener('change',()=>{
        void browser.runtime.sendMessage({type:'SET_SETTINGS',settings:{[input.dataset.setting!]:input.checked}});
      });
    }
  });
}
