import DeviceCheck
import ExpoModulesCore

public class AppAttestModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppAttest")

    /**
     * Generates a new App Attest key pair.
     *
     * Returns the base64-encoded key identifier on success.
     * Rejects if the device does not support App Attest (e.g. simulator).
     */
    AsyncFunction("generateKey") { (promise: Promise) in
      guard DCAppAttestService.shared.isSupported else {
        promise.reject("NOT_AVAILABLE", "DCAppAttestService is not supported on this device")
        return
      }
      DCAppAttestService.shared.generateKey { keyId, error in
        if let error = error {
          promise.reject("GENERATE_KEY_FAILED", error.localizedDescription)
          return
        }
        guard let keyId = keyId else {
          promise.reject("GENERATE_KEY_FAILED", "generateKey returned nil keyId without an error")
          return
        }
        promise.resolve(keyId)
      }
    }

    /**
     * Attests the key with the server challenge.
     *
     * @param keyId              base64-encoded key ID returned by generateKey
     * @param clientDataHashBase64 base64-encoded SHA-256 of the raw challenge bytes
     * @returns base64-encoded CBOR attestation object (send to POST /v1/wallets/register as appAttestation.attestation)
     */
    AsyncFunction("attestKey") { (keyId: String, clientDataHashBase64: String, promise: Promise) in
      guard DCAppAttestService.shared.isSupported else {
        promise.reject("NOT_AVAILABLE", "DCAppAttestService is not supported on this device")
        return
      }
      guard let hashData = Data(base64Encoded: clientDataHashBase64) else {
        promise.reject("INVALID_ARGUMENT", "clientDataHashBase64 is not valid base64")
        return
      }
      DCAppAttestService.shared.attestKey(keyId, clientDataHash: hashData) { attestation, error in
        if let error = error {
          promise.reject("ATTEST_KEY_FAILED", error.localizedDescription)
          return
        }
        guard let attestation = attestation else {
          promise.reject("ATTEST_KEY_FAILED", "attestKey returned nil attestation without an error")
          return
        }
        promise.resolve(attestation.base64EncodedString())
      }
    }

    /**
     * Not available on iOS — Play Integrity is Android-only.
     */
    AsyncFunction("getPlayIntegrityToken") { (_: String, promise: Promise) in
      promise.reject("NOT_AVAILABLE", "Play Integrity is not available on iOS; use generateKey + attestKey instead")
    }
  }
}
