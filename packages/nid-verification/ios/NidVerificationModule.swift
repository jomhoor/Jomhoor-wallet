import CoreNFC
import Foundation
import React

@objc(NidVerification)
final class NidVerificationModule: NSObject, NFCTagReaderSessionDelegate {
    private struct ProbeCommand {
        let name: String
        let bytes: [UInt8]
        let optional: Bool
        let checkDer: Bool
        let canRetryWrongLength: Bool

        init(
            _ name: String,
            _ hex: String,
            optional: Bool = false,
            checkDer: Bool = false,
            canRetryWrongLength: Bool = false
        ) {
            self.name = name
            bytes = NidVerificationModule.hexBytes(hex)
            self.optional = optional
            self.checkDer = checkDer
            self.canRetryWrongLength = canRetryWrongLength
        }
    }

    private struct ProbeProfile {
        let name: String
        let commands: [ProbeCommand]
    }

    private struct ProbeStandard {
        let name: String
        let pollingOption: NFCTagReaderSession.PollingOption
        let nativePolling: String
        let aliases: [String]
        let requirement: ProbeRequirement
    }

    private enum ProbeRequirement {
        case anyTag
        case iso7816
        case ndef
    }

    private struct CommandResult {
        let accepted: Bool
        let hadResponse: Bool
        let looksLikeDer: Bool
        let report: [String: Any]
    }

    private let stateLock = NSLock()
    private var session: NFCTagReaderSession?
    private var resolveBlock: RCTPromiseResolveBlock?
    private var rejectBlock: RCTPromiseRejectBlock?
    private var sessionId: String?
    private var startedAtMs: Double = 0
    private var attempts: [[String: Any]] = []
    private var standardAttempts: [[String: Any]] = []
    private var didFinish = false
    private var currentStandardIndex = -1
    private var currentStandardStartedAtMs: Double = 0
    private var currentStandardHandledTag = false
    private var phaseTransitionPending = false
    private var phaseTimeoutWorkItem: DispatchWorkItem?
    private var detectedStandard: String?
    private var lastTagReport: [String: Any] = [
        "technologies": [],
        "isoDepSupported": false,
    ]

