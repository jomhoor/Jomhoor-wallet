import { useNavigation } from '@react-navigation/native'
import type { ComponentProps } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { AppStackScreenProps } from '@/route-types'
import { useAppTheme } from '@/theme'
import type { BaseTheme } from '@/theme/config/colors'
import { GRID_UNIT } from '@/theme/config/spacing'
import { UiIcon } from '@/ui'

type AppItem = {
  labelKey: string
  route: string
  icon: { lib: string; name: string } | { custom: string }
  color: string
}

const SMALL_ICON = 60

function getDefaultHomeApps(p: BaseTheme): AppItem[] {
  return [
    {
      labelKey: 'home.documents',
      route: 'Documents',
      icon: { lib: 'Fontisto', name: 'passport-alt' },
      color: p.primaryMain,
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
    {
      labelKey: 'home.wallet',
      route: 'Wallet',
      icon: { lib: 'Ionicons', name: 'wallet-outline' },
      color: p.textSecondary,
    },
    {
      labelKey: 'home.profile',
      route: 'Profile',
      icon: { custom: 'userIcon' },
      color: p.textPlaceholder,
    },
  ]
}

const ICON_INNER_SIZE = 28
const ICON_CORNER_RADIUS = 18

function HomeShortcut({
  app,
  label,
  iconOnAccentColor,
  onPress,
}: {
  app: AppItem
  label: string
  iconOnAccentColor: string
  onPress: () => void
}) {
  return (
    <Pressable accessibilityRole='button' onPress={onPress} className='w-full items-center'>
      <View
        className='items-center justify-center'
        style={{
          width: SMALL_ICON,
          height: SMALL_ICON,
          borderRadius: ICON_CORNER_RADIUS,
          backgroundColor: app.color,
        }}
      >
        {'custom' in app.icon ? (
          <UiIcon
            {...({
              customIcon: app.icon.custom,
              size: ICON_INNER_SIZE,
              color: iconOnAccentColor,
            } as unknown as ComponentProps<typeof UiIcon>)}
          />
        ) : (
          <UiIcon
            {...({
              libIcon: app.icon.lib,
              name: app.icon.name,
              size: ICON_INNER_SIZE,
              color: iconOnAccentColor,
            } as unknown as ComponentProps<typeof UiIcon>)}
          />
        )}
      </View>
      <Text className='mt-1.5 w-full text-center text-xs text-textPrimary' numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

export default function HomeScreen({}: AppStackScreenProps<'Home'>) {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const { palette } = useAppTheme()

  const apps = useMemo(() => getDefaultHomeApps(palette), [palette])

  return (
    <View className='flex-1 bg-backgroundPrimary'>
      <View className='items-center px-home-x' style={{ paddingTop: insets.top + GRID_UNIT * 4 }}>
        <Text className='text-3xl font-bold text-textPrimary'>{t('home.title')}</Text>
      </View>

      <View className='flex-1 px-home-x' style={{ paddingTop: GRID_UNIT * 5 }}>
        <View className='flex-row flex-wrap'>
          {apps.map(app => (
            <View key={app.route} className='w-1/5 py-2'>
              <HomeShortcut
                app={app}
                label={t(app.labelKey)}
                iconOnAccentColor={palette.baseWhite}
                onPress={() => navigation.navigate(app.route as never)}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}
