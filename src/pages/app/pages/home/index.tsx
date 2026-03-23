import { useNavigation } from '@react-navigation/native'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Dimensions,
  I18nManager,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { AppStackScreenProps } from '@/route-types'
import { useAppTheme } from '@/theme'
import type { BaseTheme } from '@/theme/config/colors'
import { lightPalette } from '@/theme/config/colors'
import { GRID_UNIT, HOME_GRID_PADDING_X } from '@/theme/config/spacing'
import { UiIcon } from '@/ui'

type AppItem = {
  labelKey: string
  route: string
  icon: { lib: string; name: string } | { custom: string }
  color: string
  featured?: boolean
}

const COLUMNS = 4
const SMALL_ICON = 60
/** Row height: icon + label line (~30px). */
const ROW_EXTRA = GRID_UNIT * 7 + 2

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
      featured: true,
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

type GridMetrics = {
  cell: number
  bigIcon: number
  padLeft: number
  itemHeight: number
}

function computeGridMetrics(screenWidth: number): GridMetrics {
  const padLeft = HOME_GRID_PADDING_X
  const cell = (screenWidth - padLeft * 2) / COLUMNS
  const bigIcon = cell * 2 - padLeft
  const itemHeight = SMALL_ICON + ROW_EXTRA
  return { cell, bigIcon, padLeft, itemHeight }
}

function buildInitialPositions(
  apps: AppItem[],
  topOffset: number,
  m: GridMetrics,
): { x: number; y: number }[] {
  const { cell: CELL, bigIcon: BIG_ICON, padLeft, itemHeight: ITEM_HEIGHT } = m
  const positions: { x: number; y: number }[] = []
  const featuredIdx = apps.findIndex(a => a.featured)
  const featuredYOffset = GRID_UNIT * 5

  let smallRightIdx = 0
  let bottomIdx = 0

  for (let i = 0; i < apps.length; i++) {
    if (i === featuredIdx) {
      positions.push({
        x: padLeft + (CELL * 2 - BIG_ICON) / 2,
        y: topOffset + (ITEM_HEIGHT * 2 - BIG_ICON - featuredYOffset) / 2,
      })
    } else if (smallRightIdx < 4) {
      const col = 2 + (smallRightIdx % 2)
      const row = Math.floor(smallRightIdx / 2)
      positions.push({
        x: padLeft + col * CELL + (CELL - SMALL_ICON) / 2,
        y: topOffset + row * ITEM_HEIGHT,
      })
      smallRightIdx++
    } else {
      const col = bottomIdx % COLUMNS
      const row = 2 + Math.floor(bottomIdx / COLUMNS)
      positions.push({
        x: padLeft + col * CELL + (CELL - SMALL_ICON) / 2,
        y: topOffset + row * ITEM_HEIGHT,
      })
      bottomIdx++
    }
  }

  return positions
}