    @objc
    static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(getNidVerificationNativeStatus:rejecter:)
    func getNidVerificationNativeStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        resolve([
            "platform": "ios",
            "nativeLinked": true,
            "probeCompiled": isDebugBuild,
            "module": "NidVerification",
            "version": "0.1.0",
        ])
    }

    @objc(logNidNfcEvent:)
    func logNidNfcEvent(_ input: NSDictionary) {
        guard isDebugBuild, let rawEvent = input["event"] as? String else {
            return
        }

        let allowedCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_.-"))
        let sanitizedEvent = rawEvent.unicodeScalars.map {
            allowedCharacters.contains($0) ? String($0) : "_"
        }.joined()
        let event = String(sanitizedEvent.prefix(80))
        let rawDetails = input["details"] as? NSDictionary ?? [:]
        var safeDetails: [String: Any] = ["source": "react-native-nfc-manager"]
        for key in diagnosticDetailKeys {
            guard let value = rawDetails[key] else {
                continue
            }
            let sanitized = String(describing: value)
                .replacingOccurrences(of: "\r", with: "_")
                .replacingOccurrences(of: "\n", with: "_")
                .replacingOccurrences(of: ";", with: "_")
            safeDetails[key] = String(sanitized.prefix(120))
        }

        log("standard-read:\(event)", details: safeDetails)
    }

    @objc(probeNidChip:resolver:rejecter:)
    func probeNidChip(
        _ input: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard isDebugBuild, input["enabled"] as? Bool == true else {
            log("probe rejected", details: ["reason": "disabled_or_non_debug_build"])
            reject(
                "NID_PROBE_DISABLED",
                "NID NFC probe is available only in explicitly enabled debug builds.",
                nil
            )
            return
        }
        guard NFCTagReaderSession.readingAvailable else {
            reject("NID_NFC_UNAVAILABLE", "NFC tag reading is unavailable on this device.", nil)
            return
        }

        stateLock.lock()
        if session != nil || resolveBlock != nil {
            stateLock.unlock()
            reject("NID_NFC_SESSION_BUSY", "Another NID NFC probe is already active.", nil)
            return
        }

        let id = String(UUID().uuidString.prefix(8))
        resolveBlock = resolve
        rejectBlock = reject
        sessionId = id
        startedAtMs = nowMs()
        attempts = []
        standardAttempts = []
        didFinish = false
        currentStandardIndex = -1
        currentStandardStartedAtMs = 0
        currentStandardHandledTag = false
        phaseTransitionPending = false
        phaseTimeoutWorkItem = nil
        detectedStandard = nil
        lastTagReport = [
            "technologies": [],
            "isoDepSupported": false,
        ]
        stateLock.unlock()

        log("probe started", details: [
            "standards": probeStandards.map(\.name).joined(separator: ","),
            "phaseTimeoutMs": Int(probePhaseTimeoutMs),
        ])
        startProbeStandard(index: 0)
    }

    @objc(cancelNidProbe:rejecter:)
    func cancelNidProbe(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        stateLock.lock()
        let hasActiveProbe = resolveBlock != nil
        stateLock.unlock()

        if hasActiveProbe {
            log("cancel requested")
            finishReject(
                code: "NID_NFC_USER_CANCELLED",
                message: "NID NFC probe cancelled.",
                error: nil,
                invalidateMessage: "Probe cancelled."
            )
        }
        resolve(nil)
    }

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {
        guard let standard = standardForSession(session) else {
            return
        }
        log("reader session active", details: [
            "standard": standard.name,
            "standardIndex": currentStandardIndexSnapshot(),
            "nativePolling": standard.nativePolling,
        ])
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        stateLock.lock()
        let alreadyFinished = didFinish
        let wasTransition = phaseTransitionPending && self.session === session
        let invalidatedStandardIndex = currentStandardIndex
        if self.session === session {
            phaseTimeoutWorkItem?.cancel()
            phaseTimeoutWorkItem = nil
            self.session = nil
        }
        if wasTransition {
            phaseTransitionPending = false
        }
        stateLock.unlock()

        if alreadyFinished {
            log("post-completion invalidation observed", details: [
                "errorType": String(describing: type(of: error)),
            ])
            return
        }

        if wasTransition {
            log("standard transition invalidation observed", details: [
                "standardIndex": invalidatedStandardIndex,
                "errorType": String(describing: type(of: error)),
            ])
            scheduleNextStandard(after: invalidatedStandardIndex)
            return
        }

        let nsError = error as NSError
        log("reader session invalidated", details: [
            "standard": probeStandardName(at: invalidatedStandardIndex),
            "errorType": String(describing: type(of: error)),
            "domain": nsError.domain,
            "code": nsError.code,
        ])

        if shouldAdvanceAfterSessionError(error) {
            let standard = probeStandard(at: invalidatedStandardIndex)
            appendStandardAttempt([
                "standard": probeStandardName(at: invalidatedStandardIndex),
                "outcome": "session_error",
                "durationMs": currentStandardElapsedMs(),
                "nativePolling": standard?.nativePolling ?? "unknown",
                "aliases": standard?.aliases ?? [],
                "errorCategory": classifySessionError(error),
                "errorType": String(describing: type(of: error)),
            ])
            scheduleNextStandard(after: invalidatedStandardIndex)
            return
        }

        finishReject(
            code: classifySessionError(error),
            message: error.localizedDescription,
            error: error,
            invalidateMessage: nil
        )
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let standard = claimDetectedTags(for: session) else {
            log("stale tags ignored", details: ["count": tags.count])
            return
        }

        log("tags detected", details: [
            "standard": standard.name,
            "count": tags.count,
            "types": tags.map(describeTag),
            "nativePolling": standard.nativePolling,
        ])

        guard tags.count == 1, let tag = tags.first else {
            finishReject(
                code: "NID_NFC_MULTIPLE_TAGS",
                message: "Expected exactly one NFC tag.",
                error: nil,
                invalidateMessage: "Keep only one card near the phone."
            )
            return
        }

        var tagReport = buildTagReport(tag)
        updateDetectedTag(standard: standard.name, report: tagReport)

        Task {
            do {
                log("tag connect started", details: [
                    "standard": standard.name,
                    "type": describeTag(tag),
                ])
                try await session.connect(to: tag)
                log("tag connected", details: [
                    "standard": standard.name,
                    "type": describeTag(tag),
                ])

                switch standard.requirement {
                case .ndef:
                    let ndef = try await queryNdefStatus(tag)
                    tagReport["ndefSupported"] = ndef.status != .notSupported
                    tagReport["ndefStatus"] = describeNdefStatus(ndef.status)
                    tagReport["ndefCapacity"] = ndef.capacity
                    updateDetectedTag(standard: standard.name, report: tagReport)

                    guard ndef.status != .notSupported else {
                        transitionToNextStandard(
                            from: session,
                            report: buildStandardReport(
                                standard: standard,
                                outcome: "capability_mismatch",
                                tag: tag,
                                errorCategory: "NDEF_NOT_SUPPORTED"
                            )
                        )
                        return
                    }

                    appendStandardAttempt(
                        buildStandardReport(
                            standard: standard,
                            outcome: "detected",
                            tag: tag
                        )
                    )
                    finishResolve(
                        buildResult(
                            status: "probe_partial",
                            tag: tagReport,
                            selectedProfile: nil,
                            error: [
                                "category": "NFC_FORUM_TAG_DETECTED",
                                "message": "An NDEF-capable NFC Forum tag was detected.",
                            ]
                        ),
                        invalidateMessage: "NFC Forum tag detected."
                    )
                case .iso7816:
                    guard case let .iso7816(isoTag) = tag else {
                        transitionToNextStandard(
                            from: session,
                            report: buildStandardReport(
                                standard: standard,
                                outcome: "capability_mismatch",
                                tag: tag,
                                errorCategory: "ISO7816_NOT_SUPPORTED"
                            )
                        )
                        return
                    }
                    appendStandardAttempt(
                        buildStandardReport(
                            standard: standard,
                            outcome: "detected",
                            tag: tag
                        )
                    )
                    await runProbe(tag: tag, isoTag: isoTag)
                case .anyTag:
                    appendStandardAttempt(
                        buildStandardReport(
                            standard: standard,
                            outcome: "detected",
                            tag: tag
                        )
                    )
                    let result = buildResult(
                        status: "probe_partial",
                        tag: tagReport,
                        selectedProfile: nil,
                        error: [
                            "category": "UNSUPPORTED_TAG_TECHNOLOGY",
                            "message": "A tag was detected, but the current NID APDU probe supports ISO 7816 only.",
                        ]
                    )
                    finishResolve(result, invalidateMessage: "Tag detected. Technology recorded.")
                }
            } catch {
                let report = buildStandardReport(
                    standard: standard,
                    outcome: "connect_failed",
                    tag: tag,
                    errorCategory: classifyTransportError(error),
                    errorType: String(describing: type(of: error))
                )
                log("tag connect failed", details: report)
                transitionToNextStandard(from: session, report: report)
            }
        }
    }

    private func startProbeStandard(index: Int) {
        guard index < probeStandards.count else {
            let tagWasDetected = detectedStandardSnapshot() != nil
            finishResolve(
                buildResult(
                    status: tagWasDetected ? "probe_partial" : "probe_failed",
                    tag: lastTagReportSnapshot(),
                    selectedProfile: nil,
                    error: [
                        "category": tagWasDetected
                            ? "NO_COMPATIBLE_TAG_COMMUNICATION"
                            : "NO_COMPATIBLE_TAG_DETECTED",
                        "message": tagWasDetected
                            ? "An NFC tag was detected, but no compatible communication path completed."
                            : "No compatible NFC tag was detected during any 20-second polling phase.",
                    ]
                ),
                invalidateMessage: tagWasDetected
                    ? "Probe complete. Tag detected, but communication failed."
                    : "Probe complete. No compatible tag detected."
            )
            return
        }

        let standard = probeStandards[index]
        guard let readerSession = NFCTagReaderSession(
            pollingOption: standard.pollingOption,
            delegate: self,
            queue: nil
        ) else {
            appendStandardAttempt([
                "standard": standard.name,
                "outcome": "session_error",
                "durationMs": 0,
                "nativePolling": standard.nativePolling,
                "aliases": standard.aliases,
                "errorCategory": "SESSION_CREATION_FAILED",
                "errorType": "NFCTagReaderSession",
            ])
            log("standard session creation failed", details: [
                "standard": standard.name,
                "standardIndex": index,
            ])
            scheduleNextStandard(after: index)
            return
        }

        let timeoutWorkItem = DispatchWorkItem { [weak self, weak readerSession] in
            guard let self, let readerSession else {
                return
            }
            self.handleStandardTimeout(session: readerSession, index: index)
        }

        stateLock.lock()
        guard !didFinish, resolveBlock != nil, session == nil else {
            stateLock.unlock()
            return
        }
        currentStandardIndex = index
        currentStandardStartedAtMs = nowMs()
        currentStandardHandledTag = false
        phaseTransitionPending = false
        phaseTimeoutWorkItem?.cancel()
        phaseTimeoutWorkItem = timeoutWorkItem
        session = readerSession
        stateLock.unlock()

        readerSession.alertMessage =
            "Development NFC probe \(index + 1)/\(probeStandards.count): \(standard.name). " +
            "Hold the iPhone still against the card."
        log("standard phase started", details: [
            "standard": standard.name,
            "standardIndex": index,
            "timeoutMs": Int(probePhaseTimeoutMs),
            "nativePolling": standard.nativePolling,
            "aliases": standard.aliases,
        ])
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(Int(probePhaseTimeoutMs)),
            execute: timeoutWorkItem
        )
        readerSession.begin()
    }

    private func handleStandardTimeout(session readerSession: NFCTagReaderSession, index: Int) {
        stateLock.lock()
        guard !didFinish,
              session === readerSession,
              currentStandardIndex == index,
              !currentStandardHandledTag
        else {
            stateLock.unlock()
            return
        }
        currentStandardHandledTag = true
        phaseTransitionPending = true
        phaseTimeoutWorkItem = nil
        let durationMs = currentStandardElapsedMsLocked()
        stateLock.unlock()

        let standard = probeStandardName(at: index)
        appendStandardAttempt([
            "standard": standard,
            "outcome": "timed_out",
            "durationMs": durationMs,
            "nativePolling": probeStandard(at: index)?.nativePolling ?? "unknown",
            "aliases": probeStandard(at: index)?.aliases ?? [],
        ])
        log("standard phase timed out", details: [
            "standard": standard,
            "standardIndex": index,
            "durationMs": Int(durationMs),
        ])
        readerSession.invalidate()
    }

    private func transitionToNextStandard(
        from readerSession: NFCTagReaderSession,
        report: [String: Any]
    ) {
        stateLock.lock()
        guard !didFinish, session === readerSession else {
            stateLock.unlock()
            return
        }
        phaseTimeoutWorkItem?.cancel()
        phaseTimeoutWorkItem = nil
        currentStandardHandledTag = true
        phaseTransitionPending = true
        stateLock.unlock()

        appendStandardAttempt(report)
        readerSession.invalidate()
    }

    private func scheduleNextStandard(after index: Int) {
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(Int(standardTransitionDelayMs))
        ) {
            self.startProbeStandard(index: index + 1)
        }
    }

    private func claimDetectedTags(for readerSession: NFCTagReaderSession) -> ProbeStandard? {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !didFinish,
              session === readerSession,
              currentStandardIndex >= 0,
              currentStandardIndex < probeStandards.count,
              !currentStandardHandledTag
        else {
            return nil
        }
        currentStandardHandledTag = true
        phaseTimeoutWorkItem?.cancel()
        phaseTimeoutWorkItem = nil
        return probeStandards[currentStandardIndex]
    }

    private func standardForSession(_ readerSession: NFCTagReaderSession) -> ProbeStandard? {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard session === readerSession,
              currentStandardIndex >= 0,
              currentStandardIndex < probeStandards.count
        else {
            return nil
        }
        return probeStandards[currentStandardIndex]
    }

    private func updateDetectedTag(standard: String, report: [String: Any]) {
        stateLock.lock()
        detectedStandard = standard
        lastTagReport = report
        stateLock.unlock()
    }

    private func buildStandardReport(
        standard: ProbeStandard,
        outcome: String,
        tag: NFCTag,
        errorCategory: String? = nil,
        errorType: String? = nil
    ) -> [String: Any] {
        var report: [String: Any] = [
            "standard": standard.name,
            "outcome": outcome,
            "durationMs": currentStandardElapsedMs(),
            "detectedTechnologies": [describeTag(tag)],
            "nativePolling": standard.nativePolling,
            "aliases": standard.aliases,
        ]
        if let errorCategory {
            report["errorCategory"] = errorCategory
        }
        if let errorType {
            report["errorType"] = errorType
        }
        return report
    }

    private func queryNdefStatus(
        _ tag: NFCTag
    ) async throws -> (status: NFCNDEFStatus, capacity: Int) {
        let ndefTag: any NFCNDEFTag
        switch tag {
        case let .feliCa(value):
            ndefTag = value
        case let .iso7816(value):
            ndefTag = value
        case let .iso15693(value):
            ndefTag = value
        case let .miFare(value):
            ndefTag = value
        @unknown default:
            throw NidProbeError.unsupportedTag
        }

        return try await withCheckedThrowingContinuation { continuation in
            ndefTag.queryNDEFStatus { status, capacity, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: (status, capacity))
                }
            }
        }
    }

    private func describeNdefStatus(_ status: NFCNDEFStatus) -> String {
        switch status {
        case .notSupported: return "not_supported"
        case .readOnly: return "read_only"
        case .readWrite: return "read_write"
        @unknown default: return "unknown"
        }
    }

    private func shouldAdvanceAfterSessionError(_ error: Error) -> Bool {
        guard let nfcError = error as? NFCReaderError else {
            return true
        }
        return nfcError.code != .readerSessionInvalidationErrorUserCanceled &&
            nfcError.code != .readerSessionInvalidationErrorSystemIsBusy
    }

    private func runProbe(tag: NFCTag, isoTag: NFCISO7816Tag) async {
        var selectedProfile: String?
        var responseCount = 0

        do {
            profileLoop: for profile in profiles {
                log("profile started", details: ["profile": profile.name])
                var foundDer = false

                for command in profile.commands {
                    let result = try await transmit(
                        isoTag: isoTag,
                        profile: profile.name,
                        command: command
                    )
                    appendAttempt(result.report)
                    if result.hadResponse {
                        responseCount += 1
                    }
                    if result.looksLikeDer {
                        foundDer = true
                    }
                    if !result.accepted, !command.optional {
                        log("profile rejected", details: [
                            "profile": profile.name,
                            "command": command.name,
                        ])
                        continue profileLoop
                    }
                }

                if foundDer {
                    selectedProfile = profile.name
                    log("profile matched", details: ["profile": profile.name])
                    break
                }
                log("profile did not match", details: [
                    "profile": profile.name,
                    "looksLikeDer": foundDer,
                ])
            }

            let status: String
            if selectedProfile != nil {
                status = "probe_success"
            } else if responseCount > 0 {
                status = "probe_partial"
            } else {
                status = "probe_failed"
            }

            finishResolve(
                buildResult(
                    status: status,
                    tag: buildTagReport(tag),
                    selectedProfile: selectedProfile,
                    error: nil
                ),
                invalidateMessage: selectedProfile == nil
                    ? "Probe complete. No known card profile matched."
                    : "Probe complete."
            )
        } catch {
            log("probe transport failed", details: errorDetails(error))
            finishResolve(
                buildResult(
                    status: "probe_failed",
                    tag: buildTagReport(tag),
                    selectedProfile: selectedProfile,
                    error: [
                        "category": classifyTransportError(error),
                        "type": String(describing: type(of: error)),
                        "message": error.localizedDescription,
                    ]
                ),
                invalidateMessage: "NFC communication failed."
            )
        }
    }

    private func transmit(
        isoTag: NFCISO7816Tag,
        profile: String,
        command: ProbeCommand
    ) async throws -> CommandResult {
        let commandStartedAt = nowMs()
        log("APDU send", details: [
            "profile": profile,
            "command": command.name,
            "optional": command.optional,
            "byteLength": command.bytes.count,
        ])

        do {
            var bytes = command.bytes
            var response = try await send(isoTag: isoTag, bytes: bytes)

            if response.statusWord.hasPrefix("6C"), command.canRetryWrongLength,
               let correctedLength = UInt8(response.statusWord.suffix(2), radix: 16)
            {
                bytes[bytes.count - 1] = correctedLength
                log("APDU retry wrong length", details: [
                    "profile": profile,
                    "command": command.name,
                    "correctedLength": Int(correctedLength),
                ])
                response = try await send(isoTag: isoTag, bytes: bytes)
            }

            var data = response.data
            var continuationCount = 0
            while response.statusWord.hasPrefix("61"),
                  continuationCount < maxGetResponseCount,
                  let expectedLength = UInt8(response.statusWord.suffix(2), radix: 16)
            {
                response = try await send(
                    isoTag: isoTag,
                    bytes: [0x00, 0xC0, 0x00, 0x00, expectedLength]
                )
                data.append(response.data)
                continuationCount += 1
            }

            let accepted = isAcceptedStatus(response.statusWord)
            let warning = response.statusWord.hasPrefix("62") || response.statusWord.hasPrefix("63")
            let looksLikeDer = command.checkDer && data.first == 0x30
            let duration = max(nowMs() - commandStartedAt, 0)
            let outcome = accepted ? (warning ? "warning" : "ok") : "rejected"

            var report: [String: Any] = [
                "profile": profile,
                "command": command.name,
                "outcome": outcome,
                "durationMs": duration,
                "optional": command.optional,
                "responseLength": data.count,
                "statusWord": response.statusWord,
            ]
            if command.checkDer {
                report["looksLikeDer"] = looksLikeDer
            }
            log("APDU result", details: report)
            return CommandResult(
                accepted: accepted,
                hadResponse: true,
                looksLikeDer: looksLikeDer,
                report: report
            )
        } catch {
            let report: [String: Any] = [
                "profile": profile,
                "command": command.name,
                "outcome": "transport_error",
                "durationMs": max(nowMs() - commandStartedAt, 0),
                "optional": command.optional,
                "errorCategory": classifyTransportError(error),
                "errorType": String(describing: type(of: error)),
            ]
            appendAttempt(report)
            log("APDU transport error", details: report)
            throw error
        }
    }

    private func send(
        isoTag: NFCISO7816Tag,
        bytes: [UInt8]
    ) async throws -> (data: Data, statusWord: String) {
        guard let apdu = NFCISO7816APDU(data: Data(bytes)) else {
            throw NidProbeError.invalidApdu
        }
        let (data, sw1, sw2) = try await isoTag.sendCommand(apdu: apdu)
        return (data, String(format: "%02X%02X", sw1, sw2))
    }

    private func buildTagReport(_ tag: NFCTag) -> [String: Any] {
        var report: [String: Any] = [
            "technologies": [describeTag(tag)],
            "isoDepSupported": false,
        ]

        if case let .iso7816(isoTag) = tag {
            report["isoDepSupported"] = true
            report["historicalBytesLength"] = isoTag.historicalBytes?.count ?? 0
            report["applicationDataLength"] = isoTag.applicationData?.count ?? 0
            report["initialSelectedAidLength"] = isoTag.initialSelectedAID.utf8.count
        }
        return report
    }

    private func buildResult(
        status: String,
        tag: [String: Any],
        selectedProfile: String?,
        error: [String: Any]?
    ) -> [String: Any] {
        var result: [String: Any] = [
            "status": status,
            "platform": "ios",
            "sessionId": currentSessionId() ?? "unknown",
            "durationMs": elapsedMs(),
            "tag": tag,
            "attempts": snapshotAttempts(),
            "standardAttempts": snapshotStandardAttempts(),
        ]
        if let detectedStandard = detectedStandardSnapshot() {
            result["detectedStandard"] = detectedStandard
        }
        if let selectedProfile {
            result["selectedProfile"] = selectedProfile
        }
        if let error {
            result["error"] = error
        }
        return result
    }

    private func finishResolve(
        _ result: [String: Any],
        invalidateMessage: String
    ) {
        stateLock.lock()
        guard !didFinish else {
            stateLock.unlock()
            return
        }
        didFinish = true
        let resolve = resolveBlock
        let activeSession = session
        phaseTimeoutWorkItem?.cancel()
        phaseTimeoutWorkItem = nil
        resolveBlock = nil
        rejectBlock = nil
        stateLock.unlock()

        log("probe completed", details: [
            "status": result["status"] ?? "unknown",
            "durationMs": result["durationMs"] ?? 0,
        ])
        resolve?(result)
        activeSession?.alertMessage = invalidateMessage
        activeSession?.invalidate()
    }

    private func finishReject(
        code: String,
        message: String,
        error: Error?,
        invalidateMessage: String?
    ) {
        stateLock.lock()
        guard !didFinish else {
            stateLock.unlock()
            return
        }
        didFinish = true
        let reject = rejectBlock
        let activeSession = session
        phaseTimeoutWorkItem?.cancel()
        phaseTimeoutWorkItem = nil
        resolveBlock = nil
        rejectBlock = nil
        stateLock.unlock()

        log("probe failed", details: [
            "code": code,
            "message": message,
            "durationMs": elapsedMs(),
        ])
        reject?(code, message, error)
        if let invalidateMessage {
            activeSession?.invalidate(errorMessage: invalidateMessage)
        } else {
            activeSession?.invalidate()
        }
    }

    private func appendAttempt(_ attempt: [String: Any]) {
        stateLock.lock()
        attempts.append(attempt)
        stateLock.unlock()
    }

    private func snapshotAttempts() -> [[String: Any]] {
        stateLock.lock()
        defer { stateLock.unlock() }
        return attempts
    }

    private func appendStandardAttempt(_ attempt: [String: Any]) {
        stateLock.lock()
        standardAttempts.append(attempt)
        stateLock.unlock()
    }

    private func snapshotStandardAttempts() -> [[String: Any]] {
        stateLock.lock()
        defer { stateLock.unlock() }
        return standardAttempts
    }

    private func detectedStandardSnapshot() -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return detectedStandard
    }

    private func lastTagReportSnapshot() -> [String: Any] {
        stateLock.lock()
        defer { stateLock.unlock() }
        return lastTagReport
    }

    private func currentSessionId() -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return sessionId
    }

    private func currentStandardIndexSnapshot() -> Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return currentStandardIndex
    }

    private func currentStandardElapsedMs() -> Double {
        stateLock.lock()
        defer { stateLock.unlock() }
        return currentStandardElapsedMsLocked()
    }

    private func currentStandardElapsedMsLocked() -> Double {
        currentStandardStartedAtMs > 0 ? max(nowMs() - currentStandardStartedAtMs, 0) : 0
    }

    private func probeStandardName(at index: Int) -> String {
        probeStandard(at: index)?.name ?? "unknown"
    }

    private func probeStandard(at index: Int) -> ProbeStandard? {
        guard index >= 0, index < probeStandards.count else {
            return nil
        }
        return probeStandards[index]
    }

    private func elapsedMs() -> Double {
        stateLock.lock()
        let start = startedAtMs
        stateLock.unlock()
        return start > 0 ? max(nowMs() - start, 0) : 0
    }

    private func describeTag(_ tag: NFCTag) -> String {
        switch tag {
        case .iso7816: return "iso7816"
        case .miFare: return "miFare"
        case .iso15693: return "iso15693"
        case .feliCa: return "feliCa"
        @unknown default: return "unknown"
        }
    }

    private func isAcceptedStatus(_ statusWord: String) -> Bool {
        statusWord == "9000" ||
            statusWord.hasPrefix("61") ||
            statusWord.hasPrefix("62") ||
            statusWord.hasPrefix("63")
    }

    private func classifySessionError(_ error: Error) -> String {
        guard let nfcError = error as? NFCReaderError else {
            return "NID_NFC_SESSION_FAILED"
        }
        switch nfcError.code {
        case .readerSessionInvalidationErrorUserCanceled:
            return "NID_NFC_USER_CANCELLED"
        case .readerSessionInvalidationErrorSessionTimeout:
            return "NID_NFC_PROBE_TIMEOUT"
        case .readerSessionInvalidationErrorSystemIsBusy:
            return "NID_NFC_SESSION_BUSY"
        default:
            return "NID_NFC_SESSION_FAILED"
        }
    }

    private func classifyTransportError(_ error: Error) -> String {
        let nsError = error as NSError
        let message = error.localizedDescription.lowercased()
        if message.contains("tag") && message.contains("lost") {
            return "TAG_LOST"
        }
        if message.contains("timeout") {
            return "TRANSCEIVE_TIMEOUT"
        }
        if nsError.domain == NFCErrorDomain {
            return "TRANSCEIVE_NFC_ERROR"
        }
        return "TRANSCEIVE_ERROR"
    }

    private func errorDetails(_ error: Error) -> [String: Any] {
        let nsError = error as NSError
        return [
            "errorCategory": classifyTransportError(error),
            "errorType": String(describing: type(of: error)),
            "domain": nsError.domain,
            "code": nsError.code,
            "message": error.localizedDescription,
        ]
    }

    private func log(_ event: String, details: [String: Any] = [:]) {
        var parts = [
            "event=\(event)",
            "sessionId=\(currentSessionId() ?? "none")",
            "elapsedMs=\(Int(elapsedMs()))",
        ]
        for key in details.keys.sorted() {
            parts.append("\(key)=\(String(describing: details[key]!))")
        }
        NSLog("[NidVerificationModule] %@", parts.joined(separator: "; "))
    }

    private var profiles: [ProbeProfile] {
        [
            ProbeProfile(
                name: "pardis-signing",
                commands: [
                    ProbeCommand("select_pardis_app", "00A404000F5041524449532C4D41544952414E20"),
                    ProbeCommand("select_df_5100", "00A40000025100"),
                    ProbeCommand("select_ef_5040", "00A40200025040"),
                    ProbeCommand(
                        "read_certificate_header",
                        "00B0000004",
                        checkDer: true,
                        canRetryWrongLength: true
                    ),
                ]
            ),
            ProbeProfile(
                name: "mav4-signing",
                commands: [
                    ProbeCommand("select_card_manager", "00A4040008A000000018434D00"),
                    ProbeCommand("read_cplc", "80CA9F7F2D", optional: true),
                    ProbeCommand("select_ias_app", "00A404000CA0000000180C000001634200"),
                    ProbeCommand("select_mf", "00A40000023F00"),
                    ProbeCommand("select_df_5100", "00A40000025100"),
                    ProbeCommand("select_ef_5040", "00A4020C025040"),
                    ProbeCommand(
                        "read_certificate_header",
                        "00B0000004",
                        checkDer: true,
                        canRetryWrongLength: true
                    ),
                ]
            ),
            ProbeProfile(
                name: "mav4-authentication",
                commands: [
                    ProbeCommand("select_ias_app", "00A404000CA0000000180C000001634200"),
                    ProbeCommand("select_card_manager", "00A4040008A000000018434D00"),
                    ProbeCommand("read_cplc", "80CA9F7F2D", optional: true),
                    ProbeCommand("reselect_ias_app", "00A404000CA0000000180C000001634200"),
                    ProbeCommand("select_mf", "00A40000023F00"),
                    ProbeCommand("select_df_5000", "00A40000025000"),
                    ProbeCommand("select_ef_5040", "00A4020C025040"),
                    ProbeCommand("select_ef_0303", "00A4020C020303"),
                    ProbeCommand(
                        "read_certificate_header",
                        "00B0000004",
                        checkDer: true,
                        canRetryWrongLength: true
                    ),
                ]
            ),
        ]
    }

    private var probeStandards: [ProbeStandard] {
        [
            ProbeStandard(
                name: "nfc-forum-tags",
                pollingOption: [.iso14443, .iso15693, .iso18092],
                nativePolling: "iso14443|iso15693|iso18092",
                aliases: ["NFC Forum Type 1-5"],
                requirement: .ndef
            ),
            ProbeStandard(
                name: "iso-dep-iso7816",
                pollingOption: [.iso14443],
                nativePolling: "iso14443",
                aliases: ["ISO-DEP", "ISO 7816 over NFC"],
                requirement: .iso7816
            ),
            ProbeStandard(
                name: "iso14443-a-b",
                pollingOption: [.iso14443],
                nativePolling: "iso14443",
                aliases: ["ISO 14443-A", "ISO 14443-B"],
                requirement: .anyTag
            ),
            ProbeStandard(
                name: "iso15693",
                pollingOption: [.iso15693],
                nativePolling: "iso15693",
                aliases: ["ISO 15693", "NFC-V"],
                requirement: .anyTag
            ),
            ProbeStandard(
                name: "iso18092-felica",
                pollingOption: [.iso18092],
                nativePolling: "iso18092",
                aliases: ["ISO 18092", "FeliCa", "NFC-F"],
                requirement: .anyTag
            ),
        ]
    }

    private static func hexBytes(_ hex: String) -> [UInt8] {
        stride(from: 0, to: hex.count, by: 2).compactMap { offset in
            let start = hex.index(hex.startIndex, offsetBy: offset)
            let end = hex.index(start, offsetBy: 2)
            return UInt8(hex[start ..< end], radix: 16)
        }
    }

    private var isDebugBuild: Bool {
        #if DEBUG
            return true
        #else
            return false
        #endif
    }

    private func nowMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    private let maxGetResponseCount = 4
    private let probePhaseTimeoutMs = 20_000.0
    private let standardTransitionDelayMs = 300.0
    private let diagnosticDetailKeys = [
        "stage",
        "profile",
        "command",
        "statusWord",
        "responseLength",
        "durationMs",
        "offset",
        "requestedLength",
        "chunkCount",
        "certificateLength",
        "hasSigningCertificate",
        "hasAuthenticationCertificate",
        "errorCategory",
        "errorType",
    ]
}

private enum NidProbeError: LocalizedError {
    case invalidApdu
    case unsupportedTag

    var errorDescription: String? {
        switch self {
        case .invalidApdu:
            return "The diagnostic APDU could not be constructed."
        case .unsupportedTag:
            return "The detected tag cannot be queried for NDEF support."
        }
    }
}
