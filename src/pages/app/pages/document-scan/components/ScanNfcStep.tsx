import {
  cancelNidNfcProbe,
  isNidNfcProbeEnabled,
  type NidBackScanResult,
  type NidFrontScanResult,
  type NidNfcProbeResult,
  type NidNfcReadResult,
  NidVerificationFlow,
  type NidVerificationInitialData,
  type NidVerificationResult,
  probeNidChip,
  type ReadNidNfcInput,
} from '@iland/nid-verification'
import { useNavigation } from '@react-navigation/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ErrorHandler } from '@/core'
import { nidNfcResultToEID } from '@/pages/app/pages/document-scan/adapters'
import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import {
  clearInidNfcTemporaryData,
  initNfc,
  readSigningCertDgAndSod,
  stopNfc,
} from '@/utils/e-document/inid-nfc-reader'
import {
  appendNfcEvidence,
  clearNfcEvidence,
  createNfcFailureEvidence,
  createNidProbeEvidence,
  createNidReadEvidence,
  getNfcEvidenceSummary,
  logNfcEvidenceExport,
} from '@/utils/nfc-evidence'

function normalizeNationalId(value?: string): string | undefined {
  if (!value) return undefined
  const normalized = value
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '')
  return normalized || undefined
}

export default function ScanNfcStep() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const nfcProbeEnabled = isNidNfcProbeEnabled()
  const [nfcProbeBusy, setNfcProbeBusy] = useState(false)
  const [nfcProbeResult, setNfcProbeResult] = useState<NidNfcProbeResult>()
  const [nfcEvidenceLabel, setNfcEvidenceLabel] = useState('nid-sample')
  const [nfcEvidenceSummary, setNfcEvidenceSummary] = useState('')

  const {
    resetFaceVerification,
    setCurrentStep,
    setNidVerificationResult,
    setTempEDoc,
    setVerificationUserData,
    verificationUserData,
  } = useDocumentScanContext()

  const nidInitialData = useMemo<NidVerificationInitialData>(() => {
    const nid = verificationUserData.document.nid

    return {
      front: nid.front?.imageUri
        ? {
            frontImageUri: nid.front.imageUri,
          }
        : undefined,
      back: nid.back
        ? {
            barcode: nid.back.barcode,
            barcodeRaw: nid.back.barcodeRaw,
            nationalId: nid.back.nationalId
              ? {
                  value: nid.back.nationalId,
                  source: 'barcode',
                  confidence: 0.95,
                }
              : undefined,
          }
        : undefined,
      nfc: nid.nfc,
      result: nid.verification,
    }
  }, [verificationUserData])

  const refreshEvidenceSummary = useCallback(async () => {
    setNfcEvidenceSummary(await getNfcEvidenceSummary('nid', nfcEvidenceLabel))
  }, [nfcEvidenceLabel])

  useEffect(() => {
    void refreshEvidenceSummary()
  }, [refreshEvidenceSummary])

  useEffect(() => {
    void initNfc().catch(() => undefined)

    return () => {
      void cancelNidNfcProbe().catch(() => undefined)
      void stopNfc().catch(() => undefined)
    }
  }, [])

  const runNfcProbe = useCallback(async () => {
    setNfcProbeBusy(true)
    setNfcProbeResult(undefined)
    try {
      const result = await probeNidChip()
      console.warn('[NID-NFC-PROBE][REPORT]\n', JSON.stringify(result, null, 2))
      setNfcProbeResult(result)
      await appendNfcEvidence(createNidProbeEvidence(result, nfcEvidenceLabel))
      await refreshEvidenceSummary()
    } catch (error) {
      await appendNfcEvidence(
        createNfcFailureEvidence({
          documentFlow: 'nid',
          source: 'probe',
          testLabel: nfcEvidenceLabel,
          error,
        }),
      )
      await refreshEvidenceSummary()
      ErrorHandler.processWithoutFeedback(
        error instanceof Error ? error : new Error('NID NFC probe failed.'),
      )
    } finally {
      setNfcProbeBusy(false)
    }
  }, [nfcEvidenceLabel, refreshEvidenceSummary])

  const readLiveNidNfc = useCallback(
    async (input: ReadNidNfcInput): Promise<NidNfcReadResult> => {
      const expectedNationalId = normalizeNationalId(input.expectedNationalId)

      try {
        const { authCert, dg1Bytes, dg15Bytes, signingCert, sodBytes } =
          await readSigningCertDgAndSod()
        const hasSigningCert = Boolean(signingCert)
        const hasAuthCert = Boolean(authCert)
        const status = hasSigningCert && hasAuthCert ? 'success' : 'failed'

        return {
          status,
          nationalId: expectedNationalId
            ? {
                value: expectedNationalId,
                source: 'derived',
                confidence: 0.9,
              }
            : undefined,
          signingCertHex: signingCert ?? undefined,
          authCertHex: authCert ?? undefined,
          dg1Bytes,
          dg15Bytes,
          sodBytes,
          debug: {
            backend: 'inid-nfc-reader',
            hasAuthCert,
            hasSigningCert,
            mocked: false,
            readAt: Date.now(),
          },
        }
      } catch (error) {
        await appendNfcEvidence(
          createNfcFailureEvidence({
            documentFlow: 'nid',
            source: 'read',
            testLabel: nfcEvidenceLabel,
            error,
            probeTechnology: 'iso-dep-iso7816',
            readerStrategy: 'nid-certificate-auto',
          }),
        )
        await refreshEvidenceSummary()
        throw error instanceof Error ? error : new Error('Failed to read NID NFC chip.')
      }
    },
    [nfcEvidenceLabel, refreshEvidenceSummary],
  )

  const handleFrontStored = useCallback(
    (front: NidFrontScanResult) => {
      setVerificationUserData(previous => ({
        ...previous,
        document: {
          ...previous.document,
          nid: {
            ...previous.document.nid,
            front: {
              capturedAt: Date.now(),
              imageUri: front.frontImageUri,
            },
          },
        },
        evidence: [
          ...previous.evidence,
          {
            keys: ['document.nid.front'],
            source: 'camera',
            step: 'nid-front-scan',
            storedAt: Date.now(),
          },
        ],
      }))
    },
    [setVerificationUserData],
  )

  const handleBackStored = useCallback(
    (back: NidBackScanResult) => {
      setVerificationUserData(previous => ({
        ...previous,
        document: {
          ...previous.document,
          nid: {
            ...previous.document.nid,
            back: {
              barcode: back.barcode,
              barcodeRaw: back.barcodeRaw,
              nationalId: back.nationalId?.value,
            },
          },
        },
        evidence: [
          ...previous.evidence,
          {
            keys: ['document.nid.back'],
            source: 'barcode',
            step: 'nid-back-barcode-scan',
            storedAt: Date.now(),
          },
        ],
      }))
    },
    [setVerificationUserData],
  )

  const handleNfcStored = useCallback(
    async (nfc: NidNfcReadResult, result: NidVerificationResult) => {
      setVerificationUserData(previous => ({
        ...previous,
        document: {
          ...previous.document,
          nid: {
            ...previous.document.nid,
            nfc,
            verification: result,
          },
        },
        evidence: [
          ...previous.evidence,
          {
            keys: ['document.nid.nfc', 'document.nid.verification'],
            source: 'nfc',
            step: 'nid-nfc-read',
            storedAt: Date.now(),
          },
        ],
        session: {
          ...previous.session,
          status: result.verified ? 'ready-for-proof' : 'failed',
        },
      }))
      await appendNfcEvidence(createNidReadEvidence(nfc, result, nfcEvidenceLabel))
      await refreshEvidenceSummary()
      await clearInidNfcTemporaryData()
    },
    [nfcEvidenceLabel, refreshEvidenceSummary, setVerificationUserData],
  )

  const handleComplete = (result: NidVerificationResult) => {
    setNidVerificationResult(result)
    if (!result.verified) {
      ErrorHandler.process(
        new Error('NID verification did not pass'),
        'NID verification did not pass validation checks.',
      )
      return
    }

    try {
      setTempEDoc(nidNfcResultToEID(result.nfc))
    } catch (error) {
      ErrorHandler.process(
        error instanceof Error ? error : new Error('Failed to convert NID NFC data'),
        'Could not prepare NID NFC data for proof generation.',
      )
      return
    }

    resetFaceVerification()
    setCurrentStep(Steps.FaceGazeStep)
  }

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <NidVerificationFlow
        initialData={nidInitialData}
        nfcReader={readLiveNidNfc}
        onBackStored={handleBackStored}
        onComplete={handleComplete}
        onCancel={() => {
          navigation.navigate('App', { screen: 'Home' })
        }}
        onError={error => {
          ErrorHandler.processWithoutFeedback(error)
        }}
        onFrontStored={handleFrontStored}
        onNfcStored={handleNfcStored}
        nfcProbeEnabled={nfcProbeEnabled}
        nfcProbeBusy={nfcProbeBusy}
        nfcProbeResult={nfcProbeResult}
        onNfcProbe={() => {
          void runNfcProbe()
        }}
        nfcEvidenceLabel={nfcEvidenceLabel}
        nfcEvidenceSummary={nfcEvidenceSummary}
        onNfcEvidenceLabelChange={setNfcEvidenceLabel}
        onLogNfcEvidence={() => {
          void logNfcEvidenceExport()
        }}
        onClearNfcEvidence={() => {
          void clearNfcEvidence().then(refreshEvidenceSummary)
        }}
      />
    </View>
  )
}
