const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const load=import('../plugin/webview/popup.js');
const defaults={automaticApply:false,colorMode:'native',customColor:'#FF6A00',version:2};
function page(id='730') {return new JSDOM(`<div class="apphub_AppName">Game ${id}</div><a class="btnv6_blue_hoverfade btn_medium" href="https://steamcommunity.com/app/${id}"><span>Community Hub</span></a>`,{url:`https://store.steampowered.com/app/${id}/`});}
function control(shadow,name){return [...shadow.querySelectorAll('button')].find(b=>b.textContent===name);}
function ready(id='730'){return {taskId:'current-task',appId:id,state:'ReadyToApply',message:'Verified package ready',revision:1,fileCount:1,overwriteCount:0,preview:[{name:`${id}.lua`,destination:`Steam/config/${id}.lua`,bytes:42,overwrite:false}]};}

test('Nght-Bridge retains native classes with a small original bundled logo',async()=>{
  const {attachBridge}=await load; const dom=page();
  const api=attachBridge(dom.window,{request:async()=>({ok:true,task:ready(),settings:defaults})},{allowSyntheticEvents:true});
  const trigger=dom.window.document.querySelector('#darkdevil-import-button');
  assert.equal(trigger.textContent,'Nght-Bridge'); assert.equal(trigger.className,'btnv6_blue_hoverfade btn_medium');
  const img=trigger.querySelector('img'); assert.equal(img.style.width,'18px'); assert.equal(img.alt,'');
  assert.deepEqual(Buffer.from(img.src.split(',')[1],'base64'),fs.readFileSync(path.resolve(__dirname,'../../website/asests/logo.png')));
  assert.equal(trigger.style.background,''); api.dispose();dom.window.close();
});

test('automatic enabling names the current task and stale status cannot undo the saved ON state',async()=>{
  const {attachBridge}=await load;const dom=page();let hold=false, release;let saved={...defaults};const requests=[];
  const transport={preferences:async()=>defaults,request:async message=>{
    requests.push(message);
    if(message.op==='settings'){saved=message.settings;return {ok:true,settings:saved,task:{...ready(),state:'Completed',message:'Configuration applied successfully',revision:3,automaticRequested:true}};}
    if(hold) return new Promise(resolve=>release=()=>resolve({ok:true,settings:defaults,task:ready()}));
    return {ok:true,settings:saved,task:ready()};
  }};
  const api=attachBridge(dom.window,transport,{allowSyntheticEvents:true});api.testing.showPopup();await tick();
  hold=true;const delayed=api.testing.sync(false);await tick();
  const automatic=api.testing.shadow.querySelector('input[type=checkbox]');automatic.checked=true;
  automatic.dispatchEvent(new dom.window.Event('change'));control(api.testing.shadow,'Enable Automatic Apply').click();await tick();
  const update=requests.find(r=>r.op==='settings');assert.equal(update.appId,'730');assert.equal(update.taskId,'current-task');assert.equal(update.confirmed,true);
  assert.equal(automatic.checked,true);release();await delayed;await tick();
  assert.equal(automatic.checked,true);assert.match(api.testing.shadow.textContent,/Automatic Apply ON/);
  assert.match(api.testing.shadow.textContent,/Configuration applied successfully/);api.dispose();dom.window.close();
});

test('every external-file AppID uses only the fixed bot and the exact canonical start payload',async()=>{
  const {telegramUrl}=await import('../plugin/webview/game-requirements.js');
  const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../website/config/game-requirements.json'),'utf8'));
  for(const [id,value] of Object.entries(config)) assert.equal(telegramUrl(id),value.externalFiles ? `https://t.me/Nightfile_bot?start=${id}` : null);
  for(const id of ['730','7940&start=evil','07940','https://evil','4294967296',7940,null])assert.equal(telegramUrl(id),null);
});

test('late cached preferences cannot overwrite authoritative worker settings',async()=>{
  const {attachBridge}=await load;const dom=page();let cached;
  const api=attachBridge(dom.window,{preferences:()=>new Promise(resolve=>cached=resolve),
    request:async()=>({ok:true,task:ready(),settings:{...defaults,automaticApply:true}})},{allowSyntheticEvents:true});
  api.testing.showPopup();await tick();
  cached(defaults);await tick();
  assert.equal(api.testing.shadow.querySelector('input[type=checkbox]').checked,true);
  assert.match(api.testing.shadow.textContent,/Automatic Apply ON/);api.dispose();dom.window.close();
});

test('listed game always prompts for bot files including after completion; navigation removes the old link',async()=>{
  const {attachBridge}=await load;const dom=page('7940');
  const api=attachBridge(dom.window,{request:async m=>({ok:true,task:{...ready(m.appId),state:'Completed'},settings:defaults})},{allowSyntheticEvents:true});
  api.testing.showPopup();await tick();
  const notice=api.testing.shadow.querySelector('.requirements');assert.equal(notice.hidden,false);
  const link=notice.querySelector('a');assert.equal(link.href,'https://t.me/Nightfile_bot?start=7940');assert.equal(link.rel,'noopener noreferrer');assert.equal(link.target,'_blank');
  assert.match(api.testing.shadow.querySelector('[role=status]').textContent,/additional files/);
  dom.window.document.querySelector('a[href]').href='https://steamcommunity.com/app/730';
  dom.window.history.pushState({},'','/app/730/');await tick();api.testing.showPopup();await tick();
  assert.equal(notice.hidden,true);assert.equal(link.hasAttribute('href'),false);api.dispose();dom.window.close();
});

test('untrusted names, errors and preview paths remain text; only bundled logo images are rendered',async()=>{
  const {attachBridge}=await load;const dom=page();const attack='<img src=x onerror="window.__injected=1">';
  const api=attachBridge(dom.window,{request:async()=>({ok:true,task:{...ready(),gameName:attack,message:'<script>bad()</script>',preview:[{name:attack,destination:attack,bytes:1,overwrite:true}]},settings:defaults})},{allowSyntheticEvents:true});
  api.testing.showPopup();await tick();
  assert.equal(api.testing.shadow.querySelector('.game').textContent,attack);
  assert.equal(api.testing.shadow.querySelector('.game img'),null);assert.equal(api.testing.shadow.querySelector('.preview img'),null);
  assert.equal(api.testing.shadow.querySelector('script'),null);assert.equal(dom.window.__injected,undefined);
  api.dispose();dom.window.close();
});
