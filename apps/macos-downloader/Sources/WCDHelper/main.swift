import AppKit
import CoreGraphics
import Darwin
import Foundation

private let appName = "WeChat Channels Downloader"
private let proxyHost = "127.0.0.1"
private let proxyPort = 18088
private let mitmVersion = "11.0.2"

@main
struct WCDHelper {
    static func main() {
        do {
            let cli = CLI(Array(CommandLine.arguments.dropFirst()))
            let result = try dispatch(cli)
            printJSON(result)
            exit((result["ok"] as? Bool) == true ? 0 : 2)
        } catch {
            printJSON(["ok": false, "message": error.localizedDescription])
            exit(2)
        }
    }

    private static func dispatch(_ cli: CLI) throws -> [String: Any] {
        try ensureBaseDirectories()
        guard let command = cli.command else {
            return ["ok": false, "message": usage()]
        }
        switch command {
        case "doctor":
            return try doctor()
        case "bootstrap":
            let path = try ensureMitmproxy()
            return ["ok": true, "message": "mitmproxy ready", "data": ["mitmdump": path]]
        case "cert":
            return try cert(cli)
        case "proxy":
            return try proxy(cli)
        case "captures":
            return try captures(cli)
        case "download":
            guard let captureID = cli.value(after: "--capture-id") else {
                throw AppError("missing --capture-id")
            }
            return try download(captureID: captureID)
        case "record-current":
            let seconds = cli.intValue(after: "--duration-seconds") ?? 30
            return try recordCurrent(durationSeconds: seconds)
        default:
            return ["ok": false, "message": "unknown command: \(command)", "data": ["usage": usage()]]
        }
    }
}

private func usage() -> String {
    """
    usage:
      wcd-helper doctor --json
      wcd-helper bootstrap --json
      wcd-helper cert install --json
      wcd-helper proxy start|stop|status --json
      wcd-helper captures tail|clear --json
      wcd-helper download --capture-id ID --json
      wcd-helper record-current --duration-seconds N --json
    """
}

private struct CLI {
    let args: [String]
    var command: String? { args.first }

    init(_ args: [String]) {
        self.args = args
    }

    func has(_ value: String) -> Bool {
        args.contains(value)
    }

    func value(after flag: String) -> String? {
        guard let index = args.firstIndex(of: flag), index + 1 < args.count else {
            return nil
        }
        return args[index + 1]
    }

    func intValue(after flag: String) -> Int? {
        value(after: flag).flatMap(Int.init)
    }
}

private struct AppError: LocalizedError {
    let message: String
    var errorDescription: String? { message }

    init(_ message: String) {
        self.message = message
    }
}

private struct ProcessResult {
    let status: Int32
    let stdout: String
    let stderr: String
    var ok: Bool { status == 0 }
}

private func printJSON(_ object: Any) {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

@discardableResult
private func runProcess(_ executable: String, _ arguments: [String], environment: [String: String]? = nil) -> ProcessResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let environment {
        var env = ProcessInfo.processInfo.environment
        for (key, value) in environment {
            env[key] = value
        }
        process.environment = env
    }
    let out = Pipe()
    let err = Pipe()
    process.standardOutput = out
    process.standardError = err
    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return ProcessResult(status: 127, stdout: "", stderr: error.localizedDescription)
    }
    let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    return ProcessResult(status: process.terminationStatus, stdout: stdout, stderr: stderr)
}

private func appSupportDir() -> URL {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support", isDirectory: true)
        .appendingPathComponent(appName, isDirectory: true)
}

private func downloadsDir() -> URL {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Movies", isDirectory: true)
        .appendingPathComponent("WeChat Channels Downloads", isDirectory: true)
}

private func logsDir() -> URL {
    appSupportDir().appendingPathComponent("logs", isDirectory: true)
}

private func mitmDir() -> URL {
    appSupportDir().appendingPathComponent("mitmproxy", isDirectory: true)
}

private func venvDir() -> URL {
    appSupportDir().appendingPathComponent("venv", isDirectory: true)
}

private func capturesLog() -> URL {
    appSupportDir().appendingPathComponent("captures.jsonl")
}

private func capturesJSON() -> URL {
    appSupportDir().appendingPathComponent("captures.json")
}

