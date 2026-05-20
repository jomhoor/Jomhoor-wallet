import { identicon } from '@dicebear/collection'
import { createAvatar } from '@dicebear/core'
import { Env } from '@env'
import { useNavigation } from '@react-navigation/native'
import type { ComponentProps } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SvgXml } from 'react-native-svg'

import type { AppStackScreenProps } from '@/route-types'
import { identityStore, walletStore } from '@/store'
import { useAppTheme } from '@/theme'
import type { BaseTheme } from '@/theme/config/colors'
import { GRID_UNIT } from '@/theme/config/spacing'
import { UiCard, UiIcon } from '@/ui'

type HomeDestination = {
  labelKey: 'home.profile' | 'home.proposals' | 'home.hub' | 'home.compass'
  route: 'Profile' | 'Proposals' | 'Hub' | 'Compass'
  icon: { lib: string; name: string } | { custom: string }
  color: string
}

function getHomeDestinations(p: BaseTheme): HomeDestination[] {
  return [
    {
      labelKey: 'home.profile',
      route: 'Profile',
      icon: { custom: 'userIcon' },
      color: p.textPlaceholder,
    },
    {
      labelKey: 'home.proposals',
      route: 'Proposals',
      icon: { lib: 'FontAwesome', name: 'list-ul' },
      color: p.successMain,
    },
    {
      labelKey: 'home.hub',
      route: 'Hub',
      icon: { lib: 'Ionicons', name: 'chatbubbles-outline' },
      color: p.secondaryMain,
    },
    {
      labelKey: 'home.compass',
      route: 'Compass',
      icon: { lib: 'Ionicons', name: 'compass-outline' },
      color: p.warningMain,
    },
  ]
}

const LOGO_SIZE = 40
const AVATAR_OUTER = 85
const AVATAR_XML = 80
const TILE = 52
const TILE_RADIUS = 16
const ICON_INNER = 26

function HomeSectionCard({
  item,
  label,
  iconOnAccentColor,
  onPress,
}: {
  item: HomeDestination
  label: string
  iconOnAccentColor: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
      className='w-full active:opacity-90'
    >
      <UiCard className='min-h-20 w-full flex-row items-center gap-3'>
        <View
          className='items-center justify-center'
          style={{
            width: TILE,
            height: TILE,
            borderRadius: TILE_RADIUS,
            backgroundColor: item.color,
          }}
        >
          {'custom' in item.icon ? (
            <UiIcon
              {...({
                customIcon: item.icon.custom,
                size: ICON_INNER,
                color: iconOnAccentColor,
              } as unknown as ComponentProps<typeof UiIcon>)}
            />
          ) : (
            <UiIcon
              {...({
                libIcon: item.icon.lib,
                name: item.icon.name,
                size: ICON_INNER,
                color: iconOnAccentColor,
              } as unknown as ComponentProps<typeof UiIcon>)}
            />
          )}
        </View>
        <Text className='typography-body1 flex-1 font-semibold text-textPrimary'>{label}</Text>
        <UiIcon
          libIcon='FontAwesome'
          name='chevron-right'
          className='text-textSecondary'
          size={3 * 4}
        />
      </UiCard>
    </Pressable>
  )
}

export default function HomeScreen({}: AppStackScreenProps<'Home'>) {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const { palette } = useAppTheme()
  const publicKeyHash = walletStore.usePublicKeyHash().toString()
  const hasHydrated = identityStore.useIdentityStore(state => state._hasHydrated)
  const hasVerifiedIdentity = identityStore.useIdentityStore(state => state.identities.length > 0)
  const isVerifiedCitizen = hasHydrated && hasVerifiedIdentity

  const avatarXml = useMemo(
    () => createAvatar(identicon, { seed: publicKeyHash }).toString(),
    [publicKeyHash],
  )

  const destinations = useMemo(() => getHomeDestinations(palette), [palette])

  return (
    <View className='flex-1 bg-backgroundPrimary'>
      <View
        className='flex-row items-center gap-3 px-home-x'
        style={{ paddingTop: insets.top + GRID_UNIT * 2 }}
      >
        <Image
          accessibilityIgnoresInvertColors
          source={require('@assets/icon.png')}
          style={{ width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: GRID_UNIT }}
        />
        <Text className='flex-1 text-xl font-bold text-textPrimary'>{Env.NAME}</Text>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={t('home.settings')}
          onPress={() => navigation.navigate('Settings' as never)}
          className='py-2 ps-2'
        >
          <UiIcon
            libIcon='Ionicons'
            name='settings-outline'
            className='text-textPrimary'
            size={26}
          />
        </Pressable>
      </View>

      <View className='my-10 items-center px-home-x' style={{ paddingTop: GRID_UNIT * 3 }}>
        <View
          className='items-center overflow-hidden rounded-full bg-componentPrimary'
          style={{ width: AVATAR_OUTER, height: AVATAR_OUTER }}
        >
          <SvgXml height={AVATAR_XML} width={AVATAR_XML} xml={avatarXml} />
        </View>
        <Text className='typography-body1 mt-2 text-center text-textPrimary'>
          {t(isVerifiedCitizen ? 'profile.display-name-verified' : 'profile.display-name')}
        </Text>
      </View>

      <View className='flex-1 gap-4 px-home-x' style={{ paddingTop: GRID_UNIT * 4 }}>
        {destinations.map(item => (
          <HomeSectionCard
            key={item.route}
            item={item}
            label={t(item.labelKey)}
            iconOnAccentColor={palette.baseWhite}
            onPress={() => navigation.navigate(item.route as never)}
          />
        ))}
      </View>
    </View>
  )
}
