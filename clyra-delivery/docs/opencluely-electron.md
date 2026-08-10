# OpenCluely (in-app) + Clyra + local vision

OpenCluely is part of the Clyra desktop app. It is **not** a separate Terminal workflow.

## How to launch (in-app only)

1. Start Clyra: `npm run desktop:dev` (or the packaged **Clyra.app**).
2. Activate OpenCluely with **⌘/** (Cmd+/) **or** start a **Voice Call**.
3. Clyra spawns/manages OpenCluely as a child process with `CLYRA_CONTROL_PORT` (default `3847`), starts it hidden, then plays: fade-in collapsed → expand → reveal buttons.

One-time setup (still in-app/repo, not Terminal.app launchers):

```bash
ollama pull gemma3:4b          # local vision default
npm run opencluely:clone       # clone + apply scripts/opencluely-bridge
npm run desktop:dev            # Clyra owns OpenCluely from here
```

## Stack

| Piece | What |
| --- | --- |
| App | Fresh clone of [TechyCSR/OpenCluely](https://github.com/TechyCSR/OpenCluely.git) → `apps/opencluely` |
| UI | Centered frosted bar (`index.html` + `bar-chat.js`) |
| Vision | **gemma3:4b** via Ollama (~3GB). Override with `OPENCLUELY_VISION_MODEL`. |
| Capture | Native per OS: Linux ImageMagick, macOS `screencapture`, Windows PowerShell — fallback `desktopCapturer` |
| Text / chat | Clyra `/api/companion/ask` |
| Stealth | **Rejected** — no content-protection, no Terminal disguise |
| Control | Local HTTP on `127.0.0.1:3847` (Clyra Cmd+/ and Voice Call) |

## macOS Camera / Microphone

Clyra must appear under **System Settings → Privacy & Security → Camera / Microphone**.

- Packaged builds: `productName` **Clyra**, `appId` `ai.clyra.desktop`, `extendInfo` usage strings, entitlements in `tools/entitlements.mac.plist`.
- `desktop:dev`: `tools/patch-electron-macos-privacy.mjs` rewrites Electron.app identity to **Clyra** / `ai.clyra.desktop.dev` (OpenCluely → `ai.clyra.opencluely.dev`).
- Electron main calls `systemPreferences.askForMediaAccess("microphone"|"camera")` on boot so the native prompt appears (macOS cannot silently grant TCC).
- Optional ad-hoc codesign: `CLYRA_ELECTRON_CODESIGN=1` (uses `tools/electron-dev.entitlements` — includes JIT so Electron keeps working).

**What you click once:** Allow **Microphone** and **Camera** when Clyra (or OpenCluely) shows the system prompt. After that, both apps stay listed in Privacy settings.

If a stale “Electron” denial blocks prompts after identity patching:

```bash
tccutil reset Camera ai.clyra.desktop.dev
tccutil reset Microphone ai.clyra.desktop.dev
```

Normal use does **not** require Terminal — only this reset if TCC is stuck.

## Manual / test helpers

```bash
# Control API (OpenCluely already managed by Clyra, or):
bash scripts/start-opencluely-electron.sh

curl -X POST http://127.0.0.1:3847/show -H 'content-type: application/json' \
  -d '{"windows":["main"],"animate":true}'
curl -X POST http://127.0.0.1:3847/chat -H 'content-type: application/json' \
  -d '{"text":"What is on my screen right now?"}'
```

Bridge sources of truth live under `scripts/opencluely-bridge/` and are copied by `scripts/clone-opencluely.sh`.
