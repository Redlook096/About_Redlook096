import Foundation
import CoreGraphics

struct SceneRect: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var cgRect: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }

    init(_ rect: CGRect) {
        x = rect.origin.x
        y = rect.origin.y
        width = rect.size.width
        height = rect.size.height
    }

    init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

struct SceneDisplay: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var cgRect: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }

    init(_ rect: CGRect) {
        x = rect.origin.x
        y = rect.origin.y
        width = rect.size.width
        height = rect.size.height
    }
}

struct ScanScene: Codable {
    var display: SceneDisplay
    var contours: [SceneRect]
    var quality: String?
    var reduceMotion: Bool?
    var permissionMode: String?
}

enum ScanQuality: String {
    case low, medium, high

    init(raw: String?) {
        switch raw?.lowercased() {
        case "low": self = .low
        case "medium": self = .medium
        default: self = .high
        }
    }

    var contourCap: Int {
        switch self {
        case .low: return 40
        case .medium: return 80
        case .high: return 120
        }
    }
}

enum PermissionMode: String, Codable {
    case fullAX
    case windowOnly
    case minimalWave
}
