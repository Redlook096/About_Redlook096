# Clyra delivery — OpenCluely bar + Visual Intelligence Scan

Mirrored fixes for [Clyra-AI-Final](https://github.com/Redlook096/Clyra-AI-Final) (write access unavailable to the cloud agent).

## Critical screenshot / scan fixes in this package

1. **Capture before scan** — the AI screenshots the real desktop first; the Visual Intelligence Scan starts only after pixels are safe.
2. **Never hide apps** — macOS no longer calls `win.hide()` during capture (that caused Spaces flicker / “all apps disappeared”). Overlays use `setContentProtection(true)` instead.
3. **Transparent front-layer overlay** — fullscreen scan uses `#00000000` background, macOS `panel` type, `showInactive`, `screen-saver` always-on-top, and content protection so screencapture omits it.
4. **Smoother / lighter animation** — single rAF clock, precomputed Path2D, no `shadowBlur`, quintic ease-out, nested UI contours; multi-display support.
5. **Linux transparency** — removed `disable-gpu-compositing` (it forced an opaque black overlay) and enabled `enable-transparent-visuals`.

## Apply to Clyra-AI-Final

```bash
cd /path/to/Clyra-AI-Final
git apply --3way path/to/clyra-delivery/opencluely-bar-scan.patch
# or copy files from clyra-delivery/ over the matching paths
npm run opencluely:clone   # refreshes apps/opencluely from scripts/opencluely-bridge
```

Key paths:
- `electron/visual-scan-manager.mjs`
- `electron/visual-scan-overlay.html`
- `scripts/opencluely-bridge/main.js`
- `scripts/opencluely-bridge/capture.service.js`
- `scripts/opencluely-bridge/ui/bar-chat.js`
- `scripts/opencluely-bridge/visual-scan-bridge.js`
