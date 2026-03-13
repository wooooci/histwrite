# Codex Chrome Extension (Browser Relay)

Purpose: attach Codex to an existing Chrome tab so a local CDP relay server can automate it (via the extension).

## Dev / load unpacked

1. Start the Codex relay server (default port: `18992`).
2. Ensure the relay server is reachable at `http://127.0.0.1:18992/` (default).
3. Chrome → `chrome://extensions` → enable “Developer mode”.
4. “Load unpacked” → select this folder:
   - `.../extensions/codex-browser-relay/extension`
5. Pin the extension.
   - For hands-free use, open Options and enable “Auto-connect to relay”.
   - To control a specific existing tab, click the icon on that tab to attach/detach.

## Options

- `Relay port`: defaults to `18992`.
- `Auto-connect to relay`: keeps the local relay connection ready in the background.
