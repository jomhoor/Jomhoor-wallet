import {
  type NidNfcReadResult,
  NidVerificationFlow,
  type NidVerificationInitialData,
  type NidVerificationResult,
  type ReadNidNfcInput,
} from '@iland/nid-verification'
import { useNavigation } from '@react-navigation/core'
import { useCallback, useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ErrorHandler } from '@/core'
import { Steps, useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import {
  initNfc,
  readSigningAndAuthCertificates,
  stopNfc,
} from '@/utils/e-document/inid-nfc-reader'

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

  const {
    resetFaceVerification,
    setCurrentStep,
    setNidVerificationResult,
    setPassportNfcDetails,
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

  useEffect(() => {
    void initNfc().catch(() => undefined)

    return () => {
      void stopNfc().catch(() => undefined)
    }
  }, [])

  const readLiveNidNfc = useCallback(async (input: ReadNidNfcInput): Promise<NidNfcReadResult> => {
    const expectedNationalId = normalizeNationalId(input.expectedNationalId)

    try {
      const { signingCert, authCert } = await readSigningAndAuthCertificates()
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
        debug: {
          backend: 'inid-nfc-reader',
          hasAuthCert,
          hasSigningCert,
          mocked: false,
          readAt: Date.now(),
        },
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error('Failed to read NID NFC chip.')
    }
  }, [])

  const handleComplete = (result: NidVerificationResult) => {
    setNidVerificationResult(result)
    if (!result.verified) {
      ErrorHandler.process(
        new Error('NID verification did not pass'),
        'NID verification did not pass validation checks.',
      )
      return
    }

    setPassportNfcDetails({
      normalized: {
        firstName: result.nfc.firstName?.value,
        lastName: result.nfc.lastName?.value,
        nidn: result.identity?.nationalId,
      },
      portrait: result.front.frontImageUri
        ? {
            filePath: result.front.frontImageUri,
          }
        : undefined,
    })
    resetFaceVerification()
    setCurrentStep(Steps.FaceLivenessStep)
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
        onComplete={handleComplete}
        onCancel={() => {
          navigation.navigate('App', { screen: 'Home' })
        }}
        onError={error => {
          ErrorHandler.processWithoutFeedback(error)
        }}
      />
    </View>
  )
}
