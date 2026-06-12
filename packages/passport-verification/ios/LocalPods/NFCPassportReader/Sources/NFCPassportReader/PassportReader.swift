
import Foundation
import OSLog

#if !os(macOS)
import UIKit
import CoreNFC

@available(iOS 15, *)
public protocol PassportReaderTrackingDelegate: AnyObject {
    func nfcTagDetected()
    func readCardAccess(cardAccess: CardAccess)
    func paceStarted()
    func paceSucceeded()
    func paceFailed()
    func bacStarted()
    func bacSucceeded()
    func bacFailed()
}

@available(iOS 15, *)
extension PassportReaderTrackingDelegate {
    func nfcTagDetected() { /* default implementation */ }
    func readCardAccess(cardAccess: CardAccess) { /* default implementation */ }
    func paceStarted() { /* default implementation */ }
    func paceSucceeded() { /* default implementation */ }
    func paceFailed() { /* default implementation */ }
    func bacStarted() { /* default implementation */ }
    func bacSucceeded() { /* default implementation */ }
    func bacFailed() { /* default implementation */ }
}

@available(iOS 15, *)
public struct PassportReaderDebugSnapshot {
    public var sessionStartedAtMs: Double?
    public var sessionBeginRequestedAtMs: Double?
    public var sessionCreated = false
    public var sessionBeginRequested = false
    public var sessionDidBecomeActive = false
    public var sessionBecameActiveAtMs: Double?
    public var tagDetected = false
    public var tagDetectedAtMs: Double?
    public var tagConnectedAtMs: Double?
    public var bacStartedAtMs: Double?
    public var bacSucceededAtMs: Double?
    public var firstFileReadAtMs: Double?
    public var readCompletedAtMs: Double?
    public var tagType: String?
    public var supportsIso7816 = false
    public var supportsIso14443 = false
    public var iso7816IdentifierHex: String?
    public var historicalBytesHex: String?
    public var applicationDataHex: String?
    public var initialSelectedAidHex: String?
    public var sessionInvalidatedBeforeActive = false
    public var sessionInvalidatedAfterActive = false
    public var invalidationAtMs: Double?
    public var invalidationErrorDomain: String?
    public var invalidationErrorCode: Int?
    public var invalidationErrorMessage: String?
    public var preActiveFailureCode: String?
}

@available(iOS 15, *)
public enum PassportReaderReleaseBarrierStatus {
    case skippedNoSession
    case alreadyReleased
    case observedDidInvalidate
    case timedOut
}

@available(iOS 15, *)
public class PassportReader : NSObject {
    private typealias NFCCheckedContinuation = CheckedContinuation<NFCPassportModel, Error>
    private var nfcContinuation: NFCCheckedContinuation?

    public weak var trackingDelegate: PassportReaderTrackingDelegate?
    private var passport : NFCPassportModel = NFCPassportModel()
    
    private var readerSession: NFCTagReaderSession?
    private var currentlyReadingDataGroup : DataGroupId?
    
    private var dataGroupsToRead : [DataGroupId] = []
    private var readAllDatagroups = false
    private var skipSecureElements = true
    private var skipCA = false
    private var skipPACE = false
    
    // Extended mode is used for reading eMRTD's that support extended length APDUs
    private var useExtendedMode = false

    // When set, this exact challenge is used for Active Authentication instead of a
    // random one, so the recovered AA signature can be verified on-chain against a
    // challenge derived from the wallet identity key.
    private var aaChallengeOverride : [UInt8]? = nil

    private var bacHandler : BACHandler?
    private var caHandler : ChipAuthenticationHandler?
    private var paceHandler : PACEHandler?
    private var mrzKey : String = ""
    private var dataAmountToReadOverride : Int? = nil
    private var sessionDidBecomeActive = false
    public private(set) var debugSnapshot = PassportReaderDebugSnapshot()
    
    private var scanCompletedHandler: ((NFCPassportModel?, NFCPassportReaderError?)->())!
    private var nfcViewDisplayMessageHandler: ((NFCViewDisplayMessage) -> String?)?
    private var masterListURL : URL?
    private var shouldNotReportNextReaderSessionInvalidationErrorUserCanceled : Bool = false
    private let releaseBarrierLock = NSLock()
    private var sessionWasCreatedForCurrentRead = false
    private var sessionDidInvalidateForCurrentRead = false
    private var releaseBarrierContinuation: CheckedContinuation<PassportReaderReleaseBarrierStatus, Never>?
    private var preActiveTimeoutWorkItem: DispatchWorkItem?
    private let preActiveTimeoutMs: Int = 6000

