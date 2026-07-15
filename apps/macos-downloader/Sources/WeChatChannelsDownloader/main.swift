import AppKit
import Foundation

// MARK: - Theme

private enum Theme {
    static let canvas = NSColor.windowBackgroundColor
    static let surface = NSColor.controlBackgroundColor
    static let textPrimary = NSColor.labelColor
    static let textSecondary = NSColor.secondaryLabelColor
    static let accent = NSColor.controlAccentColor
    static let accentMuted = NSColor.controlAccentColor.withAlphaComponent(0.12)
    static let success = accent
    static let warning = NSColor.systemOrange
    static let danger = NSColor.systemRed
    static let border = NSColor.separatorColor
}

// MARK: - Data Models

private enum Step: Int, CaseIterable {
    case prepare
    case listen
    case download

    var title: String {
        switch self {
        case .prepare: return "准备环境"
        case .listen: return "开始监听"
        case .download: return "下载 / 录制"
        }
    }

    var subtitle: String {
        switch self {
        case .prepare: return "检查证书、代理、下载工具和权限"
        case .listen: return "打开微信视频号并播放内容"
        case .download: return "保存音频，必要时录制窗口"
        }
    }

    var number: String { "\(rawValue + 1)" }
}

private struct ProxyStatus {
    var running = false
    var stateSaved = false
    var host = "127.0.0.1"
    var port = 18088
    var pid = 0
    var services: [String] = []

    init(_ value: [String: Any] = [:]) {
        running = value["running"] as? Bool ?? false
        stateSaved = value["state_saved"] as? Bool ?? false
        host = value["host"] as? String ?? host
        port = value["port"] as? Int ?? port
        pid = value["pid"] as? Int ?? 0
        services = value["services"] as? [String] ?? []
    }
}

private struct DoctorStatus {
    var ok = false
    var message = "尚未检查"
    var blockers: [String] = []
    var python = ""
    var ffmpeg = ""
    var ffprobe = ""
    var mitmdump = ""
    var mitmproxyVersion = ""
    var certPath = ""
    var downloadDir = ""
    var stateDir = ""
    var screenRecording = "unknown"
    var recordingFallback = ""
    var version = ""
    var wechatWindows: [[String: Any]] = []
    var proxy = ProxyStatus()

    init(root: [String: Any] = [:]) {
        ok = root["ok"] as? Bool ?? false
        message = root["message"] as? String ?? message
        guard let data = root["data"] as? [String: Any] else { return }
        blockers = data["blockers"] as? [String] ?? []
        python = data["python3_11"] as? String ?? ""
        ffmpeg = data["ffmpeg"] as? String ?? ""
        ffprobe = data["ffprobe"] as? String ?? ""
        mitmdump = data["mitmdump"] as? String ?? ""
        mitmproxyVersion = data["mitmproxy_version"] as? String ?? ""
        certPath = data["cert_path"] as? String ?? ""
        downloadDir = data["download_dir"] as? String ?? ""
        stateDir = data["state_dir"] as? String ?? ""
        screenRecording = data["screen_recording"] as? String ?? "unknown"
        recordingFallback = data["recording_fallback"] as? String ?? ""
        version = data["version"] as? String ?? ""
        wechatWindows = data["wechat_windows"] as? [[String: Any]] ?? []
        proxy = ProxyStatus(data["proxy"] as? [String: Any] ?? [:])
    }
}

private struct CaptureItem {
    var id = ""
    var title = ""
    var mediaType = ""
    var source = ""
    var status = ""
    var capturedAt = 0
    var url = ""

    init(_ value: [String: Any]) {
        id = value["id"] as? String ?? ""
        title = value["title"] as? String ?? "未命名视频"
        mediaType = value["media_type"] as? String ?? ""
        source = value["source"] as? String ?? ""
        status = value["status"] as? String ?? ""
        capturedAt = value["captured_at"] as? Int ?? 0
        url = value["url"] as? String ?? ""
    }
}

// MARK: - Custom Controls

/// A filled button using the accent colour for primary actions.
private final class AccentButton: NSButton {
    override init(frame: NSRect) {
        super.init(frame: frame)
        setup()
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    convenience init(title: String, target: AnyObject?, action: Selector?) {
        self.init(frame: .zero)
        self.target = target
        self.action = action
        self.title = title
        updateTitle()
    }

    private func setup() {
        isBordered = false
        wantsLayer = true
        layer?.cornerRadius = 8
        setButtonType(.momentaryPushIn)
        font = .systemFont(ofSize: 13, weight: .semibold)
    }

    override var title: String { didSet { updateTitle() } }

    private func updateTitle() {
        attributedTitle = NSAttributedString(string: title, attributes: [
            .foregroundColor: NSColor.white,
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
        ])
    }

    override func layout() {
        super.layout()
        layer?.backgroundColor = Theme.accent.cgColor
    }

    override var isHighlighted: Bool {
        didSet {
            layer?.backgroundColor = isHighlighted
                ? Theme.accent.blended(withFraction: 0.18, of: .black)?.cgColor
                : Theme.accent.cgColor
        }
    }

    override var intrinsicContentSize: NSSize {
        var s = super.intrinsicContentSize
        s.width += 28
        s.height = max(s.height, 34)
        return s
    }
}

/// Table row view with accent-coloured selection highlight.
private final class AccentRowView: NSTableRowView {
    override func drawSelection(in dirtyRect: NSRect) {
        Theme.accentMuted.setFill()
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 4, dy: 1), xRadius: 6, yRadius: 6)
        path.fill()
    }

    override var interiorBackgroundStyle: NSView.BackgroundStyle { .normal }
}

