import Foundation
import NFCPassportReader

enum PassportVerificationInputValidator {
    static func configuration(from input: [String: Any]) throws -> PassportReadConfiguration {
        let credentials = (input["credentials"] as? [String: Any]) ?? input
        guard let mrzKey = extractMrzKey(from: credentials), !mrzKey.isEmpty else {
            throw PassportBridgeError.invalidInput(
                "Missing credentials. Provide credentials.mrzKey or credentials.documentNumber/dateOfBirth/dateOfExpiry."
            )
        }
        let activeAuthenticationChallengeHex = try parseActiveAuthenticationChallengeHex(from: input)

        return PassportReadConfiguration(
            mrzKey: mrzKey,
            preferredMethod: AccessControlMethod.from(input: input),
            allowBacFallback: (input["allowBacFallback"] as? Bool) ?? true,
            includeImageBase64: (input["includeImageBase64"] as? Bool) ?? false,
            persistDg2ImageFile: parsePersistDg2ImageFile(from: input),
            activeAuthenticationChallenge: try parseActiveAuthenticationChallenge(from: activeAuthenticationChallengeHex),
            activeAuthenticationChallengeHex: activeAuthenticationChallengeHex,
            requestedGroups: try parseRequestedGroups(from: input)
        )
    }

    static func tagsToRead(
        for groups: [RequestedDataGroup],
        includeActiveAuthenticationSupport: Bool = false
    ) -> [DataGroupId] {
        var tags: [DataGroupId] = []
        for group in groups {
            if let id = group.dataGroupId, !tags.contains(id) {
                tags.append(id)
            }
        }

        if includeActiveAuthenticationSupport && !tags.contains(.DG15) {
            tags.append(.DG15)
        }

        if tags.isEmpty {
            return [.COM]
        }

        return tags
    }

    static func probeConfiguration(from input: [String: Any]) throws -> PassportProbeConfiguration {
        let readConfiguration = try configuration(from: input)
        return PassportProbeConfiguration(
            readConfiguration: readConfiguration,
            allowPaceProbe: (input["allowPaceProbe"] as? Bool) ?? true,
            includeAtr: (input["includeAtr"] as? Bool) ?? true,
            includeHistoricalBytes: (input["includeHistoricalBytes"] as? Bool) ?? true,
            includeCardAccessProbe: (input["includeCardAccessProbe"] as? Bool) ?? true,
            includeComProbe: (input["includeComProbe"] as? Bool) ?? true,
            includeMinimalApduProbe: (input["includeMinimalApduProbe"] as? Bool) ?? true
        )
    }

