import CoreNFC
import Foundation
import NFCPassportReader

private struct PassportVerificationAccessControlState {
    var usedMethod: AccessControlMethod?
    var fallbackUsed = false
    var fallbackReason: String?
    var paceStatus = "notDone"
    var bacStatus = "notDone"
    var paceSupported = false
    var accessControlError: [String: Any]?

    mutating func merge(_ attempt: ReadAttemptResult) {
        if usedMethod == nil, let method = attempt.usedMethod {
            usedMethod = method
        }
        if attempt.fallbackUsed {
            fallbackUsed = true
        }
        if fallbackReason == nil, let reason = attempt.fallbackReason {
            fallbackReason = reason
        }
        if let passport = attempt.passport {
            paceStatus = PassportVerificationResultMapper.authStatusString(passport.PACEStatus)
            bacStatus = PassportVerificationResultMapper.authStatusString(passport.BACStatus)
            paceSupported = paceSupported || passport.isPACESupported
        }
        if let error = attempt.error {
            accessControlError = PassportVerificationErrorMapper.errorInfo(error)
        }
    }
}

private struct PassportVerificationReadAccumulator {
    var files: [String: Any] = [:]
    var successfulFileCount = 0
    var firstFailure: Error?

    mutating func recordGroupEntry(
        _ entry: [String: Any],
        for group: RequestedDataGroup,
        errorCandidate: Error? = nil
    ) {
        files[group.responseKey] = entry
        if PassportVerificationResultMapper.fileStatus(entry) == "ok" {
            successfulFileCount += 1
        } else if firstFailure == nil {
            firstFailure = errorCandidate
        }
    }

    mutating func recordGroupError(_ error: Error, for group: RequestedDataGroup) {
        if firstFailure == nil {
            firstFailure = error
        }
        files[group.responseKey] = PassportVerificationResultMapper.errorFileEntry(group: group, error: error)
    }

    mutating func recordFirstFailureIfNeeded(_ error: Error) {
        if firstFailure == nil {
            firstFailure = error
        }
    }
}

private struct PassportVerificationActiveAuthenticationState {
    let challengeHex: String
    var supported = false
    var performed = false
    var passed = false
    var signatureHex: String?

    mutating func merge(passport: NFCPassportModel?) {
        guard let passport = passport else {
            return
        }

        supported = supported || passport.activeAuthenticationSupported

        let signature = passport.activeAuthenticationSignature
        if !signature.isEmpty {
            performed = true
            passed = passed || passport.activeAuthenticationPassed
            if signatureHex == nil {
                signatureHex = signature.map { String(format: "%02X", $0) }.joined()
            }
        }
    }

    var payload: [String: Any] {
        let status: String
        if !supported {
            status = "not_supported"
        } else if !performed {
            status = "not_performed"
        } else if passed {
            status = "passed"
        } else {
            status = "failed"
        }

        return [
            "requested": true,
            "status": status,
            "supported": supported,
            "performed": performed,
            "passed": passed,
            "challenge": challengeHex,
            "signature": signatureHex ?? NSNull(),
        ]
    }
}

@available(iOS 15.0, *)
private struct ReadPassportOnceResult {
    var passport: NFCPassportModel?
    var error: Error?
    var readerSnapshot: PassportReaderDebugSnapshot?
}

@available(iOS 15.0, *)
private struct PassportProbeAttempt {
    let method: AccessControlMethod
    let startedAtMs: Double
    var completedAtMs: Double?
    var passport: NFCPassportModel?
    var error: Error?
    var readerSnapshot: PassportReaderDebugSnapshot?
}

final class PassportVerificationSessionManager {
    private let lock = NSLock()
    private var isReading = false
    private var activeCancelAction: (() -> Void)?
    private var cancelRequested = false
    private var currentAttemptId: String?
    private var activeReader: PassportReader?

    func readPassport(input: [String: Any], attemptId: String? = nil) async throws -> [String: Any] {
        setCurrentAttemptId(attemptId)
        logSession(event: "readPassport started")
        validateAndLogSessionState(context: "readPassport entry")
        try beginRead()
        logSession(event: "session began, isReading=true")
        defer {
            endRead()
            validateAndLogSessionState(context: "readPassport exit after endRead")
            logSession(event: "session ended, isReading=false")
        }

        guard #available(iOS 15.0, *) else {
            throw PassportBridgeError.unsupportedPlatform
        }

        let configuration = try PassportVerificationInputValidator.configuration(from: input)
        var accessControl = PassportVerificationAccessControlState()
        var accumulator = PassportVerificationReadAccumulator()
        var activeAuthentication = configuration.activeAuthenticationChallengeHex.map {
            PassportVerificationActiveAuthenticationState(challengeHex: $0)
        }
        try ensureNotCanceled()

        logSession(event: "attempting unified read of all data groups")
        let allAttempt = await readAttempt(
            mrzKey: configuration.mrzKey,
            preferredMethod: configuration.preferredMethod,
            allowBacFallback: configuration.allowBacFallback,
            aaChallenge: configuration.activeAuthenticationChallenge,
            tags: PassportVerificationInputValidator.tagsToRead(
                for: configuration.requestedGroups,
                includeActiveAuthenticationSupport: configuration.activeAuthenticationChallenge != nil
            )
        )
        logSession(event: "unified read completed", details: [
            "passport": allAttempt.passport != nil ? "success" : "nil",
            "error": allAttempt.error != nil ? String(describing: type(of: allAttempt.error!)) : "none"
        ])
        accessControl.merge(allAttempt)
        activeAuthentication?.merge(passport: allAttempt.passport)
        try throwIfCanceled(error: allAttempt.error)

        if let passport = allAttempt.passport {
            for group in configuration.requestedGroups {
                let entry = PassportVerificationResultMapper.fileEntry(
                    for: group,
                    passport: passport,
                    includeImageBase64: configuration.includeImageBase64,
                    persistDg2ImageFile: configuration.persistDg2ImageFile
                )
                accumulator.recordGroupEntry(entry, for: group)
            }
        } else {
            if let error = allAttempt.error {
                accumulator.recordFirstFailureIfNeeded(error)
                let fallbackDecision = shouldSkipPerGroupFallback(
                    error: error,
                    snapshot: allAttempt.readerSnapshot
                )
                var details = PassportVerificationErrorMapper.errorDebugDetails(error)
                details["skipPerGroupFallback"] = fallbackDecision.skip
                details["fallbackAllowed"] = !fallbackDecision.skip
                details["reason"] = fallbackDecision.reason
                details["sessionBecameActive"] = allAttempt.readerSnapshot?.sessionDidBecomeActive ?? NSNull()
                details["didDetectTag"] = allAttempt.readerSnapshot?.tagDetected ?? NSNull()
                if let snapshot = allAttempt.readerSnapshot {
                    details.merge(normalReadTimingDetails(snapshot: snapshot)) { _, new in new }
                }
                logSession(event: "unified read failed", details: details)
                logSession(event: "fallback decision", details: [
                    "skipPerGroupFallback": fallbackDecision.skip,
                    "reason": fallbackDecision.reason,
                    "sessionBecameActive": allAttempt.readerSnapshot?.sessionDidBecomeActive ?? NSNull(),
                    "didDetectTag": allAttempt.readerSnapshot?.tagDetected ?? NSNull(),
                ])

                if fallbackDecision.skip {
                    logNormalReadSummary(
                        status: "failed",
                        attempt: allAttempt,
                        files: summarizeFiles(accumulator.files),
                        method: accessControl.usedMethod?.rawValue
                    )
                    if let bridgeError = error as? PassportBridgeError,
                       case .nfcTagNotDetected = bridgeError
                    {
                        logSession(event: "skipping per-group fallback after NFC_TAG_NOT_DETECTED")
                    } else {
                        logSession(event: "skipping per-group fallback after terminal NFC attempt error")
                    }
                    throw error
                }
            }

            logSession(event: "unified read did not return passport, attempting per-group reads")
            for group in configuration.requestedGroups {
                try ensureNotCanceled()
                logSession(event: "reading data group", details: ["group": group.rawValue])
                let perGroupAttempt = await readAttempt(
                    mrzKey: configuration.mrzKey,
                    preferredMethod: configuration.preferredMethod,
                    allowBacFallback: configuration.allowBacFallback,
                    aaChallenge: configuration.activeAuthenticationChallenge,
                    tags: PassportVerificationInputValidator.tagsToRead(
                        for: [group],
                        includeActiveAuthenticationSupport: configuration.activeAuthenticationChallenge != nil
                    )
                )
                accessControl.merge(perGroupAttempt)
                activeAuthentication?.merge(passport: perGroupAttempt.passport)
                try throwIfCanceled(error: perGroupAttempt.error)

                if let passport = perGroupAttempt.passport {
                    let entry = PassportVerificationResultMapper.fileEntry(
                        for: group,
                        passport: passport,
                        includeImageBase64: configuration.includeImageBase64,
                        persistDg2ImageFile: configuration.persistDg2ImageFile
                    )
                    accumulator.recordGroupEntry(
                        entry,
                        for: group,
                        errorCandidate: perGroupAttempt.error
                    )
                } else {
                    let error = perGroupAttempt.error ?? PassportBridgeError.noDataRead
                    accumulator.recordGroupError(error, for: group)
                }
            }
        }

