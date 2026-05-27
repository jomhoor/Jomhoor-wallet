import {
  NidVerificationFlow,
  type NidVerificationResult,
  toNidProofInputAdapterData,
} from '@iland/nid-verification'
import { useNavigation } from '@react-navigation/core'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ErrorHandler } from '@/core'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'

export default function ScanNfcStep() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()

  const { setNidVerificationResult, runMockNidProofGeneration } = useDocumentScanContext()

  const handleComplete = async (result: NidVerificationResult) => {
    setNidVerificationResult(result)
    if (!result.verified) {
      ErrorHandler.process(
        new Error('NID verification did not pass'),
        'NID verification did not pass validation checks.',
      )
      return
    }
    const adapterData = toNidProofInputAdapterData(result)
    await runMockNidProofGeneration(adapterData)
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
        onComplete={result => {
          void handleComplete(result)
        }}
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