    // By default, Passive Authentication uses the new RFS5652 method to verify the SOD, but can be switched to use
    // the previous OpenSSL CMS verification if necessary
    public var passiveAuthenticationUsesOpenSSL : Bool = false

    public init( masterListURL: URL? = nil ) {
        super.init()
        
        self.masterListURL = masterListURL
    }
    
    public func setMasterListURL( _ masterListURL : URL ) {
        self.masterListURL = masterListURL
    }
    
    // This function allows you to override the amount of data the TagReader tries to read from the NFC
    // chip. NOTE - this really shouldn't be used for production but is useful for testing as different
    // passports support different data amounts.
    // It appears that the most reliable is 0xA0 (160 chars) but some will support arbitary reads (0xFF or 256)
    public func overrideNFCDataAmountToRead( amount: Int ) {
        dataAmountToReadOverride = amount
    }
    
    public func readPassport( mrzKey : String, tags : [DataGroupId] = [], skipSecureElements : Bool = true, skipCA : Bool = false, skipPACE : Bool = false, useExtendedMode : Bool = false, aaChallenge : [UInt8]? = nil, customDisplayMessage : ((NFCViewDisplayMessage) -> String?)? = nil) async throws -> NFCPassportModel {
        
        self.passport = NFCPassportModel()
        self.mrzKey = mrzKey
        self.skipCA = skipCA
        self.skipPACE = skipPACE
        self.useExtendedMode = useExtendedMode
        self.aaChallengeOverride = aaChallenge
        
        self.dataGroupsToRead.removeAll()
        self.dataGroupsToRead.append( contentsOf:tags)
        self.nfcViewDisplayMessageHandler = customDisplayMessage
        self.skipSecureElements = skipSecureElements
        self.currentlyReadingDataGroup = nil
        self.bacHandler = nil
        self.caHandler = nil
        self.paceHandler = nil
        self.debugSnapshot = PassportReaderDebugSnapshot()
        self.debugSnapshot.sessionStartedAtMs = Self.currentEpochMs()
        self.resetReleaseBarrierTracking()
        
        // If no tags specified, read all
        if self.dataGroupsToRead.count == 0 {
            // Start off with .COM, will always read (and .SOD but we'll add that after), and then add the others from the COM
            self.dataGroupsToRead.append(contentsOf:[.COM, .SOD] )
            self.readAllDatagroups = true
        } else {
            // We are reading specific datagroups
            self.readAllDatagroups = false
        }
        
        guard NFCNDEFReaderSession.readingAvailable else {
            throw NFCPassportReaderError.NFCNotSupported
        }
        
        if NFCTagReaderSession.readingAvailable {
            sessionDidBecomeActive = false
            debugSnapshot.sessionBeginRequestedAtMs = Self.currentEpochMs()
            Logger.passportReader.debug("tagReaderSession: preparing session request")
            readerSession = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil)
            self.markSessionCreatedForCurrentRead()
            debugSnapshot.sessionCreated = true
            
            self.updateReaderSessionMessage( alertMessage: NFCViewDisplayMessage.requestPresentPassport )
            debugSnapshot.sessionBeginRequested = true
            Logger.passportReader.debug("tagReaderSession: begin requested")
            readerSession?.begin()
            schedulePreActiveTimeout()
        }
        
