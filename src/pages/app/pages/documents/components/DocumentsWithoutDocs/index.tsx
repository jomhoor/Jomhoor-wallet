import { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import { useNavigation } from '@react-navigation/native'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import AppContainer from '@/pages/app/components/AppContainer'
import { cn, useAppPaddings, useAppTheme, useBottomBarOffset } from '@/theme'
import {
  UiActionCard,
  UiBottomSheet,
  UiButton,
  UiCard,
  UiHorizontalDivider,
  UiIcon,
  UiScreenScrollable,
  useUiBottomSheet,
} from '@/ui'

export default function DocumentsWithoutDocs() {
  const { palette } = useAppTheme()

  const insets = useSafeAreaInsets()
  const appPaddings = useAppPaddings()
  const offset = useBottomBarOffset()

  const aboutAppBottomSheet = useUiBottomSheet()
  const startScanBottomSheet = useUiBottomSheet()

  const navigation = useNavigation()

  return (
    <AppContainer>
      <UiScreenScrollable
        style={{
          paddingTop: insets.top,
          paddingLeft: appPaddings.left,
          paddingRight: appPaddings.right,
          paddingBottom: offset,
        }}
        className='justify-center gap-5'
      >
        <UiCard>
          <UiIcon customIcon='starFillIcon' className='m-auto mb-5 size-[110] color-primaryMain' />
          <View className='flex flex-col gap-2'>
            <Text className='typography-h6 text-center text-textPrimary'>
              Create your digital identity
            </Text>
            <Text className='typography-body3 text-center text-textPrimary'>
              This profile is anonymous and secure
            </Text>
          </View>

          <UiHorizontalDivider className='my-5' />

          <UiButton
            className='w-full'
            size='large'
            title="Let's start"
            trailingIconProps={{
              customIcon: 'arrowRightIcon',
            }}
            onPress={() => {
              startScanBottomSheet.present()
            }}
          />
        </UiCard>

        <UiActionCard
          pressProps={{
            onPress: () => {
              aboutAppBottomSheet.present()
            },
          }}
          title='The App'
          subtitle='Learn how this works'
          leadingContent={<UiIcon customIcon='infoIcon' className='size-[40] text-primaryMain' />}
          trailingContent={
            <UiIcon customIcon='arrowRightIcon' className='size-[24] text-textPrimary' />
          }
        />
        {/*  TODO:Change text */}
        <UiBottomSheet
          ref={aboutAppBottomSheet.ref}
          backgroundStyle={{
            backgroundColor: palette.backgroundContainer,
          }}
          enableDynamicSizing={false}
          snapPoints={['85%']}
        >
          <BottomSheetScrollView style={{ paddingBottom: insets.bottom }}>
            <View className={cn('py-0, flex flex-col items-center gap-4 p-5')}>
              <UiIcon customIcon='infoIcon' className='size-[80] text-primaryMain' />

              <Text className='typography-h5 text-textPrimary'>About the App</Text>

              <UiHorizontalDivider className='my-4' />

              <Text className='typography-body2 text-textSecondary'>
                Iranians.vote app is built using the following technologies: NFC card readers,
                zero-knowledge proofs, end-to-end encryption, and decentralized identity standards
                to ensure secure and private digital identity verification.
              </Text>

              <Text className='typography-body2 text-textSecondary'>
                you scan your government-issued ID card using NFC technology, the app reads the data
                directly from the card. Instead of storing this data on a central server, the app
                uses zero-knowledge proofs to verify your identity without actually transmitting
                your personal information. This means that your sensitive data remains on your
                device and is never shared with third parties.
              </Text>
              <Text className='typography-body2 text-textSecondary'>
                once your identity is verified, the app creates a decentralized identity (DID) for
                you. This DID is stored on a blockchain or distributed ledger, giving you full
                control over your digital identity. You can use this DID to prove your identity to
                various services without revealing unnecessary personal information. You can vote
                securely and anonymously using your digital identity, ensuring that your vote is
                private and cannot be traced back to you.
              </Text>

              <UiButton
                className='mt-auto w-full'
                title='Okay'
                onPress={() => {
                  aboutAppBottomSheet.dismiss()
                }}
              />
            </View>
          </BottomSheetScrollView>
        </UiBottomSheet>
        {/*  TODO:Change text */}
        <UiBottomSheet
          ref={startScanBottomSheet.ref}
          backgroundStyle={{
            backgroundColor: palette.backgroundContainer,
          }}
          enableDynamicSizing={false}
          snapPoints={['85%']}
        >
          <BottomSheetScrollView style={{ paddingBottom: insets.bottom }}>
            <View className={cn('py-0, flex flex-col items-center gap-4 p-5')}>
              <UiIcon customIcon='infoIcon' className='size-[80] text-primaryMain' />

              <Text className='typography-h5 text-textPrimary'>Start scan</Text>

              <UiHorizontalDivider className='my-4' />

              <Text className='typography-body2 text-textSecondary'>
                Iranians.vote app is built using the following technologies: NFC card readers,
                zero-knowledge proofs, end-to-end encryption, and decentralized identity standards
                to ensure secure and private digital identity verification.
              </Text>

              <Text className='typography-body2 text-textSecondary'>
                you scan your government-issued ID card using NFC technology, the app reads the data
                directly from the card. Instead of storing this data on a central server, the app
                uses zero-knowledge proofs to verify your identity without actually transmitting
                your personal information. This means that your sensitive data remains on your
                device and is never shared with third parties.
              </Text>
              <Text className='typography-body2 text-textSecondary'>
                once your identity is verified, the app creates a decentralized identity (DID) for
                you. This DID is stored on a blockchain or distributed ledger, giving you full
                control over your digital identity. You can use this DID to prove your identity to
                various services without revealing unnecessary personal information. You can vote
                securely and anonymously using your digital identity, ensuring that your vote is
                private and cannot be traced back to you.
              </Text>

              <UiButton
                className='mt-auto w-full'
                title='Okay'
                onPress={() => {
                  startScanBottomSheet.dismiss()
                  navigation.navigate('App', {
                    screen: 'Scan',
                  })
                }}
              />
            </View>
          </BottomSheetScrollView>
        </UiBottomSheet>
      </UiScreenScrollable>
    </AppContainer>
  )
}
