const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const load = import('../plugin/webview/popup.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function dom() { return new JSDOM('<div class="apphub_AppName">Mock Game</div><a href="https://steamcommunity.com/app/730/">Community Hub</a>', { url: 'https://store.steampowered.com/app/730/' }); }
function fake() {
  const requests = []; let task, settings = { automaticApply: false, colorMode: 'automatic', customColor: '#FF6A00', version: 2 };
  return { requests, preferences: async () => settings, task: () => task,
    async request(message) {
      requests.push(message);
      if (message.op === 'settings') settings = message.settings || settings;
      if (message.op === 'start') task = { taskId: 'a', appId: message.appId, gameName: 'Mock Game', state: 'ReadyToApply', message: 'Ready', fileCount: 1, overwriteCount: 1,
        verification: 'SHA-256 verified', preview: [{ name: '730.lua', destination: 'Steam/config/lua/730.lua', bytes: 100, overwrite: true }] };
      if (message.op === 'apply') task = { ...task, state: 'Completed', message: 'Configuration applied successfully' };
      if (message.op === 'cancel') task = { ...task, state: 'Cancelled', message: 'Cancelled' };
      return { ok: true, task, settings };
    } };
}
function button(shadow, name) { return [...shadow.querySelectorAll('button')].find(b => b.textContent === name); }

test('embedded popup previews, confirms manual apply, closes/reopens without duplicate import', async () => {
  const { attachBridge } = await load; const page = dom(), transport = fake();
  const api = attachBridge(page.window, transport, { allowSyntheticEvents: true });
  page.window.document.querySelector('#darkdevil-import-button').click(); await tick(); await tick();
  assert.match(api.testing.shadow.textContent, /Steam\/config\/lua\/730.lua/);
  button(api.testing.shadow, 'Apply Changes').click(); await tick();
  assert.equal(transport.requests.filter(r => r.op === 'apply').length, 0);
  button(api.testing.shadow, 'Confirm Apply').click(); await tick();
  assert.equal(transport.requests.find(r => r.op === 'apply').confirmed, true);
  assert.match(api.testing.shadow.textContent, /Configuration applied successfully/);
  api.testing.closePopup(); api.testing.showPopup(); await tick();
  assert.equal(transport.requests.filter(r => r.op === 'start').length, 1);
  api.dispose(); page.window.close();
});

test('synthetic page clicks do not reach the native backend in production mode', async () => {
  const { attachBridge } = await load; const page = dom(), transport = fake();
  const api = attachBridge(page.window, transport);
  page.window.document.querySelector('#darkdevil-import-button').click(); await tick();
  assert.equal(transport.requests.length, 0);
  assert.equal(api.testing, undefined);
  assert.equal(page.window.document.querySelector('#darkdevil-import-popup').shadowRoot, null);
  api.dispose(); page.window.close();
});

test('Automatic Apply requires explicit enabling confirmation; defaults and colors persist through native settings', async () => {
  const { attachBridge } = await load; const page = dom(), transport = fake();
  const api = attachBridge(page.window, transport, { allowSyntheticEvents: true });
  api.testing.showPopup(); await tick(); await tick();
  const automatic = api.testing.shadow.querySelector('input[type=checkbox]');
  assert.equal(automatic.checked, false);
  automatic.checked = true; automatic.dispatchEvent(new page.window.Event('change')); await tick();
  assert.equal(transport.requests.filter(r => r.op === 'settings').length, 0);
  button(api.testing.shadow, 'Enable Automatic Apply').click(); await tick();
  assert.equal(transport.requests.find(r => r.op === 'settings').confirmed, true);
  assert.equal(automatic.checked, true);
  api.testing.shadow.querySelector('input[type=text]').value = '#FFFFFF';
  button(api.testing.shadow, 'Save color').click(); await tick();
  assert.equal(page.window.document.querySelector('#darkdevil-import-button').style.color, 'rgb(0, 0, 0)');
  button(api.testing.shadow, 'Reset to Default').click(); await tick();
  assert.equal(automatic.checked, false);
  assert.equal(transport.requests.at(-1).settings.colorMode, 'native');
  api.dispose(); page.window.close();
});

test('cross-game results are rejected and navigation cleans the popup', async () => {
  const { attachBridge } = await load; const page = dom();
  const api = attachBridge(page.window, { request: async () => ({ ok: true, task: { appId: '220', state: 'Completed' } }) }, { allowSyntheticEvents: true });
  api.testing.showPopup(); await tick();
  assert.match(api.testing.shadow.textContent, /another game/);
  assert.match(api.testing.shadow.textContent, /Failed/);
  page.window.history.pushState({}, '', '/sub/1/'); await tick();
  assert.equal(page.window.document.querySelector('#darkdevil-import-button'), null);
  assert.equal(page.window.document.querySelector('#darkdevil-import-popup').hidden, true);
  api.dispose(); assert.equal(page.window.document.querySelector('#darkdevil-import-popup'), null); page.window.close();
});

test('worker errors terminate Connecting; retry and cancel send only associated task messages', async () => {
  const { attachBridge } = await load; const page = dom(), transport = fake();
  let unavailable = true;
  const api = attachBridge(page.window, { ...transport, request: message => unavailable
    ? Promise.resolve({ ok: false, message: 'Worker unavailable' }) : transport.request(message) }, { allowSyntheticEvents: true });
  api.testing.showPopup(); await tick(); assert.match(api.testing.shadow.textContent, /Failed/);
  unavailable = false; button(api.testing.shadow, 'Retry').click(); await tick(); await tick();
  assert.equal(transport.requests.find(r => r.op === 'start').retry, true);
  button(api.testing.shadow, 'Cancel').click(); await tick();
  assert.equal(transport.requests.at(-1).taskId, 'a');
  assert.match(api.testing.shadow.textContent, /Cancelled/);
  api.dispose(); page.window.close();
});

test('theme comes from website variables and valid HEX colors have readable contrast', async () => {
  const { defaultSettings, validColor, safeSettings, textForColor, solidColor } = await load;
  assert.equal(defaultSettings.customColor, '#FF6A00'); assert.equal(defaultSettings.automaticApply, false);
  assert.equal(textForColor('#000000'), '#FFFFFF'); assert.equal(textForColor('#FFFFFF'), '#000000');
  assert.equal(solidColor('#ABC'), '#AABBCC'); assert.equal(validColor('#12345678'), true);
  assert.equal(validColor('url(https://evil)'), false); assert.equal(validColor('#GGGGGG'), false);
  assert.equal(safeSettings({ automaticApply: true }).automaticApply, false);
  assert.equal(defaultSettings.colorMode, 'native');
  assert.deepEqual(safeSettings({automaticApply:true,colorMode:'automatic',customColor:'#123456',version:2}),
    {automaticApply:true,colorMode:'native',customColor:'#123456',version:2});
  assert.equal(safeSettings({automaticApply:true,colorMode:'custom',customColor:'#abc',version:2}).customColor,'#ABC');
});

test('native trigger inherits Community Hub styles, reacts to theme changes and survives repeated navigation without duplicates', async () => {
  const {attachBridge}=await load; const page=dom(), transport=fake();
  const hub=page.window.document.querySelector('a'); hub.className='btnv6_blue_hoverfade btn_medium theme-native';
  hub.style.cssText='background:rgb(30,60,80);color:rgb(90,190,230);border-radius:2px;';
  hub.innerHTML='<span style="padding:0 15px;line-height:32px;font-size:15px">Community Hub</span>';
  const api=attachBridge(page.window,transport,{allowSyntheticEvents:true}); await tick();
  let trigger=page.window.document.querySelector('#darkdevil-import-button');
  assert.equal(trigger.className,hub.className); assert.equal(trigger.style.background,hub.style.background);
  assert.equal(trigger.style.color,hub.style.color); assert.equal(trigger.firstElementChild.style.cssText,hub.firstElementChild.style.cssText);
  assert.equal(trigger.previousElementSibling,hub); assert.equal(trigger.style.minHeight,'');
  hub.className+=' updated'; hub.style.color='white'; await tick();
  assert.equal(trigger.className,hub.className); assert.equal(trigger.style.color,hub.style.color);
  for(const id of ['2406770','220','730']) {
    hub.href=`https://steamcommunity.com/app/${id}`;
    page.window.history.pushState({},'',`/app/${id}/`); await tick();
    trigger=page.window.document.querySelector('#darkdevil-import-button');
    assert.equal(trigger.dataset.appId,id); assert.equal(page.window.document.querySelectorAll('#darkdevil-import-button').length,1);
    api.testing.showPopup(); await tick(); await tick();
    assert.equal(transport.requests.filter(r=>r.op==='status').at(-1).appId,id);
  }
  attachBridge(page.window,transport,{allowSyntheticEvents:true});
  assert.equal(page.window.document.querySelectorAll('#darkdevil-import-button').length,1);
  page.window.__darkdevilSteamBridge.dispose(); page.window.close();
});

test('configuration unavailable displays a specific terminal message', async () => {
  const {attachBridge}=await load; const page=dom();
  const api=attachBridge(page.window,{request:async()=>({ok:true,task:{taskId:'missing',appId:'730',state:'Unsupported',errorCode:'CONFIGURATION_NOT_FOUND',message:'AppID not found'}})}, {allowSyntheticEvents:true});
  api.testing.showPopup(); await tick();
  assert.match(api.testing.shadow.textContent,/Configuration Not Found for AppID 730/);
  assert.doesNotMatch(api.testing.shadow.textContent,/\[object Object\]/);
  api.dispose(); page.window.close();
});
