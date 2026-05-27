require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'PassportVerification'
  s.version      = package['version']
  s.summary      = 'Reusable passport verification native bridge for React Native/Expo apps'
  s.homepage     = 'https://example.invalid/passport-verification'
  s.license      = { :type => 'MIT' }
  s.authors      = { 'iLand' => 'dev@invalid.local' }
  s.platforms    = { :ios => '15.5' }
  s.source       = { :path => '.' }

  s.source_files = 'ios/PassportVerification*.{h,m,mm,swift}'
  s.requires_arc = true
  s.swift_version = '5.0'

  s.dependency 'React-Core'
  s.dependency 'OpenSSLLocal'
  s.dependency 'NFCPassportReader'
end
