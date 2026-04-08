import { BottomSheetView } from '@gorhom/bottom-sheet'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Text, TouchableOpacity, View } from 'react-native'

import { useCopyToClipboard } from '@/hooks'
import { AppTabScreenProps } from '@/route-types'
import { authStore, walletStore } from '@/store'
import { cn, useAppPaddings } from '@/theme'
import { UiBottomSheet, UiCard, UiHorizontalDivider, UiIcon, useUiBottomSheet } from '@/ui'

import { AppStackScrollLayout } from '../../components/app-stack-scroll-layout'
import { ProfileListButton } from '../../components/profile-list-button'

export default function ProfileScreen({}: AppTabScreenProps<'Profile'>) {
  const { t } = useTranslation()

  return (
    <AppStackScrollLayout title={t('home.profile')}>
      <WalletAndDocumentsCard />
      <UiCard className='flex gap-4'>
        <AdvancedCard />
      </UiCard>
    </AppStackScrollLayout>
  )
}

function AdvancedCard() {
  const { t } = useTranslation()
  const privateKey = walletStore.useWalletStore(state => state.privateKey)
  const logout = authStore.useLogout()
  const { isCopied, copy } = useCopyToClipboard()
  const appPaddings = useAppPaddings()
  const bottomSheet = useUiBottomSheet()
  return (
    <>
      <View className='flex w-full flex-col gap-4'>
        <ProfileListButton
          leadingIcon={
            <UiIcon libIcon='Entypo' name='cog' className='text-textPrimary' size={5 * 4} />
          }
          title={t('profile.advanced')}
          onPress={bottomSheet.present}
        />
      </View>
      <UiBottomSheet
        title={t('profile.advanced')}
        ref={bottomSheet.ref}
        detached
        enableDynamicSizing={false}
        snapPoints={['30%']}
        headerComponent={
          <>
            <UiHorizontalDivider className='mx-auto my-4 mb-0 h-3 w-14 rounded-full' />
          </>
        }
      >
        <BottomSheetView
          className='mt-3 flex size-full gap-2 pb-6'
          style={{
            paddingLeft: appPaddings.left,
            paddingRight: appPaddings.right,
          }}
        >
          <View className={cn('flex size-full flex-1 gap-2')}>
            <Text className='typography-caption2 ml-4 font-semibold text-textPrimary'>
              {t('profile.private-key')}
            </Text>
            <UiCard className='flex-row bg-backgroundPrimary py-6'>
              <Text className='typography-body3 line-clamp-1 w-9/12 truncate whitespace-nowrap text-textPrimary'>
                {privateKey}
              </Text>

              <TouchableOpacity className='ml-auto'>
                <UiIcon
                  customIcon={isCopied ? 'checkIcon' : 'copySimpleIcon'}
                  className='text-textSecondary'
                  size={5 * 4}
                  onPress={() => copy(privateKey)}
                />
              </TouchableOpacity>
            </UiCard>

            <ProfileListButton
              className='mt-auto rounded-full bg-componentPrimary p-3 px-4'
              leadingIcon={
                <UiIcon
                  libIcon='MaterialCommunityIcons'
                  name='logout'
                  className='text-errorMain'
                  size={4 * 4}
                />
              }
              trailingIcon={<></>}
              title={t('profile.log-out')}
              onPress={logout}
            />
          </View>
        </BottomSheetView>
      </UiBottomSheet>
    </>
  )
}

function WalletAndDocumentsCard() {
  const navigation = useNavigation()
  const { t } = useTranslation()

  return (
    <UiCard className='items-center gap-3 rounded-3xl'>
      <ProfileListButton
        leadingIcon={
          <UiIcon libIcon='Fontisto' name='passport-alt' className='text-textPrimary' size={24} />
        }
        title={t('home.documents')}
        onPress={() => navigation.navigate('Documents' as never)}
      />
      <ProfileListButton
        leadingIcon={
          <UiIcon libIcon='Ionicons' name='wallet-outline' className='text-textPrimary' size={24} />
        }
        title={t('home.wallet')}
        onPress={() => navigation.navigate('Wallet' as never)}
      />
    </UiCard>
  )
}
