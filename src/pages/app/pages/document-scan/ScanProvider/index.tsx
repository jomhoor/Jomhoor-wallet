import type {
  FaceComparisonResult,
  GazeChallengeResult,
  LivenessResult,
  ParsedMrz,
  PassportCredentials,
  PassportNfcReadResult,
} from '@iland/passport-verification'
import type { FieldRecords } from 'mrz'
import type { PropsWithChildren } from 'react'
import { useCallback } from 'react'
import { useState } from 'react'
import { createContext, useContext } from 'react'

import { NoirEIDRegistration } from '@/api/modules/registration/variants/noir-eid'
import { NoirEPassportRegistration } from '@/api/modules/registration/variants/noir-epassport'
import { ErrorHandler } from '@/core'
import { tryCatch } from '@/helpers/try-catch'
import { resolveDocumentScanFaceFlowEnabled } from '@/pages/app/pages/document-scan/adapters'
import { identityStore } from '@/store/modules/identity'
import { PassportRegisteredWithAnotherPKError } from '@/store/modules/identity/errors'
import { IdentityItem } from '@/store/modules/identity/Identity'
import { walletStore } from '@/store/modules/wallet'
import { DocType, EDocument, EPassport } from '@/utils/e-document/e-document'
import type { PassportNfcScanOutput } from '@/utils/e-document/passport-nfc-reader'

export enum Steps {
  SelectDocTypeStep,
  ScanMrzStep,
  ScanPassportNfcStep,
  PassportNfcDetailsStep,
  FaceLivenessStep,
  FaceGazeStep,
  FaceComparisonStep,
  ScanNfcStep,
  DocumentPreviewStep,
  GenerateProofStep,
  RevocationStep,
}

export enum GenProofSteps {
  DownloadCircuit,
  GenerateProof,
  CreateProfile,
  Final,
}

type DocumentScanContext = {
  identity?: IdentityItem

  currentStep: Steps
  setCurrentStep: (step: Steps) => void

  creatingIdentityStep: GenProofSteps

  docType?: DocType
  setDocType: (docType: DocType) => void

  tempMRZ?: FieldRecords
  setTempMrz: (value: FieldRecords) => void
  tempEDoc?: EDocument
  setTempEDoc: (value: EDocument) => void
  passportNfcDetails?: {
    normalized?: {
      firstName?: string
      lastName?: string
      nationality?: string
      nidn?: string
      expiryDate?: string
      documentNumber?: string
    }
    portrait?: {
      base64?: string
      filePath?: string
    }
    packageNfcResult?: PassportNfcReadResult
  }
  setPassportNfcDetails: (value?: {
    normalized?: {
      firstName?: string
      lastName?: string
      nationality?: string
      nidn?: string
      expiryDate?: string
      documentNumber?: string
    }
    portrait?: {
      base64?: string
      filePath?: string
    }
    packageNfcResult?: PassportNfcReadResult
  }) => void
  setPassportNfcScanOutput: (value: PassportNfcScanOutput) => void
  passportMrzBarcode?: {
    credentials: PassportCredentials
    parsedMrz: ParsedMrz
    barcode?: {
      raw?: string
      nidn?: string
      fields?: Record<string, unknown>
    }
  }
  setPassportMrzBarcode: (value?: {
    credentials: PassportCredentials
    parsedMrz: ParsedMrz
    barcode?: {
      raw?: string
      nidn?: string
      fields?: Record<string, unknown>
    }
  }) => void
  faceVerification: {
    enabled: boolean
    liveness?: LivenessResult
    gaze?: GazeChallengeResult
    comparison?: FaceComparisonResult
  }
  setFaceLivenessResult: (value: LivenessResult) => void
  setFaceGazeResult: (value: GazeChallengeResult) => void
  setFaceComparisonResult: (value: FaceComparisonResult) => void
  resetFaceVerification: () => void

  createIdentity: () => Promise<void>
  revokeIdentity: () => Promise<void>

  circuitLoadingDetails?: {
    isLoaded: boolean
    isLoadFailed: boolean
    downloadingProgress: string
  }
}

