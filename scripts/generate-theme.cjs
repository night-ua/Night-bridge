const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = path.resolve(__dirname, '../../website/web-port/frontend/style.css');
const css = fs.readFileSync(source, 'utf8');
const root = /:root\s*\{([^}]+)\}/.exec(css)?.[1];
function value(name) {
  const color = new RegExp(`--${name}:\\s*(#[a-fA-F0-9]{6})\\s*;`).exec(root || '')?.[1];
  if (!color) throw new Error(`Website theme variable ${name} is missing`);
  return color.toUpperCase();
}
const theme = { version: 'css-' + crypto.createHash('sha256').update(css).digest('hex').slice(0, 12),
  accent: value('orange'), hover: value('orange-hover'), surface: value('surface'),
  text: value('text'), border: value('border'), success: value('success'), error: value('error') };
fs.writeFileSync(path.resolve(__dirname, '../plugin/webview/website-theme.js'),
  '// Generated from the website :root variables. Do not hand-edit.\nexport const websiteTheme = Object.freeze(' + JSON.stringify(theme, null, 2) + ');\n');
console.log(`Website theme: ${theme.accent}, ${theme.version}`);