private func downloadsJSON() -> URL {
    appSupportDir().appendingPathComponent("downloads.json")
}

private func proxyStateJSON() -> URL {
    appSupportDir().appendingPathComponent("proxy-state.json")
}

private func proxyPIDFile() -> URL {
    appSupportDir().appendingPathComponent("proxy.pid")
}

private func ensureBaseDirectories() throws {
    for directory in [appSupportDir(), logsDir(), mitmDir(), downloadsDir()] {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        chmod(directory.path, 0o700)
    }
}

private func writeRestrictedJSON(_ object: Any, to url: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url, options: .atomic)
    chmod(url.path, 0o600)
}

private func readJSONObject(_ url: URL) -> Any? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
}

private func findExecutable(_ names: [String]) -> String? {
    for name in names where name.hasPrefix("/") && FileManager.default.isExecutableFile(atPath: name) {
        return name
    }
    let paths = (ProcessInfo.processInfo.environment["PATH"] ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        .split(separator: ":")
        .map(String.init)
    for name in names where !name.hasPrefix("/") {
        for path in paths {
            let candidate = URL(fileURLWithPath: path).appendingPathComponent(name).path
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
    }
    return nil
}

private func python311Path() -> String? {
    findExecutable([
        "/Users/evander/.local/bin/python3.11",
        "/opt/homebrew/bin/python3.11",
        "python3.11",
    ])
}

private func ffmpegPath() -> String? {
    findExecutable(["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"])
}

private func ffprobePath() -> String? {
    findExecutable(["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"])
}

private func resourceDir() -> URL {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let macOSDir = executable.deletingLastPathComponent()
    let appResources = macOSDir.deletingLastPathComponent().appendingPathComponent("Resources", isDirectory: true)
    if FileManager.default.fileExists(atPath: appResources.path) {
        return appResources
    }
    return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent("Resources", isDirectory: true)
}

private func proxyAddonPath() throws -> String {
    let candidates = [
        resourceDir().appendingPathComponent("proxy/proxy_addon.py").path,
        URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("Resources/proxy/proxy_addon.py").path,
    ]
    for candidate in candidates where FileManager.default.fileExists(atPath: candidate) {
        return candidate
    }
    throw AppError("missing proxy_addon.py")
}

private func bundledRecorderPath() -> String? {
    let candidates = [
        resourceDir().appendingPathComponent("tools/wechat-live-exporter").path,
        "/Users/evander/Documents/Software/必备工具/wechat-live-exporter/.build/release/wechat-live-exporter",
    ]
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
}

private func mitmdumpPath() -> String {
    venvDir().appendingPathComponent("bin/mitmdump").path
}

private func ensureMitmproxy() throws -> String {
    let mitmdump = mitmdumpPath()
    if FileManager.default.isExecutableFile(atPath: mitmdump) {
        return mitmdump
    }
    guard let python = python311Path() else {
        throw AppError("Python 3.11 not found")
    }
    let venv = runProcess(python, ["-m", "venv", venvDir().path])
    guard venv.ok else {
        throw AppError("failed to create venv: \(venv.stderr)")
    }
    let pip = venvDir().appendingPathComponent("bin/pip").path
    let install = runProcess(pip, ["install", "--upgrade", "pip", "mitmproxy==\(mitmVersion)"])
    guard install.ok else {
        throw AppError("failed to install mitmproxy: \(install.stderr)")
    }
    return mitmdump
}

private func doctor() throws -> [String: Any] {
    let python = python311Path()
    let ffmpeg = ffmpegPath()
    let ffprobe = ffprobePath()
    let recorder = bundledRecorderPath()
    let mitmdump = FileManager.default.isExecutableFile(atPath: mitmdumpPath()) ? mitmdumpPath() : ""
    let certPath = mitmDir().appendingPathComponent("mitmproxy-ca-cert.pem").path
    let proxyStatus = try proxyStatusData()
    let screenRecording = CGPreflightScreenCaptureAccess()
    let windows = wechatWindowSnapshot()
    var blockers: [String] = []
    if python == nil { blockers.append("python3.11_missing") }
    if ffmpeg == nil { blockers.append("ffmpeg_missing") }
    if ffprobe == nil { blockers.append("ffprobe_missing") }
    if mitmdump.isEmpty { blockers.append("mitmproxy_venv_missing") }
    if !FileManager.default.fileExists(atPath: certPath) { blockers.append("mitmproxy_cert_missing_until_first_start") }
    if !screenRecording { blockers.append("screen_recording_missing_for_recording_fallback") }
    if recorder == nil { blockers.append("recording_fallback_missing") }
    return [
        "ok": blockers.filter { !$0.contains("cert_missing") && !$0.contains("screen_recording") && !$0.contains("recording_fallback") }.isEmpty,
        "message": blockers.isEmpty ? "ready" : "blocked: \(blockers.joined(separator: ","))",
        "data": [
            "version": "0.1.3-beta.1",
            "python3_11": python ?? "",
            "ffmpeg": ffmpeg ?? "",
            "ffprobe": ffprobe ?? "",
            "mitmdump": mitmdump,
            "mitmproxy_version": mitmVersion,
            "cert_path": certPath,
            "state_dir": appSupportDir().path,
            "download_dir": downloadsDir().path,
            "proxy": proxyStatus,
            "screen_recording": screenRecording ? "granted" : "missing",
            "wechat_windows": windows,
            "recording_fallback": recorder ?? "",
            "blockers": blockers,
        ],
    ]
}

private func cert(_ cli: CLI) throws -> [String: Any] {
    guard cli.args.dropFirst().first == "install" else {
        return ["ok": false, "message": "usage: wcd-helper cert install --json"]
    }
    let mitmdump = try ensureMitmproxy()
    try generateMitmCertificate(mitmdump: mitmdump)
    let cert = mitmDir().appendingPathComponent("mitmproxy-ca-cert.pem")
    guard FileManager.default.fileExists(atPath: cert.path) else {
        throw AppError("mitmproxy certificate was not generated")
    }
    let security = findExecutable(["/usr/bin/security", "security"]) ?? "/usr/bin/security"
    let keychain = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Keychains/login.keychain-db").path
    let add = runProcess(security, ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychain, cert.path])
    guard add.ok else {
        throw AppError("certificate install failed: \(add.stderr)")
    }
    return ["ok": true, "message": "certificate trusted", "data": ["cert_path": cert.path]]
}

private func generateMitmCertificate(mitmdump: String) throws {
    if FileManager.default.fileExists(atPath: mitmDir().appendingPathComponent("mitmproxy-ca-cert.pem").path) {
        return
    }
    let log = logsDir().appendingPathComponent("cert-generation.log")
    FileManager.default.createFile(atPath: log.path, contents: nil)
    let handle = try FileHandle(forWritingTo: log)
    defer { try? handle.close() }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: mitmdump)
    process.arguments = ["--set", "confdir=\(mitmDir().path)", "--listen-host", proxyHost, "--listen-port", "18089", "-q"]
    process.standardOutput = handle
    process.standardError = handle
    try process.run()
    Thread.sleep(forTimeInterval: 2.0)
    process.terminate()
    process.waitUntilExit()
}

