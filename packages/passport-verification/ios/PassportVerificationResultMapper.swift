import Foundation
import NFCPassportReader

enum PassportVerificationResultMapper {
    static func buildResult(
        preferredMethod: AccessControlMethod,
        usedMethod: AccessControlMethod?,
        fallbackUsed: Bool,
        fallbackReason: String?,
        paceStatus: String,
        bacStatus: String,
        paceSupported: Bool,
        accessControlError: [String: Any]?,
        activeAuthentication: [String: Any]?,
        files: [String: Any]
    ) -> [String: Any] {
        let successCount = files.values.filter { fileStatus($0) == "ok" }.count
        let errorCount = files.values.filter { fileStatus($0) == "error" }.count
        let finalStatus: String
        if successCount == 0 {
            finalStatus = "error"
        } else if errorCount == 0 {
            finalStatus = "success"
        } else {
            finalStatus = "partial_success"
        }

        let accessControl: [String: Any] = [
            "preferred": preferredMethod.rawValue,
            "used": usedMethod?.rawValue ?? NSNull(),
            "fallbackUsed": fallbackUsed,
            "fallbackReason": fallbackReason ?? NSNull(),
            "paceStatus": paceStatus,
            "bacStatus": bacStatus,
            "paceSupported": paceSupported,
            "error": accessControlError ?? NSNull(),
        ]

        let okData = extractOkData(from: files)
        // Baseline contract for JS callers:
        // - `files` always contains per-group entries with `status: ok|error`.
        // - `finalStatus` is currently one of `success`, `partial_success`, or `error`.
        // - `data` is a convenience projection of only the `ok` file entries.
        // - `method`, `preferredAccessControl`, and `fallbackUsed` are compatibility keys kept for existing JS consumers.
        var result: [String: Any] = [
            "accessControl": accessControl,
            "files": files,
            "finalStatus": finalStatus,
            "success": finalStatus != "error",
            "method": usedMethod?.rawValue ?? NSNull(),
            "preferredAccessControl": preferredMethod.rawValue,
            "fallbackUsed": fallbackUsed,
            "metadata": [
                "paceStatus": paceStatus,
                "bacStatus": bacStatus,
                "paceSupported": paceSupported,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "fallbackReason": fallbackReason ?? NSNull(),
            ],
            "data": okData,
        ]

        if let activeAuthentication {
            result["activeAuthentication"] = activeAuthentication
        }

        return result
    }

