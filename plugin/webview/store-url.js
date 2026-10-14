export function validAppId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 4294967295;
}
export function appIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'store.steampowered.com' || url.port || url.username || url.password) return null;
    const match = /^\/app\/([1-9][0-9]{0,9})(?:\/|$)/.exec(url.pathname);
    return match && validAppId(match[1]) ? match[1] : null;
  } catch { return null; }
}
export function activationUrl(appId) {
  if (!validAppId(appId)) throw new TypeError('Invalid Steam AppID');
  return `night-injection://import?appId=${appId}`;
}
