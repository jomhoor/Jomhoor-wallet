Pod::Spec.new do |s|
  s.name = 'NFCPassportReader'
  s.version = '2.1.2'
  s.summary = 'This package handles reading an NFC Enabled passport using iOS 13 CoreNFC APIS'
  s.homepage = 'https://github.com/AndyQ/NFCPassportReader'
  s.license = 'MIT'
  s.authors = { 'Any' => 'andy.qua@gmail.com' }
  s.platforms = { :ios => '14.0' }
  s.source = { :path => '.' }
  s.source_files = 'Sources/**/*.{swift}'
  s.swift_versions = '5.0'
  s.dependency 'OpenSSLLocal'
  s.xcconfig = {
    'OTHER_LDFLAGS' => '-weak_framework CryptoKit -weak_framework CoreNFC -weak_framework CryptoTokenKit',
  }
  s.swift_version = '5.0'
end
