#include <jni.h>

#include <string>

#include "wallet_key_crypto.h"

namespace {

jstring toJavaString(JNIEnv *env, char *value) {
  if (value == nullptr) {
    return nullptr;
  }
  jstring result = env->NewStringUTF(value);
  wallet_key_string_free(value);
  return result;
}

std::string toString(JNIEnv *env, jstring value) {
  const char *chars = env->GetStringUTFChars(value, nullptr);
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_walletkeyservice_WalletKeyCryptoBridge_publicMaterial(
    JNIEnv *env,
    jobject,
    jbyteArray secret) {
  const auto length = env->GetArrayLength(secret);
  auto *bytes = env->GetByteArrayElements(secret, nullptr);
  char *result = wallet_key_public_material(
      reinterpret_cast<const uint8_t *>(bytes),
      static_cast<size_t>(length));
  env->ReleaseByteArrayElements(secret, bytes, JNI_ABORT);
  return toJavaString(env, result);
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_walletkeyservice_WalletKeyCryptoBridge_signChallenge(
    JNIEnv *env,
    jobject,
    jbyteArray secret,
    jstring challengeHex) {
  const auto length = env->GetArrayLength(secret);
  auto *bytes = env->GetByteArrayElements(secret, nullptr);
  const std::string challenge = toString(env, challengeHex);
  char *result = wallet_key_sign_challenge(
      reinterpret_cast<const uint8_t *>(bytes),
      static_cast<size_t>(length),
      challenge.c_str());
  env->ReleaseByteArrayElements(secret, bytes, JNI_ABORT);
  return toJavaString(env, result);
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_walletkeyservice_WalletKeyCryptoBridge_deriveNullifier(
    JNIEnv *env,
    jobject,
    jbyteArray secret,
    jstring eventId) {
  const auto length = env->GetArrayLength(secret);
  auto *bytes = env->GetByteArrayElements(secret, nullptr);
  const std::string event = toString(env, eventId);
  char *result = wallet_key_derive_nullifier(
      reinterpret_cast<const uint8_t *>(bytes),
      static_cast<size_t>(length),
      event.c_str());
  env->ReleaseByteArrayElements(secret, bytes, JNI_ABORT);
  return toJavaString(env, result);
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_walletkeyservice_WalletKeyCryptoBridge_runCompatibilitySelfTest(
    JNIEnv *env,
    jobject) {
  return toJavaString(env, wallet_key_run_compatibility_self_test());
}
