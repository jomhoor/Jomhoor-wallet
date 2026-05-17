Pod::Spec.new do |s|
  s.name           = 'AppAttest'
  s.version        = '1.0.0'
  s.summary        = 'iOS App Attest native Expo module for jomhoor-wallet'
  s.description    = 'Wraps DCAppAttestService for iOS App Attest key generation and attestation'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "src/**/*.{h,m,mm,swift}"

  # DeviceCheck framework provides DCAppAttestService.
  s.frameworks = 'DeviceCheck'
end