    static func fileEntry(
        for group: RequestedDataGroup,
        passport: NFCPassportModel,
        includeImageBase64: Bool,
        persistDg2ImageFile: Bool
    ) -> [String: Any] {
        switch group {
        case .dg1:
            guard let dg1 = passport.getDataGroup(.DG1) as? DataGroup1 else {
                return errorFileEntry(group: group, message: "DG1 is not available on this document.", code: "FILE_NOT_FOUND")
            }
            let mrz = passport.passportMRZ
            let parsed: [String: Any] = [
                "mrz": mrz,
                "mrzLines": splitMRZLines(mrz),
                "documentNumber": passport.documentNumber,
                "personalNumber": passport.personalNumber ?? NSNull(),
                "issuingAuthority": passport.issuingAuthority,
                "dateOfBirth": passport.dateOfBirth,
                "documentExpiryDate": passport.documentExpiryDate,
                "nationality": passport.nationality,
                "gender": passport.gender,
                "firstName": passport.firstName,
                "lastName": passport.lastName,
                "elements": dg1.elements,
            ]
            return okFileEntry(name: "DG1", rawHex: toHex(dg1.data), parsed: parsed)

        case .dg11:
            guard let dg11 = passport.getDataGroup(.DG11) as? DataGroup11 else {
                return errorFileEntry(group: group, message: "DG11 is not available on this document.", code: "FILE_NOT_FOUND")
            }
            let parsed: [String: Any] = [
                "fullName": dg11.fullName ?? NSNull(),
                "personalNumber": dg11.personalNumber ?? NSNull(),
                "dateOfBirth": dg11.dateOfBirth ?? NSNull(),
                "placeOfBirth": dg11.placeOfBirth ?? NSNull(),
                "address": dg11.address ?? NSNull(),
                "telephone": dg11.telephone ?? NSNull(),
                "profession": dg11.profession ?? NSNull(),
                "title": dg11.title ?? NSNull(),
                "personalSummary": dg11.personalSummary ?? NSNull(),
                "proofOfCitizenship": dg11.proofOfCitizenship ?? NSNull(),
                "tdNumbers": dg11.tdNumbers ?? NSNull(),
                "custodyInfo": dg11.custodyInfo ?? NSNull(),
            ]
            return okFileEntry(name: "DG11", rawHex: toHex(dg11.data), parsed: parsed)

        case .dg2:
            guard let dg2 = passport.getDataGroup(.DG2) as? DataGroup2 else {
                return errorFileEntry(group: group, message: "DG2 is not available on this document.", code: "FILE_NOT_FOUND")
            }
            cleanupGeneratedDg2TempFiles()
            let imageFormat = detectImageFormat(dg2.imageData)
            let filePath = persistDg2ImageFile ? persistImageToTempFile(dg2.imageData, format: imageFormat) : nil
            let imageHex: Any = dg2.imageData.isEmpty ? NSNull() : toHex(dg2.imageData)
            let imageBase64: Any =
                includeImageBase64 && !dg2.imageData.isEmpty
                ? Data(dg2.imageData).base64EncodedString()
                : NSNull()
            let parsed: [String: Any] = [
                "numberOfFacialImages": dg2.numberOfFacialImages,
                "imageWidth": dg2.imageWidth,
                "imageHeight": dg2.imageHeight,
                "imageDataType": dg2.imageDataType,
                "imageByteLength": dg2.imageData.count,
                "hasFaceImage": dg2.imageData.count > 0,
                "imageFormat": imageFormat,
                "imageHex": imageHex,
                "imageBase64Included": includeImageBase64 && !dg2.imageData.isEmpty,
                "imageFilePersisted": filePath != nil,
                "filePath": filePath ?? NSNull(),
                "imageBase64": imageBase64,
            ]
            return [
                "status": "ok",
                "name": "DG2",
                "rawHex": toHex(dg2.data),
                "parsed": parsed,
                "imageFormat": imageFormat,
                "imageHex": imageHex,
                "filePath": filePath ?? NSNull(),
                "imageBase64": imageBase64,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
            ]

        case .dg12:
            guard let dg12 = passport.getDataGroup(.DG12) as? DataGroup12 else {
                return errorFileEntry(group: group, message: "DG12 is not available on this document.", code: "FILE_NOT_FOUND")
            }
            let parsed: [String: Any] = [
                "issuingAuthority": dg12.issuingAuthority ?? NSNull(),
                "dateOfIssue": dg12.dateOfIssue ?? NSNull(),
                "otherPersonsDetails": dg12.otherPersonsDetails ?? NSNull(),
                "endorsementsOrObservations": dg12.endorsementsOrObservations ?? NSNull(),
                "taxOrExitRequirements": dg12.taxOrExitRequirements ?? NSNull(),
                "personalizationTime": dg12.personalizationTime ?? NSNull(),
                "personalizationDeviceSerialNr": dg12.personalizationDeviceSerialNr ?? NSNull(),
                "frontImageByteLength": dg12.frontImage?.count ?? 0,
                "rearImageByteLength": dg12.rearImage?.count ?? 0,
            ]
            return okFileEntry(name: "DG12", rawHex: toHex(dg12.data), parsed: parsed)

        case .dg13:
            guard let dg13 = passport.getDataGroup(.DG13) else {
                return errorFileEntry(group: group, message: "DG13 is not available on this document.", code: "FILE_NOT_FOUND")
            }
            let parsed: [String: Any] = [
                "supportedParser": false,
                "description": "DG13 parsed as raw data only in this build.",
                "bodyByteLength": dg13.body.count,
            ]
            return okFileEntry(name: "DG13", rawHex: toHex(dg13.data), parsed: parsed)

        case .dg15:
            guard let dg15 = passport.getDataGroup(.DG15) as? DataGroup15 else {
                return errorFileEntry(group: group, message: "DG15 is not available on this document.", code: "FILE_NOT_FOUND")
            }
            let parsed: [String: Any] = [
                "hasRsaPublicKey": dg15.rsaPublicKey != nil,
                "hasEcdsaPublicKey": dg15.ecdsaPublicKey != nil,
                "activeAuthenticationSupported": passport.activeAuthenticationSupported,
            ]
            return okFileEntry(name: "DG15", rawHex: toHex(dg15.data), parsed: parsed)

        case .com:
            guard let com = passport.getDataGroup(.COM) as? COM else {
                return errorFileEntry(group: group, message: "COM is not available on this document.", code: "FILE_NOT_FOUND")
            }
            let parsed: [String: Any] = [
                "ldsVersion": com.version,
                "unicodeVersion": com.unicodeVersion,
                "dataGroupsPresent": com.dataGroupsPresent,
            ]
            return okFileEntry(name: "COM", rawHex: toHex(com.data), parsed: parsed)

        case .sod:
            guard let sod = passport.getDataGroup(.SOD) else {
                return errorFileEntry(group: group, message: "SOD is not available on this document.", code: "FILE_NOT_FOUND")
            }
            let hashes = passport.dataGroupHashes.values.sorted { $0.id < $1.id }
            let parsedHashes = hashes.map {
                [
                    "id": $0.id,
                    "sodHash": $0.sodHash,
                    "computedHash": $0.computedHash,
                    "match": $0.match,
                ]
            }
            let parsed: [String: Any] = [
                "hashAlgorithm": inferHashAlgorithm(from: hashes),
                "dgHashes": parsedHashes,
                "passportCorrectlySigned": passport.passportCorrectlySigned,
                "documentSigningCertificateVerified": passport.documentSigningCertificateVerified,
                "passportDataNotTampered": passport.passportDataNotTampered,
                "verificationErrors": passport.verificationErrors.map { $0.localizedDescription },
            ]
            return okFileEntry(name: "SOD", rawHex: toHex(sod.data), parsed: parsed)

        case .cardAccess:
            guard let cardAccess = passport.cardAccess else {
                return errorFileEntry(group: group, message: "EF.CardAccess is not available or readable for this document.", code: "FILE_NOT_FOUND")
            }
            let protocols = cardAccess.securityInfos.map { $0.getProtocolOIDString() }
            let objectIdentifiers = cardAccess.securityInfos.map { $0.getObjectIdentifier() }
            let parsed: [String: Any] = [
                "paceSupported": passport.isPACESupported,
                "securityInfoCount": cardAccess.securityInfos.count,
                "protocols": protocols,
                "objectIdentifiers": objectIdentifiers,
            ]
            return okFileEntry(name: "CardAccess", rawHex: NSNull(), parsed: parsed)
        }
    }

