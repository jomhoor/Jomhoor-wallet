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
import {
  classifyIdentityCreationError,
  logIdentityDiagnostic,
  logIdentityDiagnosticError,
} from '@/helpers/identity-proof-diagnostics'
import { tryCatch } from '@/helpers/try-catch'
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

function getEDocumentDiagnosticSnapshot(value?: EDocument): Record<string, unknown> {
  if (!value) {
    return {
      hasEDocument: false,
      eDocumentClass: 'unknown',
    }
  }

  if (value instanceof EPassport) {
    return {
      hasEDocument: true,
      eDocumentClass: 'EPassport',
      docCode: value.docCode,
      hasSodBytes: value.sodBytes.length > 0,
      sodBytesLength: value.sodBytes.length,
      dg1BytesLength: value.dg1Bytes.length,
      dg15BytesLength: value.dg15Bytes?.length ?? 0,
      dg11BytesLength: value.dg11Bytes?.length ?? 0,
      hasAaSignature: Boolean(value.aaSignature?.length),
      hasPersonDetails: Boolean(value.personDetails),
      hasFirstName: Boolean(value.personDetails?.firstName),
      hasLastName: Boolean(value.personDetails?.lastName),
      hasBirthDate: Boolean(value.personDetails?.birthDate),
      hasExpiryDate: Boolean(value.personDetails?.expiryDate),
      hasDocumentNumber: Boolean(value.personDetails?.documentNumber),
      hasNationality: Boolean(value.personDetails?.nationality),
      hasIssuingAuthority: Boolean(value.personDetails?.issuingAuthority),
      hasPassportImageRaw: Boolean(value.personDetails?.passportImageRaw),
      personDetailsKeys: Object.keys(value.personDetails ?? {}),
    }
  }

  return {
    hasEDocument: true,
    eDocumentClass: value.constructor?.name ?? 'EDocument',
    docCode: value.docCode,
    hasPersonDetails: Boolean(value.personDetails),
    personDetailsKeys: Object.keys(value.personDetails ?? {}),
  }
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

  const [tempMRZ, setTempMRZ] = useState<FieldRecords>()
  const [tempEDoc, setTempEDoc] = useState<EDocument>()
  const [passportNfcDetails, setPassportNfcDetails] =
    useState<DocumentScanContext['passportNfcDetails']>()
  const [passportMrzBarcode, setPassportMrzBarcode] =
    useState<DocumentScanContext['passportMrzBarcode']>()
  const [faceVerification, setFaceVerification] = useState<DocumentScanContext['faceVerification']>(
    {
      enabled: true,
    },
  )

  const [identity, setIdentity] = useState<IdentityItem>()

  const revokeIdentity = useCallback(async () => {
    throw new Error('Revoke identity is not implemented for EID')
  }, [])

  const createIdentity = useCallback(async () => {
    const baseContext = {
      selectedDocType: selectedDocType ?? 'unknown',
      hasPrivateKey: Boolean(privateKey),
      privateKeyLength: privateKey?.length ?? 0,
      publicKeyHashLength: publicKeyHash?.length ?? 0,
      faceVerificationEnabled: faceVerification.enabled,
      hasFaceLivenessResult: Boolean(faceVerification.liveness),
      hasFaceGazeResult: Boolean(faceVerification.gaze),
      hasFaceComparisonResult: Boolean(faceVerification.comparison),
      faceComparisonPassed: faceVerification.comparison?.passed ?? null,
      ...getEDocumentDiagnosticSnapshot(tempEDoc),
    }

    logIdentityDiagnostic('IdentityProof', 'createIdentity:start', baseContext)

    if (!tempEDoc) {
      const classification = classifyIdentityCreationError({ stage: 'nfc-missing-edoc' })
      logIdentityDiagnosticError({
        domain: 'IdentityProof',
        event: 'createIdentity:missing-edoc',
        stage: 'nfc-missing-edoc',
        classification,
        error: new Error('EDocument is not set'),
        context: baseContext,
      })
      throw new Error('EDocument is not set')
    }

    if (!privateKey) {
      const classification = classifyIdentityCreationError({ stage: 'wallet-private-key-missing' })
      logIdentityDiagnostic('WalletCredential', 'createIdentity:private-key-missing', {
        classification,
        ...baseContext,
      })
    }

    if (selectedDocType === DocType.PASSPORT && !faceVerification.comparison?.passed) {
      const classification = classifyIdentityCreationError({ stage: 'face-comparison-missing' })
      logIdentityDiagnostic(
        'PassportVerification',
        'createIdentity:face-result-missing-or-unpassed',
        {
          classification,
          hasFaceComparisonResult: Boolean(faceVerification.comparison),
          faceComparisonPassed: faceVerification.comparison?.passed ?? null,
        },
      )
    }

    if (tempEDoc instanceof EPassport) {
      const requiredPassportFields = {
        hasFirstName: Boolean(tempEDoc.personDetails?.firstName),
        hasLastName: Boolean(tempEDoc.personDetails?.lastName),
        hasBirthDate: Boolean(tempEDoc.personDetails?.birthDate),
        hasExpiryDate: Boolean(tempEDoc.personDetails?.expiryDate),
        hasDocumentNumber: Boolean(tempEDoc.personDetails?.documentNumber),
        hasNationality: Boolean(tempEDoc.personDetails?.nationality),
        hasSodBytes: tempEDoc.sodBytes.length > 0,
        hasDg1Bytes: tempEDoc.dg1Bytes.length > 0,
      }
      const missingRequiredFieldKeys = Object.entries(requiredPassportFields)
        .filter(([, present]) => !present)
        .map(([fieldName]) => fieldName)

      if (missingRequiredFieldKeys.length > 0) {
        const classification = classifyIdentityCreationError({ stage: 'passport-field-missing' })
        logIdentityDiagnostic(
          'PassportVerification',
          'createIdentity:passport-required-field-missing',
          {
            classification,
            missingRequiredFieldKeys,
          },
        )
      } else {
        logIdentityDiagnostic(
          'PassportVerification',
          'createIdentity:passport-required-fields-present',
          {
            checkedFieldsCount: Object.keys(requiredPassportFields).length,
          },
        )
      }
    }

    setCurrentStep(Steps.GenerateProofStep)
    logIdentityDiagnostic('IdentityProof', 'createIdentity:step-updated', {
      nextStep: 'GenerateProofStep',
    })

    const strategy = selectedDocType === DocType.PASSPORT ? epassportRegistration : eidRegistration
    logIdentityDiagnostic('IdentityProof', 'createIdentity:strategy-selected', {
      strategy:
        selectedDocType === DocType.PASSPORT ? 'NoirEPassportRegistration' : 'NoirEIDRegistration',
    })

    const [identityItem, registrationError] = await tryCatch(
      strategy.createIdentity(tempEDoc as EPassport, privateKey, publicKeyHash, {
        onDownloading: () => {
          logIdentityDiagnostic('IdentityProof', 'createIdentity:callback-onDownloading')
          setCreatingIdentityStep(GenProofSteps.DownloadCircuit)
        },
        onGenerateProof: () => {
          logIdentityDiagnostic('IdentityProof', 'createIdentity:callback-onGenerateProof')
          setCreatingIdentityStep(GenProofSteps.GenerateProof)
        },
        onRegister: () => {
          logIdentityDiagnostic('IdentityProof', 'createIdentity:callback-onRegister')
          setCreatingIdentityStep(GenProofSteps.CreateProfile)
        },
      }),
    )
    if (registrationError) {
      const classification = classifyIdentityCreationError({
        stage: 'strategy-create-identity',
        error: registrationError,
      })

      logIdentityDiagnosticError({
        domain: 'IdentityProof',
        event: 'createIdentity:strategy-failed',
        stage: 'strategy-create-identity',
        classification,
        error: registrationError,
        context: baseContext,
      })

      ErrorHandler.processWithoutFeedback(registrationError)

      if (registrationError instanceof PassportRegisteredWithAnotherPKError) {
        logIdentityDiagnostic('IdentityProof', 'createIdentity:revocation-step-required', {
          reason: 'PassportRegisteredWithAnotherPKError',
          classification,
        })
        setCurrentStep(Steps.RevocationStep)
        return
      }

      ErrorHandler.process(
        registrationError,
        'Failed to create identity. Please check your NFC connection and try again.',
      )
      setCurrentStep(Steps.DocumentPreviewStep)
      logIdentityDiagnostic('IdentityProof', 'createIdentity:step-updated', {
        nextStep: 'DocumentPreviewStep',
        classification,
      })
      return
    }

    logIdentityDiagnostic('IdentityProof', 'createIdentity:strategy-succeeded', {
      identityType: identityItem.identityType,
      hasRegistrationProof: Boolean(identityItem.registrationProof),
      registrationProofKeys:
        identityItem.registrationProof && typeof identityItem.registrationProof === 'object'
          ? Object.keys(identityItem.registrationProof)
          : [],
    })

    try {
      logIdentityDiagnostic('SecureStorage', 'createIdentity:addIdentity:before', {
        identityType: identityItem.identityType,
      })
      addIdentity(identityItem)
      logIdentityDiagnostic('SecureStorage', 'createIdentity:addIdentity:after', {
        identityType: identityItem.identityType,
      })
    } catch (error) {
      const classification = classifyIdentityCreationError({
        stage: 'secure-storage-add-identity',
        error,
      })
      logIdentityDiagnosticError({
        domain: 'SecureStorage',
        event: 'createIdentity:addIdentity:failed',
        stage: 'secure-storage-add-identity',
        classification,
        error,
        context: {
          identityType: identityItem.identityType,
        },
      })
      throw error
    }

    setIdentity(identityItem)

    setCreatingIdentityStep(GenProofSteps.Final)
    logIdentityDiagnostic('IdentityProof', 'createIdentity:completed', {
      identityType: identityItem.identityType,
      nextStep: 'GenerateProofStep.Final',
    })
  }, [addIdentity, faceVerification, privateKey, publicKeyHash, selectedDocType, tempEDoc])

  // ---------------------------------------------------------------------------------------------

  const handleSetSelectedDocType = useCallback((value: DocType) => {
    logIdentityDiagnostic('PassportVerification', 'setDocType', {
      selectedDocType: value,
    })
    setSelectedDocType(value)
    setPassportNfcDetails(undefined)
    setPassportMrzBarcode(undefined)
    setFaceVerification({
      enabled: true,
    })
    if (value === DocType.PASSPORT) {
      setCurrentStep(Steps.ScanMrzStep)
    } else {
      setCurrentStep(Steps.ScanNfcStep)
    }
  }, [])

  const handleSetMrz = useCallback((value: FieldRecords) => {
    logIdentityDiagnostic('PassportVerification', 'setTempMrz', {
      hasDocumentCode: Boolean(value.documentCode),
      hasDocumentNumber: Boolean(value.documentNumber),
      hasBirthDate: Boolean(value.birthDate),
      hasExpirationDate: Boolean(value.expirationDate),
    })
    setTempMRZ(value)
    setPassportNfcDetails(undefined)
    setFaceVerification({
      enabled: true,
    })
    setCurrentStep(Steps.ScanPassportNfcStep)
  }, [])

  const handleSetEDoc = useCallback(
    (value: EDocument) => {
      logIdentityDiagnostic('PassportVerification', 'setTempEDoc', {
        ...getEDocumentDiagnosticSnapshot(value),
      })
      setTempEDoc(value)
      setPassportNfcDetails(undefined)
      const shouldRunFaceFlow =
        selectedDocType === DocType.PASSPORT &&
        value instanceof EPassport &&
        !faceVerification.comparison?.passed

      if (shouldRunFaceFlow) {
        logIdentityDiagnostic('PassportVerification', 'setTempEDoc:next-step', {
          nextStep: 'PassportNfcDetailsStep',
          reason: 'face-verification-required',
        })
        setCurrentStep(Steps.PassportNfcDetailsStep)
        return
      }

      logIdentityDiagnostic('PassportVerification', 'setTempEDoc:next-step', {
        nextStep: 'DocumentPreviewStep',
        reason: 'face-verification-complete-or-not-required',
      })
      setCurrentStep(Steps.DocumentPreviewStep)
    },
    [faceVerification.comparison?.passed, selectedDocType, setTempEDoc],
  )

  const handleSetPassportNfcScanOutput = useCallback(
    (value: PassportNfcScanOutput) => {
      const nfcFileStatuses = value.packageNfcResult
        ? Object.entries(value.packageNfcResult.files).reduce<Record<string, string>>(
            (acc, entry) => {
              const [dataGroup, result] = entry
              acc[dataGroup] = result.status
              return acc
            },
            {},
          )
        : {}
      const normalizedPresence = {
        hasFirstName: Boolean(value.normalized?.firstName),
        hasLastName: Boolean(value.normalized?.lastName),
        hasNationality: Boolean(value.normalized?.nationality),
        hasExpiryDate: Boolean(value.normalized?.expiryDate),
        hasDocumentNumber: Boolean(value.normalized?.documentNumber),
        hasBirthDate: Boolean(value.normalized?.birthDate),
      }

      logIdentityDiagnostic('NfcResult', 'setPassportNfcScanOutput:received', {
        hasPackageNfcResult: Boolean(value.packageNfcResult),
        backend: value.packageNfcResult?.backend ?? 'unknown',
        finalStatus: value.packageNfcResult?.finalStatus ?? 'unknown',
        dataGroups: value.packageNfcResult ? Object.keys(value.packageNfcResult.files) : [],
        dataGroupStatuses: nfcFileStatuses,
        hasPortraitBase64: Boolean(value.portrait?.base64),
        hasPortraitFilePath: Boolean(value.portrait?.filePath),
        ...normalizedPresence,
        ...getEDocumentDiagnosticSnapshot(value.ePassport),
      })

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

      const missingCriticalDataGroups =
        value.packageNfcResult &&
        ['DG1', 'SOD'].filter(
          dataGroup => value.packageNfcResult?.files[dataGroup]?.status !== 'ok',
        )
      if (missingCriticalDataGroups && missingCriticalDataGroups.length > 0) {
        const classification = classifyIdentityCreationError({
          stage: 'nfc-missing-critical-datagroup',
        })
        logIdentityDiagnostic('NfcResult', 'setPassportNfcScanOutput:critical-datagroup-missing', {
          classification,
          missingCriticalDataGroups,
        })
      }

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
        logIdentityDiagnostic('PassportVerification', 'setPassportNfcDetails', {
          hasDetails: true,
          hasPortraitBase64: Boolean(value.portrait?.base64),
          hasPortraitFilePath: Boolean(value.portrait?.filePath),
          normalizedKeys: Object.keys(value.normalized ?? {}),
        })
      } else {
        setPassportNfcDetails(undefined)
        logIdentityDiagnostic('PassportVerification', 'setPassportNfcDetails', {
          hasDetails: false,
          normalizedKeys: [],
        })
      }

      const shouldRunFaceFlow =
        selectedDocType === DocType.PASSPORT &&
        value.ePassport instanceof EPassport &&
        !faceVerification.comparison?.passed

      if (shouldRunFaceFlow) {
        logIdentityDiagnostic('PassportVerification', 'setPassportNfcScanOutput:next-step', {
          nextStep: 'PassportNfcDetailsStep',
          reason: 'face-verification-required',
        })
        setCurrentStep(Steps.PassportNfcDetailsStep)
        return
      }

      logIdentityDiagnostic('PassportVerification', 'setPassportNfcScanOutput:next-step', {
        nextStep: 'DocumentPreviewStep',
        reason: 'face-verification-complete-or-not-required',
      })
      setCurrentStep(Steps.DocumentPreviewStep)
    },
    [faceVerification.comparison?.passed, passportMrzBarcode?.barcode?.nidn, selectedDocType],
  )

  const setFaceLivenessResult = useCallback((value: LivenessResult) => {
    logIdentityDiagnostic('PassportVerification', 'setFaceLivenessResult', {
      passed: value.passed,
      challengeCount: value.challenges.length,
      hasStartedAt: typeof value.startedAt === 'number',
      hasCompletedAt: typeof value.completedAt === 'number',
    })
    setFaceVerification(previous => ({
      ...previous,
      liveness: value,
    }))
  }, [])

  const setFaceGazeResult = useCallback((value: GazeChallengeResult) => {
    logIdentityDiagnostic('PassportVerification', 'setFaceGazeResult', {
      passed: value.passed,
      score: value.score,
      targetsCompleted: value.targetsCompleted ?? 0,
      targetsTotal: value.targetsTotal ?? 0,
    })
    setFaceVerification(previous => ({
      ...previous,
      gaze: value,
    }))
  }, [])

  const setFaceComparisonResult = useCallback((value: FaceComparisonResult) => {
    logIdentityDiagnostic('PassportVerification', 'setFaceComparisonResult', {
      passed: value.passed,
      similarity: value.similarity,
      threshold: value.threshold,
    })
    setFaceVerification(previous => ({
      ...previous,
      comparison: value,
    }))
  }, [])

  const resetFaceVerification = useCallback(() => {
    setFaceVerification({
      enabled: true,
    })
  }, [])

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
