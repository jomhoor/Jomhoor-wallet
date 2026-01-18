package expo.modules.rapidsnarkwrp

import android.util.Base64
import com.google.gson.Gson
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.iden3.rapidsnark.DEFAULT_ERROR_BUFFER_SIZE
import io.iden3.rapidsnark.DEFAULT_PROOF_BUFFER_SIZE
import io.iden3.rapidsnark.groth16Prove
import io.iden3.rapidsnark.groth16PublicBufferSize
import java.io.File

data class Proof(
  val pi_a: List<String>,
  val pi_b: List<List<String>>,
  val pi_c: List<String>,
  val protocol: String,
) {
  companion object {
    fun fromJson(jsonString: String): Proof {
      val json = Gson().fromJson(jsonString, Proof::class.java)
      return json
    }
  }

}

data class ZkProof(
  val proof: Proof,
  val pub_signals: List<String>
)

fun base64StringToData(base64String: String): ByteArray {
  return Base64.decode(base64String, Base64.DEFAULT)
}

class RapidsnarkWrpModule : Module() {
  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  override fun definition() = ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('RapidsnarkWrp')` in JavaScript.
    Name("RapidsnarkWrp")

    AsyncFunction("groth16ProveWithZKeyFilePath") { wtns: ByteArray, zkeyFilePath: String, proofBufferSize: Int?, publicBufferSize: Int?, errorBufferSize: Int? ->
      val fileUrl = zkeyFilePath.replace("file://", "")
      val file = File(fileUrl)

      if (!file.exists()) {
        throw Exception("Zkey file does not exist")
      }

      val currentErrorBufferSize = errorBufferSize ?: DEFAULT_ERROR_BUFFER_SIZE
      val currentProofBufferSize = proofBufferSize ?: DEFAULT_PROOF_BUFFER_SIZE
      val currentPublicBufferSize = publicBufferSize ?: groth16PublicBufferSize(file.path, currentErrorBufferSize)

      val response = groth16Prove(
        file.path,
        wtns,
        currentProofBufferSize,
        currentPublicBufferSize,
        currentErrorBufferSize
      )

      val zkProof = createZkProof(
        proof = response.proof,
        pubSignals = response.publicSignals
      )

      val zkProofJson = Gson().toJson(zkProof)

      return@AsyncFunction zkProofJson
    }

    // Defines a JavaScript function that always returns a Promise and whose native code
    // is by default dispatched on the different thread than the JavaScript runtime runs on.
    AsyncFunction("groth16Prove") { wtns: ByteArray, zkey: ByteArray ->
      // Local AAR requires file path, so write zkey to temp file
      val tempFile = File.createTempFile("zkey_", ".zkey")
      try {
        tempFile.writeBytes(zkey)

        val currentErrorBufferSize = DEFAULT_ERROR_BUFFER_SIZE
        val currentProofBufferSize = DEFAULT_PROOF_BUFFER_SIZE
        val currentPublicBufferSize = groth16PublicBufferSize(tempFile.path, currentErrorBufferSize)

        val response = groth16Prove(
          tempFile.path,
          wtns,
          currentProofBufferSize,
          currentPublicBufferSize,
          currentErrorBufferSize
        )

        val zkProof = createZkProof(
          proof = response.proof,
          pubSignals = response.publicSignals
        )

        val zkProofJson = Gson().toJson(zkProof)

        return@AsyncFunction zkProofJson
      } finally {
        tempFile.delete()
      }
    }
  }
}

fun createZkProof(proof: String, pubSignals: String): ZkProof {
  val proofInstance = Proof.fromJson(proof)

  val gson = Gson()
  val stringArray = gson.fromJson(pubSignals, Array<String>::class.java)
  val pubSignalsArray = stringArray.toList()

  val zkProof = ZkProof(
    proof = proofInstance,
    pub_signals = pubSignalsArray
  )

  return zkProof
}
