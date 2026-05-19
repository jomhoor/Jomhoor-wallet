import type {
  PassportCredentials,
  PassportIdentityVerificationResult,
  PassportVerificationNativeStatus,
} from '@iland/passport-verification'
import {
  getPassportVerificationNativeStatus,
  PassportIdentityFlow,
} from '@iland/passport-verification'
import { useNavigation } from '@react-navigation/native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import type { AppStackScreenProps } from '@/route-types'
import { UiButton } from '@/ui'

import {
  JomhoorMrzAdapterError,
  jomhoorMrzToPassportCredentials,
} from './adapters/jomhoorMrzToPassportCredentials'
import { HostMrzCapture } from './components/HostMrzCapture'
import { jomhoorVerificationUiAdapter } from './jomhoorVerificationUiAdapter'

const maskDocumentIdentifier = (value: string | undefined): string => {
  if (!value) return 'not available'
  if (value.length <= 4) return `${value.slice(0, 1)}***`
  return `${value.slice(0, 2)}****${value.slice(-2)}`
}

export default function PassportScreen({}: AppStackScreenProps<'Passport'>): JSX.Element {
  const navigation = useNavigation()
  const [status, setStatus] = useState<PassportVerificationNativeStatus | null>(null)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [result, setResult] = useState<PassportIdentityVerificationResult | null>(null)
  const [isCollectingMrz, setIsCollectingMrz] = useState(false)
  const mrzRequestRef = useRef<{
    resolve: (credentials: PassportCredentials) => void
    reject: (error?: unknown) => void
  } | null>(null)

  useEffect(() => {
    let isMounted = true

    const run = async () => {
      try {
        const nativeStatus = await getPassportVerificationNativeStatus()
        if (isMounted) setStatus(nativeStatus)
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        if (isMounted) setNativeError(message)
      }
    }

    run()

    return () => {
      isMounted = false
    }
  }, [])

  const resultSummary = useMemo(() => {
    if (!result) return null

    return {
      finalDecision: result.finalDecision,
      maskedDocumentNumber: maskDocumentIdentifier(result.passport.credentials?.documentNumber),
      hasCredentials: Boolean(result.passport.credentials),
      backend: result.debug?.backend ?? 'unknown',
      livenessPassed: result.face?.liveness?.passed ?? null,
      gazePassed: result.face?.gaze?.passed ?? null,
      comparisonPassed: result.face?.comparison?.passed ?? null,
    }
  }, [result])

  const handleRequestHostMrz = useCallback((): Promise<PassportCredentials> => {
    setIsCollectingMrz(true)
    return new Promise<PassportCredentials>((resolve, reject) => {
      mrzRequestRef.current = { resolve, reject }
    })
  }, [])

  const handleHostMrzCaptured = useCallback((mrzFields: unknown) => {
    const pending = mrzRequestRef.current
    mrzRequestRef.current = null
    setIsCollectingMrz(false)

    if (!pending) return

    try {
      const credentials = jomhoorMrzToPassportCredentials(mrzFields)
      pending.resolve(credentials)
    } catch (error) {
      if (error instanceof JomhoorMrzAdapterError) {
        pending.reject(error)
        return
      }

      pending.reject(new Error('Unable to normalize MRZ capture. Please try again.'))
    }
  }, [])

  const handleHostMrzCancel = useCallback(() => {
    const pending = mrzRequestRef.current
    mrzRequestRef.current = null
    setIsCollectingMrz(false)
    pending?.reject(new Error('MRZ capture cancelled by user.'))
  }, [])

  useEffect(() => {
    return () => {
      if (!mrzRequestRef.current) return
      mrzRequestRef.current.reject(new Error('MRZ capture interrupted.'))
      mrzRequestRef.current = null
    }
  }, [])

  return (
    <View className='flex-1 bg-backgroundPrimary'>
      {isCollectingMrz ? (
        <HostMrzCapture onCaptured={handleHostMrzCaptured} onCancel={handleHostMrzCancel} />
      ) : !result ? (
        <PassportIdentityFlow
          uiAdapter={jomhoorVerificationUiAdapter}
          mrzMode='host-provided'
          onRequestHostMrz={handleRequestHostMrz}
          config={{
            initialStep: 'mrz',
            nfcBackend: 'stub',
            face: {
              enabled: true,
              livenessEnabled: true,
              gazeEnabled: true,
              comparisonEnabled: true,
            },
          }}
          onCancel={() => navigation.goBack()}
          onComplete={setResult}
        />
      ) : (
        <View className='flex-1 gap-3 p-6'>
          <Text className='typography-h5 text-textPrimary'>Passport Placeholder Flow Result</Text>
          <Text className='typography-body3 text-textSecondary'>
            Phase 3 uses host MRZ capture only. No proof or wallet actions are triggered.
          </Text>
          <Text className='typography-body3 text-textPrimary'>
            {JSON.stringify(resultSummary, null, 2)}
          </Text>
          <UiButton
            title='Run placeholder flow again'
            onPress={() => setResult(null)}
            className='w-full'
          />
          <UiButton
            title='Back'
            variant='outlined'
            onPress={() => navigation.goBack()}
            className='w-full'
          />
        </View>
      )}

      <View className='border-t border-backgroundContainer bg-backgroundPrimary px-6 py-4'>
        <Text className='typography-body4 text-textSecondary'>Native linking status</Text>
        <Text className='typography-body4 text-textPrimary'>
          {status ? JSON.stringify(status) : 'Loading...'}
        </Text>
        {nativeError ? (
          <Text className='typography-body4 text-errorMain'>{nativeError}</Text>
        ) : null}
      </View>
    </View>
  )
}
