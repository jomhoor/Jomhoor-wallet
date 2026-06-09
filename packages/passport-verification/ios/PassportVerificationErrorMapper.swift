import CoreNFC
import Foundation
import NFCPassportReader

enum PassportVerificationErrorMapper {
    static func bridgeRejection(for error: Error) -> (code: String, message: String, error: Error) {
        let nsError = error as NSError
        if nsError.domain == "com.iland.passportverification.PassportBridgeError",
           let code = nsError.userInfo["bridgeCode"] as? String
        {
            let message = (nsError.userInfo["bridgeMessage"] as? String) ?? nsError.localizedDescription
            return (code, message, error)
        }

        if let bridgeError = error as? PassportBridgeError {
            switch bridgeError {
            case .unsupportedPlatform:
                return ("UNSUPPORTED_PLATFORM", "iOS 15+ is required for this module.", error)
            case .invalidInput(let message):
                return ("INVALID_INPUT", message, error)
            case .nfcSessionBusy:
                return ("NFC_SESSION_BUSY", "A passport read is already in progress.", error)
            case .nfcTagNotDetected(let message):
                return ("NFC_TAG_NOT_DETECTED", message, error)
            case .paceUnsupported:
                return ("PACE_UNSUPPORTED", "PACE did not succeed for this document.", error)
            case .bacFailed:
                return ("BAC_FAILED", "BAC authentication failed.", error)
            case .noDataRead:
                return ("NO_DATA_READ", "No readable data groups were retrieved.", error)
            case .nativeTimeout(let message):
                return ("NFC_TIMEOUT", message, error)
            }
        }

        if let passportError = error as? NFCPassportReaderError {
            switch passportError {
            case .ResponseError(let message, let sw1, let sw2):
                let sw = String(format: "%02X%02X", sw1, sw2)
                if message == "Security status not satisfied" {
                    return (
                        "SECURITY_STATUS_NOT_SATISFIED",
                        "Security status not satisfied (SW=\(sw)).",
                        error
                    )
                } else if message == "File not found" {
                    return ("FILE_NOT_FOUND", "Requested file not found (SW=\(sw)).", error)
                } else {
                    return ("APDU_RESPONSE_ERROR", "\(message) (SW=\(sw)).", error)
                }
            case .TagNotValid:
                return ("NON_ISO7816_TAG", "Detected tag is not an ISO7816 passport chip.", error)
            case .ConnectionError:
                return ("NFC_SESSION_INVALIDATED", "NFC connection lost while reading passport.", error)
            case .UserCanceled:
                return ("NFC_USER_CANCELLED", "User canceled NFC session.", error)
            case .TimeOutError:
                return ("NFC_TIMEOUT", "NFC session timed out.", error)
            case .InvalidMRZKey:
                return ("INVALID_CREDENTIALS", "Provided MRZ key is invalid.", error)
            case .NotYetSupported(let reason):
                return ("PACE_UNSUPPORTED", reason, error)
            case .PACEError(let step, let reason):
                return ("PACE_FAILED", "PACE failed at \(step): \(reason)", error)
            case .UnexpectedError:
                return ("NFC_SESSION_INVALIDATED", "NFC session invalidated unexpectedly.", error)
            case .Unknown(let innerError):
                if let nfcError = extractNfcReaderError(from: innerError) {
                    let mapped = mapNfcReaderError(nfcError)
                    return (mapped.code, mapped.message, error)
                }
                if let mapped = mapNfcNSError(innerError as NSError) {
                    return (mapped.code, mapped.message, error)
                }
                return ("PASSPORT_READ_FAILED", innerError.localizedDescription, error)
            default:
                return ("PASSPORT_READ_FAILED", error.localizedDescription, error)
            }
        }

        if let nfcError = error as? NFCReaderError {
            let mapped = mapNfcReaderError(nfcError)
            return (mapped.code, mapped.message, nfcError)
        }

        return ("UNKNOWN_ERROR", error.localizedDescription, error)
    }

