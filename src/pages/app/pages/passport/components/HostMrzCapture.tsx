import type { FieldRecords } from 'mrz'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'

import ScanMrzStep from '@/pages/app/pages/document-scan/components/ScanMrzStep'
import {
  ScanContextProvider,
  useDocumentScanContext,
} from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton } from '@/ui'
import { DocType } from '@/utils/e-document'

type HostMrzCaptureProps = {
  onCaptured: (mrzFields: FieldRecords) => void
  onCancel: () => void
}

function MrzCaptureBridge({ onCaptured }: { onCaptured: (mrzFields: FieldRecords) => void }) {
  const { tempMRZ } = useDocumentScanContext()
  const didCaptureRef = useRef(false)

  useEffect(() => {
    if (didCaptureRef.current || !tempMRZ) return
    didCaptureRef.current = true
    onCaptured(tempMRZ)
  }, [onCaptured, tempMRZ])

  return null
}

export function HostMrzCapture({ onCaptured, onCancel }: HostMrzCaptureProps): JSX.Element {
  return (
    <View className='flex-1'>
      <ScanContextProvider docType={DocType.PASSPORT}>
        <ScanMrzStep />
        <MrzCaptureBridge onCaptured={onCaptured} />
      </ScanContextProvider>

      <View className='absolute bottom-0 left-0 right-0 border-t border-backgroundContainer bg-backgroundPrimary px-6 pb-8 pt-4'>
        <UiButton
          title='Cancel MRZ capture'
          variant='outlined'
          onPress={onCancel}
          className='w-full'
        />
      </View>
    </View>
  )
}
