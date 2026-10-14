import {externalFileAppIds} from './brand-assets.js';
import {validAppId} from './store-url.js';
const required = new Set(externalFileAppIds);
export function telegramUrl(appId) {
  return validAppId(appId) && required.has(appId) ? `https://t.me/Nightfile_bot?start=${appId}` : null;
}
