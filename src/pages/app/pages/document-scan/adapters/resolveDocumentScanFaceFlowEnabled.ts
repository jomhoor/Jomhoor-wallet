export function resolveDocumentScanFaceFlowEnabledFromEnv(envValue: string | undefined): boolean {
  return envValue?.trim().toLowerCase() === 'enabled'
}

export function resolveDocumentScanFaceFlowEnabled(): boolean {
  return resolveDocumentScanFaceFlowEnabledFromEnv(process.env.EXPO_PUBLIC_DOCUMENT_SCAN_FACE_FLOW)
}
