import ar from './locales/ar.json'
import en from './locales/en.json'
import fa from './locales/fa.json'
import uk from './locales/uk.json'

export const resources = {
  en: { translation: { ...en } },
  fa: { translation: { ...fa } },
  ar: { translation: { ...ar } },
  uk: { translation: { ...uk } },
}

export type Language = keyof typeof resources
