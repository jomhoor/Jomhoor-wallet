//
//  DataGroupHash.swift
//  NFCPassportReader
//
//   09/02/2021.
//  Copyright © 2021 Any. All rights reserved.
//

@available(iOS 13, macOS 10.15, *)
public struct DataGroupHash {
    public var id: String
    public var sodHash: String
    public var computedHash : String
    public var match : Bool
}

