import Foundation

let args = CommandLine.arguments
let code = DispatchQueue.main.sync {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Int32 = 0
    Task {
        result = await VisualScanCLI.run(arguments: args)
        semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 6.0)
    return result
}
exit(code)
