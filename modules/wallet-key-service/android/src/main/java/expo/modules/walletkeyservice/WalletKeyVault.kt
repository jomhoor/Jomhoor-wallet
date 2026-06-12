package expo.modules.walletkeyservice

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.math.BigInteger
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class WalletKeyVault(private val context: Context) {
  companion object {
    const val KEY_ID = "jomhoor.wallet.identity.v1"

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val MASTER_KEY_ALIAS = "org.jomhoor.wallet.wallet-key-service.master.v1"
    private const val PREFERENCES = "jomhoor_wallet_key_service"
    private const val ENCRYPTED_KEY = "encrypted_babyjubjub_key_v1"
    private const val FORMAT_PREFIX = "v1:"
    private const val GCM_TAG_BITS = 128
    private const val GCM_IV_BYTES = 12
    private const val AES_KEY_BITS = 256

    private val FIELD_MODULUS = BigInteger(
      "21888242871839275222246405745257275088548364400416034343698204186575808495617"
    )
  }

  private val preferences by lazy {
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
  }

  fun status(): String {
    val encrypted = preferences.getString(ENCRYPTED_KEY, null) ?: return "missing"
    return try {
      decrypt(encrypted).fill(0)
      "ready"
    } catch (_: Throwable) {
      "invalidated"
    }
  }

  fun generate(): ByteArray {
    read()?.let { return it }

    val random = SecureRandom()
    var secret: ByteArray
    do {
      secret = ByteArray(32).also(random::nextBytes)
    } while (
      secret.all { it == 0.toByte() } ||
      BigInteger(1, secret) >= FIELD_MODULUS
    )

    try {
      preferences.edit().putString(ENCRYPTED_KEY, encrypt(secret)).commit().also { committed ->
        check(committed) { "Failed to persist encrypted wallet key" }
      }
      return secret
    } catch (error: Throwable) {
      secret.fill(0)
      throw error
    }
  }

  fun readRequired(): ByteArray {
    return read() ?: throw WalletKeyCryptoException("Wallet key is not available")
  }

  fun delete() {
    preferences.edit().remove(ENCRYPTED_KEY).commit()
    val keyStore = keyStore()
    if (keyStore.containsAlias(MASTER_KEY_ALIAS)) {
      keyStore.deleteEntry(MASTER_KEY_ALIAS)
    }
  }

  private fun read(): ByteArray? {
    val encrypted = preferences.getString(ENCRYPTED_KEY, null) ?: return null
    return decrypt(encrypted)
  }

  private fun encrypt(secret: ByteArray): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateMasterKey())
    val iv = cipher.iv
    check(iv.size == GCM_IV_BYTES) { "Unexpected AES-GCM IV size" }
    val ciphertext = cipher.doFinal(secret)
    val combined = iv + ciphertext
    return FORMAT_PREFIX + Base64.encodeToString(combined, Base64.NO_WRAP)
  }

  private fun decrypt(stored: String): ByteArray {
    require(stored.startsWith(FORMAT_PREFIX)) { "Unsupported wallet key format" }
    val combined = Base64.decode(stored.removePrefix(FORMAT_PREFIX), Base64.NO_WRAP)
    require(combined.size > GCM_IV_BYTES) { "Invalid encrypted wallet key" }

    val iv = combined.copyOfRange(0, GCM_IV_BYTES)
    val ciphertext = combined.copyOfRange(GCM_IV_BYTES, combined.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getExistingMasterKey(),
      GCMParameterSpec(GCM_TAG_BITS, iv)
    )
    return cipher.doFinal(ciphertext).also {
      require(it.size == 32) { "Invalid decrypted wallet key" }
    }
  }

  private fun getExistingMasterKey(): SecretKey {
    return keyStore().getKey(MASTER_KEY_ALIAS, null) as? SecretKey
      ?: throw WalletKeyCryptoException("Wallet key encryption key was invalidated")
  }

  private fun getOrCreateMasterKey(): SecretKey {
    (keyStore().getKey(MASTER_KEY_ALIAS, null) as? SecretKey)?.let { return it }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        return generateMasterKey(strongBox = true)
      } catch (_: StrongBoxUnavailableException) {
        keyStore().deleteEntry(MASTER_KEY_ALIAS)
      }
    }
    return generateMasterKey(strongBox = false)
  }

  private fun generateMasterKey(strongBox: Boolean): SecretKey {
    val spec = KeyGenParameterSpec.Builder(
      MASTER_KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(AES_KEY_BITS)
      .setRandomizedEncryptionRequired(true)
      .setUserAuthenticationRequired(false)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          setUnlockedDeviceRequired(true)
          setIsStrongBoxBacked(strongBox)
        }
      }
      .build()

    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
      init(spec)
      generateKey()
    }
  }

  private fun keyStore(): KeyStore {
    return KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
  }
}
