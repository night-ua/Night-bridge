// Millennium may decode a JSON-looking Lua string before resolving its proxy.
// Only parse serialized strings; the named pipe remains UTF-8 JSON bytes.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const states = new Set(['Idle', 'Connecting', 'CheckingConfiguration', 'PreparingPackage', 'Downloading',
  'VerifyingPackage', 'ReadyToApply', 'ApplyingChanges', 'Completed', 'Failed', 'Cancelled', 'Unsupported']);
const appId = value => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 4294967295;

export function decodeRecord(value, boundary = 'Millennium') {
  if (typeof value === 'string') {
    if (value.length > 65536) throw new Error(`${boundary}: response exceeds the size limit.`);
    try { value = JSON.parse(value); }
    catch { throw new Error(`${boundary}: invalid JSON response.`); }
  }
  if (!record(value)) throw new Error(`${boundary}: expected a response object.`);
  return value;
}

export function decodeSettings(value) {
  const settings = decodeRecord(value, 'Bridge settings');
  if (settings.version !== 2 || typeof settings.automaticApply !== 'boolean'
    || !['native', 'automatic', 'custom'].includes(settings.colorMode)
    || typeof settings.customColor !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(settings.customColor))
    throw new Error('Bridge settings: missing or invalid fields.');
  return settings;
}

export function decodeReply(value, request) {
  const reply = decodeRecord(value);
  if (typeof reply.ok !== 'boolean') throw new Error('Millennium: missing response status.');
  for (const key of ['error', 'message']) {
    if (reply[key] != null && typeof reply[key] !== 'string') throw new Error(`Millennium: invalid ${key} field.`);
  }
  if (!reply.ok) {
    if (typeof reply.error !== 'string' && typeof reply.message !== 'string')
      throw new Error('Millennium: missing error details.');
    return reply; // Error responses do not have to contain successful task data.
  }
  if (reply.settings != null) decodeSettings(reply.settings);
  if (request.op === 'settings' && reply.settings == null) throw new Error('Millennium: missing settings.');
  if (['start', 'apply', 'cancel', 'preview'].includes(request.op) && reply.task == null)
    throw new Error('Millennium: missing task.');
  if (reply.task != null) {
    const task = reply.task;
    if (!record(task) || !appId(task.appId) || typeof task.taskId !== 'string' || !task.taskId
      || !states.has(task.state) || typeof task.message !== 'string'
      || !Number.isSafeInteger(task.revision) || task.revision < 0)
      throw new Error('Millennium: invalid task or progress fields.');
    if (task.appId !== request.appId || (request.taskId != null && task.taskId !== request.taskId))
      throw new Error('Worker returned a task for another game or import. Nothing was applied.');
    for (const key of ['bytesReceived', 'totalBytes', 'fileCount', 'overwriteCount', 'previewOffset']) {
      if (task[key] != null && (!Number.isSafeInteger(task[key]) || task[key] < 0))
        throw new Error(`Millennium: invalid progress field ${key}.`);
    }
    if (task.preview != null && (!Array.isArray(task.preview) || task.preview.length > 40
      || task.preview.some(file => !record(file) || typeof file.name !== 'string' || typeof file.destination !== 'string'
        || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.overwrite !== 'boolean')))
      throw new Error('Millennium: invalid preview fields.');
  }
  return reply;
}

export function createTransport(backend) {
  return {
    async request(message) {
      if (!record(message) || typeof message.op !== 'string'
        || (message.appId != null && !appId(message.appId))) throw new Error('Invalid bridge request or AppID.');
      return decodeReply(await backend.bridge_request(JSON.stringify(message)), message);
    },
    async preferences() { return decodeSettings(await backend.get_bridge_preferences()); },
    openApp: () => backend.open_app(),
  };
}
