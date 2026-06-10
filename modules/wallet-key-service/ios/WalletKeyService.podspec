Pod::Spec.new do |s|
  s.name           = 'WalletKeyService'
  s.version        = '1.0.0'
  s.summary        = 'Non-exporting native wallet key service for Jomhoor'
  s.description    = 'Owns the BabyJubjub wallet key and exposes fixed cryptographic operations.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '17.5' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.vendored_frameworks = 'libs/WalletKeyCrypto.xcframework'
  s.source_files = 'src/**/*.{h,m,mm,swift}'
  s.frameworks = 'Security'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
