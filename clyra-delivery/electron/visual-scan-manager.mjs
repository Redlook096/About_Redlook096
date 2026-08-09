/**
 * Visual Intelligence Scan — Electron main-process bridge.
 * macOS: spawns native visual-scan binary when available.
 * Other platforms / missing binary: transparent canvas overlay via desktopCapturer geometry.
 */
import { BrowserWindow, desktopCapturer, screen, systemPreferences } from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCAN_DURATION_MS = 1650;
const START_BUDGET_MS = 50;

const here = path.dirname(fileURLToPath(import.meta.url));

export class VisualScanManager {
  /**
   * @param {{ projectRoot?: string }} [options]
   */
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || path.resolve(here, "..");
    this.quality = "high";
    this.active = false;
    this.overlayWindows = [];
    this.nativeChild = null;
    this.stopTimer = null;
  }

  isAvailable() {
    if (process.platform === "darwin") {
      return existsSync(this.#nativeBinaryPath());
    }
    return true;
  }

  permissionState() {
    if (process.platform === "darwin") {
      const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
      const screenCapture = systemPreferences.getMediaAccessStatus("screen") === "granted";
      let mode = "minimalWave";
      if (accessibility) mode = "fullAX";
      else if (screenCapture) mode = "windowOnly";
      return {
        ok: true,
        platform: "darwin",
        accessibility,
        screenCapture,
        mode,
        nativeBinary: existsSync(this.#nativeBinaryPath()),
      };
    }
    return {
      ok: true,
      platform: process.platform,
      accessibility: false,
      screenCapture: true,
      mode: "electronFallback",
      nativeBinary: false,
    };
  }

  setQuality(quality = "high") {
    const normalized = String(quality || "high").toLowerCase();
    this.quality = ["low", "medium", "high"].includes(normalized) ? normalized : "high";
    return { ok: true, quality: this.quality };
  }

  /**
   * Fire-and-forget scan animation. Returns within ~50ms; animation continues in background.
   * @param {{ displayId?: number, quality?: string }} [options]
   */
  async start(options = {}) {
    if (this.active) return { ok: true, alreadyRunning: true };
    this.active = true;
    const quality = options.quality || this.quality;
    const started = Date.now();

    const run = async () => {
      try {
        if (process.platform === "darwin" && existsSync(this.#nativeBinaryPath())) {
          await this.#startNative({ quality });
        } else {
          await this.#startElectronOverlay({ displayId: options.displayId, quality });
        }
      } catch (error) {
        this.active = false;
        console.warn("[visual-scan] start failed:", error instanceof Error ? error.message : error);
      }
    };

    void run();

    const elapsed = Date.now() - started;
    if (elapsed < START_BUDGET_MS) {
      await new Promise((resolve) => setTimeout(resolve, START_BUDGET_MS - elapsed));
    }

    return {
      ok: true,
      backend: process.platform === "darwin" && existsSync(this.#nativeBinaryPath()) ? "native" : "electron",
      startedMs: Date.now() - started,
    };
  }

  async stop() {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.nativeChild && !this.nativeChild.killed) {
      try {
        this.nativeChild.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      this.nativeChild = null;
    }
    for (const win of this.overlayWindows) {
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch {
        /* ignore */
      }
    }
    this.overlayWindows = [];
    this.active = false;
    return { ok: true };
  }

  #nativeBinaryPath() {
    const candidates = [
      path.join(this.projectRoot, "native", "visual-scan", ".build", "release", "visual-scan"),
      path.join(this.projectRoot, "native", "visual-scan", ".build", "debug", "visual-scan"),
      path.join(process.resourcesPath || "", "native", "visual-scan", "visual-scan"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
  }

  async #startNative({ quality }) {
    const scene = await this.#buildScene({ quality });
    const binary = this.#nativeBinaryPath();
    const child = spawn(binary, ["start", "--quality", quality], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: false,
    });
    this.nativeChild = child;
    child.stdin.write(JSON.stringify(scene));
    child.stdin.end();

    const budget = Math.max(0, START_BUDGET_MS - 5);
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, budget)),
      new Promise((resolve) => child.once("spawn", resolve)),
    ]);

    child.on("exit", () => {
      if (this.nativeChild === child) this.nativeChild = null;
      this.active = false;
    });

    this.stopTimer = setTimeout(() => {
      void this.stop();
    }, SCAN_DURATION_MS + 400);
  }

  async #startElectronOverlay({ displayId, quality }) {
    const scene = await this.#buildScene({ displayId, quality });
    const display = scene.display;
    const overlayPath = path.join(here, "visual-scan-overlay.html");
    const sceneParam = encodeURIComponent(JSON.stringify(scene));
    const url = `${pathToFileURL(overlayPath).href}?scene=${sceneParam}`;

    const win = new BrowserWindow({
      x: Math.round(display.x),
      y: Math.round(display.y),
      width: Math.round(display.width),
      height: Math.round(display.height),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.overlayWindows.push(win);

    const loadPromise = win.loadURL(url);
    await Promise.race([
      loadPromise.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 120)),
    ]);
    if (!win.isDestroyed()) win.showInactive();

    this.stopTimer = setTimeout(() => {
      void this.stop();
    }, SCAN_DURATION_MS + 250);

    win.on("closed", () => {
      this.overlayWindows = this.overlayWindows.filter((w) => w !== win);
      if (!this.overlayWindows.length && !this.nativeChild) this.active = false;
    });
  }

  async #buildScene({ displayId, quality = "high" }) {
    const cap = quality === "low" ? 40 : quality === "medium" ? 80 : 120;
    const target = this.#targetDisplay(displayId);
    const reduceMotion = this.#prefersReducedMotion();
    let contours = [];

    try {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 320, height: 200 },
        fetchWindowIcons: false,
      });

      const selfNames = /clyra|opencluely|visual scan|live transcription|ai response/i;
      const windowSources = sources.filter((s) => s.id.startsWith("window:") && !selfNames.test(s.name || ""));
      const linuxWindows = process.platform === "linux" ? await this.#linuxWindowGeometry() : [];

      for (const source of windowSources) {
        const match = linuxWindows.find((w) => this.#namesClose(w.title, source.name));
        if (match) {
          contours.push({ x: match.x, y: match.y, width: match.width, height: match.height });
          continue;
        }
        const thumb = source.thumbnail?.getSize?.() || { width: 0, height: 0 };
        if (thumb.width < 40 || thumb.height < 24) continue;
        const width = Math.min(thumb.width * 2, target.bounds.width * 0.92);
        const height = Math.min(thumb.height * 2, target.bounds.height * 0.88);
        const x = target.bounds.x + (target.bounds.width - width) / 2;
        const y = target.bounds.y + (target.bounds.height - height) / 2;
        contours.push({ x, y, width, height });
      }

      if (!contours.length) {
        contours.push({
          x: target.bounds.x + target.bounds.width * 0.06,
          y: target.bounds.y + target.bounds.height * 0.06,
          width: target.bounds.width * 0.88,
          height: target.bounds.height * 0.88,
        });
      }
    } catch {
      /* geometry probe failed — fall back to minimal frame */
    }

    if (contours.length < 8) {
      contours.push(...this.#minimalContours(target.bounds));
    }

    contours = this.#filterContours(contours, target.bounds, cap);

    return {
      display: {
        x: target.bounds.x,
        y: target.bounds.y,
        width: target.bounds.width,
        height: target.bounds.height,
      },
      contours,
      quality,
      reduceMotion,
      permissionMode: this.permissionState().mode,
    };
  }

  #targetDisplay(displayId) {
    const displays = screen.getAllDisplays();
    if (displayId != null) {
      const match = displays.find((d) => d.id === displayId);
      if (match) return match;
    }
    return screen.getPrimaryDisplay();
  }

  #prefersReducedMotion() {
    return false;
  }

  #minimalContours(bounds) {
    const inset = Math.min(bounds.width, bounds.height) * 0.08;
    const x = bounds.x + inset;
    const y = bounds.y + inset;
    const w = bounds.width - inset * 2;
    const h = bounds.height - inset * 2;
    return [
      { x, y, width: w, height: h },
      { x, y, width: w, height: 2 },
      { x, y: y + h - 2, width: w, height: 2 },
      { x, y, width: 2, height: h },
      { x: x + w - 2, y, width: 2, height: h },
    ];
  }

  #filterContours(contours, bounds, cap) {
    const minArea = Math.max(900, bounds.width * bounds.height * 0.00015);
    const seen = new Set();
    const out = [];
    for (const rect of contours
      .filter((r) => r.width >= 24 && r.height >= 12 && r.width * r.height >= minArea)
      .sort((a, b) => b.width * b.height - a.width * a.height)) {
      const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rect);
      if (out.length >= cap) break;
    }
    return out;
  }

  async #linuxWindowGeometry() {
    const display = process.env.DISPLAY || ":0";
    const env = { ...process.env, DISPLAY: display };
    try {
      const { stdout } = await execFileAsync("xdotool", ["search", "--name", "."], {
        timeout: 4000,
        env,
        encoding: "utf8",
      });
      const ids = String(stdout || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 80);
      const windows = [];
      for (const id of ids) {
        try {
          const { stdout: geom } = await execFileAsync("xdotool", ["getwindowgeometry", "--shell", id], {
            timeout: 1500,
            env,
            encoding: "utf8",
          });
          const vals = Object.fromEntries(
            String(geom || "")
              .trim()
              .split("\n")
              .map((line) => line.split("="))
              .filter((p) => p.length === 2),
          );
          const title = await execFileAsync("xdotool", ["getwindowname", id], { timeout: 1500, env, encoding: "utf8" })
            .then((r) => String(r.stdout || "").trim())
            .catch(() => "");
          if (/clyra|opencluely/i.test(title)) continue;
          windows.push({
            id,
            title,
            x: Number(vals.X) || 0,
            y: Number(vals.Y) || 0,
            width: Number(vals.WIDTH) || 0,
            height: Number(vals.HEIGHT) || 0,
          });
        } catch {
          /* skip window */
        }
      }
      return windows.filter((w) => w.width >= 200 && w.height >= 120);
    } catch {
      return [];
    }
  }

  #namesClose(a = "", b = "") {
    const left = String(a).toLowerCase().trim();
    const right = String(b).toLowerCase().trim();
    if (!left || !right) return false;
    return left.includes(right) || right.includes(left);
  }
}

let singleton = null;

/**
 * @param {{ projectRoot?: string }} [options]
 */
export function getVisualScanManager(options = {}) {
  if (!singleton) singleton = new VisualScanManager(options);
  return singleton;
}

/**
 * Fire-and-forget helper for OpenCluely bridge (CJS-friendly dynamic import target).
 */
export async function fireVisualScan(options = {}) {
  const manager = getVisualScanManager(options);
  return manager.start(options);
}
