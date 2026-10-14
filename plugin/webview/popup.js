import { appIdFromUrl } from './store-url.js';
import { websiteTheme } from './website-theme.js';
import { logoUrl } from './brand-assets.js';
import { telegramUrl } from './game-requirements.js';

export const defaultSettings = Object.freeze({ automaticApply: false, colorMode: 'native', customColor: websiteTheme.accent, version: 2 });
export function validColor(color) { return typeof color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color); }
export function safeSettings(value) {
  if (!value || value.version !== 2 || !['native', 'automatic', 'custom'].includes(value.colorMode) || !validColor(value.customColor)
    || typeof value.automaticApply !== 'boolean') return { ...defaultSettings };
  return { automaticApply: value.automaticApply, colorMode: value.colorMode === 'automatic' ? 'native' : value.colorMode,
    customColor: value.customColor.toUpperCase(), version: 2 };
}
export function solidColor(color) {
  if (!validColor(color)) return websiteTheme.accent;
  let hex = color.slice(1);
  if (hex.length < 5) hex = [...hex].map(c => c + c).join('');
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  const surface = websiteTheme.surface.slice(1);
  return '#' + [0, 2, 4].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * alpha
    + parseInt(surface.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function textForColor(color) {
  const rgb = solidColor(color).slice(1);
  const linear = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#FFFFFF';
}
const terminal = state => ['Completed', 'Failed', 'Cancelled', 'Unsupported'].includes(state);
const labels = { Idle: 'Ready', Connecting: 'Connecting to DarkDevil', CheckingConfiguration: 'Checking configuration',
  PreparingPackage: 'Preparing package', Downloading: 'Downloading', VerifyingPackage: 'Verifying package',
  ReadyToApply: 'Ready to Apply', ApplyingChanges: 'Applying Changes', Completed: 'Completed', Failed: 'Failed', Cancelled: 'Cancelled', Unsupported: 'Unsupported' };
const bytes = value => value < 1024 ? `${value} B` : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB`;
const instanceKey = '__darkdevilSteamBridge';

export function attachBridge(win, transport, options = {}) {
  win[instanceKey]?.dispose();
  const doc = win.document;
  let disposed = false, scheduled = false, epoch = 0, context = null, button = null, nativeHub = null;
  let preferences = { ...defaultSettings }, poll = null, open = false, preferencesRevision = 0;
  let savingSettings = false, previousFocus = null, hasWorkerSettings = false;
  const replySettingsRevision = new WeakMap();
  const rpcTimers = new Set();
  const host = doc.createElement('div');
  host.id = 'darkdevil-import-popup'; host.hidden = true;
  host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', 'Nght-Bridge');
  host.style.cssText = 'position:fixed;z-index:2147483647;margin:0;padding:0;border:0;border-radius:14px;overflow:visible;background:transparent;width:min(420px,calc(100vw - 24px));';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = `:host{font:13px/1.5 Arial,sans-serif;color:${websiteTheme.text};--accent:${websiteTheme.accent};color-scheme:dark}
    *{box-sizing:border-box} [hidden]{display:none!important}
    .card{background:linear-gradient(160deg,#18222e,#10161e 55%);border:1px solid #3b4b5b;border-top:2px solid var(--accent);border-radius:14px;box-shadow:0 18px 64px #000b;overflow:hidden;animation:arrive .15s ease-out}
    header{display:flex;align-items:center;gap:8px;padding:14px 16px;background:#ffffff04}header strong{flex:1;font-size:14px}
    .body{padding:4px 16px 16px;max-height:min(560px,calc(100vh - 160px));overflow:auto;min-height:180px;scrollbar-width:thin;scrollbar-color:#4b6074 transparent}
    .game{font-size:16px;font-weight:700;margin:12px 0 2px}.muted{color:#a8b0bd;font-size:12px}.state{display:flex;align-items:center;gap:7px;margin:16px 0 6px;font-weight:700}
    .dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}.message{min-height:42px;margin:6px 0;overflow-wrap:anywhere}.verification{color:#a8b0bd;font-size:11px;margin:8px 0}
    progress{width:100%;height:6px;accent-color:var(--accent);border-radius:5px;border:0;display:block;margin:12px 0 6px}progress::-webkit-progress-bar{background:#ffffff10;border-radius:5px}progress::-webkit-progress-value{background:var(--accent);border-radius:5px}
    .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}button,select,input{font:inherit}button{border:1px solid #454d59;border-radius:7px;padding:7px 11px;background:#252b34;color:#e8edf4;cursor:pointer;transition:filter .15s,background .15s}button:hover{filter:brightness(1.15)}button:disabled{opacity:.4;cursor:default;filter:none}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .row input[type=text]{min-width:0;flex:1;width:90px}.row button{flex-shrink:0}
    .primary{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}.icon{padding:2px 7px;font-size:17px;background:transparent;border-color:transparent}.row{display:flex;align-items:center;gap:10px;margin:14px 0}.row label{flex:1}.setting{padding:12px 0;border-top:1px solid #ffffff10}select,input[type=text]{background:#1c222b;color:#e8edf4;border:1px solid #454d59;border-radius:5px;padding:6px;max-width:100%}input[type=color]{width:44px;height:32px;padding:0;border:0;background:none}input[type=checkbox]{accent-color:var(--accent)}
    .consent{padding:12px;border:1px solid #e5b05b66;background:#e5b05b0a;border-radius:8px;font-size:12px}.preview{max-height:190px;overflow:auto;margin:12px 0;border:1px solid #ffffff15;border-radius:8px}.file{padding:8px 10px;border-bottom:1px solid #ffffff10}.file:last-child{border:0}.path{font-size:11px;color:#a8b0bd;overflow-wrap:anywhere}.notice{font-size:11px;color:#a8b0bd}.success{color:${websiteTheme.success}}.error{color:${websiteTheme.error}}
    .brand-logo{width:22px;height:22px;object-fit:contain;flex-shrink:0}.policy{display:inline-flex;gap:6px;align-items:center;margin-top:10px;padding:3px 8px;border:1px solid #67c1f533;border-radius:20px;color:#b9d8ed;font-size:11px;background:#67c1f508}.policy[data-auto=true]{border-color:#5cc79b66;color:#a1e4c5}
    .steps{display:flex;gap:6px;margin:14px 0 8px}.step{flex:1;border-top:2px solid #ffffff12;padding-top:5px;font-size:11px;color:#8796a6}.step[data-active=true]{color:#d9ebf8;border-color:var(--accent)}.step[data-done=true]{color:#92d9b9;border-color:#5cc79b}
    .requirements{margin:12px 0;padding:12px;border:1px solid #67c1f544;border-radius:10px;background:#67c1f508;font-size:12px}.requirements strong{color:#bfe8ff;display:block;margin-bottom:4px}.requirements a{display:inline-block;color:#bfe8ff;text-decoration:none;padding:6px 10px;border:1px solid #67c1f566;border-radius:6px;margin-top:8px}.requirements a:hover{background:#67c1f51a}.requirements a:focus-visible{outline:2px solid #67c1f5;outline-offset:2px}
    .file-top{display:flex;gap:8px;align-items:center;justify-content:space-between}.file-top strong{overflow-wrap:anywhere;min-width:0}.badge{font-size:10px;border-radius:4px;padding:2px 5px;background:#5cc79b15;color:#a1e4c5;white-space:nowrap}.badge.replace{background:#e5b05b15;color:#e5c08b}details{margin-top:4px}summary{font-size:11px;color:#9ab4ca;cursor:pointer}.settings-heading{font-size:14px;margin:14px 0 2px}.message{min-height:34px}.actions .primary{flex:1}.settings-heading + .notice{margin-bottom:14px}
    .import-actions{margin:0;padding:12px 16px;background:#10161e;border-top:1px solid #ffffff10}
    @keyframes arrive{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.card{animation:none}button{transition:none}}`;
  shadow.append(style);
  function element(tag, text, parent, className) {
    const item = doc.createElement(tag); if (text != null) item.textContent = text;
    if (className) item.className = className; parent?.append(item); return item;
  }
  function logo(parent) {
    const img = element('img', null, parent, 'brand-logo'); img.src = logoUrl; img.alt = ''; img.draggable = false;
    img.setAttribute('aria-hidden', 'true'); return img;
  }
  const card = element('div', null, shadow, 'card');
  const header = element('header', null, card);
  logo(header); element('strong', 'Nght-Bridge', header);
  const gear = element('button', '⚙', header, 'icon'); gear.type = 'button'; gear.setAttribute('aria-label', 'Settings');
  const close = element('button', '×', header, 'icon'); close.type = 'button'; close.setAttribute('aria-label', 'Close');
  const body = element('div', null, card, 'body');
  const gameName = element('div', '', body, 'game');
  const appIdLabel = element('div', '', body, 'muted');
  const policy = element('div', 'Manual confirmation', body, 'policy');
  const requirements = element('div', null, body, 'requirements'); requirements.hidden = true;
  element('strong', 'Additional files required', requirements);
  const requirementMessage = element('div', '', requirements);
  const botLink = element('a', 'Open Nightfile Bot ↗', requirements); botLink.target = '_blank'; botLink.rel = 'noopener noreferrer';
  const work = element('div', null, body);
  const steps = element('div', null, work, 'steps'); steps.setAttribute('aria-label', 'Import stages');
  const stepItems = ['Prepare', 'Review', 'Apply'].map(text => element('span', text, steps, 'step'));
  const stateRow = element('div', null, work, 'state'); element('span', '', stateRow, 'dot');
  const stateLabel = element('span', 'Ready', stateRow);
  const message = element('div', '', work, 'message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const progress = element('progress', null, work); progress.max = 100;
  const download = element('div', '', work, 'muted');
  const verification = element('div', '', work, 'verification');
  const summary = element('div', '', work, 'notice');
  const preview = element('div', null, work, 'preview');
  const paging = element('div', null, work, 'actions'); paging.hidden = true;
  const previousPage = element('button', 'Previous files', paging);
  const nextPage = element('button', 'Next files', paging);
  const confirmation = element('div', null, work, 'consent'); confirmation.hidden = true;
  const confirmationText = element('div', '', confirmation);
  const confirmRow = element('div', null, confirmation, 'actions');
  const confirmApply = element('button', 'Confirm Apply', confirmRow, 'primary');
  const back = element('button', 'Go back', confirmRow);
  const actions = element('div', null, card, 'actions import-actions');
  const apply = element('button', 'Apply Changes', actions, 'primary');
  const cancel = element('button', 'Cancel', actions);
  const retry = element('button', 'Retry', actions);
  const settings = element('div', null, body); settings.hidden = true;
  element('strong', 'Import preferences', settings, 'settings-heading');
  element('div', 'Changes take effect immediately. No Steam restart is needed.', settings, 'notice');
  const automaticRow = element('div', null, settings, 'row');
  element('label', 'Automatic Apply', automaticRow);
  const automatic = element('input', null, automaticRow); automatic.type = 'checkbox'; automatic.setAttribute('aria-label', 'Automatic Apply');
  element('div', 'OFF by default. ON applies verified changes after an import click, including replacements, without another confirmation.', settings, 'notice');
  const automaticConsent = element('div', null, settings, 'consent'); automaticConsent.hidden = true;
  const autoConsentText = element('div', 'Enable Automatic Apply? This includes the current import and future import clicks. Verified files may be written or replaced. Validation and rollback remain active.', automaticConsent);
  const autoActions = element('div', null, automaticConsent, 'actions');
  const enableAuto = element('button', 'Enable Automatic Apply', autoActions, 'primary');
  const rejectAuto = element('button', 'Keep OFF', autoActions);
  const colorRow = element('div', null, settings, 'row setting'); element('label', 'Button color', colorRow);
  const colorMode = element('select', null, colorRow); colorMode.setAttribute('aria-label', 'Button color mode');
  const autoColor = element('option', 'Steam Native (Default)', colorMode); autoColor.value = 'native';
  const customColor = element('option', 'Custom Color', colorMode); customColor.value = 'custom';
  const custom = element('div', null, settings, 'row');
  const picker = element('input', null, custom); picker.type = 'color'; picker.setAttribute('aria-label', 'Custom color picker');
  const hex = element('input', null, custom); hex.type = 'text'; hex.maxLength = 9; hex.setAttribute('aria-label', 'HEX color');
  const saveColor = element('button', 'Save color', custom);
  const settingsMessage = element('div', '', settings, 'notice');
  const settingsActions = element('div', null, settings, 'actions');
  const reset = element('button', 'Reset to Default', settingsActions);
  const openApp = element('button', 'Open Night Injection', settingsActions);
  const returnToImport = element('button', 'Back', settingsActions);
  (doc.body || doc.documentElement).append(host);
  if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');

  const trusted = event => event.isTrusted || options.allowSyntheticEvents === true;
  function stopPoll() { if (poll != null) win.clearTimeout(poll); poll = null; }
  function place() {
    if (!open || !button?.isConnected) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(420, win.innerWidth - 24);
    host.style.width = `${width}px`;
    host.style.left = `${Math.max(12, Math.min(rect.left, win.innerWidth - width - 12))}px`;
    const height = host.getBoundingClientRect().height || 360;
    const below = rect.bottom + 8;
    host.style.top = `${Math.max(12, below + height <= win.innerHeight - 12 ? below : Math.min(rect.top - height - 8, win.innerHeight - height - 12))}px`;
  }
  function colors() {
    const color = solidColor(preferences.colorMode === 'custom' ? preferences.customColor : '#67C1F5');
    const text = textForColor(color);
    if (button) {
      // Inherit the actual adjacent Steam link's classes and inline theme styling.
      // Reapply the baseline when custom mode is reset, including the label's hover CSS.
      button.className = nativeHub?.className || 'btnv6_blue_hoverfade btn_medium';
      button.style.cssText = nativeHub?.getAttribute('style') || '';
      button.style.marginLeft = '6px'; button.style.cursor = 'pointer';
      const label = button.firstElementChild;
      label.className = nativeHub?.firstElementChild?.className || '';
      label.style.cssText = nativeHub?.firstElementChild?.getAttribute('style') || '';
      if (preferences.colorMode === 'custom') {
        button.style.background = color; button.style.color = text; button.style.borderColor = color;
        label.style.background = color; label.style.color = text;
      }
    }
    host.style.setProperty('--accent', color); host.style.setProperty('--accent-text', text);
    policy.textContent = preferences.automaticApply ? 'Automatic Apply ON' : 'Manual confirmation';
    policy.dataset.auto = String(preferences.automaticApply);
  }
  function paintSettings() {
    automatic.checked = preferences.automaticApply; colorMode.value = preferences.colorMode;
    hex.value = preferences.customColor; picker.value = solidColor(preferences.customColor);
    custom.hidden = preferences.colorMode !== 'custom'; colors();
  }
  function render() {
    if (!context) return;
    const task = context.task;
    gameName.textContent = task?.gameName || context.name;
    appIdLabel.textContent = `AppID ${context.id}`;
    const state = context.error ? 'Failed' : task?.state || (context.pending ? 'Connecting' : 'Idle');
    const step = ['ReadyToApply'].includes(state) ? 1 : ['ApplyingChanges','Completed'].includes(state) ? 2 : 0;
    stepItems.forEach((item,index) => { item.dataset.active = String(index === step); item.dataset.done = String(state === 'Completed' || index < step); });
    const botUrl = telegramUrl(context.id);
    requirements.hidden = !botUrl;
    if (botUrl) { botLink.href = botUrl; requirementMessage.textContent = `AppID ${context.id} needs additional files from Telegram. Open the bot and press Start to obtain them. Applying the bridge configuration does not install these files.`; }
    else botLink.removeAttribute('href');
    stateLabel.textContent = task?.errorCode === 'CONFIGURATION_NOT_FOUND' && !context.error ? 'Configuration Not Found' : labels[state] || state;
    message.textContent = context.error || (state === 'Completed' && botUrl ? 'Bridge configuration applied. Get the additional files from Nightfile Bot to finish setup.' : task?.errorCode === 'CONFIGURATION_NOT_FOUND'
      ? `Configuration Not Found for AppID ${context.id}. No changes were applied.` : task?.message) || 'Preparing the background import…';
    message.className = `message ${state === 'Completed' ? 'success' : context.error || ['Failed', 'Unsupported'].includes(state) ? 'error' : ''}`;
    verification.textContent = task?.verification || '';
    download.textContent = task?.bytesReceived ? `Downloaded ${bytes(task.bytesReceived)}${task.totalBytes ? ` / ${bytes(task.totalBytes)}` : ''}` : '';
    progress.hidden = ['Idle', 'Failed', 'Cancelled', 'Unsupported', 'ReadyToApply'].includes(state) || !!context.error;
    if (state === 'Downloading' && task?.totalBytes > 0) progress.value = Math.min(100, 100 * task.bytesReceived / task.totalBytes);
    else if (state === 'Completed') progress.value = 100;
    else progress.removeAttribute('value');
    summary.textContent = task?.fileCount ? `${task.fileCount} file changes · ${task.overwriteCount} replacements${task.automaticRequested ? ' · Automatic Apply requested' : ''}` : '';
    preview.replaceChildren();
    for (const entry of task?.preview || []) {
      const row = element('div', null, preview, 'file');
      const top = element('div', null, row, 'file-top');
      element('strong', entry.name, top); element('span', entry.overwrite ? 'Replace' : 'New file', top, `badge${entry.overwrite ? ' replace' : ''}`);
      const location = element('details', null, row); element('summary', `${bytes(entry.bytes)} · Show destination`, location);
      element('div', entry.destination, location, 'path');
    }
    preview.hidden = !task?.preview?.length;
    if (task?.preview?.length < task?.fileCount) element('div', `Showing ${(task.previewOffset || 0) + 1}–${(task.previewOffset || 0) + task.preview.length} of ${task.fileCount} validated destinations.`, preview, 'file notice');
    paging.hidden = !task || task.fileCount <= 40;
    previousPage.disabled = !(task?.previewOffset > 0) || context.pending;
    nextPage.disabled = (task?.previewOffset || 0) + (task?.preview?.length || 0) >= task?.fileCount || context.pending;
    const busy = context.pending && !context.polling;
    apply.hidden = state !== 'ReadyToApply'; apply.disabled = busy || state !== 'ReadyToApply' || !confirmation.hidden;
    cancel.hidden = !!task && terminal(state); cancel.disabled = busy || !task || terminal(state);
    retry.textContent = state === 'Completed' ? 'Import again' : 'Retry';
    retry.hidden = !(context.error || terminal(state)); retry.disabled = context.pending;
    colors(); place();
  }
  async function rpc(message) {
    let timer;
    const settingsRevision = preferencesRevision;
    try {
      const reply = await Promise.race([transport.request(message), new Promise((_, reject) => {
        timer = win.setTimeout(() => reject(new Error('Background worker timed out. Retry to reconnect.')), 6500);
        rpcTimers.add(timer);
      })]);
      if (reply && typeof reply === 'object') replySettingsRevision.set(reply, settingsRevision);
      return reply;
    } finally { if (timer != null) { win.clearTimeout(timer); rpcTimers.delete(timer); } }
  }
  function accept(reply, target) {
    if (!reply?.ok) throw new Error(reply?.message || reply?.error || 'Background worker unavailable.');
    if (reply.settings && !savingSettings && replySettingsRevision.get(reply) === preferencesRevision) { hasWorkerSettings = true; preferences = safeSettings(reply.settings); paintSettings(); }
    if (reply.task) {
      if (reply.task.appId !== target.id) throw new Error('Worker returned a task for another game. Nothing was applied.');
      if (reply.task.taskId !== target.task?.taskId || !(reply.task.revision < target.task?.revision)) target.task = reply.task;
    }
    target.error = null;
  }
  function queuePoll() {
    stopPoll();
    if (!open || disposed || !context?.task || terminal(context.task.state) || context.task.state === 'ReadyToApply' || context.error) return;
    poll = win.setTimeout(() => sync(false), options.pollInterval ?? 750);
  }
  async function sync(startIfMissing, retryTask = false) {
    const target = context, generation = epoch;
    if (!target || target.pending) return;
    target.pending = true; target.polling = !startIfMissing && !retryTask;
    if (!target.polling) render();
    try {
      let reply = await rpc({ op: 'status', appId: target.id });
      if (disposed || epoch !== generation || context !== target) return;
      accept(reply, target);
      if ((!target.task && startIfMissing) || retryTask) {
        reply = await rpc({ op: 'start', appId: target.id, gameName: target.name, retry: retryTask });
        if (disposed || epoch !== generation || context !== target) return;
        accept(reply, target);
      }
    } catch (error) { if (epoch === generation && context === target) target.error = error.message; }
    finally { target.pending = false; target.polling = false; if (epoch === generation && context === target && !disposed) { render(); queuePoll(); } }
  }
  async function action(op) {
    const target = context, generation = epoch;
    if (!target?.task || (target.pending && !target.polling)) return;
    target.pending = true; target.polling = false; confirmation.hidden = true; render();
    try {
      const reply = await rpc({ op, appId: target.id, taskId: target.task.taskId, ...(op === 'apply' ? { confirmed: true } : {}) });
      if (epoch === generation && context === target && !disposed) accept(reply, target);
    } catch (error) { if (epoch === generation && context === target) target.error = error.message; }
    finally { target.pending = false; if (epoch === generation && context === target && !disposed) { render(); queuePoll(); } }
  }
  async function saveSettings(next, confirmed = false) {
    if (savingSettings || disposed) return;
    if (!validColor(next.customColor)) { settingsMessage.textContent = 'Enter a valid HEX color.'; return; }
    const controls = [enableAuto, automatic, saveColor, reset, colorMode, picker, hex]; controls.forEach(c => c.disabled = true);
    savingSettings = true; preferencesRevision++; settingsMessage.textContent = 'Saving preferences…';
    const target = context, generation = epoch;
    try {
      const reply = await rpc({ op: 'settings', settings: next, confirmed,
        ...(confirmed && next.automaticApply && target ? {appId:target.id, ...(target.task ? {taskId:target.task.taskId} : {})} : {}) });
      if (disposed) return;
      if (!reply?.ok) throw new Error(reply.message || reply.error);
      hasWorkerSettings = true; preferences = safeSettings(reply.settings); paintSettings(); automaticConsent.hidden = true;
      if (epoch === generation && context === target && reply.task) accept(reply, target);
      settingsMessage.textContent = 'Settings saved. Active immediately.';
    } catch (error) { if (!disposed) settingsMessage.textContent = error.message; }
    finally { savingSettings = false; controls.forEach(c => c.disabled = false); if (!disposed) { render(); queuePoll(); } }
  }
  function closePopup() {
    open = false; stopPoll(); host.hidden = true; confirmation.hidden = true;
    if (typeof host.hidePopover === 'function') try { host.hidePopover(); } catch { }
    button?.setAttribute('aria-expanded', 'false');
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true}); previousFocus = null;
  }
  function showPopup() {
    previousFocus = doc.activeElement; open = true; host.hidden = false; work.hidden = false; settings.hidden = true; actions.hidden = false; render();
    if (typeof host.showPopover === 'function') try { host.showPopover(); } catch { }
    button?.setAttribute('aria-expanded', 'true'); place();
    close.focus({preventScroll:true});
    sync(true);
  }
  close.addEventListener('click', e => { if (trusted(e)) closePopup(); });
  gear.addEventListener('click', e => { if (trusted(e)) { work.hidden = true; settings.hidden = false; actions.hidden = true; paintSettings(); place(); } });
  returnToImport.addEventListener('click', e => { if (trusted(e)) { work.hidden = false; settings.hidden = true; actions.hidden = false; render(); } });
  apply.addEventListener('click', e => {
    if (!trusted(e) || context?.task?.state !== 'ReadyToApply') return;
    confirmationText.textContent = `Apply ${context.task.fileCount} file changes? ${context.task.overwriteCount} existing files will be replaced. This uses the validated paths shown above.`;
    confirmation.hidden = false; apply.disabled = true; confirmApply.focus({preventScroll:true}); confirmation.scrollIntoView?.({block:'nearest'}); place();
  });
  confirmApply.addEventListener('click', e => { if (trusted(e)) action('apply'); });
  back.addEventListener('click', e => { if (trusted(e)) { confirmation.hidden = true; render(); } });
  async function pageFiles(offset) {
    const target = context, generation = epoch;
    if (!target?.task || target.pending) return;
    target.pending = true;
    try {
      const reply = await rpc({ op: 'preview', appId: target.id, taskId: target.task.taskId, previewOffset: offset });
      if (epoch === generation && context === target && !disposed) accept(reply, target);
    } catch (error) { if (epoch === generation && context === target) target.error = error.message; }
    finally { target.pending = false; if (epoch === generation && context === target && !disposed) render(); }
  }
  previousPage.addEventListener('click', e => { if (trusted(e)) pageFiles(Math.max(0, (context?.task?.previewOffset || 0) - 40)); });
  nextPage.addEventListener('click', e => { if (trusted(e)) pageFiles((context?.task?.previewOffset || 0) + 40); });
  cancel.addEventListener('click', e => { if (trusted(e)) action('cancel'); });
  retry.addEventListener('click', e => { if (trusted(e)) sync(true, true); });
  automatic.addEventListener('change', e => {
    if (!trusted(e)) { paintSettings(); return; }
    if (automatic.checked && !preferences.automaticApply) {
      automatic.checked = false;
      autoConsentText.textContent = `Enable Automatic Apply for ${context?.name || 'the current import'} and future import clicks? Verified Lua/Manifest files may be written or replaced without another confirmation. Validation and rollback remain active.`;
      automaticConsent.hidden = false; enableAuto.focus({preventScroll:true}); place();
    }
    else saveSettings({ ...preferences, automaticApply: false });
  });
  enableAuto.addEventListener('click', e => { if (trusted(e)) saveSettings({ ...preferences, automaticApply: true }, true); });
  rejectAuto.addEventListener('click', e => { if (trusted(e)) { automaticConsent.hidden = true; automatic.checked = false; } });
  colorMode.addEventListener('change', e => { if (trusted(e)) saveSettings({ ...preferences, colorMode: colorMode.value }); });
  picker.addEventListener('input', e => { if (trusted(e)) { hex.value = picker.value; preferences = { ...preferences, customColor: picker.value }; colors(); } });
  picker.addEventListener('change', e => { if (trusted(e)) saveSettings({ ...preferences, customColor: picker.value, colorMode: 'custom' }); });
  saveColor.addEventListener('click', e => { if (trusted(e)) saveSettings({ ...preferences, customColor: hex.value, colorMode: 'custom' }); });
  reset.addEventListener('click', e => { if (trusted(e)) saveSettings({ ...defaultSettings }); });
  openApp.addEventListener('click', async e => { if (trusted(e) && !(await transport.openApp?.())) settingsMessage.textContent = 'Could not open Night Injection. Repair its installation.'; });
  botLink.addEventListener('click', e => { if (!trusted(e) || !telegramUrl(context?.id)) e.preventDefault(); });
  const outside = event => { if (open && !event.composedPath().includes(host) && !event.composedPath().includes(button)) closePopup(); };
  const escape = event => { if (event.key === 'Escape') closePopup(); };
  doc.addEventListener('pointerdown', outside); doc.addEventListener('keydown', escape);
  win.addEventListener('resize', place); win.addEventListener('scroll', place, true);
  const schedule = () => { if (!scheduled && !disposed) { scheduled = true; win.queueMicrotask(refresh); } };
  function refresh() {
    scheduled = false; if (disposed) return;
    if (!host.isConnected) (doc.body || doc.documentElement).append(host);
    const id = appIdFromUrl(win.location.href);
    const hub = [...doc.querySelectorAll('a[href]')].find(a => {
      try { const u = new URL(a.href); return u.hostname === 'steamcommunity.com' && u.pathname.replace(/\/$/, '') === `/app/${id}`; } catch { return false; }
    });
    if (id && id === context?.id && button?.isConnected && hub === nativeHub) { colors(); return; }
    epoch++; closePopup(); button?.remove(); button = null; nativeHub = null; context = null;
    if (!id) return;
    const fallback = doc.querySelector('.apphub_OtherSiteInfo, .apphub_AppName, #game_area_purchase');
    if (!hub && !fallback) return;
    const name = doc.querySelector('.apphub_AppName')?.textContent?.trim().slice(0, 256) || `Steam AppID ${id}`;
    context = { id, name, task: null, pending: false, error: null };
    nativeHub = hub;
    button = doc.createElement('a'); button.id = 'darkdevil-import-button'; button.dataset.appId = id;
    button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    const triggerLabel = element('span', null, button);
    const triggerLogo = logo(triggerLabel);
    triggerLogo.style.cssText = 'width:18px;height:18px;object-fit:contain;vertical-align:middle;margin-right:7px;pointer-events:none;';
    triggerLabel.append(doc.createTextNode('Nght-Bridge'));
    button.addEventListener('click', e => { if (trusted(e)) { if (open) closePopup(); else showPopup(); } });
    button.addEventListener('keydown', e => {
      if (trusted(e) && ['Enter', ' '].includes(e.key)) { e.preventDefault(); if (open) closePopup(); else showPopup(); }
    });
    if (hub) hub.after(button); else fallback.append(button);
    colors();
  }
  const observer = new win.MutationObserver(records => {
    if (records.some(record => record.type === 'childList' || record.target === nativeHub || record.target === nativeHub?.firstElementChild)) schedule();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  win.addEventListener('popstate', schedule); win.addEventListener('hashchange', schedule);
  const originalPush = win.history.pushState, originalReplace = win.history.replaceState;
  const push = function(...args) { originalPush.apply(this, args); schedule(); };
  const replace = function(...args) { originalReplace.apply(this, args); schedule(); };
  win.history.pushState = push; win.history.replaceState = replace;
  const api = { dispose() {
    if (disposed) return; disposed = true; epoch++; stopPoll(); closePopup(); observer.disconnect(); button?.remove(); host.remove();
    for (const timer of rpcTimers) win.clearTimeout(timer); rpcTimers.clear();
    doc.removeEventListener('pointerdown', outside); doc.removeEventListener('keydown', escape);
    win.removeEventListener('resize', place); win.removeEventListener('scroll', place, true);
    win.removeEventListener('popstate', schedule); win.removeEventListener('hashchange', schedule); win.removeEventListener('pagehide', api.dispose);
    if (win.history.pushState === push) win.history.pushState = originalPush;
    if (win.history.replaceState === replace) win.history.replaceState = originalReplace;
    if (win[instanceKey] === api) delete win[instanceKey];
  }, ...(options.allowSyntheticEvents ? { testing: { shadow, showPopup, closePopup, sync, render } } : {}) };
  win[instanceKey] = api; win.addEventListener('pagehide', api.dispose, { once: true }); refresh();
  const initialPreferencesRevision = preferencesRevision;
  Promise.resolve(transport.preferences?.()).then(value => {
    if (!disposed && value && !hasWorkerSettings && preferencesRevision === initialPreferencesRevision) { preferences = safeSettings(value); paintSettings(); }
  }).catch(error => { if (!disposed) settingsMessage.textContent = `Could not load saved settings: ${error.message}`; });
  return api;
}