function DraggableIcon({
  app,
  label,
  posX,
  posY,
  cell,
  bigIcon,
  iconOnAccentColor,
  onTap,
  onDrop,
  onMakeDefault,
}: {
  app: AppItem
  label: string
  posX: number
  posY: number
  cell: number
  bigIcon: number
  iconOnAccentColor: string
  onTap: () => void
  onDrop: (x: number, y: number) => void
  onMakeDefault: () => void
}) {
  const translateX = useSharedValue(posX)
  const translateY = useSharedValue(posY)
  const offsetX = useSharedValue(posX)
  const offsetY = useSharedValue(posY)
  const scale = useSharedValue(1)
  const zIdx = useSharedValue(0)
  const dragged = useSharedValue(false)

  // Animate to new position when it changes externally (e.g. after make-default)
  translateX.value = withSpring(posX)
  translateY.value = withSpring(posY)
  offsetX.value = posX
  offsetY.value = posY

  const size = app.featured ? bigIcon : SMALL_ICON
  const iconSize = app.featured ? 52 : 28
  const radius = app.featured ? 28 : 18

  const DRAG_THRESHOLD = 8

  // Tap → navigate
  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onTap)()
  })

  // In RTL mode, React Native flips "left" to mean "from the right edge",
  // but gesture translations are always in physical screen coordinates.
  // Negate translationX so the icon follows the finger correctly.
  const rtlFactor = I18nManager.isRTL ? -1 : 1

  // Long-press + optional drag: if user drags → move icon; if not → context menu
  const panGesture = Gesture.Pan()
    .activateAfterLongPress(400)
    .onStart(() => {
      dragged.value = false
      offsetX.value = translateX.value
      offsetY.value = translateY.value
      zIdx.value = 100
      scale.value = withSpring(1.15)
    })
    .onUpdate(e => {
      const dist = Math.sqrt(e.translationX ** 2 + e.translationY ** 2)
      if (dist > DRAG_THRESHOLD) {
        dragged.value = true
      }
      if (dragged.value) {
        translateX.value = offsetX.value + e.translationX * rtlFactor
        translateY.value = offsetY.value + e.translationY
      }
    })
    .onEnd(() => {
      scale.value = withSpring(1)
      zIdx.value = 0
      if (dragged.value) {
        runOnJS(onDrop)(translateX.value, translateY.value)
      } else {
        // Long-pressed but didn't drag → show context menu (iOS-style)
        runOnJS(onMakeDefault)()
      }
    })

  // Exclusive: Pan (long-press) wins over Tap
  const gesture = Gesture.Exclusive(panGesture, tapGesture)

  const animStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: translateX.value,
    top: translateY.value,
    zIndex: zIdx.value,
    transform: [{ scale: scale.value }],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={animStyle} className='items-center'>
        <View
          className='items-center justify-center'
          style={{ width: size, height: size, borderRadius: radius, backgroundColor: app.color }}
        >
          {'custom' in app.icon ? (
            <UiIcon
              {...({
                customIcon: app.icon.custom,
                size: iconSize,
                color: iconOnAccentColor,
              } as unknown as ComponentProps<typeof UiIcon>)}
            />
          ) : (
            <UiIcon
              {...({
                libIcon: app.icon.lib,
                name: app.icon.name,
                size: iconSize,
                color: iconOnAccentColor,
              } as unknown as ComponentProps<typeof UiIcon>)}
            />
          )}
        </View>
        <Text
          className='mt-1.5 text-center text-xs text-textPrimary'
          numberOfLines={1}
          style={{ width: app.featured ? bigIcon : cell }}
        >
          {label}
        </Text>
      </Animated.View>
    </GestureDetector>
  )
}

