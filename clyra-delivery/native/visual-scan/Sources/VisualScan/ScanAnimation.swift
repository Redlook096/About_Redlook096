import AppKit
import QuartzCore

final class ScanAnimationController {
    static let duration: TimeInterval = 1.65

    private let rootLayer = CALayer()
    private let waveLayer = CAShapeLayer()
    private let contourLayers: [CAShapeLayer]
    private let display: CGRect
    private let contours: [CGRect]
    private let reduceMotion: Bool
    private var completion: (() -> Void)?

    init(display: CGRect, contours: [CGRect], reduceMotion: Bool) {
        self.display = display
        self.contours = contours
        self.reduceMotion = reduceMotion
        self.contourLayers = contours.map { _ in CAShapeLayer() }
        configureLayers()
    }

    var layer: CALayer { rootLayer }

    private func configureLayers() {
        rootLayer.frame = display
        rootLayer.backgroundColor = NSColor.clear.cgColor

        waveLayer.fillColor = NSColor.clear.cgColor
        waveLayer.strokeColor = NSColor(calibratedWhite: 0.94, alpha: 0.55).cgColor
        waveLayer.lineWidth = 1.4
        waveLayer.lineCap = .round
        waveLayer.lineJoin = .round
        rootLayer.addSublayer(waveLayer)

        for (index, layer) in contourLayers.enumerated() {
            layer.fillColor = NSColor.clear.cgColor
            layer.strokeColor = NSColor(calibratedRed: 0.82, green: 0.9, blue: 0.98, alpha: 0.0).cgColor
            layer.lineWidth = 1.1
            layer.lineCap = .round
            layer.lineJoin = .round
            layer.path = CGPath(roundedRect: contours[index], cornerWidth: 3, cornerHeight: 3, transform: nil)
            rootLayer.addSublayer(layer)
        }
    }

    func start(completion: @escaping () -> Void) {
        self.completion = completion
        if reduceMotion {
            runReducedMotion(completion: completion)
            return
        }
        runFullAnimation(completion: completion)
    }

    private func runReducedMotion(completion: @escaping () -> Void) {
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.0
        fade.toValue = 0.35
        fade.duration = 0.35
        fade.autoreverses = true
        fade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        rootLayer.opacity = 0
        rootLayer.add(fade, forKey: "reduceMotion")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) {
            completion()
        }
    }

    private func runFullAnimation(completion: @escaping () -> Void) {
        let center = CGPoint(x: display.midX, y: display.midY)
        let maxRadius = hypot(display.width, display.height) * 0.55

        let wave = CAShapeLayer()
        wave.fillColor = NSColor.clear.cgColor
        wave.strokeColor = NSColor(calibratedWhite: 0.95, alpha: 0.42).cgColor
        wave.lineWidth = 1.6
        rootLayer.insertSublayer(wave, below: waveLayer)

        let circlePath = CGMutablePath()
        circlePath.addEllipse(in: CGRect(x: center.x - 1, y: center.y - 1, width: 2, height: 2))
        wave.path = circlePath

        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.01
        scale.toValue = maxRadius / 2.0
        scale.duration = Self.duration * 0.82
        scale.timingFunction = CAMediaTimingFunction(name: .easeOut)

        let opacity = CABasicAnimation(keyPath: "opacity")
        opacity.fromValue = 0.55
        opacity.toValue = 0.0
        opacity.beginTime = Self.duration * 0.45
        opacity.duration = Self.duration * 0.55
        opacity.fillMode = .forwards
        opacity.isRemovedOnCompletion = false

        let group = CAAnimationGroup()
        group.animations = [scale, opacity]
        group.duration = Self.duration
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        wave.add(group, forKey: "radialWave")

        let distances = contours.map { rect -> CGFloat in
            let mid = CGPoint(x: rect.midX, y: rect.midY)
            return hypot(mid.x - center.x, mid.y - center.y)
        }
        let maxDist = max(distances.max() ?? 1, 1)

        for (index, layer) in contourLayers.enumerated() {
            let delay = (distances[index] / maxDist) * Self.duration * 0.72
            let stroke = CABasicAnimation(keyPath: "strokeColor")
            stroke.fromValue = NSColor(calibratedRed: 0.82, green: 0.9, blue: 0.98, alpha: 0.0).cgColor
            stroke.toValue = NSColor(calibratedRed: 0.88, green: 0.94, blue: 1.0, alpha: 0.72).cgColor
            stroke.duration = 0.22
            stroke.beginTime = delay
            stroke.fillMode = .forwards
            stroke.isRemovedOnCompletion = false

            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 1.0
            fade.toValue = 0.0
            fade.beginTime = delay + 0.35
            fade.duration = Self.duration - (delay + 0.35)
            fade.fillMode = .forwards
            fade.isRemovedOnCompletion = false

            let contourGroup = CAAnimationGroup()
            contourGroup.animations = [stroke, fade]
            contourGroup.duration = Self.duration
            contourGroup.beginTime = CACurrentMediaTime()
            layer.add(contourGroup, forKey: "trace")
        }

        let dissolve = CABasicAnimation(keyPath: "opacity")
        dissolve.fromValue = 1.0
        dissolve.toValue = 0.0
        dissolve.beginTime = Self.duration * 0.78
        dissolve.duration = Self.duration * 0.22
        dissolve.fillMode = .forwards
        dissolve.isRemovedOnCompletion = false
        rootLayer.add(dissolve, forKey: "dissolve")

        DispatchQueue.main.asyncAfter(deadline: .now() + Self.duration + 0.05) {
            completion()
        }
    }
}