        return try await withCheckedThrowingContinuation({ (continuation: NFCCheckedContinuation) in
            self.nfcContinuation = continuation
        })
    }

    public func cancel() {
        Logger.passportReader.debug("tagReaderSession: cancel requested")
        cancelPreActiveTimeout()
        readerSession?.invalidate()
    }

    public func waitForSessionReleaseIfNeeded(timeoutMs: Int = 1800) async -> PassportReaderReleaseBarrierStatus {
        releaseBarrierLock.lock()
        let sessionWasCreated = sessionWasCreatedForCurrentRead
        let sessionDidInvalidate = sessionDidInvalidateForCurrentRead
        releaseBarrierLock.unlock()

        if !sessionWasCreated {
            return .skippedNoSession
        }
        if sessionDidInvalidate {
            return .alreadyReleased
        }

        Logger.passportReader.debug("tagReaderSession: waiting for didInvalidate release barrier")

        return await withCheckedContinuation { continuation in
            releaseBarrierLock.lock()
            if sessionDidInvalidateForCurrentRead {
                releaseBarrierLock.unlock()
                continuation.resume(returning: .alreadyReleased)
                return
            }
            releaseBarrierContinuation = continuation
            releaseBarrierLock.unlock()

            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { [weak self] in
                guard let self else {
                    return
                }
                self.releaseBarrierLock.lock()
                let stillPending = self.releaseBarrierContinuation != nil
                let didInvalidate = self.sessionDidInvalidateForCurrentRead
                if stillPending {
                    self.releaseBarrierContinuation = nil
                }
                self.releaseBarrierLock.unlock()

                guard stillPending else {
                    return
                }
                if didInvalidate {
                    continuation.resume(returning: .observedDidInvalidate)
                } else {
                    Logger.passportReader.error("tagReaderSession: release barrier timed out before didInvalidate")
                    continuation.resume(returning: .timedOut)
                }
            }
        }
    }
}

@available(iOS 15, *)
extension PassportReader : NFCTagReaderSessionDelegate {
    // MARK: - NFCTagReaderSessionDelegate
    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {
        // If necessary, you may perform additional operations on session start.
        // At this point RF polling is enabled.
        sessionDidBecomeActive = true
        cancelPreActiveTimeout()
        debugSnapshot.sessionDidBecomeActive = true
        debugSnapshot.sessionBecameActiveAtMs = Self.currentEpochMs()
        Logger.passportReader.debug( "tagReaderSessionDidBecomeActive" )
    }
    
    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        // If necessary, you may handle the error. Note session is no longer valid.
        // You must create a new session to restart RF polling.
        cancelPreActiveTimeout()
        Logger.passportReader.debug(
            "tagReaderSession:didInvalidateWithError - active=\(self.sessionDidBecomeActive) error=\(error.localizedDescription)"
        )
        let nsError = error as NSError
        debugSnapshot.sessionInvalidatedBeforeActive = !sessionDidBecomeActive
        debugSnapshot.sessionInvalidatedAfterActive = sessionDidBecomeActive
        debugSnapshot.invalidationAtMs = Self.currentEpochMs()
        debugSnapshot.invalidationErrorDomain = nsError.domain
        debugSnapshot.invalidationErrorCode = nsError.code
        debugSnapshot.invalidationErrorMessage = error.localizedDescription
        if !sessionDidBecomeActive && debugSnapshot.preActiveFailureCode == nil {
            debugSnapshot.preActiveFailureCode = classifyPreActiveFailureCode(nsError: nsError)
        }
        self.markSessionDidInvalidateForCurrentRead()
        self.readerSession?.invalidate()
        self.readerSession = nil

