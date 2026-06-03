import type { NidProofInputAdapterData, NidVerificationResult } from '@iland/nid-verification'
import type {
  FaceComparisonResult,
  GazeChallengeResult,
  LivenessResult,
  ParsedMrz,
  PassportCredentials,
  PassportNfcReadResult,
} from '@iland/passport-verification'
import type { FieldRecords } from 'mrz'
import type { Dispatch, PropsWithChildren, SetStateAction } from 'react'
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
import { DocType, EDocument, EID, EPassport } from '@/utils/e-document/e-document'
import type { PassportNfcScanOutput } from '@/utils/e-document/passport-nfc-reader'

export enum Steps {
  SelectDocTypeStep,
  SelectPassportCountryStep,
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

  verificationUserData: VerificationUserData
  setVerificationUserData: Dispatch<SetStateAction<VerificationUserData>>

  creatingIdentityStep: GenProofSteps
  nidVerificationResult?: NidVerificationResult
  setNidVerificationResult: (value?: NidVerificationResult) => void
  nidProofInputAdapter?: NidProofInputAdapterData
  setNidProofInputAdapter: (value?: NidProofInputAdapterData) => void
  runMockNidProofGeneration: (value: NidProofInputAdapterData) => Promise<void>

  docType?: DocType
  setDocType: (docType: DocType) => void
  passportCountryCode?: string
  setPassportCountryCode: (value?: string) => void

  tempMRZ?: FieldRecords
  setTempMrz: (value?: FieldRecords) => void
  tempEDoc?: EDocument
  setTempEDoc: (value?: EDocument) => void
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
  secureCleanupSensitiveData: () => void

  circuitLoadingDetails?: {
    isLoaded: boolean
    isLoadFailed: boolean
    downloadingProgress: string
  }
}

type PassportNfcDetails = DocumentScanContext['passportNfcDetails']

export type VerificationSessionStatus =
  | 'collecting'
  | 'ready-for-proof'
  | 'proofing'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type VerificationEvidenceSource =
  | 'camera'
  | 'barcode'
  | 'nfc'
  | 'manual'
  | 'derived'
  | 'proof'

export type VerificationEvidenceRecord = {
  step: string
  source: VerificationEvidenceSource
  storedAt: number
  keys: string[]
}

export type VerificationUserData = {
  session: {
    id: string
    startedAt: number
    docType?: DocType
    selectedPassportCountry?: string
    status: VerificationSessionStatus
  }
  document: {
    passport: {
      mrz?: {
        fields?: FieldRecords
        credentials?: PassportCredentials
        rawBarcode?: string
        parsedBarcode?: {
          raw?: string
          nidn?: string
          fields?: Record<string, unknown>
        }
      }
      nfc?: {
        normalized?: PassportNfcScanOutput['normalized']
        files?: PassportNfcReadResult['files']
        packageNfcResult?: PassportNfcReadResult
        portrait?: {
          base64?: string
          filePath?: string
        }
        ePassport?: EPassport
        backend?: PassportNfcReadResult['backend']
        finalStatus?: PassportNfcReadResult['finalStatus']
        nativeSessionId?: string
      }
    }
    nid: {
      front?: {
        imageUri?: string
        capturedAt?: number
      }
      back?: {
        barcodeRaw?: string
        barcode?: NidVerificationResult['back']['barcode']
        nationalId?: string
      }
      nfc?: NidVerificationResult['nfc'] & {
        nativeSessionId?: string
      }
      eID?: EID
      verification?: NidVerificationResult
      proofInput?: NidProofInputAdapterData
    }
  }
  biometrics: {
    liveness?: LivenessResult
    gaze?: GazeChallengeResult
    comparison?: FaceComparisonResult
    images?: {
      referenceUri?: string
      liveCaptureUri?: string
      referenceCropUri?: string
      liveCropUri?: string
    }
  }
  proof: {
    creatingIdentityStep?: GenProofSteps
    identity?: IdentityItem
    error?: {
      code?: string
      message: string
    }
  }
  evidence: VerificationEvidenceRecord[]
}

