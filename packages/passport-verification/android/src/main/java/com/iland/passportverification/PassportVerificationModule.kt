package com.iland.passportverification

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PassportVerificationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "PassportVerification"

  @ReactMethod
  fun getPassportVerificationNativeStatus(promise: Promise) {
    val result = Arguments.createMap()
    result.putString("platform", "android")
    result.putBoolean("nativeLinked", true)
    result.putString("module", "PassportVerification")
    result.putString("version", "0.1.0")
    promise.resolve(result)
  }
}