        if let readerError = error as? NFCReaderError, readerError.code == NFCReaderError.readerSessionInvalidationErrorUserCanceled
            && self.shouldNotReportNextReaderSessionInvalidationErrorUserCanceled {
            
            self.shouldNotReportNextReaderSessionInvalidationErrorUserCanceled = false
        } else {
            var userError = NFCPassportReaderError.UnexpectedError
            if let readerError = error as? NFCReaderError {
                Logger.passportReader.error( "tagReaderSession:didInvalidateWithError - Got NFCReaderError - \(readerError.localizedDescription)" )
                switch (readerError.code) {
                case NFCReaderError.readerSessionInvalidationErrorUserCanceled:
                    Logger.passportReader.error( "     - User cancelled session" )
                    userError = NFCPassportReaderError.UserCanceled
                case NFCReaderError.readerSessionInvalidationErrorSessionTimeout:
                    Logger.passportReader.error("     - Session timeout")
                    userError = NFCPassportReaderError.TimeOutError
                default:
                    Logger.passportReader.error( "     - some other error - \(readerError.localizedDescription)" )
                    userError = NFCPassportReaderError.Unknown(readerError)
                }
            } else {
                Logger.passportReader.error( "tagReaderSession:didInvalidateWithError - Received error - \(error.localizedDescription)" )
            }
            nfcContinuation?.resume(throwing: userError)
            nfcContinuation = nil
        }
    }
    
    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        Logger.passportReader.debug( "tagReaderSession:didDetect - found \(tags)" )
        if tags.count > 1 {
            Logger.passportReader.debug( "tagReaderSession:more than 1 tag detected! - \(tags)" )

            let errorMessage = NFCViewDisplayMessage.error(.MoreThanOneTagFound)
            self.invalidateSession(errorMessage: errorMessage, error: NFCPassportReaderError.MoreThanOneTagFound)
            return
        }

        let tag = tags.first!
        var passportTag: NFCISO7816Tag
        switch tags.first! {
        case let .iso7816(tag):
            passportTag = tag
            debugSnapshot.tagType = "iso7816"
            debugSnapshot.supportsIso7816 = true
            debugSnapshot.supportsIso14443 = true
            debugSnapshot.iso7816IdentifierHex = Self.hexString(from: tag.identifier)
            if let historicalBytes = tag.historicalBytes {
                debugSnapshot.historicalBytesHex = Self.hexString(from: historicalBytes)
            }
            if let applicationData = tag.applicationData {
                debugSnapshot.applicationDataHex = Self.hexString(from: applicationData)
            }
            debugSnapshot.initialSelectedAidHex = tag.initialSelectedAID
        default:
            debugSnapshot.tagType = "non_iso7816"
            Logger.passportReader.debug( "tagReaderSession:invalid tag detected!!!" )

            let errorMessage = NFCViewDisplayMessage.error(NFCPassportReaderError.TagNotValid)
            self.invalidateSession(errorMessage:errorMessage, error: NFCPassportReaderError.TagNotValid)
            return
        }
        debugSnapshot.tagDetected = true
        debugSnapshot.tagDetectedAtMs = Self.currentEpochMs()
        
        Task { [passportTag] in
            do {
                try await session.connect(to: tag)
                self.debugSnapshot.tagConnectedAtMs = Self.currentEpochMs()
                
                Logger.passportReader.debug( "tagReaderSession:connected to tag - starting authentication" )
                self.updateReaderSessionMessage( alertMessage: NFCViewDisplayMessage.authenticatingWithPassport(0) )
                
                let tagReader = TagReader(tag:passportTag)
                
                if let newAmount = self.dataAmountToReadOverride {
                    tagReader.overrideDataAmountToRead(newAmount: newAmount)
                }
                
                tagReader.progress = { [unowned self] (progress) in
                    if let dgId = self.currentlyReadingDataGroup {
                        self.updateReaderSessionMessage( alertMessage: NFCViewDisplayMessage.readingDataGroupProgress(dgId, progress) )
                    } else {
                        self.updateReaderSessionMessage( alertMessage: NFCViewDisplayMessage.authenticatingWithPassport(progress) )
                    }
                }
                
                let passportModel = try await self.startReading( tagReader : tagReader)
                nfcContinuation?.resume(returning: passportModel)
                nfcContinuation = nil

                
            } catch let error as NFCPassportReaderError {
                let errorMessage = NFCViewDisplayMessage.error(error)
                self.invalidateSession(errorMessage: errorMessage, error: error)
            } catch {
                Logger.passportReader.debug( "tagReaderSession:failed to connect to tag - \(error.localizedDescription)" )

                // .readerTransceiveErrorTagResponseError is thrown when a "connection lost" scenario is forced by moving the phone away from the NFC chip
                // .readerTransceiveErrorTagConnectionLost is never thrown for this scenario, but added for the sake of completeness
                if let nfcError = error as? NFCReaderError,
                   nfcError.errorCode == NFCReaderError.readerTransceiveErrorTagResponseError.rawValue ||
                    nfcError.errorCode == NFCReaderError.readerTransceiveErrorTagConnectionLost.rawValue {
                    let errorMessage = NFCViewDisplayMessage.error(NFCPassportReaderError.ConnectionError)
                    self.invalidateSession(errorMessage: errorMessage, error: NFCPassportReaderError.ConnectionError)
                } else {
                    let errorMessage = NFCViewDisplayMessage.error(NFCPassportReaderError.Unknown(error))
                    self.invalidateSession(errorMessage: errorMessage, error: NFCPassportReaderError.Unknown(error))
                }
            }
        }
    }
    
    func updateReaderSessionMessage(alertMessage: NFCViewDisplayMessage ) {
        self.readerSession?.alertMessage = self.nfcViewDisplayMessageHandler?(alertMessage) ?? alertMessage.description
    }

    private func resetReleaseBarrierTracking() {
        releaseBarrierLock.lock()
        sessionWasCreatedForCurrentRead = false
        sessionDidInvalidateForCurrentRead = false
        releaseBarrierContinuation = nil
        releaseBarrierLock.unlock()
        cancelPreActiveTimeout()
    }

    private func markSessionCreatedForCurrentRead() {
        releaseBarrierLock.lock()
        sessionWasCreatedForCurrentRead = true
        releaseBarrierLock.unlock()
    }

    private func markSessionDidInvalidateForCurrentRead() {
        releaseBarrierLock.lock()
        sessionDidInvalidateForCurrentRead = true
        let continuation = releaseBarrierContinuation
        releaseBarrierContinuation = nil
        releaseBarrierLock.unlock()
        continuation?.resume(returning: .observedDidInvalidate)
    }

    private func schedulePreActiveTimeout() {
        cancelPreActiveTimeout()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard !self.sessionDidBecomeActive else { return }
            self.debugSnapshot.preActiveFailureCode = "NFC_SHEET_DID_NOT_BECOME_ACTIVE"
            Logger.passportReader.error("tagReaderSession: pre-active timeout before didBecomeActive")
            self.readerSession?.invalidate(errorMessage: "Unable to start NFC reader. Please try again.")
        }
        preActiveTimeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(preActiveTimeoutMs),
            execute: workItem
        )
    }

    private func cancelPreActiveTimeout() {
        preActiveTimeoutWorkItem?.cancel()
        preActiveTimeoutWorkItem = nil
    }

    private func classifyPreActiveFailureCode(nsError: NSError) -> String {
        if nsError.domain == NFCReaderError.errorDomain || nsError.domain == "NFCError" {
            switch nsError.code {
            case NFCReaderError.readerSessionInvalidationErrorSystemIsBusy.rawValue:
                return "NFC_RESOURCE_UNAVAILABLE"
            case NFCReaderError.readerSessionInvalidationErrorSessionTerminatedUnexpectedly.rawValue:
                return "NFC_APP_INTERRUPTED"
            case NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue:
                return "NFC_USER_CANCELLED"
            case NFCReaderError.readerSessionInvalidationErrorSessionTimeout.rawValue:
                return "NFC_TIMEOUT"
            default:
                return "NFC_SESSION_INVALIDATED"
            }
        }
        return "NFC_SESSION_INVALIDATED"
    }
}

