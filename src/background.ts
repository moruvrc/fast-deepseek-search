// Firefox MV3 event page. The only stored chat content is an unsent request.
{
  type JobState = 'queued' | 'waiting_for_sidebar' | 'waiting_for_chat' | 'creating_chat' | 'inserting' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled';
  interface Job { id: string; windowId: number; text: string; status: JobState; created: number; updated: number; error?: string }
  interface Settings { toolbar: boolean; animations: boolean; autoOpen: boolean }
  const DEFAULTS: Settings = { toolbar: true, animations: true, autoOpen: true };
  const ACTIVE: JobState[] = ['waiting_for_chat', 'creating_chat', 'inserting', 'sending'];
  const WAITING: JobState[] = ['queued', 'waiting_for_sidebar'];
  const MAX_TEXT = 100000;
  const MAX_JOBS = 25;
  let barrier: Promise<unknown> = Promise.resolve();
  let panelInitialization: Promise<void> | null = null;
  let cachedSettings: Settings = {...DEFAULTS};
  void browser.storage.local.get('settings').then((v: any) => { cachedSettings = {...DEFAULTS,...v.settings}; });
  browser.storage.onChanged.addListener((changes: any, area: string) => {
    if (area === 'local' && changes.settings) cachedSettings = {...DEFAULTS,...changes.settings.newValue};
  });

  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = barrier.then(fn, fn);
    barrier = next.then(() => undefined, () => undefined);
    return next;
  };

  const getJobs = async (): Promise<Job[]> => {
    const result = await browser.storage.local.get('jobs');
    return Array.isArray(result.jobs) ? result.jobs as Job[] : [];
  };
  const saveJobs = (jobs: Job[]) => browser.storage.local.set({jobs});
  const settings = async (): Promise<Settings> => ({...DEFAULTS, ...(await browser.storage.local.get('settings')).settings});
  const isPanelSender = (sender: any, windowId: unknown) => {
    if (sender.tab || !Number.isInteger(windowId) || Number(windowId) < 0) return false;
    try { return new URL(sender.url ?? '').hostname === 'chat.deepseek.com'; }
    catch { return false; }
  };
  const err = (message: string) => ({ok: false, error: message});
  const panelURL = (windowId: number) => `https://chat.deepseek.com/?askds_window=${windowId}`;

  async function ensurePanel(windowId: number): Promise<void> {
    const wanted = panelURL(windowId);
    try {
      const current = await browser.sidebarAction.getPanel({windowId});
      if (current === wanted) return;
      await browser.sidebarAction.setPanel({windowId, panel: wanted});
    } catch {
      // Preserve the manifest's local fallback if remote panels are refused.
    }
  }
  async function initializePanels(): Promise<void> {
    if (panelInitialization) return panelInitialization;
    panelInitialization = (async () => {
      const windows = await browser.windows.getAll({windowTypes: ['normal']});
      await Promise.all(windows.filter((w: any) => Number.isInteger(w.id)).map((w: any) => ensurePanel(w.id)));
    })().catch(() => undefined).finally(() => { panelInitialization = null; });
    return panelInitialization;
  }
  // Temporary add-ons do not automatically inject declarative content scripts
  // into tabs that were already loaded before installation or reload.
  async function injectExistingTabs(): Promise<void> {
    try {
      const tabs = await browser.tabs.query({});
      await Promise.all(tabs.map(async (tab: any) => {
        if (!Number.isInteger(tab.id) || typeof tab.url !== 'string' || !/^https?:\/\//.test(tab.url)) return;
        try {
          await browser.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']});
        } catch {
          // Some subframes may be protected; still try the normal page.
          try { await browser.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}); }
          catch { /* Missing permission or a protected page. */ }
        }
      }));
    } catch { /* Tab enumeration is best-effort. */ }
  }
  async function updateAccessBadge(): Promise<void> {
    try {
      const granted = await browser.permissions.contains({origins:['<all_urls>']});
      await browser.action.setBadgeText({text:granted ? '' : '!'});
      await browser.action.setTitle({title: granted ? "Открыть moru's deepseek" : "moru's deepseek: разрешите доступ к сайтам в настройках дополнения"});
    } catch { /* Badge support is optional. */ }
  }
  void initializePanels();
  void injectExistingTabs();
  void updateAccessBadge();
  browser.runtime.onInstalled.addListener(() => { void initializePanels(); void injectExistingTabs(); void updateAccessBadge(); });
  browser.runtime.onStartup.addListener(() => { void initializePanels(); void injectExistingTabs(); void updateAccessBadge(); });
  browser.permissions.onAdded.addListener(() => { void updateAccessBadge(); void injectExistingTabs(); });
  browser.permissions.onRemoved.addListener(() => { void updateAccessBadge(); });
  browser.windows.onCreated.addListener((window: any) => {
    if (window.type === 'normal' && Number.isInteger(window.id)) void ensurePanel(window.id);
  });
  browser.action.onClicked.addListener((tab: any) => {
    // This MUST precede all awaits: Firefox restricts user-activated APIs.
    void browser.sidebarAction.open().catch(() => undefined);
    if (Number.isInteger(tab?.windowId)) void ensurePanel(tab.windowId);
  });

  const attemptOpen = (): Promise<boolean> => cachedSettings.autoOpen
    ? browser.sidebarAction.open().then(() => true, () => false)
    : Promise.resolve(false);

  const enqueue = (id: string, text: string, windowId: number, opening: Promise<boolean>) => locked(async () => {
    const jobs = await getJobs();
    const prior = jobs.find(j => j.id === id);
    if (prior) return {ok: true, opened: await opening, duplicate: true};
    const now = Date.now();
    const retained = jobs.filter(j => j.text || now - j.updated < 60_000);
    if (retained.length >= MAX_JOBS) return err('Очередь заполнена. Дождитесь отправки предыдущих запросов.');
    jobs.length = 0; jobs.push(...retained);
    jobs.push({id, windowId, text, status: 'waiting_for_sidebar', created: now, updated: now});
    await saveJobs(jobs);
    return {ok: true, opened: await opening};
  });

  // Firefox's native context menu can still capture a selection if a site
  // suppresses floating elements. It does not bypass restricted browser pages.
  const menuId = 'moru-deepseek-send-selection';
  try {
    browser.menus.create({id: menuId, title: "Отправить выделение в moru's deepseek", contexts: ['selection']});
  } catch { /* The context menu is a convenience; ordinary selection still works. */ }
  browser.menus.onClicked.addListener((info: any, tab: any) => {
    if (info.menuItemId !== menuId || !Number.isInteger(tab?.windowId)) return;
    const text = info.selectionText;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return;
    const opening = attemptOpen(); // Must be called synchronously during the user gesture.
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    void enqueue(id, text, tab.windowId, opening).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((msg: any, sender: any) => {
    if (!msg || typeof msg !== 'object') return undefined;
    if (msg.type === 'ENQUEUE') {
      if (!sender.tab || !Number.isInteger(sender.tab.windowId)) return Promise.resolve(err('Не удалось определить окно браузера.'));
      if (typeof msg.id !== 'string' || !/^[a-zA-Z0-9-]{12,80}$/.test(msg.id)) return Promise.resolve(err('Неверный идентификатор запроса.'));
      if (typeof msg.text !== 'string' || !msg.text.length) return Promise.resolve(err('Текст не выделен.'));
      if (msg.text.length > MAX_TEXT) return Promise.resolve(err('Выделено слишком много текста (более 100 000 символов).'));
      return enqueue(msg.id, msg.text, sender.tab.windowId, attemptOpen());
    }
    if (msg.type === 'PANEL_NEXT') {
      if (!isPanelSender(sender, msg.windowId)) return Promise.resolve(err('Неверный источник панели.'));
      return locked(async () => {
        const jobs = await getJobs();
        let stale=false;
        for (const j of jobs) {
          if (j.windowId === msg.windowId && ACTIVE.includes(j.status) && Date.now()-j.updated>240_000) {
            j.status='uncertain';j.error='Операция прервалась. Проверьте, было ли сообщение отправлено.';j.updated=Date.now();stale=true;
          }
        }
        if (stale) await saveJobs(jobs);
        if (jobs.some(j => j.windowId === msg.windowId && ACTIVE.includes(j.status))) return {ok: true, job: null};
        const next = jobs.find(j => j.windowId === msg.windowId && WAITING.includes(j.status));
        if (!next) return {ok: true, job: null};
        next.status = 'waiting_for_chat'; next.updated = Date.now();
        await saveJobs(jobs);
        return {ok: true, job: {id: next.id, text: next.text}};
      });
    }
    if (msg.type === 'PANEL_REPORT') {
      if (!isPanelSender(sender, msg.windowId)) return Promise.resolve(err('Неверный источник панели.'));
      if (typeof msg.id !== 'string' || !['creating_chat','inserting','sending','sent','failed','uncertain'].includes(msg.status)) return Promise.resolve(err('Неверное состояние.'));
      return locked(async () => {
        const jobs = await getJobs();
        const job = jobs.find(j => j.id === msg.id && j.windowId === msg.windowId);
        if (!job) return err('Запрос не найден.');
        if (['sent','cancelled','failed','uncertain'].includes(job.status)) return err('Запрос уже завершён.');
        const allowed: Record<string, string[]> = {
          waiting_for_chat: ['creating_chat','failed','uncertain'],
          creating_chat: ['inserting','failed','uncertain'],
          inserting: ['sending','failed','uncertain'],
          sending: ['sent','failed','uncertain']
        };
        if (!(allowed[job.status] ?? []).includes(msg.status)) return err('Неверный переход состояния.');
        job.status = msg.status as JobState;
        job.updated = Date.now();
        if (typeof msg.error === 'string') job.error = msg.error.slice(0, 300);
        if (job.status === 'sent') job.text = '';
        await saveJobs(jobs.filter(j => j.text || Date.now() - j.updated < 60_000));
        return {ok: true};
      });
    }
    if (msg.type === 'ACCESS_STATUS') {
      if (!isPanelSender(sender, msg.windowId)) return Promise.resolve(err('Неверный источник панели.'));
      return browser.permissions.contains({origins:['<all_urls>']}).then(
        (granted:boolean)=>({ok:true,granted}),
        ()=>err('Не удалось проверить разрешения Firefox.')
      );
    }
    if (msg.type === 'PANEL_STATUS') {
      if (!isPanelSender(sender, msg.windowId)) return Promise.resolve(err('Неверный источник панели.'));
      return locked(async () => ({ok: true, jobs: (await getJobs())
        .filter(j => j.windowId === msg.windowId && j.status !== 'sent')
        .map(j => ({id:j.id, status:j.status, error:j.error, text:j.text}))}));
    }
    if (msg.type === 'RETRY_FAILED') {
      if (!isPanelSender(sender, msg.windowId)) return Promise.resolve(err('Неверный источник панели.'));
      return locked(async () => {
        const jobs = await getJobs();
        const job = jobs.find(j => j.id === msg.id && j.windowId === msg.windowId);
        if (!job || job.status !== 'failed') return err('Повторить этот запрос нельзя.');
        job.status = 'queued'; job.updated = Date.now(); job.error = undefined;
        await saveJobs(jobs);
        return {ok:true};
      });
    }
    if (msg.type === 'DISMISS_UNCERTAIN') {
      if (!isPanelSender(sender, msg.windowId)) return Promise.resolve(err('Неверный источник панели.'));
      return locked(async () => {
        const jobs = await getJobs();
        const job = jobs.find(j => j.id === msg.id && j.windowId === msg.windowId);
        if (!job || job.status !== 'uncertain') return err('Предупреждение уже закрыто.');
        // The user chose to dismiss the warning; never retry this request.
        job.status = 'cancelled'; job.text = ''; job.error = undefined; job.updated = Date.now();
        await saveJobs(jobs.filter(j => j.text || Date.now() - j.updated < 60_000));
        return {ok:true};
      });
    }
    if (msg.type === 'SET_SETTINGS') {
      if (!sender.url?.startsWith(browser.runtime.getURL('sidebar/'))) return Promise.resolve(err('Настройки доступны только из расширения.'));
      return Promise.resolve(settings().then(async s => {
        const next = {...s};
        for (const key of ['toolbar','animations','autoOpen'] as const) if (typeof msg.settings?.[key] === 'boolean') next[key] = msg.settings[key];
        await browser.storage.local.set({settings:next});
        return {ok:true, settings:next};
      }));
    }
    return undefined;
  });
}