    static func errorInfo(_ error: Error) -> [String: Any] {
        let nsError = error as NSError
        if nsError.domain == "com.iland.passportverification.PassportBridgeError",
           let code = nsError.userInfo["bridgeCode"] as? String
        {
            return [
                "code": code,
                "message": (nsError.userInfo["bridgeMessage"] as? String) ?? nsError.localizedDescription,
            ]
        }

        if let bridgeError = error as? PassportBridgeError {
            switch bridgeError {
            case .unsupportedPlatform:
                return ["code": "UNSUPPORTED_PLATFORM", "message": "iOS 15+ is required for this module."]
            case .invalidInput(let message):
                return ["code": "INVALID_INPUT", "message": message]
            case .nfcSessionBusy:
                return ["code": "NFC_SESSION_BUSY", "message": "A passport read is already in progress."]
            case .nfcTagNotDetected(let message):
                return ["code": "NFC_TAG_NOT_DETECTED", "message": message]
            case .paceUnsupported:
                return ["code": "PACE_UNSUPPORTED", "message": "PACE did not succeed for this document."]
            case .bacFailed:
                return ["code": "BAC_FAILED", "message": "BAC authentication failed."]
            case .noDataRead:
                return ["code": "NO_DATA_READ", "message": "No readable data groups were retrieved."]
            case .nativeTimeout(let message):
                return ["code": "NFC_TIMEOUT", "message": message]
            }
        }

        if let passportError = error as? NFCPassportReaderError {
            switch passportError {
            case .ResponseError(let message, let sw1, let sw2):
                return [
                    "code": "APDU_RESPONSE_ERROR",
                    "message": message,
                    "statusWord": String(format: "%02X%02X", sw1, sw2),
                ]
            case .TagNotValid:
                return ["code": "NON_ISO7816_TAG", "message": "Detected tag is not an ISO7816 passport chip."]
            case .ConnectionError:
                return ["code": "NFC_SESSION_INVALIDATED", "message": "NFC connection lost while reading passport."]
            case .UserCanceled:
                return ["code": "NFC_USER_CANCELLED", "message": "User canceled NFC session."]
            case .TimeOutError:
                return ["code": "NFC_TIMEOUT", "message": "NFC session timed out."]
            case .InvalidMRZKey:
                return ["code": "INVALID_CREDENTIALS", "message": "Provided MRZ key is invalid."]
            case .NotYetSupported(let reason):
                return ["code": "NOT_YET_SUPPORTED", "message": reason]
            case .PACEError(let step, let reason):
                return ["code": "PACE_FAILED", "message": "PACE failed at \(step): \(reason)"]
            case .UnexpectedError:
                return ["code": "NFC_SESSION_INVALIDATED", "message": "NFC session invalidated unexpectedly."]
            case .Unknown(let innerError):
                if let nfcError = extractNfcReaderError(from: innerError) {
                    let mapped = mapNfcReaderError(nfcError)
                    return ["code": mapped.code, "message": mapped.message]
                }
                if let mapped = mapNfcNSError(innerError as NSError) {
                    return ["code": mapped.code, "message": mapped.message]
                }
                return ["code": "PASSPORT_READ_FAILED", "message": innerError.localizedDescription]
            default:
                return ["code": "PASSPORT_READ_FAILED", "message": error.localizedDescription]
            }
        }

        if let nfcError = error as? NFCReaderError {
            let mapped = mapNfcReaderError(nfcError)
            return ["code": mapped.code, "message": mapped.message]
        }

        return ["code": "UNKNOWN_ERROR", "message": error.localizedDescription]
    }

    static func shouldFallbackToBac(_ error: Error) -> Bool {
        if let bridgeError = error as? PassportBridgeError {
            if case .paceUnsupported = bridgeError {
                return true
            }
            return false
        }

        guard let passportError = error as? NFCPassportReaderError else {
            return false
        }

        switch passportError {
        case .NotYetSupported(_):
            return true
        case .PACEError(_, _):
            return true
        case .ResponseError(let message, let sw1, let sw2):
            let sw = ((Int(sw1) << 8) | Int(sw2)) & 0xFFFF
            return message.localizedCaseInsensitiveContains("pace") || sw == 0x6982
        default:
            return false
        }
    }

    static func shouldFallbackToPace(_ error: Error) -> Bool {
        if let bridgeError = error as? PassportBridgeError {
            if case .bacFailed = bridgeError {
                return true
            }
            return false
        }

        guard let passportError = error as? NFCPassportReaderError else {
            return false
        }

        switch passportError {
        case .ResponseError(let message, let sw1, let sw2):
            let sw = ((Int(sw1) << 8) | Int(sw2)) & 0xFFFF
            return message.localizedCaseInsensitiveContains("security status not satisfied")
                || sw == 0x6982
        default:
            return false
        }
    }

