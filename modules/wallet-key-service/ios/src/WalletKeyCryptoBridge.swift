import Foundation

// Raw wallet keys must never be returned from this native boundary. These
// declarations expose only fixed operations implemented by the vendored core.
@_silgen_name("wallet_key_public_material")
private func walletKeyPublicMaterial(
  _ secret: UnsafePointer<UInt8>?,
  _ secretLength: Int
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("wallet_key_sign_challenge")
private func walletKeySignChallenge(
  _ secret: UnsafePointer<UInt8>?,
  _ secretLength: Int,
  _ challengeHex: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("wallet_key_derive_nullifier")
private func walletKeyDeriveNullifier(
  _ secret: UnsafePointer<UInt8>?,
  _ secretLength: Int,
  _ eventId: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("wallet_key_run_compatibility_self_test")
private func walletKeyRunCompatibilitySelfTest() -> UnsafeMutablePointer<CChar>?

@_silgen_name("wallet_key_string_free")
private func walletKeyStringFree(_ value: UnsafeMutablePointer<CChar>?)

enum WalletKeyCryptoBridgeError: Error {
  case nativeFailure(String)
  case invalidResponse
}

final class WalletKeyCryptoBridge {
  static func publicMaterial(secret: Data) throws -> [String: Any] {
    let response = try callWithSecret(secret) { pointer, count in
      walletKeyPublicMaterial(pointer, count)
    }
    guard var material = response as? [String: Any] else {
      throw WalletKeyCryptoBridgeError.invalidResponse
    }
    material["keyId"] = WalletKeyVault.keyId
    return material
  }

  static func signChallenge(secret: Data, challengeHex: String) throws -> String {
    let response = try challengeHex.withCString { challenge in
      try callWithSecret(secret) { pointer, count in
        walletKeySignChallenge(pointer, count, challenge)
      }
    }
    guard let signature = response as? String else {
      throw WalletKeyCryptoBridgeError.invalidResponse
    }
    return signature
  }

  static func deriveNullifier(secret: Data, eventId: String) throws -> String {
    let response = try eventId.withCString { event in
      try callWithSecret(secret) { pointer, count in
        walletKeyDeriveNullifier(pointer, count, event)
      }
    }
    guard let nullifier = response as? String else {
      throw WalletKeyCryptoBridgeError.invalidResponse
    }
    return nullifier
  }

  static func runCompatibilitySelfTest() throws -> [String: Any] {
    let response = try decode(walletKeyRunCompatibilitySelfTest())
    guard let result = response as? [String: Any] else {
      throw WalletKeyCryptoBridgeError.invalidResponse
    }
    return result
  }

  private static func callWithSecret(
    _ secret: Data,
    operation: (UnsafePointer<UInt8>?, Int) -> UnsafeMutablePointer<CChar>?
  ) throws -> Any {
    try secret.withUnsafeBytes { buffer in
      let pointer = buffer.bindMemory(to: UInt8.self).baseAddress
      return try decode(operation(pointer, buffer.count))
    }
  }

  private static func decode(_ pointer: UnsafeMutablePointer<CChar>?) throws -> Any {
    guard let pointer else {
      throw WalletKeyCryptoBridgeError.invalidResponse
    }
    defer { walletKeyStringFree(pointer) }

    let data = Data(String(cString: pointer).utf8)
    guard
      let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw WalletKeyCryptoBridgeError.invalidResponse
    }
    if let error = envelope["error"] as? String {
      throw WalletKeyCryptoBridgeError.nativeFailure(error)
    }
    guard let value = envelope["ok"] else {
      throw WalletKeyCryptoBridgeError.invalidResponse
    }
    return value
  }
}
