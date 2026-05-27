//
//  Logging.swift
//  NFCTest
//
//   11/06/2019.
//  Copyright © 2019 Any. All rights reserved.
//

import Foundation

struct Logger {
    struct Sink {
        func debug(_ message: String) { _ = message }
        func info(_ message: String) { _ = message }
        func warning(_ message: String) { _ = message }
        func error(_ message: String) { _ = message }
    }

    static let passportReader = Sink()
    static let tagReader = Sink()
    static let secureMessaging = Sink()
    static let openSSL = Sink()
    static let bac = Sink()
    static let chipAuth = Sink()
    static let pace = Sink()
}
