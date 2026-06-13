import ExpoModulesCore
import SwoirenbergLib
import Foundation

public class NoirModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Noir")

    /**
     * Generates a PLONK proof using the Noir circuit.
     *
     * @param trustedSetupUri URI pointing to the SRS file (e.g. file://...)
     * @param inputsJson JSON string representing a map of witness values
     * @param manifestJson JSON manifest for the circuit bytecode
     * @return A hex string representing the generated proof
     * @throws NSError if any step of the process fails
     */
    AsyncFunction("provePlonk") { (trustedSetupUri: String, inputsJson: String, manifestJson: String) in
      return try NoirModule.generateProof(
        trustedSetupUri: trustedSetupUri,
        inputsJson: inputsJson,
        manifestJson: manifestJson,
        proofType: "plonk"
      )
    }

    /**
     * Generates a keccak-flavored UltraHonk proof using the Noir circuit.
     * Used for the voting / query-identity path so proofs are verifiable by the
     * on-chain Solidity HonkVerifier. Registration stays on `provePlonk`.
     *
     * @param trustedSetupUri URI pointing to the SRS file (e.g. file://...)
     * @param inputsJson JSON string representing a map of witness values
     * @param manifestJson JSON manifest for the circuit bytecode
     * @return A hex string representing the generated proof (public inputs prepended)
     * @throws NSError if any step of the process fails
     */
    AsyncFunction("proveUltraHonkKeccak") { (trustedSetupUri: String, inputsJson: String, manifestJson: String) in
      return try NoirModule.generateProof(
        trustedSetupUri: trustedSetupUri,
        inputsJson: inputsJson,
        manifestJson: manifestJson,
        proofType: "honk_keccak"
      )
    }

    /**
     * Returns the verification key (hex) for a circuit bytecode.
     * Used for debugging VK mismatch with on-chain verifier.
     */
    AsyncFunction("getVerificationKey") { (manifestJson: String) -> String in
      guard let jsonData = manifestJson.data(using: .utf8),
            let manifest = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
            let bytecodeBase64 = manifest["bytecode"] as? String,
            let bytecodeData = Data(base64Encoded: bytecodeBase64) else {
        throw NSError(domain: "NoirModule", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid manifest"])
      }
      let vkHex = try Swoirenberg.get_verification_key(bytecode: bytecodeData)
      NSLog("[NoirModule] getVerificationKey result length: %d", vkHex.count)
      return vkHex
    }
  }

  /// Shared proof-generation routine used by both the plonk and keccak-honk arms.
  /// `proofType` is forwarded to the native backend ("plonk" or "honk_keccak").
  private static func generateProof(
    trustedSetupUri: String,
    inputsJson: String,
    manifestJson: String,
    proofType: String
  ) throws -> String {
      // Ensure valid URI
      guard let srsPath = URL(string: trustedSetupUri)?.path else {
        throw NSError(domain: "NoirModule", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "Invalid URI: \(trustedSetupUri)"
        ])
      }

      // Ensure valid manifest JSON
      guard let manifestData = manifestJson.data(using: .utf8) else {
        throw NSError(domain: "NoirModule", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "Invalid manifest JSON string"
        ])
      }

      // Create circuit and initialize SRS
      let circuit = try Swoir(backend: Swoirenberg.self).createCircuit(manifest: manifestData)
      NSLog("[NoirModule] circuit created, manifest bytes=%d", manifestData.count)
      try circuit.setupSrs(srs_path: srsPath)
      NSLog("[NoirModule] setupSrs done, num_points=%u", circuit.num_points)

      // Parse input values
      guard let inputsData = inputsJson.data(using: .utf8),
            let rawInputsMap = try JSONSerialization.jsonObject(with: inputsData, options: []) as? [String: Any] else {
        throw NSError(domain: "NoirModule", code: 3, userInfo: [
          NSLocalizedDescriptionKey: "Failed to parse inputs JSON"
        ])
      }

      // Convert values: arrays to arrays of strings, everything else to strings
      var inputsMap: [String: Any] = [:]
      for (key, value) in rawInputsMap {
        if let arrayValue = value as? [Any] {
          inputsMap[key] = arrayValue.map { String(describing: $0) }
          continue
        }
        if let intValue = value as? Int {
          inputsMap[key] = String(intValue)
          continue
        }
        if let doubleValue = value as? Double {
          inputsMap[key] = String(doubleValue)
          continue
        }

        inputsMap[key] = String(describing: value)
      }

      // Generate proof
      do {
        print("[NoirModule] Attempting to prove (proof_type: \(proofType)) with inputs keys: \(inputsMap.keys)")
        NSLog("[NoirModule] prove:start proofType=%@ keys=%@", proofType, inputsMap.keys.sorted().joined(separator: ","))
        // Log sample values for debugging
        for (key, value) in inputsMap {
          if let arr = value as? [Any] {
            print("[NoirModule] Input \(key): array[\(arr.count)] first=\(arr.first ?? "nil"), last=\(arr.last ?? "nil")")
          } else {
            let strValue = String(describing: value)
            print("[NoirModule] Input \(key): \(strValue.prefix(50))\(strValue.count > 50 ? "..." : "")")
          }
        }
        let proof = try circuit.prove(inputsMap, proof_type: proofType)

        print("[NoirModule] Generated proof: \(proof)")
        NSLog("[NoirModule] prove:done proofBytes=%d vkeyBytes=%d", proof.proof.count, proof.vkey.count)
        let hexProof = proof.proof.map { String(format: "%02x", $0) }.joined()
        let hexVkey = proof.vkey.map { String(format: "%02x", $0) }.joined()

        // Log VK for verifier debugging (first 512 chars = first 8 field elements)
        NSLog("[NoirModule] VK_HEX_START=%@", String(hexVkey.prefix(1024)))
        NSLog("[NoirModule] VK_HEX_LEN=%d", hexVkey.count)
        // Write full VK to file for extraction
        if let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            let vkPath = docsDir.appendingPathComponent("noir_vk_dump.hex")
            try? hexVkey.write(to: vkPath, atomically: true, encoding: .utf8)
            NSLog("[NoirModule] VK written to: %@", vkPath.path)
        }

        return hexProof
      } catch let error as NSError {
        print("[NoirModule] Error generating proof - domain: \(error.domain), code: \(error.code)")
        NSLog("[NoirModule] prove:error domain=%@ code=%ld desc=%@", error.domain, error.code, error.localizedDescription)
        print("[NoirModule] Error description: \(error.localizedDescription)")
        print("[NoirModule] Error userInfo: \(error.userInfo)")
        throw error
      } catch {
        print("[NoirModule] Unknown error generating proof: \(error)")
        NSLog("[NoirModule] prove:unknownError %@", String(describing: error))
        throw error
      }
  }
}