private func proxy(_ cli: CLI) throws -> [String: Any] {
    guard cli.args.count >= 2 else {
        return ["ok": false, "message": "usage: wcd-helper proxy start|stop|status --json"]
    }
    switch cli.args[1] {
    case "start":
        return try startProxy()
    case "stop":
        return try stopProxy()
    case "status":
        return ["ok": true, "message": "proxy status", "data": try proxyStatusData()]
    default:
        return ["ok": false, "message": "usage: wcd-helper proxy start|stop|status --json"]
    }
}

private func startProxy() throws -> [String: Any] {
    let mitmdump = try ensureMitmproxy()
    try generateMitmCertificate(mitmdump: mitmdump)
    let services = activeNetworkServices()
    guard !services.isEmpty else {
        throw AppError("no active network service found")
    }
    if !FileManager.default.fileExists(atPath: proxyStateJSON().path) {
        let state = services.map { service in
            [
                "service": service,
                "web": getProxyState(kind: "web", service: service),
                "secure": getProxyState(kind: "secure", service: service),
            ]
        }
        try writeRestrictedJSON(["services": state, "saved_at": Int(Date().timeIntervalSince1970)], to: proxyStateJSON())
    }
    for service in services {
        _ = runProcess("/usr/sbin/networksetup", ["-setwebproxy", service, proxyHost, "\(proxyPort)"])
        _ = runProcess("/usr/sbin/networksetup", ["-setsecurewebproxy", service, proxyHost, "\(proxyPort)"])
        _ = runProcess("/usr/sbin/networksetup", ["-setwebproxystate", service, "on"])
        _ = runProcess("/usr/sbin/networksetup", ["-setsecurewebproxystate", service, "on"])
    }
    if !isProxyProcessRunning() {
        try launchMitmproxy(mitmdump: mitmdump)
    }
    return ["ok": true, "message": "listening", "data": try proxyStatusData()]
}