export default function HomeScreen({}: AppStackScreenProps<'Home'>) {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const { palette } = useAppTheme()
  const [modalVisible, setModalVisible] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [apps, setApps] = useState<AppItem[]>(() => getDefaultHomeApps(lightPalette))

  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')
  const grid = useMemo(() => computeGridMetrics(SCREEN_WIDTH), [SCREEN_WIDTH])

  const headerHeight = insets.top + 56
  const topOffset = GRID_UNIT * 5

  // Positions are stored per-icon so drag-drop keeps them where you leave them
  const [iconPositions, setIconPositions] = useState<{ x: number; y: number }[]>(() =>
    buildInitialPositions(
      getDefaultHomeApps(lightPalette),
      topOffset,
      computeGridMetrics(SCREEN_WIDTH),
    ),
  )

  useEffect(() => {
    setApps(prev =>
      prev.map(app => ({
        ...app,
        color: getDefaultHomeApps(palette).find(f => f.route === app.route)?.color ?? app.color,
      })),
    )
  }, [palette])

  // Add button sits after the last icon in the grid
  const addPos = useMemo(() => {
    const featuredIdx = apps.findIndex(a => a.featured)
    const smallCount = apps.length - (featuredIdx >= 0 ? 1 : 0)
    const afterRight = Math.min(smallCount, 4)
    const afterBottom = smallCount - afterRight
    const col = afterBottom % COLUMNS
    const row = 2 + Math.floor(afterBottom / COLUMNS)
    const { cell: CELL, padLeft, itemHeight: ITEM_HEIGHT } = grid
    return {
      x: padLeft + col * CELL + (CELL - SMALL_ICON) / 2,
      y: topOffset + row * ITEM_HEIGHT,
    }
  }, [apps, topOffset, grid])

  const handleDrop = useCallback(
    (index: number, newX: number, newY: number) => {
      // Clamp to screen bounds
      const clampedX = Math.max(0, Math.min(newX, SCREEN_WIDTH - SMALL_ICON))
      const clampedY = Math.max(0, Math.min(newY, SCREEN_HEIGHT - headerHeight - grid.itemHeight))
      setIconPositions(prev => {
        const next = [...prev]
        next[index] = { x: clampedX, y: clampedY }
        return next
      })
    },
    [SCREEN_HEIGHT, SCREEN_WIDTH, grid.itemHeight, headerHeight],
  )

  const handleMakeDefault = useCallback(
    (index: number) => {
      const app = apps[index]
      if (app.featured) return
      Alert.alert(t('home.make-default'), t('home.make-default-msg', { name: t(app.labelKey) }), [
        { text: t('home.cancel'), style: 'cancel' },
        {
          text: t('home.make-default'),
          onPress: () => {
            setApps(prev => {
              const next = prev.map((a, i) => ({ ...a, featured: i === index }))
              // Recompute grid layout after changing featured
              setIconPositions(buildInitialPositions(next, topOffset, grid))
              return next
            })
          },
        },
      ])
    },
    [apps, grid, topOffset, t],
  )

  return (
    <GestureHandlerRootView className='flex-1 bg-backgroundPrimary'>
      <View className='items-center px-home-x' style={{ paddingTop: insets.top + GRID_UNIT * 4 }}>
        <Text className='text-3xl font-bold text-textPrimary'>{t('home.title')}</Text>
      </View>

      {/* Icons layer — full remaining screen */}
      <View className='flex-1'>
        {apps.map((app, i) => (
          <DraggableIcon
            key={app.route}
            app={app}
            label={t(app.labelKey)}
            posX={iconPositions[i]?.x ?? 0}
            posY={iconPositions[i]?.y ?? 0}
            cell={grid.cell}
            bigIcon={grid.bigIcon}
            iconOnAccentColor={palette.baseWhite}
            onTap={() => navigation.navigate(app.route as never)}
            onDrop={(x, y) => handleDrop(i, x, y)}
            onMakeDefault={() => handleMakeDefault(i)}
          />
        ))}

        {/* Add button */}
        <Pressable
          onPress={() => setModalVisible(true)}
          className='absolute items-center'
          style={{ left: addPos.x, top: addPos.y }}
        >
          <View
            className='items-center justify-center rounded-[18px]'
            style={{
              width: SMALL_ICON,
              height: SMALL_ICON,
              backgroundColor: palette.componentPrimary,
            }}
          >
            <Text
              style={{
                fontSize: 30,
                color: palette.textPlaceholder,
                fontWeight: '300',
              }}
            >
              +
            </Text>
          </View>
          <Text className='mt-1.5 text-center text-xs text-textPrimary'>{t('home.add')}</Text>
        </Pressable>
      </View>

      {/* Add dApp modal */}
      <Modal visible={modalVisible} transparent animationType='slide'>
        <Pressable
          className='flex-1 items-center justify-center bg-black/50'
          onPress={() => setModalVisible(false)}
        >
          <Pressable
            className='mx-6 w-5/6 rounded-2xl bg-backgroundPrimary p-6'
            onPress={e => e.stopPropagation()}
          >
            <Text className='mb-4 text-lg font-semibold text-textPrimary'>
              {t('home.add-dapp')}
            </Text>
            <TextInput
              value={urlText}
              onChangeText={setUrlText}
              placeholder={t('home.enter-url')}
              autoCapitalize='none'
              autoCorrect={false}
              keyboardType='url'
              className='mb-4 rounded-xl border border-componentPrimary px-4 py-3 text-textPrimary'
              placeholderTextColor={palette.textPlaceholder}
            />
            <View className='flex-row justify-end gap-3'>
              <Pressable onPress={() => setModalVisible(false)} className='rounded-xl px-5 py-2.5'>
                <Text className='text-textSecondary'>{t('home.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setModalVisible(false)
                  setUrlText('')
                }}
                className='rounded-xl bg-primaryMain px-5 py-2.5'
              >
                <Text className='font-medium text-baseWhite'>{t('home.add')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </GestureHandlerRootView>
  )
}
