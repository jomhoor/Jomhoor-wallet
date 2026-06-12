package expo.modules.walletkeyservice

import com.google.gson.JsonObject
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WalletKeyServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WalletKeyService")

    AsyncFunction("getStatus") {
      vault().status()
    }

    AsyncFunction("generateKey") {
      withSecret(vault().generate()) { secret ->
        publicMaterial(WalletKeyCryptoBridge.decodeObject(WalletKeyCryptoBridge.publicMaterial(secret)))
      }
    }

    AsyncFunction("getPublicMaterial") {
      if (vault().status() != "ready") {
        return@AsyncFunction null
      }
      withSecret(vault().readRequired()) { secret ->
        publicMaterial(WalletKeyCryptoBridge.decodeObject(WalletKeyCryptoBridge.publicMaterial(secret)))
      }
    }

    AsyncFunction("signChallenge") { challengeHex: String ->
      withSecret(vault().readRequired()) { secret ->
        WalletKeyCryptoBridge.decode(
          WalletKeyCryptoBridge.signChallenge(secret, challengeHex)
        ).asString
      }
    }

    AsyncFunction("deriveNullifier") { eventId: String ->
      withSecret(vault().readRequired()) { secret ->
        WalletKeyCryptoBridge.decode(
          WalletKeyCryptoBridge.deriveNullifier(secret, eventId)
        ).asString
      }
    }

    AsyncFunction("deleteKey") {
      vault().delete()
    }

    AsyncFunction("runCompatibilitySelfTest") {
      val result = WalletKeyCryptoBridge.decodeObject(
        WalletKeyCryptoBridge.runCompatibilitySelfTest()
      )
      mapOf(
        "passed" to result["passed"].asBoolean,
        "publicMaterialMatches" to result["publicMaterialMatches"].asBoolean,
        "nullifierMatches" to result["nullifierMatches"].asBoolean,
        "signatureMatches" to result["signatureMatches"].asBoolean,
      )
    }
  }

  private fun vault(): WalletKeyVault {
    val context = appContext.reactContext
      ?: throw WalletKeyCryptoException("React context is unavailable")
    return WalletKeyVault(context.applicationContext)
  }

  private fun publicMaterial(value: JsonObject): Map<String, String> {
    return mapOf(
      "keyId" to WalletKeyVault.KEY_ID,
      "publicKeyX" to value["publicKeyX"].asString,
      "publicKeyY" to value["publicKeyY"].asString,
      "publicKeyHash" to value["publicKeyHash"].asString,
      "walletAddress" to value["walletAddress"].asString,
    )
  }

  private inline fun <T> withSecret(secret: ByteArray, operation: (ByteArray) -> T): T {
    return try {
      operation(secret)
    } finally {
      secret.fill(0)
    }
  }
}
