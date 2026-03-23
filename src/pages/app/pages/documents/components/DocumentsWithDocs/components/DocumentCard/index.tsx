import { Time, time } from '@distributedlab/tools'
import { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import { BlurView } from 'expo-blur'
import { Image } from 'expo-image'
import { startCase } from 'lodash'
import get from 'lodash/get'
import { type ComponentProps, useCallback, useMemo, useState } from 'react'
import type { ImageBackgroundProps, PressableProps, TextProps, ViewProps } from 'react-native'
import { StyleSheet } from 'react-native'
import { ImageBackground } from 'react-native'
import { Pressable } from 'react-native'
import { Text, View } from 'react-native'
import type { StyleProp } from 'react-native/Libraries/StyleSheet/StyleSheet'
import type { ViewStyle } from 'react-native/Libraries/StyleSheet/StyleSheetTypes'
import { ScrollView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { formatDateDMY } from '@/helpers'
import { uiPreferencesStore } from '@/store'
import { IdentityItem } from '@/store/modules/identity/Identity'
import { cn, useAppTheme } from '@/theme'
import { UiSwitcher } from '@/ui'
import { UiBottomSheet, useUiBottomSheet } from '@/ui'
import { UiHorizontalDivider, UiIcon } from '@/ui'
import { BottomSheetHeader } from '@/ui/UiBottomSheet'

type Props = {
  identity: IdentityItem
}

export default function DocumentCard({ identity }: Props) {
  const { palette } = useAppTheme()

  const [isCardLongPressed, setIsCardLongPressed] = useState(false)

  const {
    uiVariants,
    personalDetailsShownVariants,
    documentCardUi,
    setDocumentCardUi,
    togglePersonalDetailsVisibility,
    toggleIsBlurred,
  } = uiPreferencesStore.useDocumentCardUiPreference(
    identity.document.personDetails?.documentNumber ?? '',
  )

  const cardUiSettingsBottomSheet = useUiBottomSheet()

  const insets = useSafeAreaInsets()

  const fullName = useMemo(() => {
    const firstName = identity.document.personDetails?.firstName ?? ''
    const lastName = identity.document.personDetails?.lastName ?? ''
    return `${firstName} ${lastName}`.trim()
  }, [identity.document.personDetails?.firstName, identity.document.personDetails?.lastName])

  const formattedBirthDate = useMemo(() => {
    if (!identity.document.personDetails?.birthDate) return time()
    return time(identity.document.personDetails?.birthDate, 'YYMMDD')
  }, [identity.document.personDetails?.birthDate])

  const age = useMemo(() => {
    if (!identity.document.personDetails?.birthDate) return 0
    return time().diff(formattedBirthDate, 'years')
  }, [formattedBirthDate, identity.document.personDetails?.birthDate])

  const Container = useCallback(
    ({ docCardUI, ...containerRest }: { docCardUI } & (ViewProps | ImageBackgroundProps)) => {
      if (get(docCardUI.background, 'source.uri')) {
        const imageBackgroundProps = docCardUI.background as ImageBackgroundProps

        return (
          <ImageBackground
            {...containerRest}
            {...imageBackgroundProps}
            style={StyleSheet.flatten([imageBackgroundProps.style, containerRest.style])}
          />
        )
      }

      const viewProps = docCardUI.background as ViewProps

      return (
        <View
          {...viewProps}
          {...containerRest}
          style={StyleSheet.flatten([viewProps.style, containerRest.style])}
        />
      )
    },
    [],
  )

  return (
    <>
      <Container className='relative overflow-hidden rounded-3xl p-6' docCardUI={documentCardUi}>
        <View className='flex flex-row'>
          <View className='flex gap-6'>
            {identity.document.personDetails?.passportImageRaw ? (
              <Image
                style={{ width: 56, height: 56, borderRadius: 9999 }}
                source={{
                  uri: `data:image/png;base64,${identity.document.personDetails.passportImageRaw}`,
                }}
              />
            ) : (
              <UiIcon
                size={56}
                customIcon='userIcon'
                color={documentCardUi.foregroundValues.style.color}
              />
            )}

            <View className='flex gap-2'>
              <Text {...documentCardUi.foregroundValues} className='typography-h6 text-textPrimary'>
                {fullName}
              </Text>
              {identity.document.personDetails?.birthDate && (
                <Text
                  {...documentCardUi.foregroundLabels}
                  className='typography-body3 text-textSecondary'
                >
                  Years old {age}
                </Text>
              )}
            </View>
          </View>
        </View>
        <View className='absolute right-gutter top-gutter z-20 flex flex-row items-center gap-gutter'>
          <CardActionIconButton
            iconComponentNameProps={{
              customIcon: documentCardUi.isBlurred ? 'eyeSlashIcon' : 'eyeIcon',
            }}
            pressableProps={{
              onPress: toggleIsBlurred,
            }}
          />
          <CardActionIconButton
            iconComponentNameProps={{ customIcon: 'dotsThreeOutlineIcon' }}
            pressableProps={{
              onPress: () => {
                cardUiSettingsBottomSheet.present()
              },
            }}
          />
        </View>
        <UiHorizontalDivider className='mb-6 mt-8' />

        <View className='flex w-full gap-4'>
          {documentCardUi.personalDetailsShown?.map((el, idx) => {
            const detailValue =
              identity.document.personDetails?.[el as keyof typeof identity.document.personDetails]
            if (detailValue === undefined || detailValue === null || detailValue === '') {
              return null
            }
            if (el === 'expiryDate') {
              return (
                <DocumentCardRow
                  key={idx}
                  labelProps={{
                    ...documentCardUi.foregroundLabels,
                    children: 'Expiry date',
                  }}
                  valueProps={{
                    ...documentCardUi.foregroundValues,
                    children: formatDateDMY(new Time(detailValue)),
                  }}
                />
              )
            }
            return (
              <DocumentCardRow
                key={idx}
                labelProps={{
                  ...documentCardUi.foregroundLabels,
                  children: startCase(el),
                }}
                valueProps={{
                  ...documentCardUi.foregroundValues,
                  children: detailValue,
                }}
              />
            )
          })}
        </View>

        {documentCardUi.isBlurred && (
          <Pressable
            onLongPress={() => {
              setIsCardLongPressed(true)
            }}
            onPressOut={() => {
              setIsCardLongPressed(false)
            }}
            className={cn(
              'absolute bottom-0 left-0 right-0 top-0 z-10',
              isCardLongPressed && 'opacity-0',
            )}
          >
            <BlurView
              experimentalBlurMethod='dimezisBlurView'
              intensity={35}
              className='size-full'
            />
          </Pressable>
        )}
      </Container>

      <UiBottomSheet
        ref={cardUiSettingsBottomSheet.ref}
        headerComponent={
          <BottomSheetHeader
            title='Settings'
            dismiss={cardUiSettingsBottomSheet.dismiss}
            className='px-screen-x'
          />
        }
        backgroundStyle={{
          backgroundColor: palette.backgroundContainer,
        }}
        snapPoints={['55%']}
      >
        <UiHorizontalDivider />
        <BottomSheetScrollView style={{ paddingBottom: insets.bottom }}>
          <View className={cn('flex flex-col gap-gutter px-screen-x py-gutter pb-10')}>
            <View className={cn('flex flex-col gap-4')}>
              <Text className='typography-subtitle4 text-textPrimary'>Card visual</Text>

              <ScrollView horizontal={true}>
                <View className='flex flex-row gap-6 pb-4'>
                  {uiVariants.map((el, idx) => {
                    const isActive = documentCardUi.key === el.key

                    return (
                      <Pressable
                        key={idx}
                        onPress={() =>
                          setDocumentCardUi({
                            ...el,
                            personalDetailsShown: documentCardUi.personalDetailsShown,
                            isBlurred: documentCardUi.isBlurred,
                          })
                        }
                      >
                        <View
                          className={cn(
                            'items-center gap-2 rounded-lg border border-solid border-componentPrimary px-[24] py-[16]',
                            isActive && 'border-textPrimary',
                          )}
                        >
                          <Container
                            docCardUI={el}
                            style={{
                              width: 64,
                              height: 48,
                              borderRadius: 8,
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              gap: 4,
                              ...el.background,
                            }}
                          >
                            <View
                              style={[
                                el.foregroundLabels.style as StyleProp<ViewStyle>,
                                {
                                  backgroundColor: get(
                                    el.foregroundLabels.style,
                                    'color',
                                    palette.baseWhite,
                                  ),
                                  width: 12,
                                  height: 12,
                                  borderRadius: 9999,
                                },
                              ]}
                            />
                            {[0, 0].map((_, index) => (
                              <View
                                key={index}
                                style={[
                                  {
                                    backgroundColor: get(
                                      el.foregroundValues.style,
                                      'color',
                                      palette.baseWhite,
                                    ),
                                    width: 24,
                                    height: 5,
                                    borderRadius: 12,
                                  },
                                  el.foregroundValues.style as StyleProp<ViewStyle>,
                                ]}
                              />
                            ))}
                          </Container>
                          {/* <Text className='typography-buttonMedium text-textPrimary'>
                            {el.title}
                          </Text> */}
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              </ScrollView>
            </View>

            <UiHorizontalDivider />

            <View className={cn('flex flex-col gap-2')}>
              <View className={cn('flex flex-col gap-1')}>
                <Text className='typography-subtitle4 text-textPrimary'>Data</Text>
                <Text className='typography-body4 text-textSecondary'>
                  Shows two identifiers on the card
                </Text>
              </View>

              <View className='flex flex-col gap-1'>
                {personalDetailsShownVariants.map((el, idx) => (
                  <View key={idx} className='flex flex-row items-center justify-between'>
                    <Text className='typography-subtitle4 text-textPrimary'>{startCase(el)}</Text>
                    <UiSwitcher
                      value={documentCardUi.personalDetailsShown?.includes(el)}
                      onValueChange={() => togglePersonalDetailsVisibility(el)}
                    />
                  </View>
                ))}
              </View>
            </View>
          </View>
        </BottomSheetScrollView>
      </UiBottomSheet>
    </>
  )
}

function DocumentCardRow({
  labelProps,
  valueProps,
  className,
  ...rest
}: {
  labelProps: TextProps
  valueProps: TextProps
} & ViewProps) {
  return (
    <View {...rest} className={cn('flex w-full flex-row items-center justify-between', className)}>
      <Text
        {...labelProps}
        className={cn('typography-body3 text-textSecondary', labelProps.className)}
      />
      <Text
        {...valueProps}
        className={cn('typography-subtitle4 text-textPrimary', valueProps.className)}
      />
    </View>
  )
}

function CardActionIconButton({
  iconComponentNameProps,
  viewProps,
  pressableProps,
}: {
  iconComponentNameProps: ComponentProps<typeof UiIcon>
} & {
  viewProps?: ViewProps
  pressableProps?: PressableProps
}) {
  return (
    <Pressable {...pressableProps}>
      <View
        {...viewProps}
        className={cn(
          'flex size-[36] items-center justify-center rounded-full',
          viewProps?.className,
        )}
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.15)',
        }}
      >
        <UiIcon
          {...iconComponentNameProps}
          className={cn('size-[18] text-baseWhite', iconComponentNameProps.className)}
        />
      </View>
    </Pressable>
  )
}
