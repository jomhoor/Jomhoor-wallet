import Foundation
import NFCPassportReader

enum PassportBridgeError: Error {
    case unsupportedPlatform
    case invalidInput(String)
    case nfcSessionBusy
    case nfcTagNotDetected(String)
    case paceUnsupported
    case bacFailed
    case noDataRead
    case nativeTimeout(String)
}

enum AccessControlMethod: String {
    case pace = "PACE"
    case bac = "BAC"

    static func from(input: [String: Any]) -> AccessControlMethod {
        let value = ((input["preferredAccessControl"] as? String) ?? "BAC").uppercased()
        return value == "BAC" ? .bac : .pace
    }
}

enum RequestedDataGroup: String {
    case dg1 = "DG1"
    case dg2 = "DG2"
    case dg11 = "DG11"
    case dg12 = "DG12"
    case dg13 = "DG13"
    case dg15 = "DG15"
    case com = "COM"
    case sod = "SOD"
    case cardAccess = "CardAccess"

    init?(name: String) {
        let normalized = name.uppercased()
        switch normalized {
        case "DG1": self = .dg1
        case "DG2": self = .dg2
        case "DG11": self = .dg11
        case "DG12": self = .dg12
        case "DG13": self = .dg13
        case "DG15": self = .dg15
        case "COM": self = .com
        case "SOD": self = .sod
        case "CARDACCESS": self = .cardAccess
        default: return nil
        }
    }

    var dataGroupId: DataGroupId? {
        switch self {
        case .dg1: return .DG1
        case .dg2: return .DG2
        case .dg11: return .DG11
        case .dg12: return .DG12
        case .dg13: return .DG13
        case .dg15: return .DG15
        case .com: return .COM
        case .sod: return .SOD
        case .cardAccess: return nil
        }
    }

    var responseKey: String {
        switch self {
        case .cardAccess:
            return "CardAccess"
        default:
            return rawValue
        }
    }
}

struct ReadAttemptResult {
    let preferredMethod: AccessControlMethod
    let usedMethod: AccessControlMethod?
    let fallbackUsed: Bool
    let fallbackReason: String?
    let passport: NFCPassportModel?
    let error: Error?
    let readerSnapshot: PassportReaderDebugSnapshot?
}

struct PassportReadConfiguration {
    let mrzKey: String
    let preferredMethod: AccessControlMethod
    let allowBacFallback: Bool
    let includeImageBase64: Bool
    let persistDg2ImageFile: Bool
    let activeAuthenticationChallenge: [UInt8]?
    let activeAuthenticationChallengeHex: String?
    let requestedGroups: [RequestedDataGroup]
}

struct PassportProbeConfiguration {
    let readConfiguration: PassportReadConfiguration
    let allowPaceProbe: Bool
    let includeAtr: Bool
    let includeHistoricalBytes: Bool
    let includeCardAccessProbe: Bool
    let includeComProbe: Bool
    let includeMinimalApduProbe: Bool
}

struct RawNfcProbeConfiguration {
    let mode: String
    let pollingMode: String
    let includeAtr: Bool
    let includeHistoricalBytes: Bool
    let includeMinimalApduProbe: Bool
    let includeCardAccessProbe: Bool
    let includeComProbe: Bool
}
