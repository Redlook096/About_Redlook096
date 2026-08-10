import AppKit

final class OverlayPanel: NSPanel {
    private let animationController: ScanAnimationController

    init(scene: ScanScene) {
        let display = scene.display.cgRect
        let contours = scene.contours.map(\.cgRect)
        let reduceMotion = scene.reduceMotion ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        animationController = ScanAnimationController(
            display: CGRect(origin: .zero, size: display.size),
            contours: contours.map { CGRect(x: $0.origin.x - display.origin.x,
                                           y: $0.origin.y - display.origin.y,
                                           width: $0.width,
                                           height: $0.height) },
            reduceMotion: reduceMotion
        )

        super.init(
            contentRect: display,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .screenSaver
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        ignoresMouseEvents = true
        isReleasedWhenClosed = true
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        // Exclude from screencapture / Zoom — user still sees the animation.
        // This prevents "what's on my screen" from photographing the scan overlay.
        sharingType = .none

        let content = NSView(frame: CGRect(origin: .zero, size: display.size))
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor.clear.cgColor
        content.layer?.addSublayer(animationController.layer)
        contentView = content
    }

    func runAnimation(completion: @escaping () -> Void) {
        orderFrontRegardless()
        animationController.start {
            completion()
        }
    }
}
