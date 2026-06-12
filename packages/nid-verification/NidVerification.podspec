require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'NidVerification'
  s.version      = package['version']
  s.summary      = 'Iranian national identity card verification diagnostics for React Native'
  s.homepage     = 'https://example.invalid/nid-verification'
  s.license      = { :type => 'MIT' }
  s.authors      = { 'iLand' => 'dev@invalid.local' }
  s.platforms    = { :ios => '15.5' }
  s.source       = { :path => '.' }

  s.source_files = 'ios/NidVerification*.{h,m,mm,swift}'
  s.requires_arc = true
  s.swift_version = '5.0'

  s.dependency 'React-Core'
end