const documentScanContext = createContext<DocumentScanContext>({
  currentStep: Steps.SelectDocTypeStep,

  setCurrentStep: () => {
    throw new Error('setCurrentStep not implemented')
  },

  creatingIdentityStep: GenProofSteps.DownloadCircuit,

  docType: undefined,
  setDocType: () => {
    throw new Error('setDocType not implemented')
  },
  tempMRZ: undefined,
  setTempMrz: () => {
    throw new Error('setMrz not implemented')
  },

  tempEDoc: undefined,
  setTempEDoc: () => {
    throw new Error('setEDoc not implemented')
  },
  passportNfcDetails: undefined,
  setPassportNfcDetails: () => {
    throw new Error('setPassportNfcDetails not implemented')
  },
  setPassportNfcScanOutput: () => {
    throw new Error('setPassportNfcScanOutput not implemented')
  },
  passportMrzBarcode: undefined,
  setPassportMrzBarcode: () => {
    throw new Error('setPassportMrzBarcode not implemented')
  },
  faceVerification: {
    enabled: false,
  },
  setFaceLivenessResult: () => {
    throw new Error('setFaceLivenessResult not implemented')
  },
  setFaceGazeResult: () => {
    throw new Error('setFaceGazeResult not implemented')
  },
  setFaceComparisonResult: () => {
    throw new Error('setFaceComparisonResult not implemented')
  },
  resetFaceVerification: () => {
    throw new Error('resetFaceVerification not implemented')
  },

  createIdentity: async () => {
    throw new Error('createIdentity not implemented')
  },
  revokeIdentity: async () => {
    throw new Error('revokeIdentity not implemented')
  },
})

export function useDocumentScanContext() {
  return useContext(documentScanContext)
}

const eidRegistration = new NoirEIDRegistration()
const epassportRegistration = new NoirEPassportRegistration()

function getInitialStep(docType?: DocType): Steps {
  if (docType === DocType.PASSPORT) return Steps.ScanMrzStep
  if (docType === DocType.ID) return Steps.ScanNfcStep
  return Steps.SelectDocTypeStep
}

