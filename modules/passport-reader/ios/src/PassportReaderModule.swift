import ExpoModulesCore
import NFCPassportReader
import CryptoKit
import CoreNFC

// Type alias to avoid conflict with our module name
typealias NFCReader = NFCPassportReader.PassportReader

public class PassportReaderModule: Module {
  private var passportReader: NFCReader?
  
  public func definition() -> ModuleDefinition {
    Name("PassportReader")
    
    AsyncFunction("initNfc") { () -> Bool in
      // Check if NFC reading is available on this device
      return NFCNDEFReaderSession.readingAvailable
    }
    
    AsyncFunction("isNfcEnabled") { () -> Bool in
      return NFCNDEFReaderSession.readingAvailable
    }
    
    AsyncFunction("readPassport") { (
      documentNumber: String,
      dateOfBirth: String,
      dateOfExpiry: String,
      challenge: String?
    ) -> [String: Any] in
      
      // Create MRZ key for BAC
      let mrzKey = PassportReaderModule.createMRZKey(
        documentNumber: documentNumber,
        dateOfBirth: dateOfBirth,
        dateOfExpiry: dateOfExpiry
      )
      
      let reader = NFCReader()
      self.passportReader = reader
      
      // Tags to read
      var tagsToRead: [DataGroupId] = [.COM, .DG1, .DG2, .SOD]
      
      // Add DG15 if we need Active Authentication
      if challenge != nil {
        tagsToRead.append(.DG15)
      }
      
      // Convert challenge to bytes if provided
      var activeAuthChallenge: [UInt8]? = nil
      if let challengeHex = challenge {
        activeAuthChallenge = [UInt8](Data(hexString: challengeHex))
      }
      
      // Perform the NFC reading
      let passport = try await reader.readPassport(
        mrzKey: mrzKey,
        tags: tagsToRead,
        aaChallenge: activeAuthChallenge,
        skipSecureElements: true,
        skipCA: true,
        skipPACE: false,
        customDisplayMessage: { status in
          switch status {
          case .requestPresentPassport:
            return "Hold your passport against the back of your phone"
          case .authenticatingWithPassport(_):
            return "Authenticating..."
          case .readingDataGroupProgress(let dataGroup, let progress):
            return "Reading \(dataGroup)... \(Int(progress * 100))%"
          case .error(let error):
            return "Error: \(error.localizedDescription)"
          case .successfulRead:
            return "Passport read successfully!"
          @unknown default:
            return nil
          }
        }
      )
      
      // Extract DG1 data (MRZ)
      guard let dg1 = passport.getDataGroup(.DG1) else {
        throw PassportReaderErrorType.missingDataGroup("DG1")
      }
      
      // Extract SOD data (Security Object of Document)
      guard let sod = passport.getDataGroup(.SOD) else {
        throw PassportReaderErrorType.missingDataGroup("SOD")
      }
      
      // Get DG2 hash (face image - we don't need the full image, just the hash for verification)
      let dg2Hash: String
      if let dg2 = passport.getDataGroup(.DG2) {
        let hashData = SHA256.hash(data: Data(dg2.data))
        dg2Hash = hashData.compactMap { String(format: "%02x", $0) }.joined()
      } else {
        dg2Hash = ""
      }
      
      // Get DG15 if available (Active Authentication public key)
      var dg15Hex: String? = nil
      if let dg15 = passport.getDataGroup(.DG15) {
        dg15Hex = Data(dg15.data).hexEncodedString()
      }
      
      // Get DG11 if available (additional personal details)
      var dg11Hex: String? = nil
      if let dg11 = passport.getDataGroup(.DG11) {
        dg11Hex = Data(dg11.data).hexEncodedString()
      }
      
      // Check if Active Authentication was performed
      var aaSignature: String? = nil
      if passport.activeAuthenticationPassed {
        aaSignature = Data(passport.activeAuthenticationSignature).hexEncodedString()
      }
      
      // Build person details from MRZ
      // Strip MRZ filler characters "<" from fields
      let cleanString: (String) -> String = { str in
        str.replacingOccurrences(of: "<", with: "").trimmingCharacters(in: .whitespaces)
      }
      
      let personDetails: [String: Any] = [
        "firstName": cleanString(passport.firstName),
        "lastName": cleanString(passport.lastName),
        "gender": cleanString(passport.gender),
        "dateOfBirth": passport.dateOfBirth,
        "dateOfExpiry": passport.documentExpiryDate,
        "documentNumber": cleanString(passport.documentNumber),
        "nationality": cleanString(passport.nationality),
        "issuingAuthority": cleanString(passport.issuingAuthority),
        "documentCode": cleanString(passport.documentType)
      ]
      
      // Build data groups
      var dataGroups: [String: Any] = [
        "dg1": Data(dg1.data).hexEncodedString(),
        "dg2Hash": dg2Hash,
        "sod": Data(sod.data).hexEncodedString()  // Use .data not .body for full ASN.1 wrapper
      ]
      
      if let dg15 = dg15Hex {
        dataGroups["dg15"] = dg15
      }
      
      if let dg11 = dg11Hex {
        dataGroups["dg11"] = dg11
      }
      
      // Build result
      var result: [String: Any] = [
        "personDetails": personDetails,
        "dataGroups": dataGroups
      ]
      
      if let signature = aaSignature {
        result["aaSignature"] = signature
      }
      
      return result
    }
    
    AsyncFunction("stopNfc") { () -> Void in
      // iOS handles NFC session cleanup automatically
      self.passportReader = nil
    }
  }
  
