const test = require('node:test');
const assert = require('node:assert/strict');
const load = import('../plugin/webview/transport.js');
const settings = { automaticApply:false, colorMode:'native', customColor:'#FF6A00', version:2 };
const task = { appId:'2406770', taskId:'bodycam-task', state:'Downloading', message:'Downloading package', revision:3,
  bytesReceived:100, totalBytes:506, preview:[], fileCount:0, overwriteCount:0 };
const reply = { ok:true, settings, task };

test('regression reproduces the former unconditional JSON.parse on a decoded FFI object', () => {
  assert.throws(()=>JSON.parse(reply),/\[object Object\]/);
});

for (const [name, encode] of [['JSON string', JSON.stringify], ['already-decoded object', value => value]]) {
  test(`${name} retains nested settings/task, real progress and AppID`, async () => {
    const { createTransport } = await load; let sent;
    const transport = createTransport({ bridge_request: async json => { sent = JSON.parse(json); return encode(reply); },
      get_bridge_preferences: async () => encode(settings) });
    const received = await transport.request({op:'status',appId:'2406770'});
    assert.deepEqual(received, reply); assert.equal(received.task.bytesReceived,100);
    assert.equal(sent.appId,'2406770'); assert.deepEqual(await transport.preferences(),settings);
  });
}
test('API and IPC error responses retain structured errors without parsing nested success fields', async () => {
  const { decodeReply } = await load;
  for (const code of ['CONFIGURATION_NOT_FOUND','SERVER_ERROR','WORKER_UNAVAILABLE']) {
    const failure={ok:false,error:code,message:'Specific failure',task:{invalid:true}};
    assert.deepEqual(decodeReply(failure,{appId:'2406770'}),failure);
    assert.deepEqual(decodeReply(JSON.stringify(failure),{appId:'2406770'}),failure);
  }
});
test('invalid JSON, null, missing fields, binary and malformed progress fail explicitly', async () => {
  const { decodeReply } = await load;
  for (const value of ['[object Object]','{',null,undefined,[],{}, {ok:null},{ok:false},
    Buffer.from('PK\x03\x04'), {ok:false,error:'WORKER_UNAVAILABLE',message:{}},
    {ok:true,task:{...task,bytesReceived:'100'}}, {ok:true,task:{...task,revision:null}},
    {ok:true,task:JSON.stringify(task)}, {ok:true,settings:{}}, {ok:true,task:{...task,preview:[{name:'file'}]}}])
    assert.throws(()=>decodeReply(value,{appId:'2406770'}));
});
test('cross-game and cross-task data cannot propagate to apply', async () => {
  const { decodeReply } = await load;
  assert.throws(()=>decodeReply(reply,{appId:'730'}),/another game/);
  assert.throws(()=>decodeReply(reply,{appId:'2406770',taskId:'different-task'}),/another game or import/);
});
test('worker connection rejection is surfaced; no manufactured success', async () => {
  const { createTransport } = await load;
  const transport=createTransport({bridge_request:async()=>{throw new Error('IPC disconnected');}});
  await assert.rejects(transport.request({op:'start',appId:'2406770'}),/IPC disconnected/);
});
test('null task legitimately means no existing import and invalid AppID is rejected before IPC', async () => {
  const { createTransport } = await load; let calls=0;
  const transport=createTransport({bridge_request:async()=>{calls++; return {ok:true,task:null,settings};}});
  assert.equal((await transport.request({op:'status',appId:'2406770'})).task,null);
  for (const id of ['0','02406770','4294967296',2406770]) await assert.rejects(transport.request({op:'start',appId:id}));
  assert.equal(calls,1);
});