@available(iOS 15, *)
extension PassportReader {
    private static func currentEpochMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    private static func hexString(from data: Data) -> String {
        data.map { String(format: "%02X", $0) }.joined()
    }
}

@available(iOS 15, *)
extension PassportReader {
    
    func startReading(tagReader : TagReader) async throws -> NFCPassportModel {
        trackingDelegate?.nfcTagDetected()

        if !skipPACE {
            do {
                trackingDelegate?.paceStarted()

                let data = try await tagReader.readCardAccess()
                Logger.passportReader.debug( "Read CardAccess - data \(binToHexRep(data))" )
                let cardAccess = try CardAccess(data)
                passport.cardAccess = cardAccess

                trackingDelegate?.readCardAccess(cardAccess: cardAccess)

                Logger.passportReader.info( "Starting Password Authenticated Connection Establishment (PACE)" )
                 
                let paceHandler = try PACEHandler( cardAccess: cardAccess, tagReader: tagReader )
                try await paceHandler.doPACE(mrzKey: mrzKey )
                passport.PACEStatus = .success
                Logger.passportReader.debug( "PACE Succeeded" )

                trackingDelegate?.paceSucceeded()
            } catch {
                trackingDelegate?.paceFailed()

                passport.PACEStatus = .failed
                Logger.passportReader.error( "PACE Failed - falling back to BAC" )
            }
            
            _ = try await tagReader.selectPassportApplication()
        }
        
        // If either PACE isn't supported, we failed whilst doing PACE or we didn't even attempt it, then fall back to BAC
        if passport.PACEStatus != .success {
            do {
                trackingDelegate?.bacStarted()
                try await doBACAuthentication(tagReader : tagReader)
                trackingDelegate?.bacSucceeded()
            } catch {
                trackingDelegate?.bacFailed()
                throw error
            }
        }
        
        // Now to read the datagroups
        try await readDataGroups(tagReader: tagReader)

        try await doActiveAuthenticationIfNeccessary(tagReader : tagReader)

        self.updateReaderSessionMessage(alertMessage: NFCViewDisplayMessage.successfulRead)
        self.shouldNotReportNextReaderSessionInvalidationErrorUserCanceled = true
        self.readerSession?.invalidate()

        // If we have a masterlist url set then use that and verify the passport now
        self.passport.verifyPassport(masterListURL: self.masterListURL, useCMSVerification: self.passiveAuthenticationUsesOpenSSL)
        self.debugSnapshot.readCompletedAtMs = Self.currentEpochMs()

        return self.passport
    }
    
    
    func doActiveAuthenticationIfNeccessary( tagReader : TagReader) async throws {
        guard self.passport.activeAuthenticationSupported else {
            return
        }
        self.updateReaderSessionMessage(alertMessage: NFCViewDisplayMessage.activeAuthentication)

        Logger.passportReader.info( "Performing Active Authentication" )

        let challenge = self.aaChallengeOverride ?? generateRandomUInt8Array(8)
        Logger.passportReader.debug( "Active Authentication challenge (override=\(self.aaChallengeOverride != nil)) - \(binToHexRep(challenge))")
        let response = try await tagReader.doInternalAuthentication(challenge: challenge, useExtendedMode: useExtendedMode)
        self.passport.verifyActiveAuthentication( challenge:challenge, signature:response.data )
    }
    

