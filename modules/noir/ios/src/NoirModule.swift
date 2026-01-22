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
      // Ensure valid URI
      guard let srsPath = URL(string: trustedSetupUri)?.path else {
        throw NSError(domain: "NoirModule", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "Invalid URI: \(trustedSetupUri)"
        ])
      }

      print("[NoirModule] provePlonk called")
      print("[NoirModule] SRS path: \(srsPath)")
      print("[NoirModule] Manifest JSON length: \(manifestJson.count)")
      print("[NoirModule] Inputs JSON length: \(inputsJson.count)")

      // Ensure valid manifest JSON
      guard let manifestData = manifestJson.data(using: .utf8) else {
        throw NSError(domain: "NoirModule", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "Invalid manifest JSON string"
        ])
      }

      print("[NoirModule] Creating circuit from manifest...")
      
      // Create circuit and initialize SRS
      let circuit = try Swoir(backend: Swoirenberg.self).createCircuit(manifest: manifestData)
      
      print("[NoirModule] Circuit created, bytecode size: \(circuit.bytecode.count)")
      print("[NoirModule] Setting up SRS...")
      
      try circuit.setupSrs(srs_path: srsPath)
      
      print("[NoirModule] SRS setup complete, num_points: \(circuit.num_points)")

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
        print("[NoirModule] ========================================")
        print("[NoirModule] Starting proof generation...")
        print("[NoirModule] Bytecode size: \(circuit.bytecode.count) bytes")
        print("[NoirModule] Manifest hash: \(circuit.manifest.hash)")
        print("[NoirModule] SRS points: \(circuit.num_points)")
        print("[NoirModule] ========================================")
        
        print("[NoirModule] Inputs to be passed to circuit:")
        for (key, value) in inputsMap {
          if let arrayValue = value as? [Any] {
            print("  \(key): array of \(arrayValue.count) elements")
          } else {
            print("  \(key): \(value)")
          }
        }
        print("[NoirModule] ========================================")
        print("[NoirModule] About to call circuit.prove()...")
        
        let proof = try circuit.prove(inputsMap, proof_type: "plonk")

        print("[NoirModule] Generated proof successfully: \(proof.proof.count) bytes")
        let hexProof = proof.proof.map { String(format: "%02x", $0) }.joined()

        return hexProof
      } catch let swoirError as SwoirError {
        print("[NoirModule] SwoirError: \(swoirError)")
        throw NSError(domain: "NoirModule", code: 10, userInfo: [
          NSLocalizedDescriptionKey: "Swoir error: \(swoirError)"
        ])
      } catch let swoirBackendError as SwoirCore.SwoirBackendError {
        print("[NoirModule] SwoirBackendError: \(swoirBackendError)")
        throw NSError(domain: "NoirModule", code: 11, userInfo: [
          NSLocalizedDescriptionKey: "Swoir backend error: \(swoirBackendError)"
        ])
      } catch {
        print("[NoirModule] Unknown error generating proof: \(error)")
        print("[NoirModule] Error type: \(type(of: error))")
        throw error
      }
    }
  }
}
