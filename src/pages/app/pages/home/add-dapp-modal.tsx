import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, Text, TextInput, View } from 'react-native'

import { useAppTheme } from '@/theme'

export interface AddDappModalProps {
  readonly visible: boolean
  readonly onRequestClose: () => void
}

export function AddDappModal({ visible, onRequestClose }: AddDappModalProps) {
  const { t } = useTranslation()
  const { palette } = useAppTheme()
  const [urlText, setUrlText] = useState('')

  useEffect(() => {
    if (!visible) {
      setUrlText('')
    }
  }, [visible])

  return (
    <Modal visible={visible} transparent animationType='slide' onRequestClose={onRequestClose}>
      <Pressable
        className='flex-1 items-center justify-center bg-black/50'
        onPress={onRequestClose}
      >
        <Pressable
          className='mx-6 w-5/6 rounded-2xl bg-backgroundPrimary p-6'
          onPress={e => e.stopPropagation()}
        >
          <Text className='mb-4 text-lg font-semibold text-textPrimary'>{t('home.add-dapp')}</Text>
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
            <Pressable onPress={onRequestClose} className='rounded-xl px-5 py-2.5'>
              <Text className='text-textSecondary'>{t('home.cancel')}</Text>
            </Pressable>
            <Pressable onPress={onRequestClose} className='rounded-xl bg-primaryMain px-5 py-2.5'>
              <Text className='font-medium text-baseWhite'>{t('home.add')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
