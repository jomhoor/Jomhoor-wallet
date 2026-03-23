import type { Language } from './resources'

const EN_TO_FA_DIGIT: Record<string, string> = {
  '0': '۰',
  '1': '۱',
  '2': '۲',
  '3': '۳',
  '4': '۴',
  '5': '۵',
  '6': '۶',
  '7': '۷',
  '8': '۸',
  '9': '۹',
}

/** Replace ASCII digits (0–9) with Persian digits (۰–۹). */
function digitsEnToFa(input: string): string {
  return input.replace(/[0-9]/g, d => EN_TO_FA_DIGIT[d] ?? d)
}

function isPersianLocale(language: string | undefined): boolean {
  if (!language) return false
  return language === 'fa' || language.startsWith('fa-')
}

export const nu = {
  localized: (value: number | string, language: Language | string | undefined) => {
    const s = String(value)
    if (isPersianLocale(language)) {
      return digitsEnToFa(s)
    }
    return s
  },
}