        var result = PassportVerificationResultMapper.buildResult(
            preferredMethod: configuration.preferredMethod,
            usedMethod: accessControl.usedMethod,
            fallbackUsed: accessControl.fallbackUsed,
            fallbackReason: accessControl.fallbackReason,
            paceStatus: accessControl.paceStatus,
            bacStatus: accessControl.bacStatus,
            paceSupported: accessControl.paceSupported,
            accessControlError: accessControl.accessControlError,
            activeAuthentication: activeAuthentication?.payload,
            files: accumulator.files
        )
        if let snapshot = allAttempt.readerSnapshot {
            let sessionStartMs = snapshot.sessionBeginRequestedAtMs ?? snapshot.sessionStartedAtMs
            let timeToActiveMs = durationFrom(sessionStartMs, snapshot.sessionBecameActiveAtMs)
            let timeToDetectMs = durationFrom(sessionStartMs, snapshot.tagDetectedAtMs)
            let timeToConnectMs = durationFrom(snapshot.tagDetectedAtMs, snapshot.tagConnectedAtMs)
            let timeToBacSuccessMs = durationFrom(snapshot.bacStartedAtMs, snapshot.bacSucceededAtMs)
            let timeToFirstFileMs = durationFrom(sessionStartMs, snapshot.firstFileReadAtMs)
            let totalReadMs = durationFrom(sessionStartMs, snapshot.readCompletedAtMs)

            let session: [String: Any] = [
                "sessionCreated": snapshot.sessionCreated,
                "beginRequested": snapshot.sessionBeginRequested,
                "didBecomeActive": snapshot.sessionDidBecomeActive,
                "didDetectTag": snapshot.tagDetected,
                "preActiveFailureCode": snapshot.preActiveFailureCode ?? NSNull(),
            ]
            result["session"] = session
            var timing: [String: Any] = [:]
            timing["timeToActiveMs"] = timeToActiveMs ?? NSNull()
            timing["timeToDetectMs"] = timeToDetectMs ?? NSNull()
            timing["timeToConnectMs"] = timeToConnectMs ?? NSNull()
            timing["timeToBacSuccessMs"] = timeToBacSuccessMs ?? NSNull()
            timing["timeToFirstFileMs"] = timeToFirstFileMs ?? NSNull()
            timing["totalReadMs"] = totalReadMs ?? NSNull()
            result["timing"] = timing
        }

        if accumulator.successfulFileCount == 0 {
            let failure = accumulator.firstFailure ?? PassportBridgeError.noDataRead
            logNormalReadSummary(
                status: "failed",
                attempt: ReadAttemptResult(
                    preferredMethod: configuration.preferredMethod,
                    usedMethod: accessControl.usedMethod,
                    fallbackUsed: accessControl.fallbackUsed,
                    fallbackReason: accessControl.fallbackReason,
                    passport: nil,
                    error: failure,
                    readerSnapshot: allAttempt.readerSnapshot
                ),
                files: summarizeFiles(accumulator.files),
                method: accessControl.usedMethod?.rawValue
            )
            throw attachAttemptDiagnostics(error: failure, snapshot: allAttempt.readerSnapshot)
        }

        logNormalReadSummary(
            status: result["finalStatus"] as? String ?? "success",
            attempt: allAttempt,
            files: summarizeFiles(accumulator.files),
            method: result["method"] as? String
        )

