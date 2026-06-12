#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NidVerification, NSObject)

RCT_EXTERN_METHOD(getNidVerificationNativeStatus
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(logNidNfcEvent
                  : (NSDictionary *)input)

RCT_EXTERN_METHOD(probeNidChip
                  : (NSDictionary *)input
                  resolver
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelNidProbe
                  : (RCTPromiseResolveBlock)resolve
                  rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
