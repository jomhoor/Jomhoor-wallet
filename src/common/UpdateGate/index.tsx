// Renders nothing when the app is up to date.
// Shows a dismissible banner ("soft") or a blocking full-screen ("hard")
// based on the manifest at https://jomhoor.org/wallet/latest.json.

import { Linking, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getLanguage } from '@/core/localization/utils'
import { useUpdateCheck } from '@/hooks'
import { UiButton, UiIcon, UiModal } from '@/ui'

type Copy = {
  softTitle: string
  softBody: (latest: string) => string
  hardTitle: string
  hardBody: (latest: string) => string
  updateBtn: string
  laterBtn: string
}

const COPY: Record<'fa' | 'en', Copy> = {
  en: {
    softTitle: 'Update available',
    softBody: latest => `A new version (${latest}) is available. Update for the latest fixes.`,
    hardTitle: 'Update required',
    hardBody: latest =>
      `This version is no longer supported. Please update to ${latest} to keep using the app.`,
    updateBtn: 'Update',
    laterBtn: 'Later',
  },
  fa: {
    softTitle: 'نسخه‌ی جدید موجود است',
    softBody: latest => `نسخه‌ی جدید (${latest}) منتشر شده است. برای دریافت آخرین به‌روزرسانی‌ها اپ را به‌روز کنید.`,
    hardTitle: 'به‌روزرسانی الزامی',
    hardBody: latest =>
      `این نسخه‌ی اپ دیگر پشتیبانی نمی‌شود. لطفاً به نسخه‌ی ${latest} ارتقا دهید.`,
    updateBtn: 'به‌روز کردن',
    laterBtn: 'بعداً',
  },
}

export default function UpdateGate() {
  const { state, dismissSoft } = useUpdateCheck()
  const insets = useSafeAreaInsets()
  const lang = getLanguage() === 'fa' ? 'fa' : 'en'
  const c = COPY[lang]

  if (state.status === 'ok') return null

  const openStore = () => {
    void Linking.openURL(state.url)
  }

  if (state.status === 'hard') {
    // Full-screen blocker. No dismiss path.
    return (
      <View
        style={{
          paddingTop: insets.top + 48,
          paddingBottom: insets.bottom + 24,
        }}
        className='z-modal absolute inset-0 flex-1 items-center justify-center gap-6 bg-backgroundPrimary px-6'
      >
        <UiIcon customIcon='lockIcon' className='size-16 text-errorMain' />
        <Text className='typography-h3 text-center text-textPrimary'>{c.hardTitle}</Text>
        <Text className='typography-body2 text-center text-textSecondary'>
          {c.hardBody(state.latest)}
        </Text>
        {state.releaseNotes ? (
          <Text className='typography-bodySmall text-center text-textSecondary'>
            {state.releaseNotes}
          </Text>
        ) : null}
        <UiButton title={c.updateBtn} onPress={openStore} />
      </View>
    )
  }

  // Soft: dismissible modal.
  return (
    <UiModal visible={true} onRequestClose={dismissSoft}>
      <View className='w-[320px] gap-4 rounded-2xl bg-backgroundContainer p-6'>
        <Text className='typography-h4 text-textPrimary'>{c.softTitle}</Text>
        <Text className='typography-body2 text-textSecondary'>{c.softBody(state.latest)}</Text>
        {state.releaseNotes ? (
          <Text className='typography-bodySmall text-textSecondary'>{state.releaseNotes}</Text>
        ) : null}
        <View className='flex-row justify-end gap-3'>
          <UiButton title={c.laterBtn} variant='text' onPress={dismissSoft} />
          <UiButton title={c.updateBtn} onPress={openStore} />
        </View>
      </View>
    </UiModal>
  )
}
