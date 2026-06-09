import CoreNFC
import Foundation
import NFCPassportReader

@objc(PassportVerificationModule)
class PassportVerificationModule: NSObject {

    private let manager = PassportVerificationSessionManager()
    private let operationLock = NSLock()
    private var hasResolvedOrRejected = false
    private var hasUsableResults = false
    private var didFinishReading = false
    private var finalResult: [String: Any]?
    private var currentAttemptId: String?

    @objc(getPassportVerificationNativeStatus:rejecter:)
    func getPassportVerificationNativeStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        resolve([
            "platform": "ios",
            "nativeLinked": true,
            "module": "PassportVerificationModule",
            "version": "0.1.0",
        ])
    }

    @objc(readPassport:resolver:rejecter:)
    func readPassport(
        _ input: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let attemptId = generateAttemptId()
        setCurrentAttemptId(attemptId)
        resetOperationState()

        logAttempt(attemptId: attemptId, event: "readPassport requested")

        guard #available(iOS 15, *) else {
            logAttempt(attemptId: attemptId, event: "rejecting: iOS version < 15")
            rejectLogged(
                code: "UNSUPPORTED_PLATFORM",
                message: "iOS 15+ is required for this module.",
                error: PassportBridgeError.unsupportedPlatform,
                reject: reject,
                attemptId: attemptId
            )
            return
        }

        Task {
            do {
                logAttempt(attemptId: attemptId, event: "native read starting")

                // Do not wrap CoreNFC reads in a TaskGroup timeout.
                // JS owns the outer timeout to keep CoreNFC in this async task context.
                let result = try await self.manager.readPassport(
                    input: input as? [String: Any] ?? [:],
                    attemptId: attemptId
                )

                logAttempt(attemptId: attemptId, event: "native read completed successfully")

                // Validate the result structure before accepting it
                if let validationError = validateResult(result, attemptId: attemptId) {
                    logAttempt(attemptId: attemptId, event: "result validation failed", details: [
                        "error": validationError.localizedDescription
                    ])
                    rejectLogged(
                        code: "INVALID_RESULT",
                        message: validationError.localizedDescription,
                        error: validationError,
                        reject: reject,
                        attemptId: attemptId
                    )
                    return
                }

                markReadCompleted(result: result)
                resolveOnce(result, resolve: resolve, attemptId: attemptId)
            } catch {
                logAttempt(attemptId: attemptId, event: "native read failed", details: [
                    "error": error.localizedDescription,
                    "type": String(describing: type(of: error))
                ])

                if shouldIgnorePostCompletionInvalidation(error),
                    let cached = snapshotOperationState().finalResult
                {
                    logAttempt(attemptId: attemptId, event: "post-completion invalidation ignored, resolving with cached result")
                    resolveOnce(cached, resolve: resolve, attemptId: attemptId)
                    return
                }
                rejectWithMappedError(error, reject: reject, attemptId: attemptId)
            }
        }
    }

    @objc(probePassportChip:resolver:rejecter:)
    func probePassportChip(
        _ input: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let attemptId = generateAttemptId()
        setCurrentAttemptId(attemptId)
        resetOperationState()

        logAttempt(attemptId: attemptId, event: "probePassportChip requested")

        guard #available(iOS 15, *) else {
            logAttempt(attemptId: attemptId, event: "probe rejecting: iOS version < 15")
            rejectLogged(
                code: "UNSUPPORTED_PLATFORM",
                message: "iOS 15+ is required for this module.",
                error: PassportBridgeError.unsupportedPlatform,
                reject: reject,
                attemptId: attemptId
            )
            return
        }

        Task {
            do {
                logAttempt(attemptId: attemptId, event: "native probe starting")
                let result = try await self.manager.probePassportChip(
                    input: input as? [String: Any] ?? [:],
                    attemptId: attemptId
                )

                logAttempt(attemptId: attemptId, event: "native probe completed")
                resolveOnce(result, resolve: resolve, attemptId: attemptId)
            } catch {
                logAttempt(attemptId: attemptId, event: "native probe failed", details: [
                    "error": error.localizedDescription,
                    "type": String(describing: type(of: error)),
                ])
                rejectWithMappedError(error, reject: reject, attemptId: attemptId)
            }
        }
    }

    @objc(probeRawNfcTag:resolver:rejecter:)
    func probeRawNfcTag(
        _ input: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let attemptId = generateAttemptId()
        setCurrentAttemptId(attemptId)
        resetOperationState()

        logAttempt(attemptId: attemptId, event: "probeRawNfcTag requested")

        guard #available(iOS 15, *) else {
            logAttempt(attemptId: attemptId, event: "raw probe rejecting: iOS version < 15")
            rejectLogged(
                code: "UNSUPPORTED_PLATFORM",
                message: "iOS 15+ is required for this module.",
                error: PassportBridgeError.unsupportedPlatform,
                reject: reject,
                attemptId: attemptId
            )
            return
        }

        Task {
            do {
                logAttempt(attemptId: attemptId, event: "native raw probe starting")
                let result = try await self.manager.probeRawNfcTag(
                    input: input as? [String: Any] ?? [:],
                    attemptId: attemptId
                )
                logAttempt(attemptId: attemptId, event: "native raw probe completed")
                resolveOnce(result, resolve: resolve, attemptId: attemptId)
            } catch {
                logAttempt(attemptId: attemptId, event: "native raw probe failed", details: [
                    "error": error.localizedDescription,
                    "type": String(describing: type(of: error)),
                ])
                rejectWithMappedError(error, reject: reject, attemptId: attemptId)
            }
        }
    }

    @objc(cancelSession:rejecter:)
    func cancelSession(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        manager.disconnect()
        resolve(nil)
    }

    @objc(disconnect:rejecter:)
    func disconnect(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        manager.disconnect()
        resolve(nil)
    }

    @objc(clearTemporaryData:rejecter:)
    func clearTemporaryData(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        manager.disconnect()
        resetOperationState()
        resolve(nil)
    }

    @objc
    static func requiresMainQueueSetup() -> Bool {
        true
    }

    private func generateAttemptId() -> String {
        let timestamp = Date().timeIntervalSince1970
        let random = Int.random(in: 100000..<999999)
        return String(format: "nfc_%d_%d", Int(timestamp * 1000), random)
    }

    private func setCurrentAttemptId(_ id: String) {
        operationLock.lock()
        currentAttemptId = id
        operationLock.unlock()
    }

    private func logAttempt(attemptId: String?, event: String, details: [String: Any]? = nil) {
        let id = attemptId ?? currentAttemptId ?? "unknown"
        var message = "[PassportVerification][Attempt \(id)] \(event)"
        if let details = details, !details.isEmpty {
            let detailStr = details
                .map { key, value in "\(key)=\(value)" }
                .joined(separator: " ")
            message += " {\(detailStr)}"
        }
        NSLog("%@", message)
    }

    private func resolveOnce(_ payload: [String: Any], resolve: RCTPromiseResolveBlock, attemptId: String? = nil) {
        operationLock.lock()
        defer { operationLock.unlock() }
        guard !hasResolvedOrRejected else {
            logAttempt(attemptId: attemptId, event: "resolveOnce called but already resolved/rejected, ignoring")
            return
        }
        hasResolvedOrRejected = true
        logAttempt(attemptId: attemptId, event: "resolving promise")
        resolve(payload)
    }

    private func resetOperationState() {
        operationLock.lock()
        hasResolvedOrRejected = false
        hasUsableResults = false
        didFinishReading = false
        finalResult = nil
        operationLock.unlock()
    }

    private func markReadCompleted(result: [String: Any]) {
        operationLock.lock()
        didFinishReading = true
        finalResult = result
        hasUsableResults = isUsableResult(result)
        operationLock.unlock()
    }

    private func snapshotOperationState() -> (
        hasResolvedOrRejected: Bool,
        hasUsableResults: Bool,
        didFinishReading: Bool,
        finalResult: [String: Any]?
    ) {
        operationLock.lock()
        let snapshot = (hasResolvedOrRejected, hasUsableResults, didFinishReading, finalResult)
        operationLock.unlock()
        return snapshot
    }

    private func isUsableResult(_ result: [String: Any]) -> Bool {
        if let finalStatus = result["finalStatus"] as? String, finalStatus != "error" {
            return true
        }
        guard let files = result["files"] as? [String: Any] else {
            return false
        }
        return ["DG1", "DG2"].contains { key in
            guard
                let entry = files[key] as? [String: Any],
                let status = entry["status"] as? String
            else {
                return false
            }
            return status == "ok"
        }
    }

    private func validateResult(_ result: [String: Any], attemptId: String?) -> PassportBridgeError? {
        // Validate required top-level fields
        guard let finalStatus = result["finalStatus"] as? String else {
            logAttempt(attemptId: attemptId, event: "result validation failed: missing finalStatus")
            return PassportBridgeError.invalidInput("Result missing finalStatus")
        }

        guard ["success", "partial_success", "error"].contains(finalStatus) else {
            logAttempt(attemptId: attemptId, event: "result validation failed: invalid finalStatus", details: [
                "finalStatus": finalStatus
            ])
            return PassportBridgeError.invalidInput("Invalid finalStatus: \(finalStatus)")
        }

        guard let files = result["files"] as? [String: Any] else {
            logAttempt(attemptId: attemptId, event: "result validation failed: missing files dict")
            return PassportBridgeError.invalidInput("Result missing files")
        }

        // Validate each file entry has a status
        for (fileKey, fileEntry) in files {
            guard let entry = fileEntry as? [String: Any],
                  let status = entry["status"] as? String else {
                logAttempt(attemptId: attemptId, event: "result validation failed: invalid file entry", details: [
                    "file": fileKey
                ])
                return PassportBridgeError.invalidInput("Invalid file entry: \(fileKey)")
            }

            guard ["ok", "missing", "error"].contains(status) else {
                logAttempt(attemptId: attemptId, event: "result validation failed: invalid file status", details: [
                    "file": fileKey,
                    "status": status
                ])
                return PassportBridgeError.invalidInput("Invalid file status: \(status)")
            }
        }

        logAttempt(attemptId: attemptId, event: "result validation passed", details: [
            "finalStatus": finalStatus,
            "fileCount": files.count
        ])
        return nil
    }

    private func shouldIgnorePostCompletionInvalidation(_ error: Error) -> Bool {
        let state = snapshotOperationState()
        guard state.didFinishReading, state.hasUsableResults else {
            return false
        }

        if let passportError = error as? NFCPassportReaderError {
            switch passportError {
            case .ConnectionError, .UnexpectedError:
                return true
            case .Unknown(let innerError):
                return innerError is NFCReaderError
            default:
                return false
            }
        }

        return error is NFCReaderError
    }

    private func rejectWithMappedError(_ error: Error, reject: RCTPromiseRejectBlock, attemptId: String? = nil) {
        let rejection = PassportVerificationErrorMapper.bridgeRejection(for: error)
        logAttempt(attemptId: attemptId, event: "mapped error", details: [
            "code": rejection.code,
            "message": rejection.message
        ])
        rejectLogged(
            code: rejection.code,
            message: rejection.message,
            error: rejection.error,
            reject: reject,
            attemptId: attemptId
        )
    }

    private func rejectLogged(
        code: String,
        message: String,
        error: Error,
        reject: RCTPromiseRejectBlock,
        attemptId: String? = nil
    ) {
        operationLock.lock()
        if hasResolvedOrRejected {
            operationLock.unlock()
            logAttempt(attemptId: attemptId, event: "rejectLogged called but already resolved/rejected, ignoring")
            return
        }
        hasResolvedOrRejected = true
        operationLock.unlock()

        logAttempt(attemptId: attemptId, event: "rejecting promise", details: [
            "code": code,
            "message": message
        ])

        if code != "USER_CANCELED" && code != "NFC_USER_CANCELLED" {
            NSLog("[PassportVerification][ERROR] attempt=%@: %@: %@", attemptId ?? "unknown", code, message)
        }
        reject(code, message, error)
    }
}