    static func errorFileEntry(group: RequestedDataGroup, message: String, code: String) -> [String: Any] {
        [
            "status": "error",
            "name": group.responseKey,
            "reason": message,
            "error": [
                "code": code,
                "message": message,
            ],
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
    }

    static func errorFileEntry(group: RequestedDataGroup, error: Error) -> [String: Any] {
        let info = PassportVerificationErrorMapper.errorInfo(error)
        return [
            "status": "error",
            "name": group.responseKey,
            "reason": info["message"] as? String ?? error.localizedDescription,
            "error": info,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
    }

    static func fileStatus(_ entry: Any) -> String {
        guard
            let dict = entry as? [String: Any],
            let status = dict["status"] as? String
        else {
            return "error"
        }
        return status
    }

    static func authStatusString(_ status: PassportAuthenticationStatus) -> String {
        switch status {
        case .notDone: return "notDone"
        case .success: return "success"
        case .failed: return "failed"
        }
    }

    private static func okFileEntry(name: String, rawHex: Any, parsed: [String: Any]) -> [String: Any] {
        [
            "status": "ok",
            "name": name,
            "rawHex": rawHex,
            "parsed": parsed,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
    }

    private static func extractOkData(from files: [String: Any]) -> [String: Any] {
        var data: [String: Any] = [:]
        for (key, value) in files {
            guard
                let entry = value as? [String: Any],
                let status = entry["status"] as? String,
                status == "ok"
            else {
                continue
            }

            var payload = entry
            payload.removeValue(forKey: "status")
            data[key] = payload
        }
        return data
    }

    private static func inferHashAlgorithm(from hashes: [DataGroupHash]) -> String {
        guard let sample = hashes.first(where: { !$0.sodHash.isEmpty })?.sodHash else {
            return "unknown"
        }

        switch sample.count {
        case 40: return "SHA1"
        case 56: return "SHA224"
        case 64: return "SHA256"
        case 96: return "SHA384"
        case 128: return "SHA512"
        default: return "unknown"
        }
    }

    private static func detectImageFormat(_ bytes: [UInt8]) -> String {
        if bytes.count >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
            return "jpeg"
        }

        let jp2Header: [UInt8] = [0x00, 0x00, 0x00, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A]
        if bytes.count >= jp2Header.count && Array(bytes.prefix(jp2Header.count)) == jp2Header {
            return "jpeg2000"
        }

        let j2kCodestreamHeader: [UInt8] = [0xFF, 0x4F, 0xFF, 0x51]
        if bytes.count >= j2kCodestreamHeader.count
            && Array(bytes.prefix(j2kCodestreamHeader.count)) == j2kCodestreamHeader
        {
            return "jpeg2000"
        }

        if bytes.isEmpty {
            return "none"
        }

        return "unknown"
    }

    private static func persistImageToTempFile(_ bytes: [UInt8], format: String) -> String? {
        guard !bytes.isEmpty else { return nil }

        let ext: String
        switch format {
        case "jpeg":
            ext = "jpg"
        case "jpeg2000":
            ext = "jp2"
        default:
            ext = "bin"
        }

        let fileName = "passport_dg2_\(UUID().uuidString).\(ext)"
        let path = (NSTemporaryDirectory() as NSString).appendingPathComponent(fileName)
        let url = URL(fileURLWithPath: path)

        do {
            try Data(bytes).write(to: url, options: .atomic)
            cleanupGeneratedDg2TempFiles(excluding: path)
            return path
        } catch {
            return nil
        }
    }

    private static func cleanupGeneratedDg2TempFiles(excluding keepPath: String? = nil) {
        let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let fileManager = FileManager.default

        guard let contents = try? fileManager.contentsOfDirectory(
            at: tempDirectory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return
        }

        for url in contents where url.lastPathComponent.hasPrefix("passport_dg2_") {
            if let keepPath, url.path == keepPath {
                continue
            }
            try? fileManager.removeItem(at: url)
        }
    }

    private static func splitMRZLines(_ mrz: String) -> [String] {
        if mrz.contains("\n") {
            return mrz
                .components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }

        let normalized = mrz.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.count == 88 {
            let index = normalized.index(normalized.startIndex, offsetBy: 44)
            return [String(normalized[..<index]), String(normalized[index...])]
        }
        if normalized.count == 90 {
            let i1 = normalized.index(normalized.startIndex, offsetBy: 30)
            let i2 = normalized.index(i1, offsetBy: 30)
            return [
                String(normalized[..<i1]),
                String(normalized[i1..<i2]),
                String(normalized[i2...]),
            ]
        }
        return normalized.isEmpty ? [] : [normalized]
    }

    private static func toHex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02X", $0) }.joined()
    }
}
