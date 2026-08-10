import AppKit
import Foundation

enum VisualScanCLI {
    static func run(arguments: [String]) async -> Int32 {
        guard arguments.count >= 2 else {
            fputs("usage: visual-scan <start|permission-state|is-available>\n", stderr)
            return 2
        }

        let command = arguments[1]
        switch command {
        case "is-available":
            print("true")
            return 0
        case "permission-state":
            let data = try? JSONSerialization.data(withJSONObject: SceneGeometryCache.permissionState(), options: [.prettyPrinted])
            if let data, let text = String(data: data, encoding: .utf8) {
                print(text)
            } else {
                print("{}")
            }
            return 0
        case "start":
            return await start(arguments: Array(arguments.dropFirst(2)))
        case "stop":
            return 0
        default:
            fputs("unknown command: \(command)\n", stderr)
            return 2
        }
    }

    private static func start(arguments: [String]) async -> Int32 {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)

        var scene: ScanScene?
        var quality = ScanQuality.high
        var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

        if let jsonIndex = arguments.firstIndex(of: "--scene-json"),
           arguments.indices.contains(jsonIndex + 1) {
            let jsonText = arguments[jsonIndex + 1]
            if let data = jsonText.data(using: .utf8) {
                scene = try? JSONDecoder().decode(ScanScene.self, from: data)
            }
        } else if let pathIndex = arguments.firstIndex(of: "--scene-file"),
                  arguments.indices.contains(pathIndex + 1) {
            let path = arguments[pathIndex + 1]
            if let data = FileManager.default.contents(atPath: path) {
                scene = try? JSONDecoder().decode(ScanScene.self, from: data)
            }
        } else if !stdinIsTTY() {
            let input = readStdin()
            if let data = input.data(using: .utf8), !input.isEmpty {
                scene = try? JSONDecoder().decode(ScanScene.self, from: data)
            }
        }

        if let qIndex = arguments.firstIndex(of: "--quality"), arguments.indices.contains(qIndex + 1) {
            quality = ScanQuality(raw: arguments[qIndex + 1])
        }
        if arguments.contains("--reduce-motion") {
            reduceMotion = true
        }

        if scene == nil {
            scene = await SceneGeometryCache.buildScene(quality: quality, reduceMotion: reduceMotion)
        }

        guard let readyScene = scene else {
            fputs("failed to build scan scene\n", stderr)
            return 1
        }

        let semaphore = DispatchSemaphore(value: 0)
        var exitCode: Int32 = 0

        DispatchQueue.main.async {
            let panel = OverlayPanel(scene: readyScene)
            panel.runAnimation {
                panel.close()
                exitCode = 0
                semaphore.signal()
                app.terminate(nil)
            }
        }

        app.run()
        _ = semaphore.wait(timeout: .now() + 4.0)
        return exitCode
    }

    private static func stdinIsTTY() -> Bool {
        isatty(STDIN_FILENO) == 1
    }

    private static func readStdin() -> String {
        var data = Data()
        while let chunk = try? FileHandle.standardInput.read(upToCount: 4096), !chunk.isEmpty {
            data.append(chunk)
        }
        return String(data: data, encoding: .utf8) ?? ""
    }
}
