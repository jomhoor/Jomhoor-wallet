import {
  ScanContextProvider,
  Steps,
  useDocumentScanContext,
} from '@/pages/app/pages/document-scan/ScanProvider'

import {
  DocumentPreviewStep,
  FaceComparisonStep,
  FaceLivenessStep,
  GazeChallengeStep,
  GenerateProofStep,
  PassportNfcDetailsStep,
  RevocationStep,
  ScanMrzStep,
  ScanNfcStep,
  ScanPassportNfcStep,
  SelectDocTypeStep,
} from './components'

export default function DocumentScanScreen() {
  return (
    <ScanContextProvider>
      <DocumentScanContent />
    </ScanContextProvider>
  )
}

function DocumentScanContent() {
  const { currentStep } = useDocumentScanContext()

  return (
    <>
      {{
        [Steps.SelectDocTypeStep]: () => <SelectDocTypeStep />,
        [Steps.ScanMrzStep]: () => <ScanMrzStep />,
        [Steps.ScanPassportNfcStep]: () => <ScanPassportNfcStep />,
        [Steps.PassportNfcDetailsStep]: () => <PassportNfcDetailsStep />,
        [Steps.FaceLivenessStep]: () => <FaceLivenessStep />,
        [Steps.FaceGazeStep]: () => <GazeChallengeStep />,
        [Steps.FaceComparisonStep]: () => <FaceComparisonStep />,
        [Steps.ScanNfcStep]: () => <ScanNfcStep />,
        [Steps.DocumentPreviewStep]: () => <DocumentPreviewStep />,
        [Steps.GenerateProofStep]: () => <GenerateProofStep />,
        [Steps.RevocationStep]: () => <RevocationStep />, //TODO
      }[currentStep]()}
    </>
  )
}