private func stopProxy() throws -> [String: Any] {
    if let pid = readProxyPID(), processIsRunning(pid: pid) {
        kill(pid, SIGTERM)
        Thread.sleep(forTimeInterval: 0.5)
        if processIsRunning(pid: pid) {
            kill(pid, SIGKILL)
        }
    }
    try? FileManager.default.removeItem(at: proxyPIDFile())
    try restoreProxyState()
    return ["ok": true, "message": "stopped", "data": try proxyStatusData()]
}

private func launchMitmproxy(mitmdump: String) throws {
    let addon = try proxyAddonPath()
    let log = logsDir().appendingPathComponent("proxy.log")
    FileManager.default.createFile(atPath: log.path, contents: nil)
    let handle = try FileHandle(forWritingTo: log)
    try handle.seekToEnd()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: mitmdump)
    process.arguments = [
        "--set", "confdir=\(mitmDir().path)",
        "--set", "ssl_insecure=true",
        "--listen-host", proxyHost,
        "--listen-port", "\(proxyPort)",
        "-s", addon,
        "-q",
    ]
    process.environment = ProcessInfo.processInfo.environment.merging([
        "WCD_STATE_DIR": appSupportDir().path,
        "PYTHONPATH": URL(fileURLWithPath: addon).deletingLastPathComponent().path,
    ]) { _, new in new }
    process.standardOutput = handle
    process.standardError = handle
    try process.run()
    try "\(process.processIdentifier)".write(to: proxyPIDFile(), atomically: true, encoding: .utf8)
    chmod(proxyPIDFile().path, 0o600)
}

private func readProxyPID() -> pid_t? {
    guard let text = try? String(contentsOf: proxyPIDFile(), encoding: .utf8),
          let value = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
        return nil
    }
    return value
}

private func processIsRunning(pid: pid_t) -> Bool {
    kill(pid, 0) == 0
}

private func isProxyProcessRunning() -> Bool {
    guard let pid = readProxyPID() else { return false }
    return processIsRunning(pid: pid)
}

private func proxyStatusData() throws -> [String: Any] {
    [
        "host": proxyHost,
        "port": proxyPort,
        "pid": readProxyPID().map(Int.init) ?? 0,
        "running": isProxyProcessRunning(),
        "state_file": proxyStateJSON().path,
        "state_saved": FileManager.default.fileExists(atPath: proxyStateJSON().path),
        "services": activeNetworkServices(),
    ]
}

private func activeNetworkServices() -> [String] {
    let route = runProcess("/sbin/route", ["-n", "get", "default"])
    let iface = route.stdout
        .split(separator: "\n")
        .first { $0.contains("interface:") }?
        .split(separator: ":")
        .last?
        .trimmingCharacters(in: .whitespaces)
    let order = runProcess("/usr/sbin/networksetup", ["-listnetworkserviceorder"]).stdout
    if let iface, !iface.isEmpty {
        var currentService: String?
        for rawLine in order.split(separator: "\n").map(String.init) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.range(of: #"^\(\d+\)"#, options: .regularExpression) != nil,
               let end = line.firstIndex(of: ")") {
                currentService = String(line[line.index(after: end)...]).trimmingCharacters(in: .whitespaces)
            }
            if line.contains("Device: \(iface)") || line.contains("Device: \(iface),") {
                if let currentService, !currentService.isEmpty {
                    return [currentService]
                }
            }
        }
    }
    let all = runProcess("/usr/sbin/networksetup", ["-listallnetworkservices"]).stdout
        .split(separator: "\n")
        .map { String($0).trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty && !$0.hasPrefix("An asterisk") && !$0.hasPrefix("*") }
    let preferred = ["Wi-Fi", "USB 10/100/1000 LAN", "Ethernet", "Thunderbolt Bridge"]
    let preferredMatches = preferred.filter { all.contains($0) }
    if let first = preferredMatches.first {
        return [first]
    }
    return Array(all.prefix(1))
}

