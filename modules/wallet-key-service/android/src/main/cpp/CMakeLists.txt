cmake_minimum_required(VERSION 3.22.1)
project(wallet_key_service_jni)

add_library(wallet_key_crypto SHARED IMPORTED)
set_target_properties(
  wallet_key_crypto
  PROPERTIES IMPORTED_LOCATION
  "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libwallet_key_crypto.so"
)

add_library(wallet_key_service_jni SHARED wallet_key_service_jni.cpp)
target_include_directories(
  wallet_key_service_jni
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../native-core/include"
)
target_link_libraries(wallet_key_service_jni wallet_key_crypto android log)
