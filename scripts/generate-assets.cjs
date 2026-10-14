const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
if (process.argv.includes('--prepare-output')) fs.mkdirSync(path.join(root,'artifacts'), {recursive:true});
const requirements = JSON.parse(fs.readFileSync(path.join(root,'website/config/game-requirements.json'),'utf8'));
const ids = Object.keys(requirements).filter(id => {
  if (!/^[1-9]\d{0,9}$/.test(id) || Number(id)>4294967295) throw new Error('Invalid requirements AppID');
  const entry=requirements[id];
  if (!entry || typeof entry.externalFiles!=='boolean' || entry.source!=='telegram') throw new Error(`Invalid requirement ${id}`);
  return entry.externalFiles;
});
const logo=fs.readFileSync(path.join(root,'website/asests/logo.png'));
if(logo.length>512*1024 || logo.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw new Error('Invalid bundled PNG');
fs.writeFileSync(path.join(root,'steam-bridge/plugin/webview/brand-assets.js'),
  '// Generated from the supplied logo and game-requirements.json. Do not edit.\n'+
  `export const logoUrl=${JSON.stringify('data:image/png;base64,'+logo.toString('base64'))};\n`+
  `export const externalFileAppIds=Object.freeze(${JSON.stringify(ids)});\n`);
console.log(`Bundled original logo and ${ids.length} external-file requirements.`);
