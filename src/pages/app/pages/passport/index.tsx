import type {
  PassportIdentityVerificationResult,
  PassportVerificationNativeStatus,
} from '@iland/passport-verification'
import {
  getPassportVerificationNativeStatus,
  PassportIdentityFlow,
} from '@iland/passport-verification'
import { useNavigation } from '@react-navigation/native'
import { useEffect, useMemo, useState } from 'react'
import { Text, View } from 'react-native'

import type { AppStackScreenProps } from '@/route-types'
import { UiButton } from '@/ui'

import { jomhoorVerificationUiAdapter } from './jomhoorVerificationUiAdapter'

export default function PassportScreen({}: AppStackScreenProps<'Passport'>): JSX.Element {
  const navigation = useNavigation()
  const [status, setStatus] = useState<PassportVerificationNativeStatus | null>(null)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [result, setResult] = useState<PassportIdentityVerificationResult | null>(null)

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
      documentNumber:
        result.passport.normalized?.documentNumber ?? result.passport.credentials?.documentNumber,
      backend: result.debug?.backend ?? 'unknown',
      livenessPassed: result.face?.liveness?.passed ?? null,
      gazePassed: result.face?.gaze?.passed ?? null,
      comparisonPassed: result.face?.comparison?.passed ?? null,
    }
  }, [result])

  return (
    <View className='flex-1 bg-backgroundPrimary'>
      {!result ? (
        <PassportIdentityFlow
          uiAdapter={jomhoorVerificationUiAdapter}
          config={{
            initialStep: 'mrz',
            nfcBackend: 'stub',
            mrzMode: 'host-provided',
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
            Phase 2 returns a mock typed result only. No proof or wallet actions are triggered.
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
