import { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppStackScrollLayout } from '@/pages/app/components/app-stack-scroll-layout'
import { cn, useAppTheme } from '@/theme'
import {
  UiActionCard,
  UiBottomSheet,
  UiButton,
  UiCard,
  UiHorizontalDivider,
  UiIcon,
  useUiBottomSheet,
} from '@/ui'

export default function DocumentsWithoutDocs() {
  const { t } = useTranslation()
  const { palette } = useAppTheme()

  const insets = useSafeAreaInsets()

  const aboutAppBottomSheet = useUiBottomSheet()
  const startScanBottomSheet = useUiBottomSheet()

  const navigation = useNavigation()

  return (
    <AppStackScrollLayout
      title={t('home.documents')}
      contentWrapperClassName='flex-1 justify-center gap-5'
    >
      <UiCard>
        <UiIcon customIcon='starFillIcon' className='m-auto mb-5 size-[110] color-primaryMain' />
        <View className='flex flex-col gap-2'>
          <Text className='typography-h6 text-center text-textPrimary' style={{ lineHeight: 36 }}>
            {t('home.documents-without-docs.title')}
          </Text>
          <Text className='typography-body3 text-center text-textPrimary'>
            {t('home.documents-without-docs.subtitle')}
          </Text>
        </View>

        <UiHorizontalDivider className='my-5' />

        <UiButton
          className='w-full'
          size='large'
          title={t('home.documents-without-docs.start-btn')}
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
        title={t('home.documents-without-docs.about-app-card-title')}
        subtitle={t('home.documents-without-docs.about-app-card-subtitle')}
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
          <View className={cn('flex flex-col items-center gap-gutter px-screen-x py-0')}>
            <UiIcon customIcon='infoIcon' className='size-[80] text-primaryMain' />

            <Text className='typography-h5 text-textPrimary' style={{ lineHeight: 42 }}>
              {t('home.documents-without-docs.about-app-sheet-title')}
            </Text>

            <UiHorizontalDivider className='my-4' />

            <Text className='typography-body2 text-textSecondary' style={{ textAlign: 'left' }}>
              {t('home.documents-without-docs.about-app-p1')}
            </Text>

            <Text className='typography-body2 text-textSecondary' style={{ textAlign: 'left' }}>
              {t('home.documents-without-docs.about-app-p2')}
            </Text>
            <Text className='typography-body2 text-textSecondary' style={{ textAlign: 'left' }}>
              {t('home.documents-without-docs.about-app-p3')}
            </Text>

            <UiButton
              className='mt-auto w-full'
              title={t('home.documents-without-docs.ok-btn')}
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
          <View className={cn('flex flex-col items-center gap-gutter px-screen-x py-0')}>
            <UiIcon customIcon='infoIcon' className='size-[80] text-primaryMain' />

            <Text className='typography-h5 text-textPrimary' style={{ lineHeight: 42 }}>
              {t('home.documents-without-docs.start-scan-sheet-title')}
            </Text>

            <UiHorizontalDivider className='my-4' />

            <Text className='typography-body2 text-textSecondary' style={{ textAlign: 'left' }}>
              {t('home.documents-without-docs.about-app-p1')}
            </Text>

            <Text className='typography-body2 text-textSecondary' style={{ textAlign: 'left' }}>
              {t('home.documents-without-docs.about-app-p2')}
            </Text>
            <Text className='typography-body2 text-textSecondary' style={{ textAlign: 'left' }}>
              {t('home.documents-without-docs.about-app-p3')}
            </Text>

            <UiButton
              className='mt-auto w-full'
              title={t('home.documents-without-docs.ok-btn')}
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
    </AppStackScrollLayout>
  )
}
