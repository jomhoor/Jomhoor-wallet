import { useNavigation } from '@react-navigation/native'
import { Text, View } from 'react-native'

import { AppStackScrollLayout } from '@/pages/app/components/app-stack-scroll-layout'
import { demoPassportProfileStore } from '@/store'
import { UiButton, UiCard, UiHorizontalDivider, UiIcon } from '@/ui'

const formatMrzDate = (value: string): string => {
  if (value.length !== 6) return value
  const yy = value.slice(0, 2)
  const mm = value.slice(2, 4)
  const dd = value.slice(4, 6)
  const year = Number.parseInt(yy, 10) > 30 ? `19${yy}` : `20${yy}`
  return `${dd}/${mm}/${year}`
}

const shortenIdentifier = (value: string): string =>
  value.length > 28 ? `${value.slice(0, 18)}...${value.slice(-6)}` : value

export default function DocumentsWithDemoProfile() {
  const navigation = useNavigation()
  const profile = demoPassportProfileStore.useDemoPassportProfileStore(state => state.profile)
  const clearProfile = demoPassportProfileStore.useDemoPassportProfileStore(
    state => state.clearProfile,
  )

  if (!profile) return null

  return (
    <AppStackScrollLayout title='Documents' contentWrapperClassName='flex-1 gap-5'>
      <View className='bg-warningMain/10 rounded-xl px-4 py-3'>
        <Text className='typography-body3 text-center text-warningMain'>
          Demo profile. This is not a real credential and is not registered on-chain.
        </Text>
      </View>

      <UiCard>
        <View className='flex-row items-center gap-4'>
          <View className='h-16 w-16 items-center justify-center rounded-full bg-componentHovered'>
            <UiIcon customIcon='userIcon' size={40} className='color-textPrimary' />
          </View>
          <View className='flex-1'>
            <Text className='typography-h6 text-textPrimary'>
              {profile.firstName} {profile.lastName}
            </Text>
            <Text className='typography-body3 mt-1 text-warningMain'>
              {profile.kind === 'demo-nid-profile' ? 'Demo ID profile' : 'Demo passport profile'}
            </Text>
          </View>
        </View>

        <UiHorizontalDivider className='my-5' />

        <View className='gap-3'>
          {profile.kind === 'demo-nid-profile' ? (
            <>
              <ProfileRow label='National ID' value={profile.nationalId} />
              <ProfileRow label='Card number' value={profile.cardNumber} />
            </>
          ) : (
            <ProfileRow label='Document number' value={profile.documentNumber} />
          )}
          <ProfileRow label='Nationality' value={profile.nationality} />
          <ProfileRow
            label='Date of birth'
            value={
              profile.kind === 'demo-nid-profile'
                ? profile.birthDate
                : formatMrzDate(profile.birthDate)
            }
          />
          <ProfileRow
            label='Expiry date'
            value={
              profile.kind === 'demo-nid-profile'
                ? profile.expiryDate
                : formatMrzDate(profile.expiryDate)
            }
          />
          {profile.kind === 'demo-passport-profile' ? (
            <ProfileRow label='Issuing authority' value={profile.issuingAuthority} />
          ) : null}
        </View>
      </UiCard>

      <UiCard>
        <Text className='typography-subtitle4 text-textPrimary'>Local demo registration</Text>
        <Text className='typography-body4 mt-1 text-textSecondary'>
          These identifiers exist only for the demo result and cannot be used as a proof.
        </Text>
        <UiHorizontalDivider className='my-4' />
        <View className='gap-3'>
          <ProfileRow label='Proof ID' value={shortenIdentifier(profile.proof.proofId)} />
          <ProfileRow
            label='Registration ID'
            value={shortenIdentifier(profile.proof.registrationId)}
          />
        </View>
      </UiCard>

      <View className='mt-auto gap-3'>
        <UiButton
          title='Start Verification'
          onPress={() => {
            navigation.navigate('App', {
              screen: 'Scan',
            })
          }}
        />
        <UiButton title='Remove Demo Profile' variant='outlined' onPress={clearProfile} />
      </View>
    </AppStackScrollLayout>
  )
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View className='flex-row items-center justify-between gap-4'>
      <Text className='typography-body3 text-textSecondary'>{label}</Text>
      <Text className='typography-subtitle4 flex-shrink text-right text-textPrimary'>{value}</Text>
    </View>
  )
}