export function ScanContextProvider({
  docType,
  children,
}: {
  docType?: DocType
} & PropsWithChildren) {
  const privateKey = walletStore.useWalletStore(state => state.privateKey)
  const publicKeyHash = walletStore.usePublicKeyHash()

  const addIdentity = identityStore.useIdentityStore(state => state.addIdentity)

  const [currentStep, setCurrentStep] = useState<Steps>(getInitialStep(docType))
  const [creatingIdentityStep, setCreatingIdentityStep] = useState(GenProofSteps.DownloadCircuit)

  const [selectedDocType, setSelectedDocType] = useState(docType)
  const faceFlowEnabled = resolveDocumentScanFaceFlowEnabled()

  const [tempMRZ, setTempMRZ] = useState<FieldRecords>()
  const [tempEDoc, setTempEDoc] = useState<EDocument>()
  const [passportNfcDetails, setPassportNfcDetails] =
    useState<DocumentScanContext['passportNfcDetails']>()
  const [passportMrzBarcode, setPassportMrzBarcode] =
    useState<DocumentScanContext['passportMrzBarcode']>()
  const [faceVerification, setFaceVerification] = useState<DocumentScanContext['faceVerification']>(
    {
      enabled: faceFlowEnabled,
    },
  )

  const [identity, setIdentity] = useState<IdentityItem>()

  const revokeIdentity = useCallback(async () => {
    throw new Error('Revoke identity is not implemented for EID')
  }, [])

  const createIdentity = useCallback(async () => {
    if (!tempEDoc) {
      throw new Error('EDocument is not set')
    }

    setCurrentStep(Steps.GenerateProofStep)

    const strategy = selectedDocType === DocType.PASSPORT ? epassportRegistration : eidRegistration

    const [identityItem, registrationError] = await tryCatch(
      strategy.createIdentity(tempEDoc as EPassport, privateKey, publicKeyHash, {
        onDownloading: () => {
          setCreatingIdentityStep(GenProofSteps.DownloadCircuit)
        },
        onGenerateProof: () => {
          setCreatingIdentityStep(GenProofSteps.GenerateProof)
        },
        onRegister: () => {
          setCreatingIdentityStep(GenProofSteps.CreateProfile)
        },
      }),
    )
    if (registrationError) {
      ErrorHandler.processWithoutFeedback(registrationError)

      if (registrationError instanceof PassportRegisteredWithAnotherPKError) {
        setCurrentStep(Steps.RevocationStep)
        return
      }

      ErrorHandler.process(
        registrationError,
        'Failed to create identity. Please check your NFC connection and try again.',
      )
      setCurrentStep(Steps.DocumentPreviewStep)
      return
    }

    addIdentity(identityItem)
    setIdentity(identityItem)

    setCreatingIdentityStep(GenProofSteps.Final)
  }, [addIdentity, privateKey, publicKeyHash, selectedDocType, tempEDoc])

  // ---------------------------------------------------------------------------------------------

  const handleSetSelectedDocType = useCallback(
    (value: DocType) => {
      setSelectedDocType(value)
      setPassportNfcDetails(undefined)
      setPassportMrzBarcode(undefined)
      setFaceVerification({
        enabled: faceFlowEnabled,
      })
      if (value === DocType.PASSPORT) {
        setCurrentStep(Steps.ScanMrzStep)
      } else {
        setCurrentStep(Steps.ScanNfcStep)
      }
    },
    [faceFlowEnabled],
  )

  const handleSetMrz = useCallback(
    (value: FieldRecords) => {
      setTempMRZ(value)
      setPassportNfcDetails(undefined)
      setFaceVerification({
        enabled: faceFlowEnabled,
      })
      setCurrentStep(Steps.ScanPassportNfcStep)
    },
    [faceFlowEnabled],
  )

  const handleSetEDoc = useCallback(
    (value: EDocument) => {
      setTempEDoc(value)
      setPassportNfcDetails(undefined)
      const shouldRunFaceFlow =
        selectedDocType === DocType.PASSPORT &&
        faceFlowEnabled &&
        value instanceof EPassport &&
        !faceVerification.comparison?.passed

      if (shouldRunFaceFlow) {
        setCurrentStep(Steps.PassportNfcDetailsStep)
        return
      }

      setCurrentStep(Steps.DocumentPreviewStep)
    },
    [faceFlowEnabled, faceVerification.comparison?.passed, selectedDocType, setTempEDoc],
  )

  const handleSetPassportNfcScanOutput = useCallback(
    (value: PassportNfcScanOutput) => {
      setTempEDoc(value.ePassport)

      const hasDetails =
        Boolean(value.packageNfcResult) ||
        Boolean(value.portrait?.base64 || value.portrait?.filePath) ||
        Boolean(
          value.normalized?.firstName ||
            value.normalized?.lastName ||
            value.normalized?.nationality ||
            value.normalized?.nidn ||
            passportMrzBarcode?.barcode?.nidn ||
            value.normalized?.expiryDate ||
            value.normalized?.documentNumber,
        )

      if (hasDetails) {
        setPassportNfcDetails({
          normalized: {
            firstName: value.normalized?.firstName,
            lastName: value.normalized?.lastName,
            nationality: value.normalized?.nationality,
            nidn: value.normalized?.nidn ?? passportMrzBarcode?.barcode?.nidn,
            expiryDate: value.normalized?.expiryDate,
            documentNumber: value.normalized?.documentNumber,
          },
          portrait: value.portrait,
          packageNfcResult: value.packageNfcResult,
        })
      } else {
        setPassportNfcDetails(undefined)
      }

      const shouldRunFaceFlow =
        selectedDocType === DocType.PASSPORT &&
        faceFlowEnabled &&
        value.ePassport instanceof EPassport &&
        !faceVerification.comparison?.passed

      if (shouldRunFaceFlow) {
        setCurrentStep(Steps.PassportNfcDetailsStep)
        return
      }

      setCurrentStep(Steps.DocumentPreviewStep)
    },
    [
      faceFlowEnabled,
      faceVerification.comparison?.passed,
      passportMrzBarcode?.barcode?.nidn,
      selectedDocType,
    ],
  )

  const setFaceLivenessResult = useCallback((value: LivenessResult) => {
    setFaceVerification(previous => ({
      ...previous,
      liveness: value,
    }))
  }, [])

  const setFaceGazeResult = useCallback((value: GazeChallengeResult) => {
    setFaceVerification(previous => ({
      ...previous,
      gaze: value,
    }))
  }, [])

  const setFaceComparisonResult = useCallback((value: FaceComparisonResult) => {
    setFaceVerification(previous => ({
      ...previous,
      comparison: value,
    }))
  }, [])

  const resetFaceVerification = useCallback(() => {
    setFaceVerification({
      enabled: faceFlowEnabled,
    })
  }, [faceFlowEnabled])

  return (
    <documentScanContext.Provider
      value={{
        identity,

        currentStep,
        setCurrentStep,

        creatingIdentityStep,

        docType: selectedDocType,
        setDocType: handleSetSelectedDocType,

        tempMRZ,
        tempEDoc,
        passportNfcDetails,
        faceVerification,
        setTempMrz: handleSetMrz,
        setTempEDoc: handleSetEDoc,
        setPassportNfcDetails,
        passportMrzBarcode,
        setPassportMrzBarcode,
        setPassportNfcScanOutput: handleSetPassportNfcScanOutput,
        setFaceLivenessResult,
        setFaceGazeResult,
        setFaceComparisonResult,
        resetFaceVerification,

        createIdentity,
        revokeIdentity: revokeIdentity,
      }}
      children={children}
    />
  )
}
