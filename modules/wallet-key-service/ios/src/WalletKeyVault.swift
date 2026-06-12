import Foundation
import Security

enum WalletKeyVaultError: Error {
  case invalidKey
  case keychain(OSStatus)
}

final class WalletKeyVault {
  static let shared = WalletKeyVault()

  static let keyId = "jomhoor.wallet.identity.v1"
  private let account = "babyjubjub-private-key.v1"
  private let service: String
  private let installSentinel: String

  private let fieldModulus = Data([
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
  ])

  private init() {
    let bundleId = Bundle.main.bundleIdentifier ?? "org.jomhoor.wallet"
    service = "\(bundleId).wallet-key-service"
    installSentinel = "\(bundleId).wallet-key-service.install-sentinel"
    purgeAfterFreshInstallIfNeeded()
  }

  func status() -> String {
    var result: CFTypeRef?
    let status = SecItemCopyMatching(readQuery(returnData: false) as CFDictionary, &result)
    switch status {
    case errSecSuccess:
      return "ready"
    case errSecItemNotFound:
      return "missing"
    default:
      return "invalidated"
    }
  }

  func generate() throws -> Data {
    if let existing = try read() {
      return existing
    }

    var candidate = Data(count: 32)
    repeat {
      let status = candidate.withUnsafeMutableBytes { buffer in
        SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
      }
      guard status == errSecSuccess else {
        throw WalletKeyVaultError.keychain(status)
      }
    } while candidate.allSatisfy({ $0 == 0 }) || !isLessThanFieldModulus(candidate)

    try store(candidate)
    return candidate
  }

  func readRequired() throws -> Data {
    guard let key = try read() else {
      throw WalletKeyVaultError.invalidKey
    }
    return key
  }

  func delete() throws {
    let status = SecItemDelete(baseQuery() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw WalletKeyVaultError.keychain(status)
    }
  }

  private func read() throws -> Data? {
    var result: CFTypeRef?
    let status = SecItemCopyMatching(readQuery(returnData: true) as CFDictionary, &result)
    if status == errSecItemNotFound {
      return nil
    }
    guard status == errSecSuccess, let data = result as? Data, data.count == 32 else {
      throw WalletKeyVaultError.keychain(status)
    }
    return data
  }

  private func store(_ value: Data) throws {
    SecItemDelete(baseQuery() as CFDictionary)
    var query = baseQuery()
    query[kSecValueData as String] = value
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    query[kSecAttrSynchronizable as String] = false

    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw WalletKeyVaultError.keychain(status)
    }
  }

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecAttrService as String: service,
    ]
  }

  private func readQuery(returnData: Bool) -> [String: Any] {
    var query = baseQuery()
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecReturnData as String] = returnData
    return query
  }

  private func isLessThanFieldModulus(_ value: Data) -> Bool {
    for (left, right) in zip(value, fieldModulus) {
      if left != right {
        return left < right
      }
    }
    return false
  }

  private func purgeAfterFreshInstallIfNeeded() {
    let defaults = UserDefaults.standard
    guard defaults.object(forKey: installSentinel) == nil else {
      return
    }
    SecItemDelete(baseQuery() as CFDictionary)
    defaults.set(true, forKey: installSentinel)
  }
}
