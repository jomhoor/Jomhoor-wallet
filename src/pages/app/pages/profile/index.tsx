import { BottomSheetView } from '@gorhom/bottom-sheet'
import { useNavigation } from '@react-navigation/native'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'

import { useCopyToClipboard } from '@/hooks'
import { AppTabScreenProps } from '@/route-types'
import { authStore, identityStore, walletStore } from '@/store'
import { NoirEIDIdentity } from '@/store/modules/identity/Identity'
import { cn, useAppPaddings } from '@/theme'
import { UiBottomSheet, UiCard, UiHorizontalDivider, UiIcon, useUiBottomSheet } from '@/ui'
import { recoverSsoWalletWithZk } from '@/utils/circuits/sso-zk-proof'

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
  const walletAddress = walletStore.useWalletAddress()
  const identities = identityStore.useIdentityStore(state => state.identities)
  const logout = authStore.useLogout()
  const { isCopied, copy } = useCopyToClipboard()
  const appPaddings = useAppPaddings()
  const bottomSheet = useUiBottomSheet()

  const eidIdentity = identities.find((i): i is NoirEIDIdentity => i instanceof NoirEIDIdentity)

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
        snapPoints={['45%']}
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

            <SsoRecoveryRow
              walletAddress={walletAddress}
              privateKey={privateKey}
              identity={eidIdentity}
            />

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

/**
 * M5 item 3 — SSO identity recovery entry point.
 *
 * Surfaces a button in Profile → Advanced that lets a user who has installed
 * the wallet on a new device (and re-scanned their ID) re-attach their prior
 * SSO history. The fresh INID ZK proof is the only authority: sso-svc rebinds
 * any assertions + pairwise_subjects bound to the same nullifier_hash on a
 * previous wallet to this new wallet, so relying parties keep seeing the same
 * pairwise `sub` for the user.
 *
 * Hidden entirely when the user has no INID identity yet — recovery requires
 * a re-scan first.
 */
function SsoRecoveryRow(props: {
  walletAddress: string
  privateKey: string
  identity: NoirEIDIdentity | undefined
}) {
  const { walletAddress, privateKey, identity } = props
  const [busy, setBusy] = useState(false)

  if (!identity) return null

  const run = async () => {
    if (!walletAddress || !privateKey) {
      Alert.alert('Recovery unavailable', 'Wallet is not ready yet.')
      return
    }
    setBusy(true)
    try {
      const { priorWalletExisted } = await recoverSsoWalletWithZk({
        identity,
        walletAddress,
        privateKey,
      })
      Alert.alert(
        priorWalletExisted ? 'Identity restored' : 'No prior identity',
        priorWalletExisted
          ? 'Your previous SSO history has been linked to this wallet. Relying parties will keep seeing your existing account.'
          : 'No prior SSO identity was found for this document. This wallet starts fresh.',
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error during SSO recovery'
      console.error('[Profile] SSO recovery failed:', err)
      Alert.alert('Recovery failed', message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <UiCard className='bg-backgroundPrimary py-4'>
      <TouchableOpacity
        disabled={busy}
        onPress={run}
        className='flex-row items-center justify-between'
      >
        <View className='flex-1 pr-4'>
          <Text className='typography-body3 font-semibold text-textPrimary'>
            Recover SSO identity
          </Text>
          <Text className='typography-caption2 mt-1 text-textSecondary'>
            Re-link this device to your prior Jomhoor SSO identity using a fresh ZK proof.
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator />
        ) : (
          <UiIcon
            libIcon='MaterialCommunityIcons'
            name='restore'
            className='text-textPrimary'
            size={4 * 4}
          />
        )}
      </TouchableOpacity>
    </UiCard>
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