/// A view that shows a pointing-hand cursor on hover.
private final class ClickableView: NSView {
    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .pointingHand)
    }
}

// MARK: - App Delegate

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate {
    private var window: NSWindow!
    private var doctor = DoctorStatus()
    private var proxy = ProxyStatus()
    private var captures: [CaptureItem] = []
    private var rawDebug = ""
    private var debugVisible = false
    private var autoRefreshTimer: Timer?

    private let prepareDot = NSView()
    private let prepareLabel = NSTextField(labelWithString: "准备状态")
    private let listenDot = NSView()
    private let listenLabel = NSTextField(labelWithString: "监听状态")
    private let downloadDot = NSView()
    private let downloadLabel = NSTextField(labelWithString: "音频状态")

    private let mainTitleLabel = NSTextField(labelWithString: "")
    private let mainHintLabel = NSTextField(wrappingLabelWithString: "")
    private var primaryButton: AccentButton!
    private var issuePanel: NSView!
    private let issueLabel = NSTextField(wrappingLabelWithString: "")

    private let tableView = NSTableView()
    private let captureCountLabel = NSTextField(labelWithString: "")
    private let emptyCaptureLabel = NSTextField(labelWithString: "还没有捕获到可提取音频的视频。\n先点“开始监听”，然后在微信视频号播放内容。")
    private var tableScroll: NSScrollView!
    private var downloadButton: NSButton!
    private var copyButton: NSButton!

    private let recordStatusLabel = NSTextField(wrappingLabelWithString: "")
    private let debugText = NSTextView()
    private var debugScroll: NSScrollView!
    private var debugToggleButton: NSButton!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        buildWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        runDoctor()
        refreshCaptures(showDebug: false)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        autoRefreshTimer?.invalidate()
        runHelper(["proxy", "stop", "--json"]) { _ in }
        return .terminateNow
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 920, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "微信视频号下载器"
        window.backgroundColor = Theme.canvas
        window.center()
        window.minSize = NSSize(width: 800, height: 620)

        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .width
        root.distribution = .fill
        root.spacing = 0
        root.translatesAutoresizingMaskIntoConstraints = false

        let header = buildHeader()
        let line = NSView()
        line.wantsLayer = true
        line.layer?.backgroundColor = Theme.border.cgColor
        line.translatesAutoresizingMaskIntoConstraints = false

        let dashboard = buildDashboard()
        dashboard.translatesAutoresizingMaskIntoConstraints = false
        let debugBar = buildDebugBar()

        root.addArrangedSubview(header)
        root.addArrangedSubview(line)
        root.addArrangedSubview(dashboard)
        root.addArrangedSubview(debugBar)

        window.contentView = root

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            root.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            root.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor),
            dashboard.widthAnchor.constraint(equalTo: root.widthAnchor),
            line.heightAnchor.constraint(equalToConstant: 1),
        ])

        render()
    }

    private func buildHeader() -> NSView {
        let bar = NSStackView()
        bar.orientation = .horizontal
        bar.alignment = .centerY
        bar.spacing = 10
        bar.edgeInsets = NSEdgeInsets(top: 12, left: 20, bottom: 12, right: 20)

        let title = NSTextField(labelWithString: "微信视频号下载器")
        title.font = .systemFont(ofSize: 18, weight: .medium)
        title.textColor = Theme.textPrimary

        [prepareLabel, listenLabel, downloadLabel].forEach {
            $0.font = .systemFont(ofSize: 12, weight: .regular)
            $0.textColor = Theme.textSecondary
        }
        styleDot(prepareDot, size: 7)
        styleDot(listenDot, size: 7)
        styleDot(downloadDot, size: 7)

        bar.addArrangedSubview(title)
        bar.addArrangedSubview(spacer())
        bar.addArrangedSubview(indicatorStack(prepareDot, prepareLabel))
        bar.addArrangedSubview(indicatorStack(listenDot, listenLabel))
        bar.addArrangedSubview(indicatorStack(downloadDot, downloadLabel))
        return bar
    }

    private func buildDashboard() -> NSView {
        let container = NSView()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .width
        stack.distribution = .fill
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(stack)

        let mainPanel = buildMainActionPanel()
        stack.addArrangedSubview(mainPanel)
        issuePanel = buildIssuePanel()
        stack.addArrangedSubview(issuePanel)
        let capturesPanel = buildCapturesPanel()
        let recordingPanel = buildRecordingPanel()
        stack.addArrangedSubview(capturesPanel)
        stack.addArrangedSubview(recordingPanel)
        stack.addArrangedSubview(spacer(vertical: true))

        [mainPanel, issuePanel, capturesPanel, recordingPanel].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            $0.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -16),
        ])
        return container
    }

    private func buildMainActionPanel() -> NSView {
        let panel = card()
        panel.orientation = .horizontal
        panel.alignment = .centerY
        panel.spacing = 18
        panel.edgeInsets = NSEdgeInsets(top: 20, left: 22, bottom: 20, right: 22)

        let textStack = NSStackView()
        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 6

        mainTitleLabel.font = .systemFont(ofSize: 22, weight: .semibold)
        mainTitleLabel.textColor = Theme.textPrimary
        mainHintLabel.font = .systemFont(ofSize: 13, weight: .regular)
        mainHintLabel.textColor = Theme.textSecondary
        mainHintLabel.maximumNumberOfLines = 2

        textStack.addArrangedSubview(mainTitleLabel)
        textStack.addArrangedSubview(mainHintLabel)

        primaryButton = AccentButton(title: "开始监听", target: self, action: #selector(toggleListeningAction))
        primaryButton.controlSize = .large

        panel.addArrangedSubview(textStack)
        panel.addArrangedSubview(spacer())
        panel.addArrangedSubview(primaryButton)
        return panel
    }

    private func buildIssuePanel() -> NSView {
        let panel = NSStackView()
        panel.orientation = .horizontal
        panel.alignment = .centerY
        panel.spacing = 10
        panel.edgeInsets = NSEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        panel.wantsLayer = true
        panel.layer?.cornerRadius = 10
        panel.layer?.backgroundColor = Theme.warning.withAlphaComponent(0.08).cgColor
        panel.layer?.borderColor = Theme.warning.withAlphaComponent(0.25).cgColor
        panel.layer?.borderWidth = 0.5

        issueLabel.font = .systemFont(ofSize: 12, weight: .regular)
        issueLabel.textColor = Theme.textPrimary
        issueLabel.maximumNumberOfLines = 2

        panel.addArrangedSubview(issueLabel)
        panel.addArrangedSubview(spacer())
        panel.addArrangedSubview(secondaryButton("重新检查", action: #selector(runDoctorAction)))
        panel.addArrangedSubview(secondaryButton("准备组件", action: #selector(bootstrapAction)))
        panel.addArrangedSubview(secondaryButton("信任证书", action: #selector(certAction)))
        return panel
    }

    private func buildCapturesPanel() -> NSView {
        let panel = card()
        panel.spacing = 12
        panel.edgeInsets = NSEdgeInsets(top: 16, left: 18, bottom: 16, right: 18)

        let header = NSStackView()
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 10

        let titleStack = NSStackView()
        titleStack.orientation = .vertical
        titleStack.alignment = .leading
        titleStack.spacing = 2
        titleStack.addArrangedSubview(sectionTitle("音频列表"))

        captureCountLabel.font = .systemFont(ofSize: 12, weight: .regular)
        captureCountLabel.textColor = Theme.textSecondary
        titleStack.addArrangedSubview(captureCountLabel)

        header.addArrangedSubview(titleStack)
        header.addArrangedSubview(spacer())
        header.addArrangedSubview(secondaryButton("刷新列表", action: #selector(refreshCapturesAction)))
        downloadButton = secondaryButton("下载音频", action: #selector(downloadSelectedAction))
        copyButton = secondaryButton("复制链接", action: #selector(copySelectedURLAction))
        header.addArrangedSubview(downloadButton)
        header.addArrangedSubview(copyButton)
        header.addArrangedSubview(secondaryButton("打开音频目录", action: #selector(openDownloadsAction)))
        panel.addArrangedSubview(header)

        emptyCaptureLabel.textColor = Theme.textSecondary
        emptyCaptureLabel.alignment = .center
        emptyCaptureLabel.maximumNumberOfLines = 2
        emptyCaptureLabel.font = .systemFont(ofSize: 13, weight: .regular)
        panel.addArrangedSubview(emptyCaptureLabel)

        configureTableIfNeeded()
        tableScroll = scrollView(tableView, minHeight: 275)
        tableScroll.borderType = .noBorder
        tableScroll.wantsLayer = true
        tableScroll.layer?.cornerRadius = 8
        tableScroll.layer?.borderColor = Theme.border.cgColor
        tableScroll.layer?.borderWidth = 0.5
        panel.addArrangedSubview(tableScroll)
        return panel
    }

    private func buildRecordingPanel() -> NSView {
        let panel = NSStackView()
        panel.orientation = .horizontal
        panel.alignment = .centerY
        panel.spacing = 12
        panel.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        panel.wantsLayer = true
        panel.layer?.cornerRadius = 10
        panel.layer?.backgroundColor = Theme.surface.cgColor
        panel.layer?.borderColor = Theme.border.cgColor
        panel.layer?.borderWidth = 0.5

        let text = NSStackView()
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3
        text.addArrangedSubview(sectionTitle("无法下载？录制当前微信窗口"))
        recordStatusLabel.font = .systemFont(ofSize: 12, weight: .regular)
        recordStatusLabel.textColor = Theme.textSecondary
        recordStatusLabel.maximumNumberOfLines = 2
        text.addArrangedSubview(recordStatusLabel)

        panel.addArrangedSubview(text)
        panel.addArrangedSubview(spacer())
        panel.addArrangedSubview(secondaryButton("录制 30 秒", action: #selector(recordCurrentAction)))
        panel.addArrangedSubview(secondaryButton("打开录制目录", action: #selector(openRecordingSessionsAction)))
        return panel
    }

    private func buildDebugBar() -> NSView {
        let bar = NSStackView()
        bar.orientation = .vertical
        bar.spacing = 0
        bar.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)

        // Top separator
        let line = NSView()
        line.wantsLayer = true
        line.layer?.backgroundColor = Theme.border.cgColor
        line.translatesAutoresizingMaskIntoConstraints = false

        let toggle = NSButton(title: "调试详情 ▸", target: self, action: #selector(toggleDebugAction))
        toggle.isBordered = false
        toggle.font = .systemFont(ofSize: 11, weight: .medium)
        toggle.contentTintColor = Theme.textSecondary
        toggle.alignment = .left
        debugToggleButton = toggle

        let toggleContainer = NSStackView()
        toggleContainer.orientation = .horizontal
        toggleContainer.edgeInsets = NSEdgeInsets(top: 6, left: 20, bottom: 6, right: 20)
        toggleContainer.addArrangedSubview(toggle)
        toggleContainer.addArrangedSubview(spacer())

        // Debug text
        debugText.isEditable = false
        debugText.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        debugText.textColor = Theme.textSecondary
        debugText.backgroundColor = Theme.surface
        debugText.drawsBackground = true
        debugScroll = scrollView(debugText, minHeight: 120)
        debugScroll.isHidden = true

        bar.addArrangedSubview(line)
        bar.addArrangedSubview(toggleContainer)
        bar.addArrangedSubview(debugScroll)

        NSLayoutConstraint.activate([
            line.heightAnchor.constraint(equalToConstant: 1),
        ])

        return bar
    }

    private func render() {
        updateColors()
        updateHeaderIndicators()
        updateMainAction()
        updateIssuePanel()
        updateCapturesPanel()
        updateRecordingPanel()
        updateAutoRefresh()
        debugText.string = rawDebug
    }

    private func updateColors() {
        window.backgroundColor = Theme.canvas
        tableView.backgroundColor = Theme.surface
    }

    private func updateHeaderIndicators() {
        if doctor.version.isEmpty {
            prepareDot.layer?.backgroundColor = Theme.textSecondary.cgColor
            prepareLabel.stringValue = "准备状态：检查中"
        } else if visiblePreparationBlockers.isEmpty {
            prepareDot.layer?.backgroundColor = Theme.success.cgColor
            prepareLabel.stringValue = "准备状态：就绪"
        } else {
            prepareDot.layer?.backgroundColor = Theme.warning.cgColor
            prepareLabel.stringValue = "准备状态：需处理"
        }

        if proxy.running {
            listenDot.layer?.backgroundColor = Theme.success.cgColor
            listenLabel.stringValue = "监听状态：监听中"
        } else {
            listenDot.layer?.backgroundColor = Theme.textSecondary.cgColor
            listenLabel.stringValue = "监听状态：未监听"
        }

        downloadDot.layer?.backgroundColor = captures.isEmpty
            ? Theme.textSecondary.cgColor : Theme.accent.cgColor
        downloadLabel.stringValue = captures.isEmpty ? "音频状态：暂无" : "音频状态：\(captures.count) 项"
    }

    private func updateMainAction() {
        if proxy.running {
            mainTitleLabel.stringValue = "正在监听微信视频号"
            mainHintLabel.stringValue = "在微信里播放视频号内容，捕获到的视频会自动出现在下方音频列表。"
            primaryButton.title = "停止监听并恢复网络"
            primaryButton.isEnabled = true
        } else if doctor.version.isEmpty {
            mainTitleLabel.stringValue = "正在检查准备状态"
            mainHintLabel.stringValue = "检查完成后，这里会显示是否可以开始监听。"
            primaryButton.title = "开始监听"
            primaryButton.isEnabled = false
        } else if canStartListening {
            mainTitleLabel.stringValue = "可以开始监听"
            mainHintLabel.stringValue = "点击开始后，打开微信视频号并播放你有权限观看的内容。"
            primaryButton.title = "开始监听"
            primaryButton.isEnabled = true
        } else {
            mainTitleLabel.stringValue = "需要先完成准备"
            mainHintLabel.stringValue = "按下方提示处理一次，完成后即可开始监听。"
            primaryButton.title = "开始监听"
            primaryButton.isEnabled = false
        }
    }

    private func updateIssuePanel() {
        let blockers = visiblePreparationBlockers
        issuePanel.isHidden = doctor.version.isEmpty || blockers.isEmpty
        issueLabel.stringValue = preparationIssueMessage(blockers)
    }

    private func updateCapturesPanel() {
        captureCountLabel.stringValue = captures.isEmpty
            ? "捕获到的视频会显示在这里，下载时只保存音频。"
            : "已捕获 \(captures.count) 项。"
        emptyCaptureLabel.isHidden = !captures.isEmpty
        tableScroll.isHidden = captures.isEmpty
        downloadButton.isEnabled = !captures.isEmpty
        copyButton.isEnabled = !captures.isEmpty
        tableView.reloadData()
    }

    private func updateRecordingPanel() {
        if doctor.screenRecording == "granted" {
            recordStatusLabel.stringValue = "网络下载不稳定时，可以录制当前微信窗口。"
            recordStatusLabel.textColor = Theme.textSecondary
        } else {
            recordStatusLabel.stringValue = "录制需要授予屏幕录制权限；下载捕获到的视频不受影响。"
            recordStatusLabel.textColor = Theme.warning
        }
    }

    private func updateAutoRefresh() {
        if proxy.running {
            guard autoRefreshTimer == nil else { return }
            autoRefreshTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    self?.refreshCaptures(showDebug: false)
                }
            }
            autoRefreshTimer?.tolerance = 0.8
        } else {
            autoRefreshTimer?.invalidate()
            autoRefreshTimer = nil
        }
    }

    @objc private func runDoctorAction() {
        runDoctor()
    }

    private func runDoctor() {
        prepareLabel.stringValue = "准备状态：检查中"
        runHelper(["doctor", "--json"]) { [weak self] output in
            guard let self else { return }
            self.rawDebug = output
            if let root = parseJSON(output) {
                self.doctor = DoctorStatus(root: root)
                self.proxy = self.doctor.proxy
            }
            self.render()
        }
    }

    @objc private func bootstrapAction() {
        prepareLabel.stringValue = "准备状态：准备中"
        runHelper(["bootstrap", "--json"]) { [weak self] output in
            self?.rawDebug = output
            self?.runDoctor()
        }
    }

    @objc private func certAction() {
        prepareLabel.stringValue = "准备状态：安装证书"
        runHelper(["cert", "install", "--json"]) { [weak self] output in
            self?.rawDebug = output
            self?.runDoctor()
        }
    }

    @objc private func toggleListeningAction() {
        proxy.running ? stopListeningAction() : startListeningAction()
    }

    private func startListeningAction() {
        listenLabel.stringValue = "监听状态：启动中"
        runHelper(["proxy", "start", "--json"]) { [weak self] output in
            guard let self else { return }
            self.rawDebug = output
            if let root = parseJSON(output), let data = root["data"] as? [String: Any] {
                self.proxy = ProxyStatus(data)
                self.doctor.proxy = self.proxy
            }
            if self.proxy.running {
                self.refreshCaptures(showDebug: false)
            }
            self.render()
        }
    }

    private func stopListeningAction() {
        listenLabel.stringValue = "监听状态：停止中"
        runHelper(["proxy", "stop", "--json"]) { [weak self] output in
            guard let self else { return }
            self.rawDebug = output
            if let root = parseJSON(output), let data = root["data"] as? [String: Any] {
                self.proxy = ProxyStatus(data)
                self.doctor.proxy = self.proxy
            }
            self.render()
        }
    }

    @objc private func proxyStatusAction() {
        listenLabel.stringValue = "监听状态：刷新中"
        runHelper(["proxy", "status", "--json"]) { [weak self] output in
            guard let self else { return }
            self.rawDebug = output
            if let root = parseJSON(output), let data = root["data"] as? [String: Any] {
                self.proxy = ProxyStatus(data)
                self.doctor.proxy = self.proxy
            }
            self.render()
        }
    }

    @objc private func refreshCapturesAction() {
        refreshCaptures(showDebug: true)
    }

    private func refreshCaptures(showDebug: Bool) {
        configureTableIfNeeded()
        runHelper(["captures", "tail", "--json"]) { [weak self] output in
            guard let self else { return }
            if showDebug { self.rawDebug = output }
            if let root = parseJSON(output),
               let data = root["data"] as? [String: Any],
               let rows = data["captures"] as? [[String: Any]] {
                self.captures = rows.map(CaptureItem.init)
            }
            self.tableView.reloadData()
            self.render()
        }
    }

    @objc private func clearCapturesAction() {
        runHelper(["captures", "clear", "--json"]) { [weak self] output in
            guard let self else { return }
            self.rawDebug = output
            self.captures = []
            self.tableView.reloadData()
            self.render()
        }
    }

    @objc private func downloadSelectedAction() {
        let row = tableView.selectedRow
        guard row >= 0, row < captures.count else {
            mainHintLabel.stringValue = "请先在音频列表里选择一个项目。"
            return
        }
        let item = captures[row]
        runHelper(["download", "--capture-id", item.id, "--json"]) { [weak self] output in
            self?.rawDebug = output
            self?.render()
        }
    }

    @objc private func copySelectedURLAction() {
        let row = tableView.selectedRow
        guard row >= 0, row < captures.count else {
            mainHintLabel.stringValue = "请先在音频列表里选择一个项目。"
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(captures[row].url, forType: .string)
    }

    @objc private func openDownloadsAction() {
        NSWorkspace.shared.open(downloadsURL())
    }

    @objc private func openStateFolderAction() {
        NSWorkspace.shared.open(stateURL())
    }

    @objc private func recordCurrentAction() {
        runHelper(["record-current", "--duration-seconds", "30", "--json"]) { [weak self] output in
            self?.rawDebug = output
            self?.render()
        }
    }

    @objc private func openRecordingSessionsAction() {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/WeChat Live Exporter/sessions", isDirectory: true)
        NSWorkspace.shared.open(url)
    }

    @objc private func toggleDebugAction() {
        debugVisible.toggle()
        debugToggleButton.title = debugVisible ? "调试详情 ▾" : "调试详情 ▸"
        debugText.string = rawDebug
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            context.allowsImplicitAnimation = true
            debugScroll.isHidden = !debugVisible
        }
    }

    private var visiblePreparationBlockers: [String] {
        doctor.blockers.filter {
            $0 != "screen_recording_missing_for_recording_fallback"
                && $0 != "recording_fallback_missing"
        }
    }

    private var canStartListening: Bool {
        guard !doctor.version.isEmpty else { return false }
        return !doctor.blockers.contains("python3.11_missing")
            && !doctor.blockers.contains("mitmproxy_venv_missing")
    }

    private func preparationIssueMessage(_ blockers: [String]) -> String {
        if blockers.contains("python3.11_missing") || blockers.contains("mitmproxy_venv_missing") {
            return "监听组件还没准备好，请点击“准备组件”。"
        }
        if blockers.contains("mitmproxy_cert_missing_until_first_start") {
            return "需要信任本地证书后，应用才能识别视频请求。"
        }
        if blockers.contains("ffmpeg_missing") || blockers.contains("ffprobe_missing") {
            return "下载合并工具不可用，请先重新检查或安装依赖。"
        }
        return blockers.isEmpty ? "" : "有准备项需要处理，请先重新检查。"
    }

    private func mitmSummary() -> String {
        if doctor.mitmdump.isEmpty { return "点击\u{201C}准备监听组件\u{201D}安装本地监听工具。" }
        return "版本 \(doctor.mitmproxyVersion.isEmpty ? "已安装" : doctor.mitmproxyVersion)"
    }

    private func proxyDescription() -> String {
        let service = proxy.services.first ?? "当前网络服务"
        if proxy.running {
            return "\(service) 正在使用 \(proxy.host):\(proxy.port)，停止监听后会恢复原设置。"
        }
        return "\(service) 未开启本地代理。"
    }

    private func recordingStatusTitle() -> String {
        doctor.screenRecording == "granted" ? "已授权" : "需要授权"
    }

    private func recordingStatusBody() -> String {
        if doctor.screenRecording == "granted" {
            return doctor.recordingFallback.isEmpty ? "录制工具未找到。" : "录制兜底可用。"
        }
        return "到系统设置里给本应用开启屏幕录制权限。"
    }

    private func blockerSummary() -> String {
        doctor.blockers.map(chineseBlocker).joined(separator: "\n")
    }

    private func chineseBlocker(_ key: String) -> String {
        switch key {
        case "python3.11_missing": return "缺少 Python 3.11，无法安装监听组件。"
        case "ffmpeg_missing": return "缺少 FFmpeg，无法合并视频流或录制输出。"
        case "ffprobe_missing": return "缺少 FFprobe，无法校验下载结果。"
        case "mitmproxy_venv_missing": return "监听组件未准备，点击\u{201C}准备监听组件\u{201D}。"
        case "mitmproxy_cert_missing_until_first_start": return "证书会在首次启动监听时生成。"
        case "screen_recording_missing_for_recording_fallback": return "录制兜底缺少屏幕录制权限；下载捕获项不受影响。"
        case "recording_fallback_missing": return "录制兜底工具未打包。"
        default: return key
        }
    }

    private func runHelper(_ args: [String], completion: @escaping @MainActor @Sendable (String) -> Void) {
        let helper = helperPath()
        Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: helper)
            process.arguments = args
            let out = Pipe()
            let err = Pipe()
            process.standardOutput = out
            process.standardError = err
            do {
                try process.run()
                process.waitUntilExit()
                let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                let combined = stderr.isEmpty ? stdout : stdout + "\nSTDERR:\n" + stderr
                await MainActor.run { completion(combined) }
            } catch {
                await MainActor.run {
                    completion("{\"ok\":false,\"message\":\"\(error.localizedDescription)\"}")
                }
            }
        }
    }

    private func helperPath() -> String {
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        let macOSHelper = executable.deletingLastPathComponent().appendingPathComponent("wcd-helper").path
        if FileManager.default.isExecutableFile(atPath: macOSHelper) { return macOSHelper }
        let dev = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent(".build/release/wcd-helper").path
        if FileManager.default.isExecutableFile(atPath: dev) { return dev }
        return "wcd-helper"
    }

    private func stateURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/WeChat Channels Downloader", isDirectory: true)
    }

    private func downloadsURL() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Movies/WeChat Channels Downloads", isDirectory: true)
    }

    // ────────────────────────────── Table View ──────────────────────────────

    private func configureTableIfNeeded() {
        guard tableView.tableColumns.isEmpty else { return }
        tableView.delegate = self
        tableView.dataSource = self
        tableView.usesAlternatingRowBackgroundColors = false
        tableView.backgroundColor = Theme.surface
        tableView.allowsEmptySelection = true
        tableView.allowsMultipleSelection = false
        tableView.rowHeight = 40
        tableView.gridStyleMask = []
        tableView.selectionHighlightStyle = .regular
        addColumn("title", "标题", 300)
        addColumn("mediaType", "类型", 80)
        addColumn("source", "来源", 180)
        addColumn("status", "状态", 80)
        addColumn("capturedAt", "捕获时间", 130)
    }

    private func addColumn(_ identifier: String, _ title: String, _ width: CGFloat) {
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(identifier))
        column.title = title
        column.width = width
        column.headerCell.font = .systemFont(ofSize: 11, weight: .medium)
        tableView.addTableColumn(column)
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        captures.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard row < captures.count, let identifier = tableColumn?.identifier.rawValue else { return nil }
        let item = captures[row]
        let value: String
        switch identifier {
        case "title": value = item.title
        case "mediaType": value = chineseMediaType(item.mediaType)
        case "source": value = item.source
        case "status": value = chineseStatus(item.status)
        case "capturedAt": value = formattedTime(item.capturedAt)
        default: value = ""
        }
        let cellID = NSUserInterfaceItemIdentifier("cell-\(identifier)")
        let textField = tableView.makeView(withIdentifier: cellID, owner: self) as? NSTextField ?? NSTextField(labelWithString: "")
        textField.identifier = cellID
        textField.lineBreakMode = .byTruncatingMiddle
        textField.stringValue = value
        textField.font = .systemFont(ofSize: 13, weight: .regular)
        textField.textColor = Theme.textPrimary
        return textField
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        AccentRowView()
    }
}

// MARK: - UI Helpers

@MainActor
private func styleDot(_ dot: NSView, size: CGFloat) {
    dot.wantsLayer = true
    dot.layer?.cornerRadius = size / 2
    dot.layer?.backgroundColor = Theme.textSecondary.cgColor
    dot.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
        dot.widthAnchor.constraint(equalToConstant: size),
        dot.heightAnchor.constraint(equalToConstant: size),
    ])
}

@MainActor
private func indicatorStack(_ dot: NSView, _ label: NSTextField) -> NSStackView {
    let stack = NSStackView()
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 6
    stack.addArrangedSubview(dot)
    stack.addArrangedSubview(label)
    return stack
}

/// A borderless card with subtle shadow.
@MainActor
private func card() -> NSStackView {
    let stack = NSStackView()
    stack.orientation = .vertical
    stack.spacing = 8
    stack.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
    stack.wantsLayer = true
    stack.layer?.cornerRadius = 10
    stack.layer?.backgroundColor = Theme.surface.cgColor
    stack.layer?.borderColor = Theme.border.cgColor
    stack.layer?.borderWidth = 0.5
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.03)
    shadow.shadowOffset = NSSize(width: 0, height: -1)
    shadow.shadowBlurRadius = 4
    stack.shadow = shadow
    return stack
}

/// A compact status row: title + coloured dot + status label, detail below.
@MainActor
private func statusRow(_ title: String, _ status: String, _ detail: String, good: Bool) -> NSView {
    let stack = card()
    stack.spacing = 6
    stack.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 12, right: 14)
    stack.setContentHuggingPriority(.defaultLow, for: .horizontal)

    let row = NSStackView()
    row.orientation = .horizontal
    row.alignment = .centerY
    row.spacing = 8

    let heading = NSTextField(labelWithString: title)
    heading.font = .systemFont(ofSize: 13, weight: .medium)
    heading.textColor = Theme.textPrimary

    let dot = NSView()
    styleDot(dot, size: 6)
    dot.layer?.backgroundColor = good ? Theme.success.cgColor : Theme.warning.cgColor

    let badge = NSTextField(labelWithString: status)
    badge.font = .systemFont(ofSize: 12, weight: .regular)
    badge.textColor = good ? Theme.success : Theme.warning

    row.addArrangedSubview(heading)
    row.addArrangedSubview(spacer())
    row.addArrangedSubview(dot)
    row.addArrangedSubview(badge)

    let body = NSTextField(labelWithString: detail.isEmpty ? "未提供路径" : detail)
    body.textColor = Theme.textSecondary
    body.font = .systemFont(ofSize: 11, weight: .regular)
    body.lineBreakMode = .byTruncatingMiddle
    body.maximumNumberOfLines = 2

    stack.addArrangedSubview(row)
    stack.addArrangedSubview(body)
    return stack
}

@MainActor
private func twoColumnRow(_ left: NSView, _ right: NSView) -> NSView {
    let row = NSStackView()
    row.orientation = .horizontal
    row.spacing = 8
    row.distribution = .fillEqually
    row.addArrangedSubview(left)
    row.addArrangedSubview(right)
    return row
}

@MainActor
private func sectionTitle(_ value: String) -> NSTextField {
    let label = NSTextField(labelWithString: value)
    label.font = .systemFont(ofSize: 14, weight: .medium)
    label.textColor = Theme.textPrimary
    return label
}

@MainActor
private func instruction(_ number: String, _ text: String) -> NSView {
    let row = NSStackView()
    row.orientation = .horizontal
    row.alignment = .centerY
    row.spacing = 10

    let circle = NSTextField(labelWithString: number)
    circle.alignment = .center
    circle.font = .systemFont(ofSize: 11, weight: .semibold)
    circle.textColor = Theme.accent
    circle.wantsLayer = true
    circle.layer?.cornerRadius = 10
    circle.layer?.backgroundColor = Theme.accentMuted.cgColor
    circle.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
        circle.widthAnchor.constraint(equalToConstant: 20),
        circle.heightAnchor.constraint(equalToConstant: 20),
    ])

    let label = NSTextField(wrappingLabelWithString: text)
    label.font = .systemFont(ofSize: 13, weight: .regular)
    label.textColor = Theme.textPrimary

    row.addArrangedSubview(circle)
    row.addArrangedSubview(label)
    return row
}

@MainActor
private func secondaryButton(_ title: String, action: Selector) -> NSButton {
    let button = NSButton(title: title, target: NSApp.delegate, action: action)
    button.bezelStyle = .rounded
    button.controlSize = .regular
    button.font = .systemFont(ofSize: 12, weight: .medium)
    button.contentTintColor = Theme.accent
    return button
}

@MainActor
private func infoBox(_ text: String) -> NSView {
    messageBox(text, color: Theme.accent)
}

@MainActor
private func warningBox(_ text: String) -> NSView {
    messageBox(text, color: Theme.warning)
}

@MainActor
private func messageBox(_ text: String, color: NSColor) -> NSView {
    let stack = NSStackView()
    stack.orientation = .vertical
    stack.spacing = 0
    stack.edgeInsets = NSEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
    stack.wantsLayer = true
    stack.layer?.cornerRadius = 8
    stack.layer?.backgroundColor = color.withAlphaComponent(0.08).cgColor
    stack.layer?.borderColor = color.withAlphaComponent(0.25).cgColor
    stack.layer?.borderWidth = 0.5

    let body = NSTextField(wrappingLabelWithString: text)
    body.font = .systemFont(ofSize: 12, weight: .regular)
    body.textColor = Theme.textPrimary
    stack.addArrangedSubview(body)
    return stack
}

@MainActor
private func scrollView(_ document: NSView, minHeight: CGFloat) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.hasVerticalScroller = true
    scroll.hasHorizontalScroller = false
    scroll.autohidesScrollers = true
    scroll.documentView = document
    scroll.borderType = .noBorder
    scroll.drawsBackground = false
    scroll.translatesAutoresizingMaskIntoConstraints = false
    scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: minHeight).isActive = true
    return scroll
}

@MainActor
private func separator() -> NSView {
    let view = NSView()
    view.wantsLayer = true
    view.layer?.backgroundColor = Theme.border.cgColor
    view.translatesAutoresizingMaskIntoConstraints = false
    view.heightAnchor.constraint(equalToConstant: 1).isActive = true
    return view
}

@MainActor
private func spacer(vertical: Bool = false) -> NSView {
    let view = NSView()
    view.setContentHuggingPriority(.defaultLow, for: vertical ? .vertical : .horizontal)
    return view
}

// MARK: - Utilities

private func parseJSON(_ output: String) -> [String: Any]? {
    guard let start = output.firstIndex(of: "{"), let end = output.lastIndex(of: "}") else { return nil }
    let slice = output[start...end]
    guard let data = String(slice).data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}

private func chineseMediaType(_ value: String) -> String {
    switch value {
    case "hls": return "视频流"
    case "video": return "视频"
    case "live": return "直播"
    case "fragment": return "分片"
    case "candidate": return "候选"
    default: return value.isEmpty ? "未知" : value
    }
}

private func chineseStatus(_ value: String) -> String {
    switch value {
    case "captured": return "已捕获"
    case "completed": return "已完成"
    case "failed": return "失败"
    case "http_error": return "请求异常"
    default: return value.isEmpty ? "未知" : value
    }
}

private func formattedTime(_ seconds: Int) -> String {
    guard seconds > 0 else { return "" }
    let date = Date(timeIntervalSince1970: TimeInterval(seconds))
    return DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .medium)
}

// MARK: - Entry Point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
