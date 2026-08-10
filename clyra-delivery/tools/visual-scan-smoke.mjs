/**
 * Smoke test for Visual Intelligence Scan Electron fallback (Linux-friendly).
 */
import { app, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getVisualScanManager } from "../electron/visual-scan-manager.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

async function main() {
  await app.whenReady();
  const manager = getVisualScanManager({ projectRoot });
  const available = manager.isAvailable();
  const permissions = manager.permissionState();
  const display = screen.getPrimaryDisplay();
  console.log("[visual-scan-smoke] available:", available);
  console.log("[visual-scan-smoke] permissions:", JSON.stringify(permissions));
  console.log("[visual-scan-smoke] display:", display.bounds);

  const started = await manager.start({ displayId: display.id, quality: "high" });
  console.log("[visual-scan-smoke] start:", JSON.stringify(started));

  await new Promise((resolve) => setTimeout(resolve, 1900));
  const stopped = await manager.stop();
  console.log("[visual-scan-smoke] stop:", JSON.stringify(stopped));
  app.exit(started.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[visual-scan-smoke] failed:", error);
  app.exit(1);
});
