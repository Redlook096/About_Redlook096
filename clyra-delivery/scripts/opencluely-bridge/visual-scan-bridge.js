/**
 * OpenCluely bridge helper — loads Clyra visual-scan manager from electron/.
 * Fire-and-forget; never blocks capture for more than ~50ms.
 */
const path = require("path");
const { pathToFileURL } = require("url");

let managerPromise = null;

function repoRootFromBridge() {
  // apps/opencluely/main.js → repo root
  return path.resolve(__dirname, "..", "..");
}

function loadManager() {
  if (!managerPromise) {
    const root = repoRootFromBridge();
    const modulePath = path.join(root, "electron", "visual-scan-manager.mjs");
    managerPromise = import(pathToFileURL(modulePath).href).then((mod) =>
      mod.getVisualScanManager({ projectRoot: root }),
    );
  }
  return managerPromise;
}

function fireVisualScan(options = {}) {
  void loadManager()
    .then((manager) => manager.start(options))
    .catch(() => undefined);
}

async function start(options = {}) {
  const manager = await loadManager();
  return manager.start(options);
}

module.exports = {
  fireVisualScan,
  start,
  async isAvailable() {
    const manager = await loadManager();
    return manager.isAvailable();
  },
  async permissionState() {
    const manager = await loadManager();
    return manager.permissionState();
  },
  async stop() {
    const manager = await loadManager();
    return manager.stop();
  },
  async setQuality(quality) {
    const manager = await loadManager();
    return manager.setQuality(quality);
  },
};