private func getProxyState(kind: String, service: String) -> [String: Any] {
    let flag = kind == "secure" ? "-getsecurewebproxy" : "-getwebproxy"
    let result = runProcess("/usr/sbin/networksetup", [flag, service])
    var output: [String: Any] = ["enabled": false, "server": "", "port": 0]
    for line in result.stdout.split(separator: "\n").map(String.init) {
        let parts = line.split(separator: ":", maxSplits: 1).map { String($0).trimmingCharacters(in: .whitespaces) }
        guard parts.count == 2 else { continue }
        switch parts[0].lowercased() {
        case "enabled":
            output["enabled"] = parts[1].lowercased().hasPrefix("yes")
        case "server":
            output["server"] = parts[1]
        case "port":
            output["port"] = Int(parts[1]) ?? 0
        default:
            continue
        }
    }
    return output
}

private func restoreProxyState() throws {
    guard let root = readJSONObject(proxyStateJSON()) as? [String: Any],
          let services = root["services"] as? [[String: Any]] else {
        return
    }
    for entry in services {
        guard let service = entry["service"] as? String else { continue }
        restoreProxy(kind: "web", service: service, state: entry["web"] as? [String: Any])
        restoreProxy(kind: "secure", service: service, state: entry["secure"] as? [String: Any])
    }
    try? FileManager.default.removeItem(at: proxyStateJSON())
}

private func restoreProxy(kind: String, service: String, state: [String: Any]?) {
    let enabled = (state?["enabled"] as? Bool) == true
    let server = state?["server"] as? String ?? ""
    let port = state?["port"] as? Int ?? 0
    let setFlag = kind == "secure" ? "-setsecurewebproxy" : "-setwebproxy"
    let stateFlag = kind == "secure" ? "-setsecurewebproxystate" : "-setwebproxystate"
    if enabled, !server.isEmpty, port > 0 {
        _ = runProcess("/usr/sbin/networksetup", [setFlag, service, server, "\(port)"])
        _ = runProcess("/usr/sbin/networksetup", [stateFlag, service, "on"])
    } else {
        _ = runProcess("/usr/sbin/networksetup", [stateFlag, service, "off"])
    }
}

private func captures(_ cli: CLI) throws -> [String: Any] {
    guard cli.args.count >= 2 else {
        return ["ok": false, "message": "usage: wcd-helper captures tail|clear --json"]
    }
    switch cli.args[1] {
    case "tail":
        let records = try loadCaptures()
        try writeRestrictedJSON(records, to: capturesJSON())
        return ["ok": true, "message": "\(records.count) capture(s)", "data": ["captures": records, "path": capturesJSON().path]]
    case "clear":
        for url in [capturesLog(), capturesJSON(), downloadsJSON()] where FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.removeItem(at: url)
        }
        return ["ok": true, "message": "captures cleared", "data": ["path": capturesLog().path]]
    default:
        return ["ok": false, "message": "usage: wcd-helper captures tail|clear --json"]
    }
}

private func loadCaptures() throws -> [[String: Any]] {
    guard FileManager.default.fileExists(atPath: capturesLog().path) else {
        return []
    }
    let text = try String(contentsOf: capturesLog(), encoding: .utf8)
    var byID: [String: [String: Any]] = [:]
    for line in text.split(separator: "\n") {
        guard let data = String(line).data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = object["id"] as? String else {
            continue
        }
        byID[id] = object
    }
    return byID.values.sorted {
        (($0["captured_at"] as? Int) ?? 0) > (($1["captured_at"] as? Int) ?? 0)
    }
}