    static func rawProbeConfiguration(from input: [String: Any]) -> RawNfcProbeConfiguration {
        let rawMode = (input["mode"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let mode: String
        switch rawMode {
        case "detect_only":
            mode = "detect_only"
        default:
            mode = "iso7816_apdu"
        }

        let rawPollingMode = (input["pollingMode"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let pollingMode: String
        switch rawPollingMode {
        case "broad":
            pollingMode = "broad"
        default:
            pollingMode = "passport_default"
        }

        return RawNfcProbeConfiguration(
            mode: mode,
            pollingMode: pollingMode,
            includeAtr: (input["includeAtr"] as? Bool) ?? true,
            includeHistoricalBytes: (input["includeHistoricalBytes"] as? Bool) ?? true,
            includeMinimalApduProbe: (input["includeMinimalApduProbe"] as? Bool) ?? true,
            includeCardAccessProbe: (input["includeCardAccessProbe"] as? Bool) ?? true,
            includeComProbe: (input["includeComProbe"] as? Bool) ?? true
        )
    }

    private static func parseRequestedGroups(from input: [String: Any]) throws -> [RequestedDataGroup] {
        let defaultGroups: [RequestedDataGroup] = [.com, .sod, .dg1, .dg2, .dg11, .dg12, .dg13, .dg15, .cardAccess]
        guard let requested = input["dataGroups"] else {
            return defaultGroups
        }

        guard let names = requested as? [String], !names.isEmpty else {
            throw PassportBridgeError.invalidInput("dataGroups must be a non-empty array of strings.")
        }

        var groups: [RequestedDataGroup] = []
        for name in names {
            guard let group = RequestedDataGroup(name: name) else {
                throw PassportBridgeError.invalidInput("Unsupported data group '\(name)'.")
            }
            if !groups.contains(where: { $0 == group }) {
                groups.append(group)
            }
        }

        return groups
    }

    private static func extractMrzKey(from input: [String: Any]) -> String? {
        if let mrzKey = input["mrzKey"] as? String, !mrzKey.isEmpty {
            return mrzKey
        }
        if let mrzKey = input["MRZKey"] as? String, !mrzKey.isEmpty {
            return mrzKey
        }

        guard
            let documentNumber = input["documentNumber"] as? String,
            let dateOfBirth = input["dateOfBirth"] as? String,
            let dateOfExpiry = input["dateOfExpiry"] as? String,
            dateOfBirth.count == 6,
            dateOfExpiry.count == 6
        else {
            return nil
        }

        let doc = documentNumber.uppercased()
        return doc
            + checkDigit(doc)
            + dateOfBirth
            + checkDigit(dateOfBirth)
            + dateOfExpiry
            + checkDigit(dateOfExpiry)
    }

    private static func parseActiveAuthenticationChallengeHex(from input: [String: Any]) throws -> String? {
        guard let raw = activeAuthenticationChallengeString(from: input) else {
            return nil
        }

        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .uppercased()

        guard !normalized.isEmpty else {
            throw PassportBridgeError.invalidInput(
                "activeAuthenticationChallenge must be a non-empty 16-character hex string."
            )
        }

        guard normalized.count == 16 else {
            throw PassportBridgeError.invalidInput(
                "activeAuthenticationChallenge must be exactly 8 bytes (16 hex characters)."
            )
        }

        guard normalized.allSatisfy({ $0.isHexDigit }) else {
            throw PassportBridgeError.invalidInput(
                "activeAuthenticationChallenge must contain only hex characters."
            )
        }

        return normalized
    }

    private static func parseActiveAuthenticationChallenge(from hex: String?) throws -> [UInt8]? {
        guard let hex else {
            return nil
        }

        var bytes: [UInt8] = []
        bytes.reserveCapacity(hex.count / 2)

        var index = hex.startIndex
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            let byteString = String(hex[index..<nextIndex])
            guard let byte = UInt8(byteString, radix: 16) else {
                throw PassportBridgeError.invalidInput(
                    "activeAuthenticationChallenge must contain only hex characters."
                )
            }
            bytes.append(byte)
            index = nextIndex
        }

        return bytes
    }

    private static func activeAuthenticationChallengeString(from input: [String: Any]) -> String? {
        if let challenge = input["activeAuthenticationChallenge"] as? String {
            return challenge
        }
        if let challenge = input["aaChallenge"] as? String {
            return challenge
        }
        return nil
    }

    private static func parsePersistDg2ImageFile(from input: [String: Any]) -> Bool {
        if let persist = input["persistDg2ImageFile"] as? Bool {
            return persist
        }
        if let persist = input["persistImageFile"] as? Bool {
            return persist
        }
        return false
    }

    private static func checkDigit(_ value: String) -> String {
        let weights = [7, 3, 1]
        var sum = 0

        for (index, scalar) in value.unicodeScalars.enumerated() {
            let mapped: Int
            switch scalar.value {
            case 48...57: // 0-9
                mapped = Int(scalar.value - 48)
            case 65...90: // A-Z
                mapped = Int(scalar.value - 55)
            case 97...122: // a-z
                mapped = Int(scalar.value - 87)
            default:
                mapped = 0
            }
            sum += mapped * weights[index % 3]
        }

        return String(sum % 10)
    }
}