const documentScanContext = createContext<DocumentScanContext>({
  currentStep: Steps.SelectDocTypeStep,

  setCurrentStep: () => {
    throw new Error('setCurrentStep not implemented')
  },

  verificationUserData: createInitialVerificationUserData(),
  setVerificationUserData: () => {
    throw new Error('setVerificationUserData not implemented')
  },

  creatingIdentityStep: GenProofSteps.DownloadCircuit,
  nidVerificationResult: undefined,
  setNidVerificationResult: () => {
    throw new Error('setNidVerificationResult not implemented')
  },
  nidProofInputAdapter: undefined,
  setNidProofInputAdapter: () => {
    throw new Error('setNidProofInputAdapter not implemented')
  },
  runMockNidProofGeneration: async () => {
    throw new Error('runMockNidProofGeneration not implemented')
  },

  docType: undefined,
  setDocType: () => {
    throw new Error('setDocType not implemented')
  },
  passportCountryCode: undefined,
  setPassportCountryCode: () => {
    throw new Error('setPassportCountryCode not implemented')
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
  secureCleanupSensitiveData: () => {
    throw new Error('secureCleanupSensitiveData not implemented')
  },
})

export function useDocumentScanContext() {
  return useContext(documentScanContext)
}

const eidRegistration = new NoirEIDRegistration()
const epassportRegistration = new NoirEPassportRegistration()
const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })

