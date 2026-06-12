import Foundation

public enum SwoirCore {
  public enum SwoirBackendError: Error, Equatable {
      case errorProving(String)
      case errorVerifying(String)
      case errorExecuting(String)
      case networkError(String)
      case memoryLimitExceeded
      case invalidBytecode
      case emptyBytecode
      case emptyWitnessMap
      case emptyProofData
      case emptyVerificationKey
      case emptyProofType
      case errorSettingUpSRS
  }

  public struct Proof {
      public let proof: Data
      public let vkey: Data

      public init(proof: Data, vkey: Data) {
          self.proof = proof
          self.vkey = vkey
      }
  }

  public protocol SwoirBackendProtocol {
      static func setup_srs(bytecode: Data, srs_path: String?, recursive: Bool) throws -> UInt32
      static func prove(bytecode: Data, witnessMap: [String], proof_type: String, recursive: Bool) throws -> Proof
      static func verify(proof: Proof, proof_type: String) throws -> Bool
      static func execute(bytecode: Data, witnessMap: [String]) throws -> [String]
  }
}
import Foundation
extension SwoirCore.SwoirBackendError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .errorProving(let msg): return "Error proving: \(msg)"
        case .errorVerifying(let msg): return "Error verifying: \(msg)"
        case .errorExecuting(let msg): return "Error executing: \(msg)"
        case .networkError(let msg): return "Network error: \(msg)"
        case .memoryLimitExceeded: return "Memory limit exceeded"
        case .invalidBytecode: return "Invalid bytecode"
        case .emptyBytecode: return "Empty bytecode"
        case .emptyWitnessMap: return "Empty witness map"
        case .emptyProofData: return "Empty proof data"
        case .emptyVerificationKey: return "Empty verification key"
        case .emptyProofType: return "Empty proof type"
        case .errorSettingUpSRS: return "Error setting up SRS"
        }
    }
}