        return result
    }

    func disconnect() {
        let cancelAction: (() -> Void)?
        let reader: PassportReader?
        lock.lock()
        guard isReading else {
            lock.unlock()
            logSession(event: "disconnect called but session not active")
            return
        }
        cancelRequested = true
        cancelAction = activeCancelAction
        reader = activeReader
        lock.unlock()

        logSession(event: "disconnect: calling cancel on reader and cancelAction")
        cancelAction?()
        reader?.cancel()
        validateAndLogSessionState(context: "after disconnect")
    }

    @available(iOS 15.0, *)
    func probeRawNfcTag(input: [String: Any], attemptId: String? = nil) async throws -> [String: Any] {
        setCurrentAttemptId(attemptId)
        logSession(event: "[RawNFCProbe] started")
        validateAndLogSessionState(context: "probeRawNfcTag entry")
        try beginRead()
        defer {
            endRead()
            validateAndLogSessionState(context: "probeRawNfcTag exit after endRead")
            logSession(event: "[RawNFCProbe] completed")
        }

        let configuration = PassportVerificationInputValidator.rawProbeConfiguration(from: input)

        let probeSession = RawNfcProbeSession(
            configuration: configuration,
            logger: { [weak self] event, details in
                self?.logSession(event: event, details: details)
            }
        )
        setActiveCancelAction {
            probeSession.cancel()
        }
        defer {
            clearActiveCancelAction()
        }

        let result = await probeSession.run()
        if let summary = result["summary"] as? [String: Any] {
            logSession(event: "[RawNFCProbe] result", details: summary)
        }
        return result
    }

    @available(iOS 15.0, *)
    func probePassportChip(input: [String: Any], attemptId: String? = nil) async throws -> [String: Any] {
        setCurrentAttemptId(attemptId)
        logSession(event: "[NFCProbe] probePassportChip started")
        validateAndLogSessionState(context: "probePassportChip entry")
        try beginRead()
        defer {
            endRead()
            validateAndLogSessionState(context: "probePassportChip exit after endRead")
            logSession(event: "[NFCProbe] probePassportChip completed")
        }

        let configuration = try PassportVerificationInputValidator.probeConfiguration(from: input)
        let readConfiguration = configuration.readConfiguration

        var probeTags: [DataGroupId] = []
        if configuration.includeComProbe {
            probeTags.append(.COM)
        }
        if configuration.includeMinimalApduProbe && !probeTags.contains(.SOD) {
            probeTags.append(.SOD)
        }
        if probeTags.isEmpty {
            probeTags = [.COM]
        }

        var attempts: [PassportProbeAttempt] = []
        let preferredMethod = readConfiguration.preferredMethod

        let preferredAttempt = await runProbeAttempt(
            method: preferredMethod,
            mrzKey: readConfiguration.mrzKey,
            tags: probeTags
        )
        attempts.append(preferredAttempt)

        let preferredFatal = preferredAttempt.error.map { PassportVerificationErrorMapper.isFatalSessionError($0) } ?? false
        if configuration.allowPaceProbe && preferredMethod != .pace && !preferredFatal {
            let paceAttempt = await runProbeAttempt(
                method: .pace,
                mrzKey: readConfiguration.mrzKey,
                tags: probeTags
            )
            attempts.append(paceAttempt)
        }

        let bacAttempt = attempts.first(where: { $0.method == .bac })
        let paceAttempt = attempts.first(where: { $0.method == .pace })
        let bestAttempt = attempts.first(where: { $0.passport != nil }) ?? attempts.first
        let passport = bestAttempt?.passport
        let snapshot = bestAttempt?.readerSnapshot ?? attempts.first?.readerSnapshot

        let cardAccessEntry: [String: Any]
        if configuration.includeCardAccessProbe {
            cardAccessEntry = buildProbeCardAccessEntry(passport: passport, error: bestAttempt?.error)
        } else {
            cardAccessEntry = ["attempted": false, "status": "not_attempted"]
        }

        let comEntry: [String: Any]
        if configuration.includeComProbe {
            comEntry = buildProbeComEntry(passport: passport, error: bestAttempt?.error)
        } else {
            comEntry = ["attempted": false, "status": "not_attempted"]
        }

        let totalMs = (attempts.last?.completedAtMs ?? currentEpochMs()) - (attempts.first?.startedAtMs ?? currentEpochMs())
        let didBecomeActive = snapshot?.sessionDidBecomeActive ?? false
        let timeToActiveMs = durationFrom(snapshot?.sessionStartedAtMs, snapshot?.sessionBecameActiveAtMs)
        let timeToTagDetectedMs = durationFrom(snapshot?.sessionStartedAtMs, snapshot?.tagDetectedAtMs)

        let chip: [String: Any] = [
            "tagType": snapshot?.tagType ?? NSNull(),
            "technologyDescription": snapshot?.supportsIso7816 == true ? "ISO7816 (ISO14443)" : "unknown",
            "iso7816Identifier": snapshot?.iso7816IdentifierHex ?? NSNull(),
            "historicalBytesHex": configuration.includeHistoricalBytes ? (snapshot?.historicalBytesHex ?? NSNull()) : NSNull(),
            "applicationDataHex": configuration.includeAtr ? (snapshot?.applicationDataHex ?? NSNull()) : NSNull(),
            "initialSelectedAid": snapshot?.initialSelectedAidHex ?? NSNull(),
            "supportsIso7816": snapshot?.supportsIso7816 ?? false,
            "supportsIso14443": snapshot?.supportsIso14443 ?? false,
        ]

        let session: [String: Any] = [
            "didBecomeActive": didBecomeActive,
            "invalidatedBeforeActive": snapshot?.sessionInvalidatedBeforeActive ?? false,
            "invalidatedAfterActive": snapshot?.sessionInvalidatedAfterActive ?? false,
            "invalidationErrorDomain": snapshot?.invalidationErrorDomain ?? NSNull(),
            "invalidationErrorCode": snapshot?.invalidationErrorCode ?? NSNull(),
            "invalidationErrorMessage": snapshot?.invalidationErrorMessage ?? NSNull(),
        ]

        let bacErrorInfo = bacAttempt?.error.map { PassportVerificationErrorMapper.errorInfo($0) }
        let paceErrorInfo = paceAttempt?.error.map { PassportVerificationErrorMapper.errorInfo($0) }

        let access: [String: Any] = [
            "bacAttempted": bacAttempt != nil,
            "bacResult": probeAttemptResultString(bacAttempt),
            "bacErrorDomain": (bacAttempt?.error as NSError?)?.domain ?? NSNull(),
            "bacErrorCode": (bacAttempt?.error as NSError?)?.code ?? NSNull(),
            "bacErrorMessage": bacErrorInfo?["message"] ?? NSNull(),
            "paceAttempted": paceAttempt != nil,
            "paceResult": probeAttemptResultString(paceAttempt),
            "paceErrorDomain": (paceAttempt?.error as NSError?)?.domain ?? NSNull(),
            "paceErrorCode": (paceAttempt?.error as NSError?)?.code ?? NSNull(),
            "paceErrorMessage": paceErrorInfo?["message"] ?? NSNull(),
        ]

        let timing: [String: Any] = [
            "sessionStartMs": snapshot?.sessionStartedAtMs ?? NSNull(),
            "timeToActiveMs": timeToActiveMs ?? NSNull(),
            "timeToTagDetectedMs": timeToTagDetectedMs ?? NSNull(),
            "bacAttemptMs": probeAttemptDurationMs(bacAttempt) ?? NSNull(),
            "paceAttemptMs": probeAttemptDurationMs(paceAttempt) ?? NSNull(),
            "totalMs": max(totalMs, 0),
        ]

        let rawErrors = attempts.compactMap { attempt -> [String: Any]? in
            guard let error = attempt.error else { return nil }
            var details = PassportVerificationErrorMapper.errorDebugDetails(error)
            details["accessMethod"] = attempt.method.rawValue
            let becameActive = attempt.readerSnapshot?.sessionDidBecomeActive ?? false
            let tagDetected = attempt.readerSnapshot?.tagDetected ?? false
            let phase: String = becameActive ? (tagDetected ? "access_control" : "session_active") : "session_start"
            details["phase"] = phase
            details["sessionBecameActive"] = becameActive
            details["tagDetected"] = tagDetected
            return details
        }

        let finalStatus: String
        if attempts.contains(where: { $0.passport != nil }) {
            finalStatus = rawErrors.isEmpty ? "probe_success" : "probe_partial"
        } else {
            finalStatus = "probe_failed"
        }

        let result: [String: Any] = [
            "finalStatus": finalStatus,
            "chip": chip,
            "session": session,
            "access": access,
            "files": [
                "cardAccess": cardAccessEntry,
                "com": comEntry,
            ],
            "timing": timing,
            "rawErrors": rawErrors,
        ]

        logSession(event: "[NFCProbe] result", details: [
            "finalStatus": finalStatus,
            "tagType": chip["tagType"] ?? "unknown",
            "bacResult": access["bacResult"] ?? "not_attempted",
            "paceResult": access["paceResult"] ?? "not_attempted",
            "cardAccessStatus": cardAccessEntry["status"] ?? "not_attempted",
            "comStatus": comEntry["status"] ?? "not_attempted",
            "invalidatedAfterActive": session["invalidatedAfterActive"] ?? false,
        ])

        return result
    }

    private func beginRead() throws {
        lock.lock()
        defer { lock.unlock() }

        if isReading {
            logSession(event: "beginRead rejected: session already active", details: [
                "isReading": true,
                "hasActiveReader": activeReader != nil
            ])
            throw PassportBridgeError.nfcSessionBusy
        }

        // Initialize clean state for new session
        isReading = true
        activeCancelAction = nil
        cancelRequested = false
        activeReader = nil

        logSession(event: "beginRead: session initialized with clean state", details: [
            "isReading": true,
            "activeReaderNil": true
        ])
    }

    private func endRead() {
        lock.lock()
        defer { lock.unlock() }

        guard isReading else {
            logSession(event: "endRead called but session not active", details: ["isReading": false])
            return
        }

        // Atomically reset all session state
        isReading = false
        activeCancelAction = nil
        cancelRequested = false
        activeReader = nil

        logSession(event: "endRead completed", details: [
            "isReading": false,
            "activeReaderCleared": true,
            "stateReset": true
        ])
    }

    private func ensureNotCanceled() throws {
        lock.lock()
        let canceled = cancelRequested
        lock.unlock()

        if canceled {
            throw NFCPassportReaderError.UserCanceled
        }
    }

    private func throwIfCanceled(error: Error?) throws {
        try ensureNotCanceled()

        guard let passportError = error as? NFCPassportReaderError else {
            return
        }
        if case .UserCanceled = passportError {
            throw passportError
        }
    }

    private func setActiveCancelAction(_ action: (() -> Void)?) {
        lock.lock()
        activeCancelAction = action
        lock.unlock()
    }

    private func clearActiveCancelAction() {
        lock.lock()
        activeCancelAction = nil
        lock.unlock()
    }

    private func validateAndLogSessionState(context: String) {
        lock.lock()
        defer { lock.unlock() }

        let stateIsConsistent = !isReading || (activeCancelAction == nil && !cancelRequested && activeReader != nil)
        let details: [String: Any] = [
            "context": context,
            "isReading": isReading,
            "hasActiveCancelAction": activeCancelAction != nil,
            "cancelRequested": cancelRequested,
            "hasActiveReader": activeReader != nil,
            "stateConsistent": stateIsConsistent
        ]

        if stateIsConsistent {
            logSession(event: "state validation passed", details: details)
        } else {
            logSession(event: "state validation FAILED - potential inconsistency", details: details)
        }
    }

    @available(iOS 15.0, *)
    private func readAttempt(
        mrzKey: String,
        preferredMethod: AccessControlMethod,
        allowBacFallback: Bool,
        aaChallenge: [UInt8]?,
        tags: [DataGroupId]
    ) async -> ReadAttemptResult {
        let preferredAttempt = await readPassportOnce(
            mrzKey: mrzKey,
            method: preferredMethod,
            aaChallenge: aaChallenge,
            tags: tags
        )

        if let passport = preferredAttempt.passport {
            let usedMethod = Self.resolveUsedMethod(preferredMethod: preferredMethod, passport: passport)
            let fallbackUsed = preferredMethod == .pace && usedMethod == .bac
            return ReadAttemptResult(
                preferredMethod: preferredMethod,
                usedMethod: usedMethod,
                fallbackUsed: fallbackUsed,
                fallbackReason: fallbackUsed ? "PACE did not complete; BAC authentication was used by reader." : nil,
                passport: passport,
                error: nil,
                readerSnapshot: preferredAttempt.readerSnapshot
            )
        }

        if let error = preferredAttempt.error {
            let isFatalSessionError = PassportVerificationErrorMapper.isFatalSessionError(error)
            let isTerminalForAttempt = PassportVerificationErrorMapper.isTerminalNfcAttemptError(error)
            var errorDetails = PassportVerificationErrorMapper.errorDebugDetails(error)
            errorDetails["preferredMethod"] = preferredMethod.rawValue
            errorDetails["isFatalSessionError"] = isFatalSessionError
            errorDetails["isTerminalForAttempt"] = isTerminalForAttempt
            if let snapshot = preferredAttempt.readerSnapshot {
                errorDetails.merge(normalReadTimingDetails(snapshot: snapshot)) { _, new in new }
            }
            logSession(event: "access-control attempt failed", details: errorDetails)

            let mappedError = mapNoTagDetectedErrorIfNeeded(error, snapshot: preferredAttempt.readerSnapshot)
            let terminalError = attachAttemptDiagnostics(error: mappedError, snapshot: preferredAttempt.readerSnapshot)
            if isFatalSessionError || isTerminalForAttempt || PassportVerificationErrorMapper.isTerminalNfcAttemptError(mappedError) {
                return ReadAttemptResult(
                    preferredMethod: preferredMethod,
                    usedMethod: nil,
                    fallbackUsed: false,
                    fallbackReason: nil,
                    passport: nil,
                    error: terminalError,
                    readerSnapshot: preferredAttempt.readerSnapshot
                )
            }

            if preferredMethod == .pace
                && allowBacFallback
                && PassportVerificationErrorMapper.shouldFallbackToBac(error)
            {
                logSession(event: "attempting BAC fallback after PACE failure")
                let bacFallbackAttempt = await readPassportOnce(
                    mrzKey: mrzKey,
                    method: .bac,
                    aaChallenge: aaChallenge,
                    tags: tags
                )
                if let passport = bacFallbackAttempt.passport {
                    return ReadAttemptResult(
                        preferredMethod: preferredMethod,
                        usedMethod: .bac,
                        fallbackUsed: true,
                        fallbackReason: "PACE failed or unsupported; BAC fallback used.",
                        passport: passport,
                        error: nil,
                        readerSnapshot: bacFallbackAttempt.readerSnapshot ?? preferredAttempt.readerSnapshot
                    )
                }
                return ReadAttemptResult(
                    preferredMethod: preferredMethod,
                    usedMethod: nil,
                    fallbackUsed: true,
                    fallbackReason: "PACE failed and BAC fallback also failed.",
                    passport: nil,
                    error: attachAttemptDiagnostics(
                        error: bacFallbackAttempt.error ?? error,
                        snapshot: bacFallbackAttempt.readerSnapshot ?? preferredAttempt.readerSnapshot
                    ),
                    readerSnapshot: bacFallbackAttempt.readerSnapshot ?? preferredAttempt.readerSnapshot
                )
            }

            if preferredMethod == .bac
                && allowBacFallback
                && PassportVerificationErrorMapper.shouldFallbackToPace(error)
            {
                logSession(event: "attempting PACE fallback after BAC failure")
                let paceFallbackAttempt = await readPassportOnce(
                    mrzKey: mrzKey,
                    method: .pace,
                    aaChallenge: aaChallenge,
                    tags: tags
                )
                if let passport = paceFallbackAttempt.passport {
                    let usedMethod = Self.resolveUsedMethod(preferredMethod: .pace, passport: passport)
                    return ReadAttemptResult(
                        preferredMethod: preferredMethod,
                        usedMethod: usedMethod,
                        fallbackUsed: true,
                        fallbackReason: "BAC failed; PACE fallback used.",
                        passport: passport,
                        error: nil,
                        readerSnapshot: paceFallbackAttempt.readerSnapshot ?? preferredAttempt.readerSnapshot
                    )
                }
                return ReadAttemptResult(
                    preferredMethod: preferredMethod,
                    usedMethod: nil,
                    fallbackUsed: true,
                    fallbackReason: "BAC failed and PACE fallback also failed.",
                    passport: nil,
                    error: attachAttemptDiagnostics(
                        error: paceFallbackAttempt.error ?? error,
                        snapshot: paceFallbackAttempt.readerSnapshot ?? preferredAttempt.readerSnapshot
                    ),
                    readerSnapshot: paceFallbackAttempt.readerSnapshot ?? preferredAttempt.readerSnapshot
                )
            }

            return ReadAttemptResult(
                preferredMethod: preferredMethod,
                usedMethod: nil,
                fallbackUsed: false,
                fallbackReason: nil,
                passport: nil,
                error: attachAttemptDiagnostics(error: error, snapshot: preferredAttempt.readerSnapshot),
                readerSnapshot: preferredAttempt.readerSnapshot
            )
        }

        return ReadAttemptResult(
            preferredMethod: preferredMethod,
            usedMethod: nil,
            fallbackUsed: false,
            fallbackReason: nil,
            passport: nil,
            error: PassportBridgeError.noDataRead,
            readerSnapshot: preferredAttempt.readerSnapshot
        )
    }

    @available(iOS 15.0, *)
    private func readPassportOnce(
        mrzKey: String,
        method: AccessControlMethod,
        aaChallenge: [UInt8]?,
        tags: [DataGroupId]
    ) async -> ReadPassportOnceResult {
        do {
            try ensureNotCanceled()
        } catch {
            return ReadPassportOnceResult(passport: nil, error: error, readerSnapshot: nil)
        }
        logSession(event: "readPassportOnce starting", details: [
            "method": method.rawValue,
            "tagCount": tags.count,
        ])
        let reader = PassportReader()
        lock.lock(); activeReader = reader; lock.unlock()
        setActiveCancelAction(nil)
        let skipPACE = method == .bac
        let result: ReadPassportOnceResult

        do {
            logSession(event: "readPassportOnce session begin attempted", details: [
                "method": method.rawValue,
                "skipPACE": skipPACE,
            ])
            let passport = try await reader.readPassport(
                mrzKey: mrzKey,
                tags: tags,
                skipSecureElements: true,
                skipCA: false,
                skipPACE: skipPACE,
                useExtendedMode: false,
                customDisplayMessage: { displayMessage in
                switch displayMessage {
                case .requestPresentPassport:
                    return "Hold the top of your iPhone against the passport chip area. Move slowly across the cover or data page until the chip is detected."
                case .authenticatingWithPassport:
                    return "Authenticating passport chip. Do not move the phone."
                case .readingDataGroupProgress:
                    return "Reading passport data. Keep the phone still."
                case .successfulRead:
                    return "Passport read complete."
                default:
                    return nil
                }
            })
            logSession(event: "readPassportOnce session read returned", details: [
                "method": method.rawValue,
            ])
            logSession(
                event: "readPassportOnce timing",
                details: normalReadTimingDetails(snapshot: reader.debugSnapshot)
            )

            if method == .pace {
                if Self.didAuthenticationSucceed(passport.PACEStatus)
                    || Self.didAuthenticationSucceed(passport.BACStatus)
                {
                    result = ReadPassportOnceResult(passport: passport, error: nil, readerSnapshot: reader.debugSnapshot)
                } else {
                    result = ReadPassportOnceResult(
                        passport: nil,
                        error: PassportBridgeError.paceUnsupported,
                        readerSnapshot: reader.debugSnapshot
                    )
                }
            } else if method == .bac && !Self.didAuthenticationSucceed(passport.BACStatus) {
                result = ReadPassportOnceResult(
                    passport: nil,
                    error: PassportBridgeError.bacFailed,
                    readerSnapshot: reader.debugSnapshot
                )
            } else {
                result = ReadPassportOnceResult(passport: passport, error: nil, readerSnapshot: reader.debugSnapshot)
            }
        } catch {
            var details = PassportVerificationErrorMapper.errorDebugDetails(error)
            details["method"] = method.rawValue
            details.merge(normalReadTimingDetails(snapshot: reader.debugSnapshot)) { _, new in new }
            logSession(event: "readPassportOnce failed", details: details)
            result = ReadPassportOnceResult(passport: nil, error: error, readerSnapshot: reader.debugSnapshot)
        }

        await waitForCoreNfcReleaseBarrier(reader: reader, context: "readPassportOnce")
        logSession(event: "readPassportOnce cleanup started")
        lock.lock(); activeReader = nil; lock.unlock()
        clearActiveCancelAction()
        logSession(event: "readPassportOnce cleanup completed", details: [
            "activeReaderCleared": true,
        ])
        return result
    }

    @available(iOS 15.0, *)
    private func runProbeAttempt(
        method: AccessControlMethod,
        mrzKey: String,
        tags: [DataGroupId]
    ) async -> PassportProbeAttempt {
        let startedAtMs = currentEpochMs()
        var attempt = PassportProbeAttempt(
            method: method,
            startedAtMs: startedAtMs,
            completedAtMs: nil,
            passport: nil,
            error: nil,
            readerSnapshot: nil
        )

        let reader = PassportReader()
        lock.lock(); activeReader = reader; lock.unlock()
        setActiveCancelAction(nil)

        do {
            logSession(event: "[NFCProbe] attempt started", details: [
                "accessMethod": method.rawValue,
                "phase": "session_start",
            ])
            let passport = try await reader.readPassport(
                mrzKey: mrzKey,
                tags: tags,
                skipSecureElements: true,
                skipCA: true,
                skipPACE: method == .bac,
                useExtendedMode: false,
                customDisplayMessage: { displayMessage in
                    switch displayMessage {
                    case .requestPresentPassport:
                        return "Hold your iPhone near the passport NFC chip."
                    case .authenticatingWithPassport:
                        return "Probing passport access..."
                    case .successfulRead:
                        return "Passport probe complete."
                    default:
                        return nil
                    }
                }
            )
            attempt.passport = passport
            attempt.readerSnapshot = reader.debugSnapshot
            logSession(event: "[NFCProbe] attempt completed", details: [
                "accessMethod": method.rawValue,
                "phase": "cleanup",
            ])
        } catch {
            attempt.error = error
            attempt.readerSnapshot = reader.debugSnapshot
            var details = PassportVerificationErrorMapper.errorDebugDetails(error)
            let phase: String
            if reader.debugSnapshot.sessionDidBecomeActive == false {
                phase = "session_start"
            } else if reader.debugSnapshot.tagDetected == false {
                phase = "session_active"
            } else {
                phase = "access_control"
            }
            details["phase"] = phase
            details["accessMethod"] = method.rawValue
            details["sessionBecameActive"] = reader.debugSnapshot.sessionDidBecomeActive
            details["tagDetected"] = reader.debugSnapshot.tagDetected
            logSession(event: "[NFCProbe] failed", details: details)
        }

        await waitForCoreNfcReleaseBarrier(reader: reader, context: "probePassportChip")
        lock.lock(); activeReader = nil; lock.unlock()
        clearActiveCancelAction()
        attempt.completedAtMs = currentEpochMs()
        return attempt
    }

    @available(iOS 15.0, *)
    private static func didAuthenticationSucceed(
        _ status: PassportAuthenticationStatus
    ) -> Bool {
        if case .success = status {
            return true
        }
        return false
    }

    @available(iOS 15.0, *)
    private static func resolveUsedMethod(
        preferredMethod: AccessControlMethod,
        passport: NFCPassportModel
    ) -> AccessControlMethod {
        if preferredMethod == .bac {
            return .bac
        }
        if passport.PACEStatus == .success {
            return .pace
        }
        if passport.BACStatus == .success {
            return .bac
        }
        return preferredMethod
    }

    private func mapNoTagDetectedErrorIfNeeded(
        _ error: Error,
        snapshot: PassportReaderDebugSnapshot?
    ) -> Error {
        guard let snapshot else {
            return error
        }
        if snapshot.sessionDidBecomeActive,
           snapshot.tagDetected == false,
           !isUserCanceledError(error)
        {
            let elapsedMs = durationFrom(snapshot.sessionBeginRequestedAtMs ?? snapshot.sessionStartedAtMs, snapshot.invalidationAtMs)
            let reason = classifyInvalidationReasonFromSnapshot(snapshot)
            var details = normalReadTimingDetails(snapshot: snapshot)
            details["invalidationReason"] = reason
            logSession(event: "NFC_TAG_NOT_DETECTED classified", details: details)
            let message =
                "Passport chip was not detected. Keep the top of the iPhone still on the passport. Try the cover, data page, or slowly move across the passport until detected. (elapsedMsBeforeInvalidation=\(Int(elapsedMs ?? 0)); reason=\(reason))"
            return PassportBridgeError.nfcTagNotDetected(message)
        }
        return error
    }

    private func shouldSkipPerGroupFallback(
        error: Error,
        snapshot: PassportReaderDebugSnapshot?
    ) -> (skip: Bool, reason: String) {
        if let snapshot {
            if snapshot.sessionDidBecomeActive == false {
                return (true, "session_not_active")
            }
            if snapshot.sessionDidBecomeActive && snapshot.tagDetected == false {
                return (true, "nfc_tag_not_detected")
            }
        }

        let errorCode = (PassportVerificationErrorMapper.errorInfo(error)["code"] as? String) ?? "UNKNOWN"
        if PassportVerificationErrorMapper.isTerminalNfcAttemptError(error) {
            return (true, errorCode.lowercased())
        }

        return (false, "logical_file_failure")
    }

    @available(iOS 15.0, *)
    private func waitForCoreNfcReleaseBarrier(reader: PassportReader, context: String) async {
        logSession(event: "CoreNFC release barrier waiting", details: ["context": context])
        let status = await reader.waitForSessionReleaseIfNeeded(timeoutMs: 1800)
        switch status {
        case .skippedNoSession:
            logSession(event: "CoreNFC release barrier skipped; no session was created", details: ["context": context])
        case .alreadyReleased:
            logSession(event: "CoreNFC release barrier completed", details: ["context": context, "release": "already_released"])
        case .observedDidInvalidate:
            logSession(event: "CoreNFC didInvalidate observed", details: ["context": context])
            logSession(event: "CoreNFC release barrier completed", details: ["context": context, "release": "did_invalidate_observed"])
        case .timedOut:
            logSession(event: "CoreNFC release barrier timed out; continuing cautiously", details: ["context": context])
        }
    }

    private func logNormalReadSummary(
        status: String,
        attempt: ReadAttemptResult,
        files: String?,
        method: String? = nil
    ) {
        let snapshot = attempt.readerSnapshot
        let methodValue = method ?? attempt.usedMethod?.rawValue ?? attempt.preferredMethod.rawValue
        let bacSucceeded = snapshot?.bacSucceededAtMs != nil
        let errorInfo = attempt.error.map { PassportVerificationErrorMapper.errorInfo($0) }
        let details: [String: Any] = [
            "status": status,
            "method": methodValue,
            "didDetectTag": snapshot?.tagDetected ?? false,
            "timeToDetectMs": durationFrom(snapshot?.sessionBeginRequestedAtMs ?? snapshot?.sessionStartedAtMs, snapshot?.tagDetectedAtMs) ?? NSNull(),
            "bacSucceeded": bacSucceeded,
            "files": files ?? "none",
            "errorCode": errorInfo?["code"] ?? NSNull(),
            "errorPhase": phaseForSnapshot(snapshot) ?? NSNull(),
        ]
        logSession(event: "[NFCReadSummary]", details: details)
    }

    private func phaseForSnapshot(_ snapshot: PassportReaderDebugSnapshot?) -> String? {
        guard let snapshot else { return nil }
        if snapshot.sessionDidBecomeActive == false {
            return "session_start"
        }
        if snapshot.tagDetected == false {
            return "session_active"
        }
        if snapshot.bacSucceededAtMs == nil {
            return "bac"
        }
        if snapshot.firstFileReadAtMs == nil {
            return "file_read"
        }
        return "completed"
    }

    private func classifyInvalidationReasonFromSnapshot(_ snapshot: PassportReaderDebugSnapshot) -> String {
        guard let code = snapshot.invalidationErrorCode else {
            return "unknown"
        }
        if code == NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue {
            return "user_canceled"
        }
        if code == NFCReaderError.readerSessionInvalidationErrorSessionTimeout.rawValue {
            return "session_timeout"
        }
        if code == NFCReaderError.readerSessionInvalidationErrorSessionTerminatedUnexpectedly.rawValue {
            return "session_terminated_unexpectedly"
        }
        if code == NFCReaderError.readerSessionInvalidationErrorSystemIsBusy.rawValue {
            return "system_busy"
        }
        return "nfc_error_\(code)"
    }

    private func isUserCanceledError(_ error: Error) -> Bool {
        if let passportError = error as? NFCPassportReaderError {
            if case .UserCanceled = passportError {
                return true
            }
        }
        if let nfcError = error as? NFCReaderError,
           nfcError.code == .readerSessionInvalidationErrorUserCanceled
        {
            return true
        }
        let nsError = error as NSError
        return nsError.code == NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue
    }

    private func normalReadTimingDetails(snapshot: PassportReaderDebugSnapshot) -> [String: Any] {
        let start = snapshot.sessionBeginRequestedAtMs ?? snapshot.sessionStartedAtMs
        return [
            "sessionBeginRequestedAt": snapshot.sessionBeginRequestedAtMs ?? NSNull(),
            "sessionCreated": snapshot.sessionCreated,
            "beginRequested": snapshot.sessionBeginRequested,
            "sessionBecameActiveAt": snapshot.sessionBecameActiveAtMs ?? NSNull(),
            "tagDetectedAt": snapshot.tagDetectedAtMs ?? NSNull(),
            "tagConnectedAt": snapshot.tagConnectedAtMs ?? NSNull(),
            "bacStartedAt": snapshot.bacStartedAtMs ?? NSNull(),
            "bacSucceededAt": snapshot.bacSucceededAtMs ?? NSNull(),
            "firstFileReadAt": snapshot.firstFileReadAtMs ?? NSNull(),
            "readCompletedAt": snapshot.readCompletedAtMs ?? NSNull(),
            "timeToActiveMs": durationFrom(start, snapshot.sessionBecameActiveAtMs) ?? NSNull(),
            "timeToDetectMs": durationFrom(start, snapshot.tagDetectedAtMs) ?? NSNull(),
            "timeToConnectMs": durationFrom(snapshot.tagDetectedAtMs, snapshot.tagConnectedAtMs) ?? NSNull(),
            "timeToBacSuccessMs": durationFrom(snapshot.bacStartedAtMs, snapshot.bacSucceededAtMs) ?? NSNull(),
            "timeToFirstFileMs": durationFrom(start, snapshot.firstFileReadAtMs) ?? NSNull(),
            "totalReadMs": durationFrom(start, snapshot.readCompletedAtMs) ?? NSNull(),
            "elapsedMsBeforeInvalidation": durationFrom(start, snapshot.invalidationAtMs) ?? NSNull(),
            "sessionBecameActive": snapshot.sessionDidBecomeActive,
            "didDetectTag": snapshot.tagDetected,
            "preActiveFailureCode": snapshot.preActiveFailureCode ?? NSNull(),
        ]
    }

    private func attachAttemptDiagnostics(
        error: Error,
        snapshot: PassportReaderDebugSnapshot?
    ) -> Error {
        guard let snapshot else {
            return error
        }
        let nsError = error as NSError
        let info = PassportVerificationErrorMapper.errorInfo(error)
        let code = (info["code"] as? String) ?? "PASSPORT_READ_FAILED"
        let message = (info["message"] as? String) ?? error.localizedDescription
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: message,
            "bridgeCode": code,
            "bridgeMessage": message,
            "sessionCreated": snapshot.sessionCreated,
            "beginRequested": snapshot.sessionBeginRequested,
            "didBecomeActive": snapshot.sessionDidBecomeActive,
        ]
        if let preActiveFailureCode = snapshot.preActiveFailureCode {
            userInfo["preActiveFailureCode"] = preActiveFailureCode
        }
        userInfo[NSUnderlyingErrorKey] = nsError
        return NSError(domain: "com.iland.passportverification.PassportBridgeError", code: nsError.code, userInfo: userInfo)
    }

    private func summarizeFiles(_ files: [String: Any]) -> String {
        files.compactMap { key, value in
            guard let entry = value as? [String: Any] else { return nil }
            return "\(key):\(PassportVerificationResultMapper.fileStatus(entry))"
        }
        .sorted()
        .joined(separator: ",")
    }

    private func setCurrentAttemptId(_ id: String?) {
        lock.lock()
        currentAttemptId = id
        lock.unlock()
    }

    private func buildProbeCardAccessEntry(passport: NFCPassportModel?, error: Error?) -> [String: Any] {
        if let cardAccess = passport?.cardAccess {
            return [
                "attempted": true,
                "status": "ok",
                "length": cardAccess.securityInfos.count,
                "errorDomain": NSNull(),
                "errorCode": NSNull(),
                "errorMessage": NSNull(),
            ]
        }

        if let error {
            let nsError = error as NSError
            return [
                "attempted": true,
                "status": "error",
                "length": 0,
                "errorDomain": nsError.domain,
                "errorCode": nsError.code,
                "errorMessage": error.localizedDescription,
            ]
        }

        return [
            "attempted": true,
            "status": "missing",
            "length": 0,
            "errorDomain": NSNull(),
            "errorCode": NSNull(),
            "errorMessage": "CardAccess not available.",
        ]
    }

    private func buildProbeComEntry(passport: NFCPassportModel?, error: Error?) -> [String: Any] {
        if let com = passport?.getDataGroup(.COM) as? COM {
            return [
                "attempted": true,
                "status": "ok",
                "length": com.data.count,
                "ldsVersion": com.version,
                "unicodeVersion": com.unicodeVersion,
                "dataGroupsPresent": com.dataGroupsPresent,
                "errorDomain": NSNull(),
                "errorCode": NSNull(),
                "errorMessage": NSNull(),
            ]
        }

        if let error {
            let nsError = error as NSError
            return [
                "attempted": true,
                "status": "error",
                "length": 0,
                "errorDomain": nsError.domain,
                "errorCode": nsError.code,
                "errorMessage": error.localizedDescription,
            ]
        }

        return [
            "attempted": true,
            "status": "missing",
            "length": 0,
            "errorDomain": NSNull(),
            "errorCode": NSNull(),
            "errorMessage": "COM not available.",
        ]
    }

    private func probeAttemptResultString(_ attempt: PassportProbeAttempt?) -> String {
        guard let attempt else {
            return "not_attempted"
        }
        if attempt.passport != nil {
            return "ok"
        }
        return "failed"
    }

    private func probeAttemptDurationMs(_ attempt: PassportProbeAttempt?) -> Double? {
        guard let attempt, let completedAtMs = attempt.completedAtMs else {
            return nil
        }
        return max(completedAtMs - attempt.startedAtMs, 0)
    }

    private func durationFrom(_ start: Double?, _ end: Double?) -> Double? {
        guard let start, let end else {
            return nil
        }
        return max(end - start, 0)
    }

    private func currentEpochMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    private func logSession(event: String, details: [String: Any]? = nil) {
        _ = event
        _ = details
    }
}

