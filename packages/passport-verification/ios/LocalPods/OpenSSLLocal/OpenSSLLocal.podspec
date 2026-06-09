Pod::Spec.new do |s|
  s.name = 'OpenSSLLocal'
  s.version = '3.5.5-shooresh.1'
  s.summary = 'Local OpenSSL XCFrameworks for iland'
  s.homepage = 'https://www.openssl.org/'
  s.license = { :type => 'Apache-2.0' }
  s.authors = { 'OpenSSL Project' => 'openssl-users@openssl.org' }
  s.platforms = { :ios => '14.0' }
  s.source = { :path => '.' }
  s.module_name = 'OpenSSL'
  s.requires_arc = false
  s.preserve_paths = [
    'include/OpenSSLLocal.h',
    'output/libcrypto-shooresh.xcframework',
    'output/libssl-shooresh.xcframework',
  ]
  s.source_files = 'src/OpenSSLShim.m', 'include/OpenSSLLocal.h'
  s.header_mappings_dir = 'include'
  s.public_header_files = 'include/OpenSSLLocal.h'
  s.vendored_frameworks = 'output/libcrypto-shooresh.xcframework', 'output/libssl-shooresh.xcframework'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/output/libcrypto-shooresh.xcframework/ios-arm64/Headers" "${PODS_TARGET_SRCROOT}/output/libssl-shooresh.xcframework/ios-arm64/Headers" "${PODS_TARGET_SRCROOT}/output/libcrypto-shooresh.xcframework/ios-arm64-simulator/Headers" "${PODS_TARGET_SRCROOT}/output/libssl-shooresh.xcframework/ios-arm64-simulator/Headers"',
    'HEADER_SEARCH_PATHS[sdk=iphoneos*]' => '"${PODS_TARGET_SRCROOT}/output/libcrypto-shooresh.xcframework/ios-arm64/Headers" "${PODS_TARGET_SRCROOT}/output/libssl-shooresh.xcframework/ios-arm64/Headers"',
    'HEADER_SEARCH_PATHS[sdk=iphonesimulator*]' => '"${PODS_TARGET_SRCROOT}/output/libcrypto-shooresh.xcframework/ios-arm64-simulator/Headers" "${PODS_TARGET_SRCROOT}/output/libssl-shooresh.xcframework/ios-arm64-simulator/Headers"',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64',
  }
end
