import { useNavigation } from '@react-navigation/core'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiCard, UiIcon } from '@/ui'
import { DocType } from '@/utils/e-document'

export default function SelectDocTypeStep() {
  const { t } = useTranslation()
  const { setDocType } = useDocumentScanContext()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()

  return (
    <View
      className='flex flex-1 flex-col'
      style={{
        paddingTop: insets.top,
      }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className='flex flex-1 flex-col gap-4 p-5'>
          <View className='flex-row items-center'>
            <Pressable
              onPress={() => {
                navigation.navigate('App', { screen: 'Home' })
              }}
            >
              <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
                <UiIcon customIcon='arrowLeftIcon' size={20} className='color-textPrimary' />
              </View>
            </Pressable>
          </View>

          <Text
            className='typography-h4 my-4 text-center text-textPrimary'
            style={{ lineHeight: 52 }}
          >
            {t('tabs.select-doc-type.title')}
          </Text>

          <View className='flex flex-col gap-5'>
            <Pressable
              onPress={() => {
                setDocType(DocType.PASSPORT)
              }}
            >
              <UiCard className='flex flex-row items-center gap-2'>
                <UiIcon customIcon='suitcaseSimpleIcon' className='text-textPrimary' />
                <Text
                  className='typography-subtitle4 text-textPrimary'
                  style={{ textAlign: 'left' }}
                >
                  {t('tabs.select-doc-type.passport')}
                </Text>
              </UiCard>
            </Pressable>

            <Pressable
              onPress={() => {
                setDocType(DocType.ID)
              }}
            >
              <UiCard className='flex flex-row items-center gap-2'>
                <UiIcon customIcon='cardholderIcon' className='text-textPrimary' />
                <Text
                  className='typography-subtitle4 text-textPrimary'
                  style={{ textAlign: 'left' }}
                >
                  {t('tabs.select-doc-type.id-card')}
                </Text>
              </UiCard>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