    static func isFatalSessionError(_ error: Error) -> Bool {
        if let nfcError = extractNfcReaderError(from: error) {
            switch nfcError.code {
            case .readerSessionInvalidationErrorSystemIsBusy,
                 .readerSessionInvalidationErrorSessionTerminatedUnexpectedly,
                 .readerSessionInvalidationErrorUserCanceled,
                 .readerSessionInvalidationErrorSessionTimeout:
                return true
            default:
                return true
            }
        }

        if let passportError = error as? NFCPassportReaderError {
            switch passportError {
            case .ConnectionError, .TimeOutError, .UserCanceled, .UnexpectedError:
                return true
            case .Unknown(let innerError):
                return isFatalSessionError(innerError)
            default:
                return false
            }
        }

        let nsError = error as NSError
        if mapNfcNSError(nsError) != nil {
            return true
        }

        return false
    }

    static func isTerminalNfcAttemptError(_ error: Error) -> Bool {
        if let bridgeError = error as? PassportBridgeError {
            switch bridgeError {
            case .nfcTagNotDetected, .nfcSessionBusy, .nativeTimeout:
                return true
            default:
                break
            }
        }

        if isFatalSessionError(error) {
            return true
        }

        let code = (errorInfo(error)["code"] as? String) ?? ""
        switch code {
        case "NFC_RESOURCE_UNAVAILABLE",
             "NFC_SESSION_INVALIDATED",
             "NFC_APP_INTERRUPTED",
             "NFC_USER_CANCELLED",
             "NFC_TAG_NOT_DETECTED",
             "NFC_TIMEOUT":
            return true
        default:
            return false
        }
    }

    static func errorDebugDetails(_ error: Error) -> [String: Any] {
        let nsError = error as NSError
        var details: [String: Any] = [
            "errorDomain": nsError.domain,
            "errorCode": nsError.code,
            "errorMessage": error.localizedDescription,
        ]
        if let sessionCreated = nsError.userInfo["sessionCreated"] {
            details["sessionCreated"] = sessionCreated
        }
        if let beginRequested = nsError.userInfo["beginRequested"] {
            details["beginRequested"] = beginRequested
        }
        if let didBecomeActive = nsError.userInfo["didBecomeActive"] {
            details["didBecomeActive"] = didBecomeActive
        }
        if let preActiveFailureCode = nsError.userInfo["preActiveFailureCode"] {
            details["preActiveFailureCode"] = preActiveFailureCode
        }
        return details
    }

    private static func mapNfcReaderError(_ error: NFCReaderError) -> (code: String, message: String) {
        switch error.code {
        case .readerSessionInvalidationErrorSystemIsBusy:
            return ("NFC_RESOURCE_UNAVAILABLE", "NFC system resource unavailable.")
        case .readerSessionInvalidationErrorSessionTerminatedUnexpectedly:
            return ("NFC_APP_INTERRUPTED", "NFC session was interrupted.")
        case .readerSessionInvalidationErrorUserCanceled:
            return ("NFC_USER_CANCELLED", "User canceled NFC session.")
        case .readerSessionInvalidationErrorSessionTimeout:
            return ("NFC_TIMEOUT", "NFC session timed out.")
        default:
            return ("NFC_SESSION_INVALIDATED", error.localizedDescription)
        }
    }

    private static func extractNfcReaderError(from error: Error) -> NFCReaderError? {
        error as? NFCReaderError
    }

    private static func mapNfcNSError(_ error: NSError) -> (code: String, message: String)? {
        guard error.domain == "NFCError" || error.domain == NFCReaderError.errorDomain else {
            return nil
        }

        switch error.code {
        case 203:
            return ("NFC_RESOURCE_UNAVAILABLE", "NFC system resource unavailable.")
        case 202:
            return ("NFC_APP_INTERRUPTED", "NFC session was interrupted.")
        case 201:
            return ("NFC_TIMEOUT", "NFC session timed out.")
        case 200:
            return ("NFC_USER_CANCELLED", "User canceled NFC session.")
        default:
            return ("NFC_SESSION_INVALIDATED", error.localizedDescription)
        }
    }
}