private func download(captureID: String) throws -> [String: Any] {
    let records = try loadCaptures()
    guard let record = records.first(where: { ($0["id"] as? String) == captureID }),
          let url = record["url"] as? String else {
        throw AppError("capture not found: \(captureID)")
    }
    guard let ffmpeg = ffmpegPath() else {
        throw AppError("ffmpeg missing")
    }
    let title = safeFileName(record["title"] as? String ?? captureID)
    let output = downloadsDir().appendingPathComponent("\(title)-\(captureID).m4a")
    try FileManager.default.createDirectory(at: downloadsDir(), withIntermediateDirectories: true)
    let headers = record["headers"] as? [String: String] ?? [:]
    let result = extractAudioOnly(ffmpeg: ffmpeg, url: url, headers: headers, output: output)
    let status = result.ok ? "completed" : "failed"
    let entry: [String: Any] = [
        "capture_id": captureID,
        "url": url,
        "output": output.path,
        "mode": "audio_only",
        "status": status,
        "stderr": result.stderr.suffix(4000).description,
        "updated_at": Int(Date().timeIntervalSince1970),
    ]
    try appendDownload(entry)
    guard result.ok else {
        throw AppError("download failed: \(result.stderr)")
    }
    return ["ok": true, "message": "download completed", "data": entry]
}

private func extractAudioOnly(ffmpeg: String, url: String, headers: [String: String], output: URL) -> ProcessResult {
    var baseArgs = ["-y", "-hide_banner", "-loglevel", "error"]
    let headerBlob = headers.map { "\($0.key): \($0.value)" }.joined(separator: "\r\n")
    if !headerBlob.isEmpty {
        baseArgs += ["-headers", headerBlob + "\r\n"]
    }
    baseArgs += ["-i", url, "-vn"]

    let copyResult = runProcess(ffmpeg, baseArgs + ["-c:a", "copy", output.path])
    if copyResult.ok { return copyResult }
    try? FileManager.default.removeItem(at: output)

    let transcodeResult = runProcess(ffmpeg, baseArgs + ["-c:a", "aac", "-b:a", "128k", output.path])
    if transcodeResult.ok { return transcodeResult }
    let combinedError = [copyResult.stderr, transcodeResult.stderr]
        .filter { !$0.isEmpty }
        .joined(separator: "\n--- fallback ---\n")
    return ProcessResult(status: transcodeResult.status, stdout: transcodeResult.stdout, stderr: combinedError)
}

private func appendDownload(_ entry: [String: Any]) throws {
    var existing = (readJSONObject(downloadsJSON()) as? [[String: Any]]) ?? []
    existing.removeAll { ($0["capture_id"] as? String) == (entry["capture_id"] as? String) }
    existing.insert(entry, at: 0)
    try writeRestrictedJSON(existing, to: downloadsJSON())
}

private func safeFileName(_ value: String) -> String {
    let invalid = CharacterSet(charactersIn: "/\\?%*|\"<>:\n\r\t")
    let pieces = value.components(separatedBy: invalid).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    return String((pieces.isEmpty ? "capture" : pieces).prefix(80))
}

private func recordCurrent(durationSeconds: Int) throws -> [String: Any] {
    guard let recorder = bundledRecorderPath() else {
        throw AppError("wechat-live-exporter missing")
    }
    let result = runProcess(recorder, [
        "record-current",
        "--duration-seconds", "\(max(1, durationSeconds))",
        "--audio-source", "wechat",
        "--compact",
    ])
    guard let data = result.stdout.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return ["ok": result.ok, "message": result.ok ? "recording completed" : "recording failed", "data": ["stdout": result.stdout, "stderr": result.stderr]]
    }
    return object
}

private func wechatWindowSnapshot() -> [[String: Any]] {
    let script = """
    tell application "System Events"
      set rows to {}
      repeat with p in (application processes whose name contains "WeChat" or name contains "微信")
        set procName to name of p
        repeat with w in windows of p
          set end of rows to procName & " | " & name of w
        end repeat
      end repeat
      return rows
    end tell
    """
    let result = runProcess("/usr/bin/osascript", ["-e", script])
    guard result.ok else { return [] }
    return result.stdout
        .split(separator: ",")
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .map { ["window": $0] }
}
