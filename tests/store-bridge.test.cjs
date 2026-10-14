const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const load = import('../plugin/webview/store-bridge.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('strict store URLs and canonical uint32 AppIDs', async () => {
  const { appIdFromUrl, activationUrl } = await load;
  assert.equal(appIdFromUrl('https://store.steampowered.com/app/1174180/Red_Dead_Redemption_2/'), '1174180');
  assert.equal(activationUrl('1174180'), 'night-injection://import?appId=1174180');
  for (const url of ['http://store.steampowered.com/app/730/', 'https://evil.com/app/730/',
    'https://store.steampowered.com.evil.com/app/730/', 'https://user@store.steampowered.com/app/730/',
    'https://store.steampowered.com/app/0/', 'https://store.steampowered.com/app/0730/',
    'https://store.steampowered.com/app/4294967296/', 'https://store.steampowered.com/app/730evil/',
    'https://store.steampowered.com/sub/730/', 'invalid']) assert.equal(appIdFromUrl(url), null, url);
  assert.throws(() => activationUrl('730&origin=http://evil.com'));
});

test('one button beside Community Hub; no automatic requests; click suppression and cleanup', async () => {
  const { attachBridge } = await load;
  const dom = new JSDOM('<a id="hub" href="https://steamcommunity.com/app/730">Community Hub</a>',
    { url: 'https://store.steampowered.com/app/730/' });
  let calls = 0, complete, task;
  const transport = { async request(message) {
    if (message.op === 'status') return { ok: true, task };
    assert.equal(message.appId, '730'); calls++;
    return new Promise(r => complete = () => { task = { taskId: 'test', appId: '730', state: 'ReadyToApply' }; r({ ok: true, task }); });
  } };
  attachBridge(dom.window, transport, { allowSyntheticEvents: true });
  const api = attachBridge(dom.window, transport, { allowSyntheticEvents: true });
  await tick();
  assert.equal(calls, 0);
  assert.equal(dom.window.document.querySelectorAll('#darkdevil-import-button').length, 1);
  assert.equal(dom.window.document.querySelector('#hub').nextElementSibling.id, 'darkdevil-import-button');
  const button = dom.window.document.querySelector('#darkdevil-import-button');
  button.click(); button.click(); await tick(); assert.equal(calls, 1);
  complete(); await tick(); button.click(); await tick(); assert.equal(calls, 1);
  api.dispose(); assert.equal(dom.window.document.querySelector('#darkdevil-import-button'), null);
  dom.window.close();
});

test('SPA navigation, fallback, late DOM insertion, unsupported pages and launch errors', async () => {
  const { attachBridge } = await load;
  const dom = new JSDOM('<div class="apphub_OtherSiteInfo"></div>',
    { url: 'https://store.steampowered.com/app/730/' });
  const sent = [];
  const api = attachBridge(dom.window, { async request(message) { sent.push(message.appId); return { ok: false, message: 'Worker unavailable' }; } }, { allowSyntheticEvents: true });
  dom.window.history.pushState({}, '', '/app/220/Half_Life_2/'); await tick();
  const button = dom.window.document.querySelector('#darkdevil-import-button');
  assert.equal(button.dataset.appId, '220'); button.click(); await tick();
  assert.deepEqual(sent, ['220']);
  assert.match(api.testing.shadow.querySelector('[role="status"]').textContent, /Worker unavailable/);
  dom.window.history.replaceState({}, '', '/sub/1/'); await tick();
  assert.equal(dom.window.document.querySelector('#darkdevil-import-button'), null);
  dom.window.history.pushState({}, '', '/app/440/'); await tick();
  assert.equal(dom.window.document.querySelector('#darkdevil-import-button').dataset.appId, '440');
  api.dispose(); dom.window.close();
  const late = new JSDOM('', { url: 'https://store.steampowered.com/app/730/' });
  const lateApi = attachBridge(late.window, { request: async () => ({ ok: true }) }, { allowSyntheticEvents: true });
  late.window.document.body.innerHTML = '<div class="apphub_AppName">Game</div>';
  await tick(); assert.equal(late.window.document.querySelectorAll('#darkdevil-import-button').length, 1);
  lateApi.dispose(); late.window.close();
});
