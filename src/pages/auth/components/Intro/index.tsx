import { BottomSheetView } from '@gorhom/bottom-sheet'
import { useNavigation } from '@react-navigation/native'
import { useCallback, useMemo, useRef } from 'react'
import { Dimensions, Image, Text, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import type { ICarouselInstance } from 'react-native-reanimated-carousel'
import Carousel, { Pagination } from 'react-native-reanimated-carousel'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { translate } from '@/core'
import { sleep } from '@/helpers'
import { cn, useAppTheme } from '@/theme'
import { GRID_UNIT } from '@/theme/config/spacing'
import {
  UiBottomSheet,
  UiButton,
  UiHorizontalDivider,
  UiScreenScrollable,
  useUiBottomSheet,
} from '@/ui'
import { BottomSheetHeader } from '@/ui/UiBottomSheet'

import { StepLayout } from './components'

const screenWidth = Dimensions.get('window').width

export default function Intro() {
  const insets = useSafeAreaInsets()

  const { palette } = useAppTheme()

  const ref = useRef<ICarouselInstance>(null)

  const bottomSheet = useUiBottomSheet()
  const progress = useSharedValue<number>(0)
  const navigation = useNavigation()
  const steps = useMemo(() => {
    return [
      {
        title: translate('auth.intro.step-1.title'),
        subtitle: translate('auth.intro.step-1.subtitle'),
        media: (
          <Image
            source={require('@assets/images/bg-welcome-screen.png')}
            resizeMode='contain'
            className='size-[400px] justify-self-center'
          />
        ),
      },
      {
        title: translate('auth.intro.step-2.title'),
        subtitle: translate('auth.intro.step-2.subtitle'),
        media: (
          <Image
            source={require('@assets/images/bg-welcome-screen.png')}
            resizeMode='contain'
            className='size-[400px] justify-self-center'
          />
        ),
      },
    ]
  }, [])

  const handleCreatePK = useCallback(async () => {
    bottomSheet.dismiss()
    await sleep(500) // time for animation finish
    navigation.navigate('Auth', {
      screen: 'CreateWallet',
    })
  }, [bottomSheet, navigation])

  const handleImportPK = useCallback(async () => {
    bottomSheet.dismiss()
    await sleep(500) // time for animation finish
    navigation.navigate('Auth', {
      screen: 'CreateWallet',
      params: {
        isImporting: true,
      },
    })
  }, [bottomSheet, navigation])

  return (
    <UiScreenScrollable style={{ paddingBottom: insets.bottom, paddingTop: insets.top }}>
      <View className='flex flex-1 flex-col justify-center'>
        <Carousel
          ref={ref}
          width={screenWidth}
          data={steps}
          loop={false}
          autoPlay={true}
          autoPlayInterval={5_000}
          pagingEnabled={true}
          onProgressChange={progress}
          renderItem={({ index }) => (
            <StepLayout
              className='flex-1'
              title={steps[index].title}
              subtitle={steps[index].subtitle}
              media={steps[index].media}
            />
          )}
        />
        <View className='mt-6 w-full items-center'>
          <Pagination.Custom<{ color: string }>
            progress={progress}
            data={steps.map(() => ({ color: palette.textPrimary }))}
            dotStyle={{
              width: GRID_UNIT,
              height: GRID_UNIT,
              borderRadius: 999,
              backgroundColor: palette.componentPrimary,
            }}
            activeDotStyle={{
              overflow: 'hidden',
              width: GRID_UNIT * 2,
              height: GRID_UNIT * 2,
              backgroundColor: palette.primaryDark,
            }}
            containerStyle={{
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              height: GRID_UNIT * 5,
              gap: GRID_UNIT * 2,
              backgroundColor: palette.backgroundContainer,
              borderRadius: 999,
              overflow: 'hidden',
              marginBottom: GRID_UNIT * 8,
              paddingHorizontal: GRID_UNIT * 2,
            }}
            horizontal
          />
        </View>
      </View>

      <View className='px-screen-x py-gutter'>
        <UiHorizontalDivider />
      </View>

      <View className='flex flex-col px-screen-x'>
        <UiButton
          className={cn('mb-5 w-full')}
          title={translate('auth.intro.next-btn')}
          size='large'
          onPress={() => {
            bottomSheet.present()
          }}
        />
      </View>

      <UiBottomSheet
        headerComponent={
          <BottomSheetHeader
            title='Authorization'
            dismiss={bottomSheet.dismiss}
            className='typography-h6 px-screen-x text-center text-textPrimary'
          />
        }
        ref={bottomSheet.ref}
        enableDynamicSizing={false}
        snapPoints={['32%']}
        backgroundStyle={{
          backgroundColor: palette.backgroundContainer,
        }}
      >
        <BottomSheetView style={{ paddingBottom: insets.bottom }}>
          <View className={cn('flex flex-col gap-gutter px-screen-x py-0')}>
            <Text className='typography-body3 text-textSecondary'>Choose a preferred method</Text>
            <UiHorizontalDivider />
            <View className='mt-auto flex w-full flex-col gap-2'>
              <UiButton
                size='large'
                leadingIconProps={{ customIcon: 'userPlusIcon' }}
                title='Create a new profile'
                onPress={handleCreatePK}
              />
              <UiButton
                size='large'
                leadingIconProps={{ customIcon: 'share1Icon' }}
                title='Re-activate old profile'
                onPress={handleImportPK}
              />
            </View>
          </View>
        </BottomSheetView>
      </UiBottomSheet>
    </UiScreenScrollable>
  )
}