@available(iOS 15.0, *)
private final class RawNfcProbeSession: NSObject, NFCTagReaderSessionDelegate {
    private enum Phase: String {
        case sessionStart = "session_start"
        case sessionActive = "session_active"
        case tagDetected = "tag_detected"
        case connectTag = "connect_tag"
        case iso7816Probe = "iso7816_probe"
        case cleanup = "cleanup"
    }

    private enum ProbeMode: String {
        case detectOnly = "detect_only"
        case iso7816Apdu = "iso7816_apdu"
    }

    private enum PollingMode: String {
        case passportDefault = "passport_default"
        case broad = "broad"
    }

    private let configuration: RawNfcProbeConfiguration
    private let logger: (String, [String: Any]?) -> Void
    private let probeMode: ProbeMode
    private let pollingMode: PollingMode

    private var session: NFCTagReaderSession?
    private var continuation: CheckedContinuation<[String: Any], Never>?
    private var finished = false
    private var suppressNextUserCancelInvalidation = false
    private var releaseBarrierTimeoutWorkItem: DispatchWorkItem?
    private let releaseBarrierTimeoutMs: Int = 1800

    private var phase: Phase = .sessionStart
    private var sessionStartMs: Double?
    private var sessionActiveAtMs: Double?
    private var firstTagDetectedAtMs: Double?
    private var tagConnectedAtMs: Double?
    private var invalidatedAtMs: Double?
    private var didBecomeActive = false
    private var didDetectTag = false
    private var detectedTagCount = 0
    private var invalidatedBeforeActive = false
    private var invalidatedAfterActive = false
    private var invalidatedBeforeTagDetection = false
    private var invalidatedAfterTagDetection = false
    private var invalidationErrorDomain: String?
    private var invalidationErrorCode: Int?
    private var invalidationErrorMessage: String?
    private var invalidationReason = "none"