    func doBACAuthentication(tagReader : TagReader) async throws {
        self.currentlyReadingDataGroup = nil

        Logger.passportReader.info( "Starting Basic Access Control (BAC)" )
        self.debugSnapshot.bacStartedAtMs = Self.currentEpochMs()
        
        self.passport.BACStatus = .failed

        self.bacHandler = BACHandler( tagReader: tagReader )
        try await bacHandler?.performBACAndGetSessionKeys( mrzKey: mrzKey )
        Logger.passportReader.info( "Basic Access Control (BAC) - SUCCESS!" )
        self.debugSnapshot.bacSucceededAtMs = Self.currentEpochMs()

        self.passport.BACStatus = .success
    }

    func readDataGroups( tagReader: TagReader ) async throws {
        
        // Read COM
        var DGsToRead = [DataGroupId]()

        self.updateReaderSessionMessage( alertMessage: NFCViewDisplayMessage.readingDataGroupProgress(.COM, 0) )
        
        if let com = try await readDataGroup(tagReader:tagReader, dgId:.COM) as? COM {
            self.passport.addDataGroup( .COM, dataGroup:com )
            self.addDatagroupsToRead(com: com, to: &DGsToRead)
        }
        
        if DGsToRead.contains( .DG14 ) {
            DGsToRead.removeAll { $0 == .DG14 }
            
            if !skipCA {
                // Do Chip Authentication
                if let dg14 = try await readDataGroup(tagReader:tagReader, dgId:.DG14) as? DataGroup14 {
                    self.passport.addDataGroup( .DG14, dataGroup:dg14 )
                    let caHandler = ChipAuthenticationHandler(dg14: dg14, tagReader: tagReader)
                     
                    if caHandler.isChipAuthenticationSupported {
                        do {
                            // Do Chip authentication and then continue reading datagroups
                            try await caHandler.doChipAuthentication()
                            self.passport.chipAuthenticationStatus = .success
                        } catch {
                            Logger.passportReader.info( "Chip Authentication failed - re-establishing BAC")
                            self.passport.chipAuthenticationStatus = .failed
                            
                            // Failed Chip Auth, need to re-establish BAC
                            try await doBACAuthentication(tagReader: tagReader)
                        }
                    }
                }
            }
        }

        // If we are skipping secure elements then remove .DG3 and .DG4
        if self.skipSecureElements {
            DGsToRead = DGsToRead.filter { $0 != .DG3 && $0 != .DG4 }
        }

        if self.readAllDatagroups != true {
            DGsToRead = DGsToRead.filter { dataGroupsToRead.contains($0) }
        }
        for dgId in DGsToRead {
            self.updateReaderSessionMessage( alertMessage: NFCViewDisplayMessage.readingDataGroupProgress(dgId, 0) )
            if let dg = try await readDataGroup(tagReader:tagReader, dgId:dgId) {
                self.passport.addDataGroup( dgId, dataGroup:dg )
            }
        }
    }
    
