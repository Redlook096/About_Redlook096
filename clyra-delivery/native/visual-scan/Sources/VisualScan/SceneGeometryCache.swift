import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit

enum SceneGeometryCache {
    static func buildScene(quality: ScanQuality, reduceMotion: Bool) async -> ScanScene {
        let display = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let mode = permissionMode()
        var contours: [SceneRect] = []

        switch mode {
        case .fullAX:
            contours = await contoursFromAX(display: display, cap: quality.contourCap)
            if contours.isEmpty {
                contours = await contoursFromScreenCapture(display: display, cap: quality.contourCap)
            }
        case .windowOnly:
            contours = await contoursFromScreenCapture(display: display, cap: quality.contourCap)
        case .minimalWave:
            contours = minimalContours(display: display)
        }

        contours = filterAndCap(contours, display: display, cap: quality.contourCap)

        return ScanScene(
            display: SceneDisplay(display),
            contours: contours,
            quality: quality.rawValue,
            reduceMotion: reduceMotion,
            permissionMode: mode.rawValue
        )
    }

    static func permissionMode() -> PermissionMode {
        let axTrusted = AXIsProcessTrusted()
        if axTrusted { return .fullAX }
        if CGPreflightScreenCaptureAccess() { return .windowOnly }
        return .minimalWave
    }

    static func permissionState() -> [String: Any] {
        [
            "accessibility": AXIsProcessTrusted(),
            "screenCapture": CGPreflightScreenCaptureAccess(),
            "mode": permissionMode().rawValue,
        ]
    }

    private static func filterAndCap(_ rects: [SceneRect], display: CGRect, cap: Int) -> [SceneRect] {
        let minArea = max(900.0, (display.width * display.height) * 0.00015)
        var filtered = rects
            .filter { $0.width >= 24 && $0.height >= 12 }
            .filter { $0.width * $0.height >= minArea }
            .filter { display.intersects($0.cgRect) }
            .sorted { ($0.width * $0.height) > ($1.width * $1.height) }

        if filtered.count < 40 {
            filtered.append(contentsOf: minimalContours(display: display))
        }

        var seen = Set<String>()
        var unique: [SceneRect] = []
        for rect in filtered {
            let key = "\(Int(rect.x)):\(Int(rect.y)):\(Int(rect.width)):\(Int(rect.height))"
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            unique.append(rect)
            if unique.count >= cap { break }
        }
        return unique
    }

    private static func minimalContours(display: CGRect) -> [SceneRect] {
        let inset = min(display.width, display.height) * 0.08
        let inner = display.insetBy(dx: inset, dy: inset)
        return [
            SceneRect(inner),
            SceneRect(x: inner.minX, y: inner.minY, width: inner.width, height: 2),
            SceneRect(x: inner.minX, y: inner.maxY - 2, width: inner.width, height: 2),
            SceneRect(x: inner.minX, y: inner.minY, width: 2, height: inner.height),
            SceneRect(x: inner.maxX - 2, y: inner.minY, width: 2, height: inner.height),
        ]
    }

    private static func contoursFromAX(display: CGRect, cap: Int) async -> [SceneRect] {
        guard AXIsProcessTrusted() else { return [] }
        let system = AXUIElementCreateSystemWide()
        var windows: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(system, kAXWindowsAttribute as CFString, &windows)
        guard err == .success, let list = windows as? [AXUIElement] else { return [] }

        var rects: [SceneRect] = []
        for window in list.prefix(cap * 2) {
            guard let frame = axFrame(window), display.intersects(frame) else { continue }
            rects.append(SceneRect(frame))
            if rects.count >= cap { break }
            let children = axChildren(window)
            for child in children.prefix(12) {
                guard let childFrame = axFrame(child), display.intersects(childFrame) else { continue }
                rects.append(SceneRect(childFrame))
                if rects.count >= cap { return rects }
            }
        }
        return rects
    }

    private static func contoursFromScreenCapture(display: CGRect, cap: Int) async -> [SceneRect] {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            var rects: [SceneRect] = []
            for window in content.windows {
                let frame = window.frame
                guard frame.width > 40, frame.height > 24, display.intersects(frame) else { continue }
                if window.owningApplication?.bundleIdentifier?.contains("clyra") == true { continue }
                if window.owningApplication?.bundleIdentifier?.contains("opencluely") == true { continue }
                rects.append(SceneRect(frame))
                if rects.count >= cap { break }
            }
            return rects
        } catch {
            return []
        }
    }

    private static func axFrame(_ element: AXUIElement) -> CGRect? {
        var position: CFTypeRef?
        var size: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success,
              let posVal = position, let sizeVal = size else { return nil }
        var point = CGPoint.zero
        var cgSize = CGSize.zero
        guard AXValueGetValue(posVal as! AXValue, .cgPoint, &point),
              AXValueGetValue(sizeVal as! AXValue, .cgSize, &cgSize) else { return nil }
        return CGRect(origin: point, size: cgSize)
    }

    private static func axChildren(_ element: AXUIElement) -> [AXUIElement] {
        var children: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
              let list = children as? [AXUIElement] else { return [] }
        return list
    }
}