function createVerificationSessionId(): string {
  return `verification-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createInitialVerificationUserData(docType?: DocType): VerificationUserData {
  return {
    session: {
      id: createVerificationSessionId(),
      startedAt: Date.now(),
      docType,
      status: 'collecting',
    },
    document: {
      passport: {},
      nid: {},
    },
    biometrics: {},
    proof: {},
    evidence: [],
  }
}

function withVerificationEvidence(
  value: VerificationUserData,
  evidence: Omit<VerificationEvidenceRecord, 'storedAt'>,
): VerificationUserData {
  return {
    ...value,
    evidence: [
      ...value.evidence,
      {
        ...evidence,
        storedAt: Date.now(),
      },
    ],
  }
}

function getInitialStep(docType?: DocType): Steps {
  if (docType === DocType.PASSPORT) return Steps.SelectPassportCountryStep
  if (docType === DocType.ID) return Steps.ScanNfcStep
  return Steps.SelectDocTypeStep
}

function createSecurelyCleanedVerificationUserData(): VerificationUserData {
  return {
    session: {
      id: '',
      startedAt: 0,
      docType: undefined,
      selectedPassportCountry: undefined,
      status: 'completed',
    },
    document: {
      passport: {
        mrz: undefined,
        nfc: {
          normalized: undefined,
          files: undefined,
          packageNfcResult: undefined,
          portrait: {
            base64: '',
            filePath: '',
          },
          ePassport: undefined,
          backend: undefined,
          finalStatus: undefined,
          nativeSessionId: '',
        },
      },
      nid: {
        front: {
          imageUri: '',
          capturedAt: 0,
        },
        back: {
          barcodeRaw: '',
          barcode: undefined,
          nationalId: '',
        },
        nfc: {
          nativeSessionId: '',
        },
        eID: undefined,
        verification: undefined,
        proofInput: undefined,
      },
    },
    biometrics: {
      liveness: undefined,
      gaze: undefined,
      comparison: undefined,
      images: {
        referenceUri: '',
        liveCaptureUri: '',
        referenceCropUri: '',
        liveCropUri: '',
      },
    },
    proof: {
      creatingIdentityStep: undefined,
      identity: undefined,
      error: undefined,
    },
    evidence: [],
  }
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
  const [verificationUserData, setVerificationUserData] = useState<VerificationUserData>(() =>
    createInitialVerificationUserData(docType),
  )

  const [selectedDocType, setSelectedDocType] = useState(docType)
  const [passportCountryCode, setPassportCountryCode] = useState<string>()

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
  const [nidVerificationResult, setNidVerificationResult] =
    useState<DocumentScanContext['nidVerificationResult']>()
  const [nidProofInputAdapter, setNidProofInputAdapter] =
    useState<DocumentScanContext['nidProofInputAdapter']>()

  const [identity, setIdentity] = useState<IdentityItem>()

  const secureCleanupSensitiveData = useCallback(() => {
    logIdentityDiagnostic('SecurityCleanup', 'secureCleanupSensitiveData:start', {
      timestamp: Date.now(),
    })

    setVerificationUserData(createSecurelyCleanedVerificationUserData())
    setTempMRZ(undefined)
    setTempEDoc(undefined)
    setPassportNfcDetails(undefined)
    setPassportMrzBarcode(undefined)
    setNidVerificationResult(undefined)
    setNidProofInputAdapter(undefined)
    setFaceVerification({ enabled: false })
    setIdentity(undefined)

    logIdentityDiagnostic('SecurityCleanup', 'secureCleanupSensitiveData:completed', {
      timestamp: Date.now(),
    })
  }, [])

  useEffect(() => {
    return () => {
      logIdentityDiagnostic('SecurityCleanup', 'ScanContextProvider:unmount', {
        timestamp: Date.now(),
      })
      secureCleanupSensitiveData()
    }
  }, [secureCleanupSensitiveData])

  const revokeIdentity = useCallback(async () => {
    throw new Error('Revoke identity is not implemented for EID')
  }, [])

  const createIdentity = useCallback(async () => {
    const proofEDoc =
      selectedDocType === DocType.ID
        ? (tempEDoc ?? verificationUserData.document.nid.eID)
        : (tempEDoc ?? verificationUserData.document.passport.nfc?.ePassport)
    const proofFaceVerification = {
      enabled: faceVerification.enabled,
      liveness: faceVerification.liveness ?? verificationUserData.biometrics.liveness,
      gaze: faceVerification.gaze ?? verificationUserData.biometrics.gaze,
      comparison: faceVerification.comparison ?? verificationUserData.biometrics.comparison,
    }

    const baseContext = {
      selectedDocType: selectedDocType ?? 'unknown',
      hasPrivateKey: Boolean(privateKey),
      privateKeyLength: privateKey?.length ?? 0,
      publicKeyHashLength: publicKeyHash?.length ?? 0,
      faceVerificationEnabled: proofFaceVerification.enabled,
      hasFaceLivenessResult: Boolean(proofFaceVerification.liveness),
      hasFaceGazeResult: Boolean(proofFaceVerification.gaze),
      hasFaceComparisonResult: Boolean(proofFaceVerification.comparison),
      faceComparisonPassed: proofFaceVerification.comparison?.passed ?? null,
      ...getEDocumentDiagnosticSnapshot(proofEDoc),
    }

    logIdentityDiagnostic('IdentityProof', 'createIdentity:start', baseContext)

    if (!proofEDoc) {
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

    if (selectedDocType === DocType.PASSPORT && !proofFaceVerification.comparison?.passed) {
      const classification = classifyIdentityCreationError({ stage: 'face-comparison-missing' })
      logIdentityDiagnostic(
        'PassportVerification',
        'createIdentity:face-result-missing-or-unpassed',
        {
          classification,
          hasFaceComparisonResult: Boolean(proofFaceVerification.comparison),
          faceComparisonPassed: proofFaceVerification.comparison?.passed ?? null,
        },
      )
    }

    if (proofEDoc instanceof EPassport) {
      const requiredPassportFields = {
        hasFirstName: Boolean(proofEDoc.personDetails?.firstName),
        hasLastName: Boolean(proofEDoc.personDetails?.lastName),
        hasBirthDate: Boolean(proofEDoc.personDetails?.birthDate),
        hasExpiryDate: Boolean(proofEDoc.personDetails?.expiryDate),
        hasDocumentNumber: Boolean(proofEDoc.personDetails?.documentNumber),
        hasNationality: Boolean(proofEDoc.personDetails?.nationality),
        hasSodBytes: proofEDoc.sodBytes.length > 0,
        hasDg1Bytes: proofEDoc.dg1Bytes.length > 0,
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
      strategy.createIdentity(proofEDoc as EPassport, privateKey, publicKeyHash, {
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
    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          proof: {
            ...previous.proof,
            creatingIdentityStep: GenProofSteps.Final,
            identity: identityItem,
          },
          session: {
            ...previous.session,
            status: 'completed',
          },
        },
        {
          keys: ['proof.identity', 'proof.creatingIdentityStep', 'session.status'],
          source: 'proof',
          step: 'create-identity',
        },
      ),
    )

    setCreatingIdentityStep(GenProofSteps.Final)
    logIdentityDiagnostic('IdentityProof', 'createIdentity:completed', {
      identityType: identityItem.identityType,
      nextStep: 'GenerateProofStep.Final',
    })
  }, [
    addIdentity,
    faceVerification,
    privateKey,
    publicKeyHash,
    selectedDocType,
    tempEDoc,
    verificationUserData,
  ])

  // ---------------------------------------------------------------------------------------------

  const handleSetSelectedDocType = useCallback((value: DocType) => {
    logIdentityDiagnostic('PassportVerification', 'setDocType', {
      selectedDocType: value,
    })
    setSelectedDocType(value)
    setVerificationUserData(
      withVerificationEvidence(createInitialVerificationUserData(value), {
        keys: ['session.docType'],
        source: 'manual',
        step: 'select-document-type',
      }),
    )
    setPassportCountryCode(undefined)
    setTempEDoc(undefined)
    setTempMRZ(undefined)
    setPassportNfcDetails(undefined)
    setPassportMrzBarcode(undefined)
    setNidVerificationResult(undefined)
    setNidProofInputAdapter(undefined)
    setFaceVerification({
      enabled: true,
    })
    if (value === DocType.PASSPORT) {
      setCurrentStep(Steps.SelectPassportCountryStep)
    } else {
      setCurrentStep(Steps.ScanNfcStep)
    }
  }, [])

  const handleSetPassportCountryCode = useCallback((value?: string) => {
    setPassportCountryCode(value)
    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          session: {
            ...previous.session,
            selectedPassportCountry: value,
          },
        },
        {
          keys: ['session.selectedPassportCountry'],
          source: 'manual',
          step: 'select-passport-country',
        },
      ),
    )
  }, [])

  const handleSetMrz = useCallback((value?: FieldRecords) => {
    if (!value) {
      setTempMRZ(undefined)
      return
    }

    logIdentityDiagnostic('PassportVerification', 'setTempMrz', {
      hasDocumentCode: Boolean(value.documentCode),
      hasDocumentNumber: Boolean(value.documentNumber),
      hasBirthDate: Boolean(value.birthDate),
      hasExpirationDate: Boolean(value.expirationDate),
    })
    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          document: {
            ...previous.document,
            passport: {
              ...previous.document.passport,
              mrz: {
                ...previous.document.passport.mrz,
                fields: value,
              },
            },
          },
        },
        {
          keys: ['document.passport.mrz.fields'],
          source: 'camera',
          step: 'passport-mrz-scan',
        },
      ),
    )
    setTempMRZ(undefined)
    setPassportNfcDetails(undefined)
    setNidVerificationResult(undefined)
    setNidProofInputAdapter(undefined)
    setFaceVerification({
      enabled: true,
    })
    setCurrentStep(Steps.ScanPassportNfcStep)
  }, [])

  const handleSetEDoc = useCallback(
    (value?: EDocument) => {
      if (!value) {
        setTempEDoc(undefined)
        return
      }

      logIdentityDiagnostic('PassportVerification', 'setTempEDoc', {
        ...getEDocumentDiagnosticSnapshot(value),
      })
      setVerificationUserData(previous =>
        withVerificationEvidence(
          {
            ...previous,
            document: {
              ...previous.document,
              passport: {
                ...previous.document.passport,
                nfc: {
                  ...previous.document.passport.nfc,
                  ...(value instanceof EPassport ? { ePassport: value } : {}),
                },
              },
              nid: {
                ...previous.document.nid,
                ...(value instanceof EID ? { eID: value } : {}),
              },
            },
          },
          {
            keys: value instanceof EID ? ['document.nid.eID'] : ['document.passport.nfc.ePassport'],
            source: 'nfc',
            step: value instanceof EID ? 'nid-eid-document-ready' : 'passport-nfc-read',
          },
        ),
      )
      setTempEDoc(undefined)
      setPassportNfcDetails(undefined)
      setNidVerificationResult(undefined)
      setNidProofInputAdapter(undefined)
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
    [faceVerification.comparison?.passed, selectedDocType],
  )

  const handleSetPassportNfcDetails = useCallback((value?: PassportNfcDetails) => {
    if (!value) {
      setPassportNfcDetails(undefined)
      return
    }

    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          document: {
            ...previous.document,
            passport: {
              ...previous.document.passport,
              nfc: {
                ...previous.document.passport.nfc,
                normalized: value.normalized,
                packageNfcResult: value.packageNfcResult,
                portrait: value.portrait,
              },
            },
          },
        },
        {
          keys: [
            'document.passport.nfc.normalized',
            'document.passport.nfc.packageNfcResult',
            'document.passport.nfc.portrait',
          ],
          source: 'nfc',
          step: 'passport-nfc-details',
        },
      ),
    )
    setPassportNfcDetails(undefined)
  }, [])

  const handleSetPassportMrzBarcode = useCallback(
    (value?: DocumentScanContext['passportMrzBarcode']) => {
      if (!value) {
        setPassportMrzBarcode(undefined)
        return
      }

      setVerificationUserData(previous =>
        withVerificationEvidence(
          {
            ...previous,
            document: {
              ...previous.document,
              passport: {
                ...previous.document.passport,
                mrz: {
                  ...previous.document.passport.mrz,
                  credentials: value.credentials,
                  parsedBarcode: value.barcode,
                  rawBarcode: value.barcode?.raw,
                },
              },
            },
          },
          {
            keys: [
              'document.passport.mrz.credentials',
              'document.passport.mrz.parsedBarcode',
              'document.passport.mrz.rawBarcode',
            ],
            source: 'barcode',
            step: 'passport-mrz-barcode-scan',
          },
        ),
      )
      setPassportMrzBarcode(undefined)
    },
    [],
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

      const passportBarcodeNidn = verificationUserData.document.passport.mrz?.parsedBarcode?.nidn

      setVerificationUserData(previous =>
        withVerificationEvidence(
          {
            ...previous,
            document: {
              ...previous.document,
              passport: {
                ...previous.document.passport,
                nfc: {
                  ...previous.document.passport.nfc,
                  backend: value.packageNfcResult?.backend,
                  ePassport: value.ePassport,
                  files: value.packageNfcResult?.files,
                  finalStatus: value.packageNfcResult?.finalStatus,
                  normalized: {
                    ...value.normalized,
                    nidn: value.normalized?.nidn ?? passportBarcodeNidn,
                  },
                  packageNfcResult: value.packageNfcResult,
                  portrait: value.portrait,
                },
              },
            },
          },
          {
            keys: [
              'document.passport.nfc.backend',
              'document.passport.nfc.ePassport',
              'document.passport.nfc.files',
              'document.passport.nfc.finalStatus',
              'document.passport.nfc.normalized',
              'document.passport.nfc.packageNfcResult',
              'document.passport.nfc.portrait',
            ],
            source: 'nfc',
            step: 'passport-nfc-read',
          },
        ),
      )
      setTempEDoc(undefined)

      const hasDetails =
        Boolean(value.packageNfcResult) ||
        Boolean(value.portrait?.base64 || value.portrait?.filePath) ||
        Boolean(
          value.normalized?.firstName ||
            value.normalized?.lastName ||
            value.normalized?.nationality ||
            value.normalized?.nidn ||
            passportBarcodeNidn ||
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
        const nextPassportNfcDetails = {
          normalized: {
            firstName: value.normalized?.firstName,
            lastName: value.normalized?.lastName,
            nationality: value.normalized?.nationality,
            nidn: value.normalized?.nidn ?? passportBarcodeNidn,
            expiryDate: value.normalized?.expiryDate,
            documentNumber: value.normalized?.documentNumber,
          },
          portrait: value.portrait,
          packageNfcResult: value.packageNfcResult,
        }
        handleSetPassportNfcDetails(nextPassportNfcDetails)
        logIdentityDiagnostic('PassportVerification', 'setPassportNfcDetails', {
          hasDetails: true,
          hasPortraitBase64: Boolean(value.portrait?.base64),
          hasPortraitFilePath: Boolean(value.portrait?.filePath),
          normalizedKeys: Object.keys(value.normalized ?? {}),
        })
      } else {
        handleSetPassportNfcDetails(undefined)
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
    [
      faceVerification.comparison?.passed,
      handleSetPassportNfcDetails,
      selectedDocType,
      verificationUserData.document.passport.mrz?.parsedBarcode?.nidn,
    ],
  )

  const setFaceLivenessResult = useCallback((value: LivenessResult) => {
    logIdentityDiagnostic('PassportVerification', 'setFaceLivenessResult', {
      passed: value.passed,
      challengeCount: value.challenges.length,
      hasStartedAt: typeof value.startedAt === 'number',
      hasCompletedAt: typeof value.completedAt === 'number',
    })
    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          biometrics: {
            ...previous.biometrics,
            liveness: value,
          },
        },
        {
          keys: ['biometrics.liveness'],
          source: 'camera',
          step: 'face-liveness',
        },
      ),
    )
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
    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          biometrics: {
            ...previous.biometrics,
            gaze: value,
          },
        },
        {
          keys: ['biometrics.gaze'],
          source: 'camera',
          step: 'face-gaze',
        },
      ),
    )
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
    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          biometrics: {
            ...previous.biometrics,
            comparison: value,
          },
        },
        {
          keys: ['biometrics.comparison'],
          source: 'camera',
          step: 'face-comparison',
        },
      ),
    )
    setFaceVerification(previous => ({
      ...previous,
      comparison: value,
    }))
  }, [])

  const resetFaceVerification = useCallback(() => {
    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          biometrics: {},
        },
        {
          keys: ['biometrics'],
          source: 'derived',
          step: 'face-reset',
        },
      ),
    )
    setFaceVerification({
      enabled: true,
    })
  }, [])

  const handleSetNidVerificationResult = useCallback((value?: NidVerificationResult) => {
    if (!value) {
      setNidVerificationResult(undefined)
      setVerificationUserData(previous => ({
        ...previous,
        document: {
          ...previous.document,
          nid: {
            ...previous.document.nid,
            verification: undefined,
          },
        },
      }))
      return
    }

    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          document: {
            ...previous.document,
            nid: {
              ...previous.document.nid,
              back: {
                barcode: value.back.barcode,
                barcodeRaw: value.back.barcodeRaw,
                nationalId: value.back.nationalId?.value,
              },
              front: {
                capturedAt: Date.now(),
                imageUri: value.front.frontImageUri,
              },
              nfc: value.nfc,
              verification: value,
            },
          },
          session: {
            ...previous.session,
            status: value.verified ? 'ready-for-proof' : 'failed',
          },
        },
        {
          keys: [
            'document.nid.front',
            'document.nid.back',
            'document.nid.nfc',
            'document.nid.verification',
            'session.status',
          ],
          source: 'derived',
          step: 'nid-verification-result',
        },
      ),
    )
    setNidVerificationResult(undefined)
  }, [])

  const handleSetNidProofInputAdapter = useCallback((value?: NidProofInputAdapterData) => {
    if (!value) {
      setNidProofInputAdapter(undefined)
      setVerificationUserData(previous => ({
        ...previous,
        document: {
          ...previous.document,
          nid: {
            ...previous.document.nid,
            proofInput: undefined,
          },
        },
      }))
      return
    }

    setVerificationUserData(previous =>
      withVerificationEvidence(
        {
          ...previous,
          document: {
            ...previous.document,
            nid: {
              ...previous.document.nid,
              proofInput: value,
            },
          },
          proof: {
            ...previous.proof,
            creatingIdentityStep: GenProofSteps.DownloadCircuit,
          },
          session: {
            ...previous.session,
            status: 'proofing',
          },
        },
        {
          keys: ['document.nid.proofInput', 'proof.creatingIdentityStep', 'session.status'],
          source: 'proof',
          step: 'nid-proof-input-adapter',
        },
      ),
    )
    setNidProofInputAdapter(undefined)
  }, [])

  const runMockNidProofGeneration = useCallback(
    async (value: NidProofInputAdapterData) => {
      handleSetNidProofInputAdapter(value)
      setCurrentStep(Steps.GenerateProofStep)
      setCreatingIdentityStep(GenProofSteps.DownloadCircuit)
      setVerificationUserData(previous => ({
        ...previous,
        proof: {
          ...previous.proof,
          creatingIdentityStep: GenProofSteps.DownloadCircuit,
        },
      }))

      await sleep(800)
      setCreatingIdentityStep(GenProofSteps.GenerateProof)
      setVerificationUserData(previous => ({
        ...previous,
        proof: {
          ...previous.proof,
          creatingIdentityStep: GenProofSteps.GenerateProof,
        },
      }))

      await sleep(900)
      setCreatingIdentityStep(GenProofSteps.CreateProfile)
      setVerificationUserData(previous => ({
        ...previous,
        proof: {
          ...previous.proof,
          creatingIdentityStep: GenProofSteps.CreateProfile,
        },
      }))

      await sleep(900)
      setCreatingIdentityStep(GenProofSteps.Final)
      setVerificationUserData(previous =>
        withVerificationEvidence(
          {
            ...previous,
            proof: {
              ...previous.proof,
              creatingIdentityStep: GenProofSteps.Final,
            },
            session: {
              ...previous.session,
              status: 'completed',
            },
          },
          {
            keys: ['proof.creatingIdentityStep', 'session.status'],
            source: 'proof',
            step: 'nid-mock-proof-generation',
          },
        ),
      )
    },
    [handleSetNidProofInputAdapter, setCurrentStep],
  )

  return (
    <documentScanContext.Provider
      value={{
        identity,

        currentStep,
        setCurrentStep,

        verificationUserData,
        setVerificationUserData,

        creatingIdentityStep,
        nidVerificationResult,
        setNidVerificationResult: handleSetNidVerificationResult,
        nidProofInputAdapter,
        setNidProofInputAdapter: handleSetNidProofInputAdapter,
        runMockNidProofGeneration,

        docType: selectedDocType,
        setDocType: handleSetSelectedDocType,
        passportCountryCode,
        setPassportCountryCode: handleSetPassportCountryCode,

        tempMRZ,
        tempEDoc,
        passportNfcDetails,
        faceVerification,
        setTempMrz: handleSetMrz,
        setTempEDoc: handleSetEDoc,
        setPassportNfcDetails: handleSetPassportNfcDetails,
        passportMrzBarcode,
        setPassportMrzBarcode: handleSetPassportMrzBarcode,
        setPassportNfcScanOutput: handleSetPassportNfcScanOutput,
        setFaceLivenessResult,
        setFaceGazeResult,
        setFaceComparisonResult,
        resetFaceVerification,

        createIdentity,
        revokeIdentity: revokeIdentity,
        secureCleanupSensitiveData,
      }}
      children={children}
    />
  )
}
