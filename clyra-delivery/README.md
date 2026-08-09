# Clyra OpenCluely bar + Visual Intelligence Scan delivery

This branch was produced because the cloud agent was started against `About_Redlook096` instead of `Clyra-AI-Final`.

## Apply to Clyra-AI-Final

```bash
git clone https://github.com/Redlook096/Clyra-AI-Final.git
cd Clyra-AI-Final
git checkout -b cursor/opencluely-bar-scan-b2ee
git am /path/to/clyra-delivery/opencluely-bar-scan.patch
# or copy files from clyra-delivery/ over the matching paths
npm run opencluely:clone
npm run desktop:dev
# Activate with Cmd+/ then Ask / Auto Answer / "what's on my screen"
```

## What changed

1. **OpenCluely bar** — expand only downward; Ask fades open immediately; chat-parity assistant print + user bubbles; light/dark theme; thinking border glow; button icon hover motion; composer scaled like chat (no command palette).
2. **Web search** — no longer triggers on casual/screen questions; explicit research verbs only.
3. **What's on my screen** — screen path + Visual Intelligence Scan animation (native Swift on macOS, Electron canvas fallback elsewhere).
4. **Visual Intelligence Scan** — AX/ScreenCaptureKit native package + Electron manager overlay.

Source commits (from local Clyra clone):
- `471a2c5` Add Visual Intelligence Scan system
- `471cf2b` Polish OpenCluely bar