    private var tagType = "unknown"
    private var supportsIso7816 = false
    private var supportsIso14443 = false
    private var identifierHex: String?
    private var historicalBytesHex: String?
    private var applicationDataHex: String?
    private var initialSelectedAidHex: String?
    private var tagAvailable = false

    private var selectPassportAidAttempted = false
    private var selectPassportAidStatusWord: String?
    private var selectPassportAidError: String?
    private var selectCardAccessAttempted = false
    private var selectCardAccessStatusWord: String?
    private var selectCardAccessError: String?
    private var selectComAttempted = false
    private var selectComStatusWord: String?
    private var selectComError: String?
    private var pollingOptionsUsed: [String] = []

    private var rawErrors: [[String: Any]] = []

    init(
        configuration: RawNfcProbeConfiguration,
        logger: @escaping (String, [String: Any]?) -> Void
    ) {
        self.configuration = configuration
        self.logger = logger
        self.probeMode = ProbeMode(rawValue: configuration.mode) ?? .iso7816Apdu
        self.pollingMode = PollingMode(rawValue: configuration.pollingMode) ?? .passportDefault
        super.init()
    }

    func run() async -> [String: Any] {
        sessionStartMs = nowMs()
        let polling = resolvePollingOptions()
        pollingOptionsUsed = describePollingOptions(polling)
        logger("[RawNFCProbe] session begin requested", [
            "mode": probeMode.rawValue,
            "pollingMode": pollingMode.rawValue,
            "pollingOptionsUsed": pollingOptionsUsed.joined(separator: ","),
        ])

        guard NFCTagReaderSession.readingAvailable else {
            recordError(
                phase: .sessionStart,
                error: PassportBridgeError.invalidInput("NFC tag reading is not available.")
            )
            return buildResult()
        }

        session = NFCTagReaderSession(pollingOption: polling, delegate: self, queue: nil)
        session?.alertMessage = alertMessageForCurrentMode()
        session?.begin()

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func cancel() {
        logger("[RawNFCProbe] cancel requested", nil)
        finalizeAndInvalidate()
    }

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {
        phase = .sessionActive
        didBecomeActive = true
        sessionActiveAtMs = nowMs()
        logger("[RawNFCProbe] session became active", nil)
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        let nsError = error as NSError
        invalidatedAtMs = nowMs()
        invalidatedBeforeActive = !didBecomeActive
        invalidatedAfterActive = didBecomeActive
        invalidatedBeforeTagDetection = !didDetectTag
        invalidatedAfterTagDetection = didDetectTag
        invalidationErrorDomain = nsError.domain
        invalidationErrorCode = nsError.code
        invalidationErrorMessage = error.localizedDescription
        invalidationReason = classifyInvalidationReason(error: error, nsError: nsError)

        logger("[RawNFCProbe] session invalidated", [
            "phase": phase.rawValue,
            "didBecomeActive": didBecomeActive,
            "didDetectTag": didDetectTag,
            "domain": nsError.domain,
            "code": nsError.code,
            "message": error.localizedDescription,
            "reason": invalidationReason,
            "elapsedMsBeforeInvalidation": durationMs(from: sessionStartMs, to: invalidatedAtMs) ?? -1,
        ])

        if suppressNextUserCancelInvalidation,
           let readerError = error as? NFCReaderError,
           readerError.code == .readerSessionInvalidationErrorUserCanceled
        {
            suppressNextUserCancelInvalidation = false
            logger("[RawNFCProbe] CoreNFC didInvalidate observed", nil)
            finishIfNeeded()
            return
        }

        if !finished {
            recordError(phase: phase, error: error)
            logger("[RawNFCProbe] CoreNFC didInvalidate observed", nil)
            finishIfNeeded()
        }
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        phase = .tagDetected
        didDetectTag = true
        if firstTagDetectedAtMs == nil {
            firstTagDetectedAtMs = nowMs()
        }
        detectedTagCount = tags.count

        logger("[RawNFCProbe] didDetect tags", [
            "count": tags.count,
            "types": tags.map { describeTagType($0) },
        ])

        guard tags.count == 1, let tag = tags.first else {
            recordError(
                phase: .tagDetected,
                message: "Expected exactly one NFC tag but found \(tags.count)."
            )
            finalizeAndInvalidate()
            return
        }

        populateTagMetadata(tag)

        if probeMode == .detectOnly {
            logger("[RawNFCProbe] detect-only mode complete after tag detection", [
                "type": tagType,
                "identifier": identifierHex ?? "null",
            ])
            finalizeAndInvalidate()
            return
        }

        Task {
            do {
                phase = .connectTag
                logger("[RawNFCProbe] connect started", ["type": tagType])
                try await session.connect(to: tag)
                tagConnectedAtMs = nowMs()
                logger("[RawNFCProbe] connect succeeded", ["type": tagType])

                if case let .iso7816(isoTag) = tag {
                    phase = .iso7816Probe
                    logger("[RawNFCProbe] iso7816 metadata", [
                        "identifier": identifierHex ?? "null",
                        "historicalBytes": historicalBytesHex ?? "null",
                        "applicationData": applicationDataHex ?? "null",
                        "initialSelectedAid": initialSelectedAidHex ?? "null",
                    ])
                    if configuration.includeMinimalApduProbe {
                        await runIso7816ApduProbe(isoTag: isoTag)
                    }
                }

                finalizeAndInvalidate()
            } catch {
                recordError(phase: .connectTag, error: error)
                finalizeAndInvalidate()
            }
        }
    }

    private func runIso7816ApduProbe(isoTag: NFCISO7816Tag) async {
        do {
            selectPassportAidAttempted = true
            let selectAidCmd = NFCISO7816APDU(
                instructionClass: 0x00,
                instructionCode: 0xA4,
                p1Parameter: 0x04,
                p2Parameter: 0x0C,
                data: Data([0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01]),
                expectedResponseLength: -1
            )
            let (_, sw1, sw2) = try await isoTag.sendCommand(apdu: selectAidCmd)
            selectPassportAidStatusWord = statusWord(sw1: sw1, sw2: sw2)
            logger("[RawNFCProbe] select AID result", ["sw": selectPassportAidStatusWord ?? "null"])
        } catch {
            selectPassportAidError = error.localizedDescription
            recordError(phase: .iso7816Probe, error: error)
        }

        if configuration.includeCardAccessProbe {
            do {
                selectCardAccessAttempted = true
                let selectMfCmd = NFCISO7816APDU(
                    instructionClass: 0x00,
                    instructionCode: 0xA4,
                    p1Parameter: 0x00,
                    p2Parameter: 0x0C,
                    data: Data([0x3F, 0x00]),
                    expectedResponseLength: -1
                )
                let _ = try await isoTag.sendCommand(apdu: selectMfCmd)

                let selectCardAccessCmd = NFCISO7816APDU(
                    instructionClass: 0x00,
                    instructionCode: 0xA4,
                    p1Parameter: 0x02,
                    p2Parameter: 0x0C,
                    data: Data([0x01, 0x1C]),
                    expectedResponseLength: -1
                )
                let (_, sw1, sw2) = try await isoTag.sendCommand(apdu: selectCardAccessCmd)
                selectCardAccessStatusWord = statusWord(sw1: sw1, sw2: sw2)
            } catch {
                selectCardAccessError = error.localizedDescription
                recordError(phase: .iso7816Probe, error: error)
            }
        }

        if configuration.includeComProbe {
            do {
                selectComAttempted = true
                let selectComCmd = NFCISO7816APDU(
                    instructionClass: 0x00,
                    instructionCode: 0xA4,
                    p1Parameter: 0x02,
                    p2Parameter: 0x0C,
                    data: Data([0x01, 0x1E]),
                    expectedResponseLength: -1
                )
                let (_, sw1, sw2) = try await isoTag.sendCommand(apdu: selectComCmd)
                selectComStatusWord = statusWord(sw1: sw1, sw2: sw2)
            } catch {
                selectComError = error.localizedDescription
                recordError(phase: .iso7816Probe, error: error)
            }
        }
    }

    private func finalizeAndInvalidate() {
        phase = .cleanup
        guard let session else {
            logger("[RawNFCProbe] CoreNFC release barrier skipped; no session was created", nil)
            finishIfNeeded()
            return
        }

        logger("[RawNFCProbe] CoreNFC release barrier waiting", nil)
        suppressNextUserCancelInvalidation = true
        let timeoutWorkItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if self.finished {
                return
            }
            self.logger("[RawNFCProbe] CoreNFC release barrier timed out; continuing cautiously", [
                "timeoutMs": self.releaseBarrierTimeoutMs,
            ])
            self.finishIfNeeded()
        }
        releaseBarrierTimeoutWorkItem = timeoutWorkItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(releaseBarrierTimeoutMs),
            execute: timeoutWorkItem
        )
        session.invalidate()
        self.session = nil
    }

    private func finishIfNeeded() {
        guard !finished else { return }
        finished = true
        releaseBarrierTimeoutWorkItem?.cancel()
        releaseBarrierTimeoutWorkItem = nil
        continuation?.resume(returning: buildResult())
        continuation = nil
    }

    private func buildResult() -> [String: Any] {
        let startMs = sessionStartMs ?? nowMs()
        let totalMs = max(nowMs() - startMs, 0)
        let timeToActiveMs = durationMs(from: sessionStartMs, to: sessionActiveAtMs)
        let timeToDetectMs = durationMs(from: sessionStartMs, to: firstTagDetectedAtMs)
        let timeToConnectMs = durationMs(from: firstTagDetectedAtMs, to: tagConnectedAtMs)
        let elapsedMsBeforeInvalidation = durationMs(from: sessionStartMs, to: invalidatedAtMs)

        let hasConnectSuccess = tagConnectedAtMs != nil
        let hasErrors = !rawErrors.isEmpty
        let finalStatus: String
        if probeMode == .detectOnly {
            if didDetectTag && !hasErrors {
                finalStatus = "raw_probe_success"
            } else if didBecomeActive {
                finalStatus = "raw_probe_partial"
            } else {
                finalStatus = "raw_probe_failed"
            }
        } else if hasConnectSuccess && !hasErrors {
            finalStatus = "raw_probe_success"
        } else if didDetectTag || didBecomeActive {
            finalStatus = "raw_probe_partial"
        } else {
            finalStatus = "raw_probe_failed"
        }

        let sessionPayload: [String: Any] = [
            "didBecomeActive": didBecomeActive,
            "didDetectTag": didDetectTag,
            "detectedTagCount": detectedTagCount,
            "invalidatedBeforeActive": invalidatedBeforeActive,
            "invalidatedAfterActive": invalidatedAfterActive,
            "invalidatedBeforeTagDetection": invalidatedBeforeTagDetection,
            "invalidatedAfterTagDetection": invalidatedAfterTagDetection,
            "invalidationErrorDomain": invalidationErrorDomain ?? NSNull(),
            "invalidationErrorCode": invalidationErrorCode ?? NSNull(),
            "invalidationErrorMessage": invalidationErrorMessage ?? NSNull(),
            "invalidationReason": invalidationReason,
        ]

        let tagPayload: [String: Any] = [
            "type": tagType,
            "supportsIso7816": supportsIso7816,
            "supportsIso14443": supportsIso14443,
            "identifierHex": identifierHex ?? NSNull(),
            "historicalBytesHex": configuration.includeHistoricalBytes ? (historicalBytesHex ?? NSNull()) : NSNull(),
            "applicationDataHex": configuration.includeAtr ? (applicationDataHex ?? NSNull()) : NSNull(),
            "initialSelectedAidHex": initialSelectedAidHex ?? NSNull(),
            "available": tagAvailable,
        ]

        let apduPayload: [String: Any] = [
            "selectPassportAidAttempted": selectPassportAidAttempted,
            "selectPassportAidStatusWord": selectPassportAidStatusWord ?? NSNull(),
            "selectPassportAidError": selectPassportAidError ?? NSNull(),
            "selectCardAccessAttempted": selectCardAccessAttempted,
            "selectCardAccessStatusWord": selectCardAccessStatusWord ?? NSNull(),
            "selectCardAccessError": selectCardAccessError ?? NSNull(),
            "selectComAttempted": selectComAttempted,
            "selectComStatusWord": selectComStatusWord ?? NSNull(),
            "selectComError": selectComError ?? NSNull(),
        ]

        let timingPayload: [String: Any] = [
            "sessionStartMs": sessionStartMs ?? NSNull(),
            "timeToActiveMs": timeToActiveMs ?? NSNull(),
            "timeToDetectMs": timeToDetectMs ?? NSNull(),
            "timeToConnectMs": timeToConnectMs ?? NSNull(),
            "firstDidDetectTimeMs": firstTagDetectedAtMs ?? NSNull(),
            "invalidationTimeMs": invalidatedAtMs ?? NSNull(),
            "elapsedMsBeforeInvalidation": elapsedMsBeforeInvalidation ?? NSNull(),
            "totalMs": totalMs,
        ]

        let summary: [String: Any] = [
            "finalStatus": finalStatus,
            "mode": probeMode.rawValue,
            "pollingOptionsUsed": pollingOptionsUsed.joined(separator: ","),
            "phase": phase.rawValue,
            "didBecomeActive": didBecomeActive,
            "didDetectTag": didDetectTag,
            "detectedTagCount": detectedTagCount,
            "tagType": tagType,
            "selectPassportAidStatusWord": selectPassportAidStatusWord ?? NSNull(),
            "error": rawErrors.last?["message"] ?? NSNull(),
            "elapsedMsBeforeInvalidation": elapsedMsBeforeInvalidation ?? NSNull(),
        ]

        return [
            "finalStatus": finalStatus,
            "mode": probeMode.rawValue,
            "pollingMode": pollingMode.rawValue,
            "pollingOptionsUsed": pollingOptionsUsed,
            "phase": phase.rawValue,
            "session": sessionPayload,
            "tag": tagPayload,
            "apdu": apduPayload,
            "timing": timingPayload,
            "rawErrors": rawErrors,
            "summary": summary,
        ]
    }

    private func populateTagMetadata(_ tag: NFCTag) {
        tagAvailable = true

        switch tag {
        case let .iso7816(isoTag):
            tagType = "iso7816"
            supportsIso7816 = true
            supportsIso14443 = true
            identifierHex = hexString(isoTag.identifier)
            historicalBytesHex = isoTag.historicalBytes.map { hexString($0) }
            applicationDataHex = isoTag.applicationData.map { hexString($0) }
            initialSelectedAidHex = isoTag.initialSelectedAID
        case let .miFare(miFareTag):
            tagType = "miFare"
            supportsIso7816 = false
            supportsIso14443 = true
            identifierHex = hexString(miFareTag.identifier)
        case let .iso15693(isoTag):
            tagType = "iso15693"
            supportsIso7816 = false
            supportsIso14443 = false
            identifierHex = hexString(isoTag.identifier)
        case let .feliCa(feliCaTag):
            tagType = "feliCa"
            supportsIso7816 = false
            supportsIso14443 = false
            identifierHex = hexString(feliCaTag.currentIDm)
        @unknown default:
            tagType = "unknown"
            supportsIso7816 = false
            supportsIso14443 = false
        }

        logger("[RawNFCProbe] selected tag", [
            "type": tagType,
            "identifier": identifierHex ?? "null",
        ])
    }

    private func describeTagType(_ tag: NFCTag) -> String {
        switch tag {
        case .iso7816: return "iso7816"
        case .miFare: return "miFare"
        case .iso15693: return "iso15693"
        case .feliCa: return "feliCa"
        @unknown default: return "unknown"
        }
    }

    private func statusWord(sw1: UInt8, sw2: UInt8) -> String {
        String(format: "%02X%02X", sw1, sw2)
    }

    private func recordError(phase: Phase, error: Error) {
        let nsError = error as NSError
        let payload: [String: Any] = [
            "phase": phase.rawValue,
            "domain": nsError.domain,
            "code": nsError.code,
            "message": error.localizedDescription,
            "didBecomeActive": didBecomeActive,
            "didDetectTag": didDetectTag,
        ]
        rawErrors.append(payload)
        logger("[RawNFCProbe] failed", payload)
    }

    private func recordError(phase: Phase, message: String) {
        let payload: [String: Any] = [
            "phase": phase.rawValue,
            "domain": "RawNfcProbe",
            "code": -1,
            "message": message,
            "didBecomeActive": didBecomeActive,
            "didDetectTag": didDetectTag,
        ]
        rawErrors.append(payload)
        logger("[RawNFCProbe] failed", payload)
    }

    private func nowMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    private func resolvePollingOptions() -> NFCTagReaderSession.PollingOption {
        var options: NFCTagReaderSession.PollingOption = [.iso14443]
        if pollingMode == .broad {
            options.insert(.iso15693)
            options.insert(.iso18092)
        }
        return options
    }

    private func describePollingOptions(_ options: NFCTagReaderSession.PollingOption) -> [String] {
        var names: [String] = []
        if options.contains(.iso14443) {
            names.append("iso14443")
        }
        if options.contains(.iso15693) {
            names.append("iso15693")
        }
        if options.contains(.iso18092) {
            names.append("iso18092")
        }
        if names.isEmpty {
            names.append("none")
        }
        return names
    }

    private func alertMessageForCurrentMode() -> String {
        if probeMode == .detectOnly {
            return "Raw NFC Probe: waiting for tag detection only. Hold iPhone still and sweep slowly across passport chip area."
        }
        return "Raw NFC Probe: hold iPhone on passport chip area and keep both devices still."
    }

    private func classifyInvalidationReason(error: Error, nsError: NSError) -> String {
        if let readerError = error as? NFCReaderError {
            switch readerError.code {
            case .readerSessionInvalidationErrorUserCanceled:
                return "user_canceled"
            case .readerSessionInvalidationErrorSessionTimeout:
                return "session_timeout"
            case .readerSessionInvalidationErrorSessionTerminatedUnexpectedly:
                return "session_terminated_unexpectedly"
            case .readerSessionInvalidationErrorSystemIsBusy:
                return "system_busy"
            case .readerSessionInvalidationErrorFirstNDEFTagRead:
                return "first_ndef_tag_read"
            default:
                return "nfc_reader_error_\(readerError.code.rawValue)"
            }
        }
        if nsError.domain == NFCErrorDomain {
            return "nfc_error_\(nsError.code)"
        }
        return "unknown"
    }

    private func durationMs(from start: Double?, to end: Double?) -> Double? {
        guard let start, let end else {
            return nil
        }
        return max(end - start, 0)
    }

    private func hexString(_ data: Data) -> String {
        data.map { String(format: "%02X", $0) }.joined()
    }
}
