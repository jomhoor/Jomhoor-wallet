#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(PassportVerificationEventEmitter, RCTEventEmitter)
@end

@interface RCT_EXTERN_MODULE(PassportVerificationModule, NSObject)

RCT_EXTERN_METHOD(getPassportVerificationNativeStatus
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(readPassport
                  : (NSDictionary *)input
                  resolver
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(probePassportChip
                  : (NSDictionary *)input
                  resolver
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(probeRawNfcTag
                  : (NSDictionary *)input
                  resolver
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelSession
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(disconnect
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
