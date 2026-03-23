import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { useNavigation } from '@react-navigation/core'
import { Image } from 'expo-image'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { translate } from '@/core'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'
import { EID } from '@/utils/e-document'
import { ExtendedCertificate } from '@/utils/e-document/extended-cert'
import {
  initNfc,
  readSigningAndAuthCertificates,
  stopNfc,
} from '@/utils/e-document/inid-nfc-reader'

export default function ScanNfcStep() {
  const { setTempEDoc } = useDocumentScanContext()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const navigation = useNavigation()
  // start NFC once, right after mount
  useEffect(() => {
    initNfc().catch(e => console.warn('NFC init error', e))
  }, [])

  const onReadPress = useCallback(async () => {
    setBusy(true)
    try {
      const { signingCert, authCert } = await readSigningAndAuthCertificates(() => {
        setIsScanning(true)
      })

      if (!signingCert) throw new Error('Signing certificate not found')

      const extendedSigCert = new ExtendedCertificate(
        AsnConvert.parse(Buffer.from(signingCert, 'hex'), Certificate),
      )

      if (!authCert) throw new Error('Authentication certificate not found')

      const extendedAuthCert = new ExtendedCertificate(
        AsnConvert.parse(Buffer.from(authCert, 'hex'), Certificate),
      )

      const eID = new EID(extendedSigCert, extendedAuthCert)

      setTempEDoc(eID)
    } catch (e) {
      console.error({ e })
    }

    setBusy(false)
    setIsScanning(false)
  }, [setTempEDoc])

  // const pk = walletStore.useWalletStore(state => state.privateKey)
  // const registrationChallenge = walletStore.useRegistrationChallenge()

  return (
    <View
      style={{ paddingBottom: insets.bottom, paddingTop: insets.top }}
      className='flex-1 justify-center p-6'
    >
      <View className='flex-row'>
        <Text className='typography-h5 mb-2 text-textPrimary'>NFC Reader</Text>
        <View className='flex-1' />
        <Pressable
          className='absolute right-[15px] top-[15px]'
          onPress={() => {
            stopNfc()
            navigation.navigate('App', { screen: 'Home' })
          }}
        >
          <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
            <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
          </View>
        </Pressable>
      </View>
      <Text className='typography-body3 mb-6 text-textSecondary'>Reading personal data</Text>
      {isScanning && (
        <Text className='typography-body2 mb-6 rounded-xl border-componentPrimary bg-componentPrimary p-4 text-center text-textPrimary'>
          Scanning NFC tag... Please hold your passport close to the phone.
        </Text>
      )}
      {!isScanning && busy && (
        <Text className='typography-body2 mb-6 rounded-xl border-componentPrimary bg-componentPrimary p-4 text-center text-textPrimary'>
          Place your Passport/ID to the back of your phone
        </Text>
      )}
      <Image
        source={require('@assets/images/passport-scan-example.png')}
        style={{
          width: 300,
          height: 300,
          alignSelf: 'center',
          marginBottom: 24,
          marginTop: 24,
        }}
      />
      <Text className='typography-body3 text-textSecondary'>{translate('tabs.scan-nfc.tip')}</Text>
      {busy && <ActivityIndicator className='my-4' />}
      {/* {error && <Text className='mt-4 text-errorMain typography-body2'>{error}</Text>} */}
      <UiButton
        onPress={onReadPress}
        title={busy ? 'Read Signing Certificate' : 'Start NFC Scan'}
        className='mt-auto w-full'
        disabled={busy}
      />
    </View>
  )
}
