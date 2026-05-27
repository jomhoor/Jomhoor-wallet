package expo.modules.appattest

import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class AppAttestModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppAttest")

    /**
     * Not available on Android — App Attest is iOS-only.
     */
    AsyncFunction("generateKey") { promise: Promise ->
      promise.reject("NOT_AVAILABLE", "Apple App Attest is not available on Android; use getPlayIntegrityToken instead", null)
    }

    /**
     * Not available on Android — App Attest is iOS-only.
     */
    AsyncFunction("attestKey") { _: String, _: String, promise: Promise ->
      promise.reject("NOT_AVAILABLE", "Apple App Attest is not available on Android; use getPlayIntegrityToken instead", null)
    }

    /**
     * Requests a Play Integrity token.
     *
     * @param nonce base64-encoded nonce (base64(SHA-256(challengeBytes)))
     * @returns Play Integrity token string (send to POST /v1/wallets/register as appAttestation.token)
     */
    AsyncFunction("getPlayIntegrityToken") { nonce: String, promise: Promise ->
      val context = appContext.reactContext
        ?: return@AsyncFunction promise.reject("NO_CONTEXT", "No React context available", null)

      val integrityManager = IntegrityManagerFactory.create(context)
      val request = IntegrityTokenRequest.builder()
        .setNonce(nonce)
        .build()

      integrityManager.requestIntegrityToken(request)
        .addOnSuccessListener { response ->
          promise.resolve(response.token())
        }
        .addOnFailureListener { exception ->
          promise.reject("PLAY_INTEGRITY_FAILED", exception.message ?: "Play Integrity request failed", exception)
        }
    }
  }
}
