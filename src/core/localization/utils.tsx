import type TranslateOptions from 'i18next'
import i18n from 'i18next'
import memoize from 'lodash/memoize'
import { useCallback } from 'react'
import { I18nManager } from 'react-native'
import { useMMKVString } from 'react-native-mmkv'

import { storage } from '@/core/storage'
import { setDayjsLocale } from '@/helpers/formatters'

import type { Language, resources } from './resources'
import type { RecursiveKeyOf } from './types'

type DefaultLocale = typeof resources.en.translation
export type TxKeyPath = RecursiveKeyOf<DefaultLocale>

export const LOCAL = 'local'

export const getLanguage = (): Language => (storage.getString(LOCAL) as Language) || 'fa' // 'Marc' getItem<Language | undefined>(LOCAL);

export const translate = memoize(
  (key: TxKeyPath, options = undefined) => i18n.t(key, options) as unknown as string,
  (key: TxKeyPath, options: typeof TranslateOptions) =>
    [i18n.language, key, options ? JSON.stringify(options) : ''].join('|'),
)

export const changeLanguage = (lang: Language) => {
  i18n.changeLanguage(lang)
  if (lang === 'ar' || lang === 'fa') {
    I18nManager.allowRTL(true)
    I18nManager.forceRTL(true)
  } else {
    I18nManager.allowRTL(false)
    I18nManager.forceRTL(false)
  }

  setDayjsLocale(lang)
}

export const useSelectedLanguage = () => {
  const [language, setLang] = useMMKVString(LOCAL)

  const setLanguage = useCallback(
    (lang: Language) => {
      setLang(lang)
      if (lang !== undefined) changeLanguage(lang as Language)
    },
    [setLang],
  )

  return { language: (language as Language) || 'fa', setLanguage }
}
