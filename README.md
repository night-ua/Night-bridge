# Nght-Bridge 2.0.2

Windows Steam store integration for Millennium 3.5.0 / Starlight 2-format plugins.
The npm compiler package is pinned to `@steambrew/starlight@1.1.6`; its shipped binary reports compiler 1.1.5 and STAR format 2.0.

Run `npm ci --ignore-scripts`, `npm test`, then `npm run build`.
The actual package is `../artifacts/space.darkdevil.steam-bridge.star`.
No Steam installation is changed by building it.

Keep this directory beside `../website/` and `../injector/`. The build reads the website logo, theme and game requirements; the injector build bundles the resulting plugin. Generated JavaScript assets, `.millennium/`, dependencies and release output are ignored by Git and recreated by the build/test commands. The existing MIT license is at `../LICENSE`.

Upgrade using the **2.0.2 Setup** with **Enable DarkDevil Steam Integration**, choose the Steam folder, then restart Steam and enable Nght-Bridge in Millennium settings. Millennium must already be installed. Setup offers the official guide and does not download or run dependencies. For manual installation, upgrade the worker app to 2.0.2 as well as copying the `.star` file to `<Steam>/millennium/plugins/`, then enable it in Millennium. Manual installations must be removed manually unless Setup created the ownership receipt.

The webview preload creates one button beside the Community Hub anchor or in the game's header/purchase area. It observes DOM replacement, handles navigation, suppresses overlapping clicks, and cleans up on pagehide/reinitialization. Disabling the plugin requires a Steam reload/restart to destroy its existing isolated webview contexts. Do not use the legacy Python plugin format or `callServerMethod`.

The store button now opens a compact, anchored popup in a closed shadow root. The preload uses Starlight-generated RPC methods to pass typed JSON to the Lua backend. LuaJIT FFI connects to a per-user Windows named pipe, validates the server SID, and makes bounded overlapped message transactions. If necessary it starts the registered Night Injection V2 executable with `--steam-worker` and `SW_HIDE`. It does not use the deep link for ordinary Steam imports. The full app is opened only through the explicit Open Night Injection control.

The worker performs download, validation, preview and application using existing services. Automatic Apply is OFF by default and enabling it requires explicit informed confirmation. Manual mode previews all destinations in pages and asks for confirmation. The worker persists settings and task outcomes; popup closing does not cancel its work. Status polling is active only while an open popup has active work, and stops at terminal/ready states.

In 2.0.2 the Enable consent names the current import and future clicks. The settings request includes its AppID/task ID, so the current verified ReadyToApply task can apply immediately, without restarting Steam. Other manual tasks stay manual. Stale status/cache replies cannot undo the saved switch. The supplied logo is embedded at build time. Games in game-requirements.json show a persistent, user-initiated Nightfile Bot link with the exact AppID and a notice that bridge application does not install those extra files. See ../docs/NGHT-BRIDGE-2.0.2.ar.md for UI, security and runtime verification.

The trigger defaults to **Steam Native (Default)**, copying the adjacent Community Hub link's native classes and label styling, so Steam controls normal/hover/theme appearance. Legacy `automatic` settings migrate to `native`; explicit custom colors and Automatic Apply consent are preserved. Custom HEX colors are validated, alpha is flattened against the known surface, and readable black/white text is selected by luminance. The popup defaults to a subtle Steam blue accent. Worker settings are mirrored to Millennium's supported plugin configuration API for offline button appearance.

`transport.js` accepts a JSON string or an already-decoded object and validates the reply; it never parses nested task/settings objects again. Millennium's Lua interop parses JSON-looking return strings, and its raw FFI proxy returns that object directly. The previous unconditional `JSON.parse` in `preload.ts` caused the `[object Object]` failure. See `../docs/V2.0.1-FIX-REPORT.ar.md` for every serialization boundary, tests and delivery files.

Runtime verification found that Millennium 3.5.0 registers its JSON library as `require("json")`, despite the cjson reference page name. The release uses that verified module name. There is no command interpreter, local HTTP listener, network download, secret or game-file access in the plugin. See `../docs/V2-ARCHITECTURE.md` and `../docs/V2-REPORT.ar.md` for exact verification scope. Temporary smoke-test sources/configuration are excluded from the production TOML entries.

Validation: DOM/transport tests and official compiler build pass. Bodycam 2406770 and 730 were tested with the actual API, headless executable and Windows IPC in Chromium using official Steam button markup/CSS. Manual apply writes only to isolated test folders. Native Lua/IPC was verified in the V2 runtime investigation; the final 2.0.1 popup still needs visual acceptance inside the Steam client. See `../docs/TESTING.md` for acceptance checks.

Primary references:
- https://docs.steambrew.app/plugins/structure/file-structure
- https://docs.steambrew.app/plugins/structure/config
- https://github.com/SteamClientHomebrew/PluginTemplate/tree/af0a07c7c90de902333ab5268e53ac1bf73bed36
- https://github.com/SteamClientHomebrew/Millennium/blob/fb75bf7629562474a7a4cc06a03bb827de28a601/starlight/src/pack.rs
- https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutea
- https://luajit.org/ext_ffi_api.html
