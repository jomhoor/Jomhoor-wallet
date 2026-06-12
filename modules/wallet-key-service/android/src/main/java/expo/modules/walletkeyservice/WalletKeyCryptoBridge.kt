package expo.modules.walletkeyservice

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

internal object WalletKeyCryptoBridge {
  init {
    System.loadLibrary("wallet_key_crypto")
    System.loadLibrary("wallet_key_service_jni")
  }

  external fun publicMaterial(secret: ByteArray): String
  external fun signChallenge(secret: ByteArray, challengeHex: String): String
  external fun deriveNullifier(secret: ByteArray, eventId: String): String
  external fun runCompatibilitySelfTest(): String

  fun decode(response: String): JsonElement {
    val envelope = JsonParser.parseString(response).asJsonObject
    envelope.get("error")?.takeUnless { it.isJsonNull }?.let {
      throw WalletKeyCryptoException(it.asString)
    }
    return envelope.get("ok") ?: throw WalletKeyCryptoException("Native crypto response is missing")
  }

  fun decodeObject(response: String): JsonObject = decode(response).asJsonObject
}

internal class WalletKeyCryptoException(message: String) : Exception(message)
