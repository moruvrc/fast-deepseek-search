// Runs in the PAGE'S MAIN world. It deliberately has no extension APIs and
// never reads credentials, cookies, network requests or chat history.
// React's value tracking lives in this world, not in Firefox's isolated world.
(() => {
  if (location.hostname !== 'chat.deepseek.com') return;
  const key = '__moruDeepseekInputBridgeV13';
  const marker = window as typeof window & { [key: string]: boolean };
  if (marker[key]) return;
  marker[key] = true;

  type Editable = HTMLTextAreaElement | HTMLInputElement | HTMLElement;
  const visible = (node: Element): boolean => {
    const el = node as HTMLElement;
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return rect.width > 40 && rect.height > 8 && css.visibility !== 'hidden' && css.display !== 'none';
  };
  const getEditor = (): Editable | null => {
    const queries = [
      'textarea#chat-input', 'textarea[placeholder*="DeepSeek"]',
      'textarea[placeholder*="сообщ"]', 'textarea[placeholder*="消息"]',
      'textarea:not([disabled])',
      '[contenteditable="true"][data-placeholder]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ];
    for (const selector of queries) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (!visible(element) || element.closest('[data-askds-root]')) continue;
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
          if (element.disabled || element.readOnly) continue;
        }
        return element;
      }
    }
    return null;
  };
  const currentText = (e: Editable): string => {
    if (e instanceof HTMLTextAreaElement || e instanceof HTMLInputElement) return e.value;
    return (e.innerText ?? e.textContent ?? '').replace(/\r\n?/g, '\n');
  };
  const same = (a: string, b: string) => a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');
  const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  function insert(e: Editable, text: string): void {
    e.focus();
    if (e instanceof HTMLTextAreaElement || e instanceof HTMLInputElement) {
      // IMPORTANT: bypass React's per-element value tracker. Assigning e.value
      // directly calls React's tracked setter and can make onChange a no-op.
      const base = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(base, 'value')?.set;
      if (!nativeSetter) throw new Error('Не найден нативный редактор текста.');
      nativeSetter.call(e, text);
      e.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertFromPaste', data: text
      }));
      // Do not fire change: a React onBlur/onChange may reset the editor.
      return;
    }
    // A contenteditable field (including a framework-managed rich text editor).
    // Browser editing commands produce input events through the page's editing
    // pipeline. Raw textContent alone does not update rich editor state.
    const range = document.createRange();
    range.selectNodeContents(e);
    const selection = window.getSelection();
    if (!selection) throw new Error('Не удалось выбрать поле ввода.');
    selection.removeAllRanges(); selection.addRange(range);
    if (!document.execCommand('insertText', false, text)) {
      // Fallback for plain contenteditable editors. Never silently call Send
      // unless the visible field confirms exactly the requested content.
      if (e.matches('[data-lexical-editor],[data-slate-editor],.ProseMirror')) {
        throw new Error('Редактор DeepSeek отклонил программную вставку.');
      }
      e.textContent = text;
      e.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertFromPaste', data: text
      }));
    }
  }

  async function insertAndCheck(text: string): Promise<{ok:boolean;reason?:string}> {
    const initial = getEditor();
    if (!initial) return {ok:false,reason:'Поле ввода DeepSeek не найдено.'};
    // Avoid clobbering a draft typed by the user. New chat should be empty.
    if (currentText(initial).trim().length && !same(currentText(initial), text)) {
      return {ok:false,reason:'В поле DeepSeek уже есть текст. Автоматическая вставка остановлена.'};
    }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const live = getEditor();
        if (!live) return {ok:false,reason:'DeepSeek заменил поле ввода во время вставки.'};
        if (same(currentText(live), text)) {
          await pause(180);
          if (same(currentText(getEditor() ?? live),text)) return {ok:true};
        }
        insert(live, text);
        // Let React process its update and rerender before confirming.
        await pause(180);
        const after = getEditor();
        if (after && same(currentText(after), text)) {
          await pause(150);
          if (same(currentText(getEditor() ?? after), text)) return {ok:true};
        }
      }
      return {ok:false,reason:'Текст не закрепился в редакторе DeepSeek. Сообщение не отправлено.'};
    } catch (err) {
      return {ok:false,reason:err instanceof Error ? err.message : 'Ошибка редактора DeepSeek.'};
    }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.channel !== 'moru-deepseek-input-v1' || data.kind !== 'insert') return;
    if (!document.documentElement.classList.contains('askds-sidebar')) return;
    if (typeof data.id !== 'string' || !/^[a-zA-Z0-9-]{12,80}$/.test(data.id)) return;
    if (typeof data.text !== 'string' || !data.text.length || data.text.length > 100000) return;
    // Replies contain status only, never echo the user's selected text.
    void insertAndCheck(data.text).then(result => {
      window.postMessage({channel:'moru-deepseek-input-v1',kind:'insert-result',id:data.id,...result},location.origin);
    });
  });
})();
