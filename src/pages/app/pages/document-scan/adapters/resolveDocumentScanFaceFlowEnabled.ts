// Temporary kill-switch for emergency rollback to legacy flow.
// Keep disabled by default so face flow is always on in all environments.
const ENABLE_LEGACY_FACE_FLOW_FALLBACK = false

export function resolveDocumentScanFaceFlowEnabledFromEnv(_envValue: string | undefined): boolean {
  return !ENABLE_LEGACY_FACE_FLOW_FALLBACK
}

export function resolveDocumentScanFaceFlowEnabled(): boolean {
  return resolveDocumentScanFaceFlowEnabledFromEnv(process.env.EXPO_PUBLIC_DOCUMENT_SCAN_FACE_FLOW)
}
