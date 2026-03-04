import type { FieldRecords } from 'mrz'
import type { PropsWithChildren } from 'react'
import { useCallback } from 'react'
import { useState } from 'react'
import { createContext, useContext } from 'react'

import { NoirEIDRegistration } from '@/api/modules/registration/variants/noir-eid'
import { NoirEPassportRegistration } from '@/api/modules/registration/variants/noir-epassport'
import { ErrorHandler } from '@/core'
import { tryCatch } from '@/helpers/try-catch'
import { identityStore } from '@/store/modules/identity'
import { PassportRegisteredWithAnotherPKError } from '@/store/modules/identity/errors'
import { IdentityItem } from '@/store/modules/identity/Identity'
import { walletStore } from '@/store/modules/wallet'
import { DocType, EDocument, EPassport } from '@/utils/e-document/e-document'

export enum Steps {
  SelectDocTypeStep,
  ScanMrzStep,
  ScanPassportNfcStep,
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

  const [tempMRZ, setTempMRZ] = useState<FieldRecords>()
  const [tempEDoc, setTempEDoc] = useState<EDocument>()

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

  const handleSetSelectedDocType = useCallback((value: DocType) => {
    setSelectedDocType(value)
    if (value === DocType.PASSPORT) {
      setCurrentStep(Steps.ScanMrzStep)
    } else {
      setCurrentStep(Steps.ScanNfcStep)
    }
  }, [])

  const handleSetMrz = useCallback((value: FieldRecords) => {
    setTempMRZ(value)
    setCurrentStep(Steps.ScanPassportNfcStep)
  }, [])

  const handleSetEDoc = useCallback(
    (value: EDocument) => {
      setTempEDoc(value)
      setCurrentStep(Steps.DocumentPreviewStep)
    },
    [setTempEDoc],
  )

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
        setTempMrz: handleSetMrz,
        setTempEDoc: handleSetEDoc,

        createIdentity,
        revokeIdentity: revokeIdentity,
      }}
      children={children}
    />
  )
}
