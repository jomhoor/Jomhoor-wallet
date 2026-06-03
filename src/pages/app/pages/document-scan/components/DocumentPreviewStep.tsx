import { Time } from '@distributedlab/tools'
import { Image } from 'expo-image'
import { startCase } from 'lodash'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { formatDateDMY } from '@/helpers'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiCard, UiHorizontalDivider, UiIcon, UiScreenScrollable } from '@/ui'
import { EID, EPassport } from '@/utils/e-document'

import DemoModeBanner from './DemoModeBanner'

const buildPassportPortraitUri = (
  portrait: { base64?: string; filePath?: string } | undefined,
  passportImageRaw: string | null,
): string | undefined => {
  if (typeof portrait?.filePath === 'string' && portrait.filePath.length > 0) {
    return portrait.filePath.startsWith('file://') ? portrait.filePath : `file://${portrait.filePath}`
  }

  if (typeof portrait?.base64 === 'string' && portrait.base64.length > 0) {
    return `data:image/jpeg;base64,${portrait.base64}`
  }

  if (typeof passportImageRaw === 'string' && passportImageRaw.length > 0) {
    return `data:image/png;base64,${passportImageRaw}`
  }

  return undefined
}

export default function DocumentPreviewStep() {
  const {
    createIdentity,
    passportMrzBarcode,
    passportNfcDetails,
    tempEDoc,
    verificationMode,
    verificationUserData,
  } = useDocumentScanContext()
  const storedPassport = verificationUserData.document.passport
  const reviewEDoc = tempEDoc ?? storedPassport.nfc?.ePassport
  const reviewPassportNfcDetails = passportNfcDetails ?? storedPassport.nfc
  const reviewPassportBarcode = passportMrzBarcode ?? {
    barcode: storedPassport.mrz?.parsedBarcode,
  }

  const insets = useSafeAreaInsets()

  if (reviewEDoc instanceof EPassport) {
    if (!reviewEDoc?.personDetails) return null

    const { firstName, lastName, passportImageRaw, ...restDetails } = reviewEDoc.personDetails
    const reviewNidn =
      reviewPassportNfcDetails?.normalized?.nidn ?? reviewPassportBarcode?.barcode?.nidn
    const portraitUri = buildPassportPortraitUri(
      reviewPassportNfcDetails?.portrait,
      passportImageRaw,
    )

    return (
      <UiScreenScrollable
        className='pb-20'
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View className='flex-1 flex-col gap-4 p-5'>
          {verificationMode === 'demo' ? (
            <DemoModeBanner message='Demo mode: this preview uses fictional passport details and your session-only live capture.' />
          ) : null}

          <UiCard>
            <View className='flex flex-row'>
              <View className='flex flex-1 flex-col gap-2'>
                <Text className='typography-h6 text-textPrimary'>{`${firstName} ${lastName}`}</Text>
                <Text className='typography-body3 text-textSecondary'>
                  Age: ${restDetails.birthDate} {/* TODO change in the future */}
                </Text>
              </View>

              {portraitUri ? (
                <Image
                  style={{ width: 120, height: 120, borderRadius: 1000 }}
                  source={{ uri: portraitUri }}
                />
              ) : (
                <UiIcon className='color-textPrimary' size={56} customIcon='userIcon' />
              )}
            </View>
          </UiCard>

          <View className='mt-6 flex flex-col gap-4'>
            {reviewNidn ? (
              <View className='flex flex-row items-center justify-between gap-2'>
                <Text className='typography-body3 capitalize text-textSecondary'>
                  National ID Number
                </Text>
                <Text className='typography-subtitle4 text-textPrimary'>{reviewNidn}</Text>
              </View>
            ) : null}
            {restDetails &&
              Object.keys(restDetails).map(key => {
                return (
                  <View key={key} className='flex flex-row items-center justify-between gap-2'>
                    <Text className='typography-body3 capitalize text-textSecondary'>{key}</Text>
                    <Text className='typography-subtitle4 text-textPrimary'>
                      {restDetails?.[key as keyof typeof reviewEDoc.personDetails]}
                    </Text>
                  </View>
                )
              })}
            {/* Only for Testing*/}
            {/* <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>dg1</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc.dg1Bytes.length} length
              </Text>
            </View>

            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>dg11</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc.dg11Bytes?.length} length
              </Text>
            </View>

            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>dg15</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc.dg15Bytes?.length ?? 0} length
              </Text>
            </View>

            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 capitalize text-textPrimary'>signature</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {tempEDoc?.aaSignature?.length ?? 0} length
              </Text>
            </View>*/}
          </View>

          <View className='mt-auto'>
            <UiHorizontalDivider className='my-5' />
            <UiButton title='Generate Proof' onPress={createIdentity} />
          </View>
        </View>
      </UiScreenScrollable>
    )
  }

  if (reviewEDoc instanceof EID) {
    if (!reviewEDoc?.personDetails) {
      return null
    }
    const { firstName, lastName, expiryDate, ...restDetails } = reviewEDoc.personDetails

    return (
      <UiScreenScrollable
        className='pb-20'
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View className='flex-1 flex-col gap-4 p-5'>
          <UiCard>
            <View className='flex flex-row items-center'>
              <View className='flex flex-1 flex-row items-center gap-5'>
                <UiIcon
                  className='color-textPrimary'
                  size={56}
                  customIcon='userIcon'
                  color='textPrimary'
                />
                <Text className='typography-h6 text-textPrimary'>{`${firstName} ${lastName}`}</Text>
              </View>
            </View>
          </UiCard>
          <View className='mt-6 flex flex-col gap-4'>
            <View className='flex flex-row items-center justify-between gap-2'>
              <Text className='typography-body3 text-textSecondary'>Expiry Date</Text>
              <Text className='typography-subtitle4 text-textPrimary'>
                {formatDateDMY(new Time(expiryDate))}
              </Text>
            </View>
            {restDetails &&
              Object.entries(restDetails).map(([key, value]) => {
                return (
                  <View key={key} className='flex flex-row items-center justify-between gap-2'>
                    <Text className='typography-body3 text-textSecondary'>{startCase(key)}</Text>
                    <Text className='typography-subtitle4 text-textPrimary'>
                      {key === 'expiryDate' ? formatDateDMY(new Time(value)) : value}
                    </Text>
                  </View>
                )
              })}
          </View>
          <View className='mt-auto'>
            <UiHorizontalDivider className='my-5' />
            <UiButton title='Generate Proof' onPress={createIdentity} />
          </View>
        </View>
      </UiScreenScrollable>
    )
  }

  return (
    <UiScreenScrollable
      className='flex-1 items-center justify-center'
      style={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <Text className='typography-title1 text-textPrimary'>Document Preview</Text>
      <Text className='typography-body2 mt-2 text-textPrimary'>
        Document preview is not available for this document type.
      </Text>
    </UiScreenScrollable>
  )
}
