import ExpoModulesCore

public final class WalletKeyServiceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WalletKeyService")

    AsyncFunction("getStatus") {
      WalletKeyVault.shared.status()
    }

    AsyncFunction("generateKey") {
      var key = try WalletKeyVault.shared.generate()
      defer { key.resetBytes(in: 0..<key.count) }
      return try WalletKeyCryptoBridge.publicMaterial(secret: key)
    }

    AsyncFunction("getPublicMaterial") {
      guard WalletKeyVault.shared.status() == "ready" else {
        return nil as [String: Any]?
      }
      var key = try WalletKeyVault.shared.readRequired()
      defer { key.resetBytes(in: 0..<key.count) }
      return try WalletKeyCryptoBridge.publicMaterial(secret: key)
    }

    AsyncFunction("signChallenge") { (challengeHex: String) in
      var key = try WalletKeyVault.shared.readRequired()
      defer { key.resetBytes(in: 0..<key.count) }
      return try WalletKeyCryptoBridge.signChallenge(secret: key, challengeHex: challengeHex)
    }

    AsyncFunction("deriveNullifier") { (eventId: String) in
      var key = try WalletKeyVault.shared.readRequired()
      defer { key.resetBytes(in: 0..<key.count) }
      return try WalletKeyCryptoBridge.deriveNullifier(secret: key, eventId: eventId)
    }

    AsyncFunction("deleteKey") {
      try WalletKeyVault.shared.delete()
    }

    AsyncFunction("runCompatibilitySelfTest") {
      try WalletKeyCryptoBridge.runCompatibilitySelfTest()
    }
  }
}
