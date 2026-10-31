Pod::Spec.new do |s|
  s.name = 'T3RemoteDesktop'
  s.version = '0.0.0'
  s.summary = 'Native remote desktop prototype for T3 Code'
  s.homepage = 'https://github.com/pingdotgg/t3code'
  s.license = { :type => 'Apache-2.0', :file => 'Vendor/LICENSE' }
  s.author = 'T3 Code contributors; Sill contributors'
  s.source = { :path => '.' }
  s.platforms = { :ios => '18.0' }
  s.source_files = 'ios/**/*.swift', 'Vendor/**/*.swift'
  s.vendored_frameworks = 'Frameworks/LiveKitWebRTC.xcframework'
  s.resource_bundles = { 'T3RemoteDesktopNotices' => ['Vendor/LICENSE', 'Vendor/MODIFICATIONS.md', 'Vendor/LiveKitWebRTC-LICENSE.txt', 'Vendor/LiveKitWebRTC-THIRD-PARTY-NOTICES.txt', 'Vendor/LiveKitWebRTC-PROVENANCE.json'] }
  s.frameworks = 'UIKit', 'SwiftUI', 'AVFoundation', 'VideoToolbox', 'Network', 'Security', 'GameController'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
end