  /// Create MRZ key from document details
  /// Format: documentNumber + checkDigit + dateOfBirth + checkDigit + dateOfExpiry + checkDigit
  private static func createMRZKey(
    documentNumber: String,
    dateOfBirth: String,
    dateOfExpiry: String
  ) -> String {
    let docNum = documentNumber.padding(toLength: 9, withPad: "<", startingAt: 0)
    let docNumCheck = calculateCheckDigit(docNum)
    let dobCheck = calculateCheckDigit(dateOfBirth)
    let doeCheck = calculateCheckDigit(dateOfExpiry)
    
    return "\(docNum)\(docNumCheck)\(dateOfBirth)\(dobCheck)\(dateOfExpiry)\(doeCheck)"
  }
  
  /// Calculate MRZ check digit according to ICAO 9303
  private static func calculateCheckDigit(_ input: String) -> Int {
    let weights = [7, 3, 1]
    let chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<"
    var sum = 0
    
    for (index, char) in input.uppercased().enumerated() {
      if let value = chars.firstIndex(of: char) {
        sum += chars.distance(from: chars.startIndex, to: value) * weights[index % 3]
      }
    }
    
    return sum % 10
  }
}

// MARK: - Error Types

enum PassportReaderErrorType: Error, LocalizedError {
  case missingDataGroup(String)
  case activeAuthenticationFailed
  case nfcNotAvailable
  
  var errorDescription: String? {
    switch self {
    case .missingDataGroup(let group):
      return "Missing data group: \(group)"
    case .activeAuthenticationFailed:
      return "Active Authentication failed"
    case .nfcNotAvailable:
      return "NFC is not available on this device"
    }
  }
}

// MARK: - Data Extensions

extension Data {
  func hexEncodedString() -> String {
    return map { String(format: "%02x", $0) }.joined()
  }
  
  init(hexString: String) {
    self.init()
    var hex = hexString
    while hex.count > 0 {
      let subIndex = hex.index(hex.startIndex, offsetBy: 2)
      let byteString = String(hex[..<subIndex])
      hex = String(hex[subIndex...])
      if let byte = UInt8(byteString, radix: 16) {
        self.append(byte)
      }
    }
  }
}