    func readDataGroup( tagReader : TagReader, dgId : DataGroupId ) async throws -> DataGroup?  {

        self.currentlyReadingDataGroup = dgId
        Logger.passportReader.info( "Reading tag - \(dgId.getName())" )
        var readAttempts = 0
        var nfcPassportReaderError: NFCPassportReaderError
        
        self.updateReaderSessionMessage( alertMessage: NFCViewDisplayMessage.readingDataGroupProgress(dgId, 0) )

        repeat {
            do {
                let response = try await tagReader.readDataGroup(dataGroup:dgId)
                let dg = try DataGroupParser().parseDG(data: response)
                if self.debugSnapshot.firstFileReadAtMs == nil {
                    self.debugSnapshot.firstFileReadAtMs = Self.currentEpochMs()
                }
                return dg
            } catch let error as NFCPassportReaderError {
                Logger.passportReader.error( "TagError reading tag - \(error)" )
                nfcPassportReaderError = error

                // OK we had an error - depending on what happened, we may want to try to re-read this
                // E.g. we failed to read the last Datagroup because its protected and we can't
                let errMsg = error.value
                Logger.passportReader.error( "ERROR - \(errMsg)" )
                var redoBAC = false
                if errMsg == "Session invalidated" || errMsg == "Class not supported" || errMsg == "Tag connection lost" || errMsg == "Tag response error / no response" {
                    // Check if we have done Chip Authentication, if so, set it to nil and try to redo BAC
                    if self.caHandler != nil {
                        self.caHandler = nil
                        redoBAC = true
                    } else {
                        // Can't go any more!
                        throw error
                    }
                } else if errMsg == "Security status not satisfied" || errMsg == "File not found" {
                    // Can't read this element as we aren't allowed - remove it and return out so we re-do BAC
                    self.dataGroupsToRead.removeFirst()
                    redoBAC = true
                } else if errMsg == "SM data objects incorrect" || errMsg == "Class not supported" {
                    // Can't read this element security objects now invalid - and return out so we re-do BAC
                    redoBAC = true
                } else if errMsg.hasPrefix( "Wrong length" ) || errMsg.hasPrefix( "End of file" ) {  // Should now handle errors 0x6C xx, and 0x67 0x00
                    // OK passport can't handle max length so drop it down
                    tagReader.reduceDataReadingAmount()
                    redoBAC = true
                } else if errMsg == "UnsupportedDataGroup" {
                    // OK, this DataGroup is not supported, lets skip it
                    Logger.passportReader.debug("Unsupported DataGroup - \(dgId.rawValue)")
                    return nil
                }
                
                if redoBAC {
                    // Redo BAC and try again
                    try await doBACAuthentication(tagReader : tagReader)
                } else {
                    // Some other error lets have another try
                }
            }
            readAttempts += 1
        } while ( readAttempts < 2 )

        // The error will be thrown after n attempts
        throw nfcPassportReaderError
    }

    func invalidateSession(errorMessage: NFCViewDisplayMessage, error: NFCPassportReaderError) {
        // Mark the next 'invalid session' error as not reportable (we're about to cause it by invalidating the
        // session). The real error is reported back with the call to the completed handler
        self.shouldNotReportNextReaderSessionInvalidationErrorUserCanceled = true
        self.readerSession?.invalidate(errorMessage: self.nfcViewDisplayMessageHandler?(errorMessage) ?? errorMessage.description)
        nfcContinuation?.resume(throwing: error)
        nfcContinuation = nil
    }
    
    internal func addDatagroupsToRead(com: COM, to DGsToRead: inout [DataGroupId]) {
        DGsToRead += com.dataGroupsPresent.compactMap { DataGroupId.getIDFromName(name:$0) }
        DGsToRead.removeAll { $0 == .COM }
        
        // SOD should not be present in COM, but just in case we check before adding it so its not read twice
        if !DGsToRead.contains(.SOD) { DGsToRead.insert(.SOD, at: 0) }
    }
}
#endif
