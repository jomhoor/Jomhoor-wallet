import { useAppState } from '@react-native-community/hooks'
import { useNavigation } from '@react-navigation/native'
import { useIsFocused } from '@react-navigation/native'
import { parse } from 'mrz'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { PhotoRecognizer } from 'react-native-vision-camera-text-recognition'

import { bus, DefaultBusEvents, ErrorHandler } from '@/core'
import { useDocumentScanContext } from '@/pages/app/pages/document-scan/ScanProvider'
import { UiButton, UiIcon } from '@/ui'
import { DocType } from '@/utils/e-document'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')
const GUIDE_WIDTH = SCREEN_WIDTH - 40
const GUIDE_HEIGHT = Math.round(GUIDE_WIDTH / 1.42)
const GUIDE_TOP = Math.round((SCREEN_HEIGHT - GUIDE_HEIGHT) / 2)

// ─────────────────────────────────────────────────────────────────────────────
// MRZ utilities
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeMrzLine(raw: string): string {
  return raw
    .replaceAll('«', '<<')
    .replace(/\s/g, '')
    .toUpperCase()
    .replace(/[({[\]})]/g, '<')
    .replace(/[^A-Z0-9<]/g, '')
}

function mrzCheckDigit(s: string): number {
  const weights = [7, 3, 1]
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const val = c === '<' ? 0 : chars.indexOf(c)
    if (val < 0) continue
    sum += val * weights[i % 3]
  }
  return sum % 10
}

const OCR_SUBS: Record<string, string[]> = {
  O: ['0'],
  '0': ['O', 'D', 'Q'],
  I: ['1'],
  '1': ['I', 'L'],
  S: ['5'],
  '5': ['S'],
  B: ['8'],
  '8': ['B'],
  Z: ['2'],
  '2': ['Z'],
  G: ['6'],
  '6': ['G'],
  D: ['0'],
  Q: ['0'],
  L: ['1'],
  W: ['9'],
  '9': ['W'],
  A: ['4'],
  '4': ['A'],
}

function tryFixWithCheckDigit(field: string, expected: number): string | null {
  if (mrzCheckDigit(field) === expected) return field
  for (let i = 0; i < field.length; i++) {
    const subs = OCR_SUBS[field[i]]
    if (!subs) continue
    for (const sub of subs) {
      const fixed = field.substring(0, i) + sub + field.substring(i + 1)
      if (mrzCheckDigit(fixed) === expected) return fixed
    }
  }
  for (let i = 0; i < field.length; i++) {
    const si = OCR_SUBS[field[i]]
    if (!si) continue
    for (const subi of si) {
      for (let j = i + 1; j < field.length; j++) {
        const sj = OCR_SUBS[field[j]]
        if (!sj) continue
        for (const subj of sj) {
          const fixed =
            field.substring(0, i) + subi + field.substring(i + 1, j) + subj + field.substring(j + 1)
          if (mrzCheckDigit(fixed) === expected) return fixed
        }
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// OCR line extraction from ML Kit blocks
// ─────────────────────────────────────────────────────────────────────────────

function extractLinesFromBlocks(blocks: Record<string, unknown>[]): string[] {
  const lines: string[] = []
  if (!Array.isArray(blocks)) return lines
  const sorted = [...blocks].sort((a, b) => {
    const ay = a?.blockFrame?.y ?? 0
    const by = b?.blockFrame?.y ?? 0
    return ay - by
  })
  for (const block of sorted) {
    if (block?.lines && Array.isArray(block.lines)) {
      const sortedLines = [...block.lines].sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) => {
          const ay = (a?.lineFrame as Record<string, number>)?.y ?? 0
          const by = (b?.lineFrame as Record<string, number>)?.y ?? 0
          return ay - by
        },
      )
      for (const line of sortedLines) {
        if (line?.lineText) lines.push(String(line.lineText))
      }
    }
  }
  return lines
}

function mergeAdjacentShortLines(lines: string[], minLen: number): string[] {
  const sanitized = lines.map(sanitizeMrzLine)
  const merged: string[] = []
  let i = 0
  while (i < sanitized.length) {
    let current = sanitized[i]
    while (current.length < minLen && i + 1 < sanitized.length) {
      i++
      current += sanitized[i]
    }
    merged.push(current)
    i++
  }
  return merged
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct MRZ line 2 positional extraction
// Works even when line 1 is too short for the mrz parser (ML Kit drops <<<)
// TD3 line 2: [docNum(9)][docCheck(1)][nationality(3)][dob(6)][dobCheck(1)][sex(1)][expiry(6)][expCheck(1)]...
// ─────────────────────────────────────────────────────────────────────────────

interface DirectMrzResult {
  docNumber: string
  nationality: string
  birthDate: string
  expiryDate: string
  sex: string
  firstName: string
  lastName: string
}

function tryDirectMrzLine2(allLines: string[]): DirectMrzResult | null {
  for (const raw of allLines) {
    const line = sanitizeMrzLine(raw)
    if (line.length < 28) continue

    // Must contain a nationality code (3 uppercase letters) at position 10
    const nat = line.slice(10, 13)
    if (!/^[A-Z]{3}$/.test(nat)) continue

    // Must have a sex indicator at position 20
    const sex = line[20]
    if (sex !== 'M' && sex !== 'F' && sex !== '<') continue

    // Extract fields by position
    const docNum = line.slice(0, 9).replace(/<+$/, '')
    const docCheck = parseInt(line[9], 10)
    const dob = line.slice(13, 19)
    const dobCheck = parseInt(line[19], 10)
    const expiry = line.slice(21, 27)
    const expCheck = parseInt(line[27], 10)

    // Validate: doc# must have letters+digits, dates must be 6 digits
    if (!/^[A-Z0-9]+$/.test(docNum) || docNum.length < 5) continue
    if (!/^\d{6}$/.test(dob)) continue
    if (!/^\d{6}$/.test(expiry)) continue

    // Verify check digits
    const docOk = isNaN(docCheck) || mrzCheckDigit(line.slice(0, 9)) === docCheck
    const dobOk = isNaN(dobCheck) || mrzCheckDigit(dob) === dobCheck
    const expOk = isNaN(expCheck) || mrzCheckDigit(expiry) === expCheck

    if (!docOk || !dobOk || !expOk) continue

    // Try to extract name from line 1 (the line starting with P)
    let firstName = '',
      lastName = ''
    for (const rawL1 of allLines) {
      const l1 = sanitizeMrzLine(rawL1)
      if (l1.startsWith('P') && l1.includes('<<')) {
        const nameField = l1.slice(5).replace(/<+$/, '')
        const parts = nameField.split('<<')
        lastName = (parts[0] ?? '').replace(/</g, ' ').trim()
        firstName = (parts[1] ?? '').replace(/</g, ' ').trim()
        break
      }
    }

    return {
      docNumber: docNum,
      nationality: nat,
      birthDate: dob,
      expiryDate: expiry,
      sex,
      firstName,
      lastName,
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// VIZ (Visual Inspection Zone) field extraction — cross-validates MRZ data
// ─────────────────────────────────────────────────────────────────────────────

interface VizFields {
  docNumber?: string
  dates: string[] // YYMMDD candidates
  names: string[] // capitalized name-like strings
}

/** Extract machine-readable fields from the human-readable VIZ text on the passport page. */
function extractVizFields(allText: string): VizFields {
  const text = allText.toUpperCase()

  // Passport numbers: 1-2 letters followed by 6-8 digits (e.g. W97985688, AB1234567)
  const docNumMatch = text.match(/([A-Z]{1,2}\d{6,8})/)
  const docNumber = docNumMatch?.[1]

  const dates: string[] = []
  const seen = new Set<string>()
  const addDate = (yymmdd: string) => {
    if (seen.has(yymmdd)) return
    // Basic validation: month 01-12, day 01-31
    const mm = parseInt(yymmdd.slice(2, 4))
    const dd = parseInt(yymmdd.slice(4, 6))
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      dates.push(yymmdd)
      seen.add(yymmdd)
    }
  }

  // Pattern 1: DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
  const sep = /(\d{2})[/.-](\d{2})[/.-](\d{4})/g
  let m
  while ((m = sep.exec(text)) !== null) {
    const a = m[1],
      b = m[2],
      c = m[3]
    if (parseInt(c) > 31) {
      // DD/MM/YYYY
      addDate(`${c.slice(2)}${b}${a}`)
    }
  }

  // Pattern 2: YYYY/MM/DD
  const ymd = /(\d{4})[/.-](\d{2})[/.-](\d{2})/g
  while ((m = ymd.exec(text)) !== null) {
    addDate(`${m[1].slice(2)}${m[2]}${m[3]}`)
  }

  // Pattern 3: Bare DDMMYYYY (no separators — common when OCR strips slashes)
  // Look for 8-digit sequences that could be dates
  const bare = /(\d{8})/g
  while ((m = bare.exec(text)) !== null) {
    const s = m[1]
    const dd = parseInt(s.slice(0, 2))
    const mm = parseInt(s.slice(2, 4))
    const yyyy = parseInt(s.slice(4, 8))
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 1900 && yyyy <= 2099) {
      addDate(`${s.slice(6, 8)}${s.slice(2, 4)}${s.slice(0, 2)}`)
    }
  }

  // Capitalized word sequences (potential names)
  const nameMatches = text.match(/[A-Z]{2,}(?:\s+[A-Z]{2,}){0,5}/g) ?? []
  const names = nameMatches.filter(n => n.length > 3)

  return { docNumber, dates, names }
}

// ─────────────────────────────────────────────────────────────────────────────
// MRZ parsers (passport TD3 + ID card TD1)
// ─────────────────────────────────────────────────────────────────────────────

const useMrzParser = (docType: DocType) => {
  const idCardParser = useCallback((lines: string[]) => {
    const possibleMRZLines = lines?.slice(-3)
    if (!possibleMRZLines?.length || possibleMRZLines.length !== 3) return
    const sanitized = possibleMRZLines.map(sanitizeMrzLine)
    sanitized[2] = sanitized[2].padEnd(30, '<').toUpperCase()
    return parse(sanitized, { autocorrect: true })
  }, [])

  const passportParser = useCallback(
    (
      lines: string[],
    ): { result: ReturnType<typeof parse>; line1: string; line2: string } | undefined => {
      const tdLen = 44
      const sanitized = lines.map(sanitizeMrzLine)

      const candidates: number[] = []
      for (let i = 0; i < sanitized.length; i++) {
        if (sanitized[i].length >= 28) candidates.push(i)
      }

      const tryPair = (i1: number, i2: number) => {
        const l1 = sanitized[i1].slice(0, tdLen).padEnd(tdLen, '<')
        const l2 = sanitized[i2].slice(0, tdLen).padEnd(tdLen, '<')
        try {
          const result = parse([l1, l2], { autocorrect: true })
          if (result) return { result, line1: l1, line2: l2 }
        } catch {
          /* invalid pair */
        }
        return undefined
      }

      // Pass 1: pairs starting with P
      for (let i = 0; i < candidates.length - 1; i++) {
        const a = candidates[i],
          b = candidates[i + 1]
        if (b - a > 2 || !sanitized[a].startsWith('P')) continue
        const r = tryPair(a, b)
        if (r) return r
      }
      // Pass 2: any consecutive pair
      for (let i = 0; i < candidates.length - 1; i++) {
        const a = candidates[i],
          b = candidates[i + 1]
        if (b - a > 2) continue
        const r = tryPair(a, b)
        if (r) return r
      }
      return undefined
    },
    [],
  )

  return {
    [DocType.ID]: idCardParser,
    [DocType.PASSPORT]: passportParser,
  }[docType]
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracted data type
// ─────────────────────────────────────────────────────────────────────────────

interface ExtractedData {
  docNumber: string
  birthDate: string
  expiryDate: string
  firstName: string
  lastName: string
  nationality: string
  corrected: boolean
  vizMatch: boolean // whether VIZ text confirmed the MRZ data
  fields: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type StepState = 'camera' | 'processing' | 'result' | 'failed'

function formatDateDisplay(yymmdd: string): string {
  if (yymmdd.length !== 6) return yymmdd
  const yy = yymmdd.slice(0, 2)
  const mm = yymmdd.slice(2, 4)
  const dd = yymmdd.slice(4, 6)
  const year = parseInt(yy, 10) > 30 ? `19${yy}` : `20${yy}`
  return `${dd}/${mm}/${year}`
}

export default function ScanMrzStep() {
  const { docType, setTempMrz } = useDocumentScanContext()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()

  const isFocused = useIsFocused()
  const currentAppState = useAppState()

  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()
  const cameraRef = useRef<Camera>(null)

  const [step, setStep] = useState<StepState>('camera')
  const [progress, setProgress] = useState('')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [extracted, setExtracted] = useState<ExtractedData | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [debugLines, setDebugLines] = useState<string[]>([])

  const mrzParser = useMrzParser(docType ?? DocType.PASSPORT)

  const isActive = useMemo(() => {
    return isFocused && currentAppState === 'active'
  }, [currentAppState, isFocused])

  useEffect(() => {
    if (hasPermission) return
    requestPermission()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addDebug = useCallback((line: string) => {
    setDebugLines(prev => {
      const next = [...prev, line]
      return next.length > 12 ? next.slice(-12) : next
    })
  }, [])

  /** Core extraction: try multiple strategies to get MRZ data, cross-validate with VIZ. */
  const extractFromOcr = useCallback(
    (ocrResult: {
      resultText: string
      blocks?: Record<string, unknown>[]
    }): ExtractedData | null => {
      const fullText = ocrResult.resultText
      const rawLines = fullText.split('\n')

      // Extract VIZ fields for cross-validation and fallback
      const viz = extractVizFields(fullText)
      addDebug(`VIZ: doc=${viz.docNumber ?? 'none'}, dates=[${viz.dates.join(',')}]`)

      // ── Strategy 0: Direct positional extraction from MRZ line 2 ──
      // This works even when line 1 is truncated (ML Kit drops <<< fillers)
      const blockLines = extractLinesFromBlocks(ocrResult.blocks ?? [])
      const allLineSets = [blockLines, rawLines]
      for (const lineSet of allLineSets) {
        const direct = tryDirectMrzLine2(lineSet)
        if (direct) {
          const vizMatch = !!(viz.docNumber && viz.docNumber.includes(direct.docNumber))
          addDebug(
            `Direct MRZ L2: ${direct.docNumber}|${direct.birthDate}|${direct.expiryDate}${vizMatch ? ' [VIZ]' : ''}`,
          )
          return {
            docNumber: direct.docNumber,
            birthDate: direct.birthDate,
            expiryDate: direct.expiryDate,
            firstName: direct.firstName,
            lastName: direct.lastName,
            nationality: direct.nationality,
            corrected: false,
            vizMatch,
            fields: {
              documentNumber: direct.docNumber,
              birthDate: direct.birthDate,
              expirationDate: direct.expiryDate,
              firstName: direct.firstName,
              lastName: direct.lastName,
              nationality: direct.nationality,
              sex: direct.sex,
            },
          }
        }
      }
      const strategies: [string, string[]][] = [
        ['blocks', blockLines],
        ['merged-blocks', blockLines.length > 0 ? mergeAdjacentShortLines(blockLines, 30) : []],
        ['text', rawLines],
        ['merged-text', mergeAdjacentShortLines(rawLines, 30)],
      ]

      // Track the best partial result (MRZ parsed but some check digits failed)
      let bestPartial: {
        label: string
        docNum: string
        dob: string
        expiry: string
        docOk: boolean
        dobOk: boolean
        expiryOk: boolean
        fields: Record<string, unknown>
      } | null = null

      for (const [label, lines] of strategies) {
        if (lines.length === 0) continue

        const sanitized = lines.map(sanitizeMrzLine)
        const mrzLike = sanitized.filter(l => l.length >= 28)
        addDebug(`[${label}] ${lines.length} lines, ${mrzLike.length} MRZ-like`)

        const parseResult = mrzParser(lines)
        if (!parseResult) continue

        const mrzResult = 'result' in parseResult ? parseResult.result : parseResult
        const { fields } = mrzResult

        let docNum = String(fields.documentNumber ?? '')
        let dob = String(fields.birthDate ?? '')
        let expiry = String(fields.expirationDate ?? '')
        const docNumCheck = parseInt(String(fields.documentNumberCheckDigit ?? '-1'), 10)
        const dobCheck = parseInt(String(fields.birthDateCheckDigit ?? '-1'), 10)
        const expiryCheck = parseInt(String(fields.expirationDateCheckDigit ?? '-1'), 10)

        let corrected = false
        if (docNum && docNumCheck >= 0 && mrzCheckDigit(docNum) !== docNumCheck) {
          const fixed = tryFixWithCheckDigit(docNum, docNumCheck)
          if (fixed) {
            docNum = fixed
            corrected = true
          }
        }
        if (dob && dobCheck >= 0 && mrzCheckDigit(dob) !== dobCheck) {
          const fixed = tryFixWithCheckDigit(dob, dobCheck)
          if (fixed) {
            dob = fixed
            corrected = true
          }
        }
        if (expiry && expiryCheck >= 0 && mrzCheckDigit(expiry) !== expiryCheck) {
          const fixed = tryFixWithCheckDigit(expiry, expiryCheck)
          if (fixed) {
            expiry = fixed
            corrected = true
          }
        }

        const docOk =
          docNum.length >= 5 && (docNumCheck < 0 || mrzCheckDigit(docNum) === docNumCheck)
        const dobOk = dob.length === 6 && (dobCheck < 0 || mrzCheckDigit(dob) === dobCheck)
        const expiryOk =
          expiry.length === 6 && (expiryCheck < 0 || mrzCheckDigit(expiry) === expiryCheck)

        // Save partial if doc number is good (best candidate for VIZ repair)
        if (docOk && !bestPartial) {
          bestPartial = {
            label,
            docNum,
            dob,
            expiry,
            docOk,
            dobOk,
            expiryOk,
            fields: { ...fields },
          }
        }

        if (!docOk || !dobOk || !expiryOk) {
          addDebug(`[${label}] check: doc=${docOk} dob=${dobOk} exp=${expiryOk}`)
          continue
        }

        // All check digits pass!
        const vizMatch = !!(viz.docNumber && viz.docNumber.includes(docNum.replace(/<+$/, '')))
        addDebug(
          `[${label}] MRZ OK${corrected ? ' (corrected)' : ''}${vizMatch ? ' [VIZ]' : ''}: ${docNum}|${dob}|${expiry}`,
        )

        const correctedFields = { ...fields }
        if (corrected) {
          correctedFields.documentNumber = docNum
          correctedFields.birthDate = dob
          correctedFields.expirationDate = expiry
        }
        return {
          docNumber: docNum,
          birthDate: dob,
          expiryDate: expiry,
          firstName: String(fields.firstName ?? '')
            .replace(/<+/g, ' ')
            .trim(),
          lastName: String(fields.lastName ?? '')
            .replace(/<+/g, ' ')
            .trim(),
          nationality: String(fields.nationality ?? ''),
          corrected,
          vizMatch,
          fields: correctedFields,
        }
      }

      // ── VIZ fallback: repair failing MRZ fields using VIZ-extracted dates ──
      if (bestPartial && viz.dates.length > 0) {
        addDebug(`VIZ fallback: repairing ${bestPartial.label} with VIZ dates`)
        const { docNum } = bestPartial
        let { dob, expiry, dobOk, expiryOk } = bestPartial
        const dobCheck = parseInt(String(bestPartial.fields.birthDateCheckDigit ?? '-1'), 10)
        const expiryCheck = parseInt(
          String(bestPartial.fields.expirationDateCheckDigit ?? '-1'),
          10,
        )

        // Try each VIZ date as a replacement for failing DOB/expiry
        for (const vizDate of viz.dates) {
          if (!dobOk && dobCheck >= 0) {
            if (mrzCheckDigit(vizDate) === dobCheck) {
              addDebug(`VIZ: DOB ${dob} -> ${vizDate} (check digit match)`)
              dob = vizDate
              dobOk = true
            }
          }
          if (!expiryOk && expiryCheck >= 0) {
            if (mrzCheckDigit(vizDate) === expiryCheck) {
              addDebug(`VIZ: Expiry ${expiry} -> ${vizDate} (check digit match)`)
              expiry = vizDate
              expiryOk = true
            }
          }
        }

        // If check digits still fail, try VIZ dates without check digit validation
        // (MRZ check digit itself may have been misread)
        if (!dobOk && viz.dates.length >= 1) {
          // The earliest date is likely DOB, latest is likely expiry
          const sorted = [...viz.dates].sort()
          dob = sorted[0]
          dobOk = true
          addDebug(`VIZ: using earliest date as DOB: ${dob}`)
        }
        if (!expiryOk && viz.dates.length >= 2) {
          const sorted = [...viz.dates].sort()
          expiry = sorted[sorted.length - 1]
          expiryOk = true
          addDebug(`VIZ: using latest date as expiry: ${expiry}`)
        }

        if (dobOk && expiryOk) {
          addDebug(`VIZ repaired: ${docNum}|${dob}|${expiry}`)
          const correctedFields = { ...bestPartial.fields }
          correctedFields.documentNumber = docNum
          correctedFields.birthDate = dob
          correctedFields.expirationDate = expiry
          return {
            docNumber: docNum,
            birthDate: dob,
            expiryDate: expiry,
            firstName: String(bestPartial.fields.firstName ?? '')
              .replace(/<+/g, ' ')
              .trim(),
            lastName: String(bestPartial.fields.lastName ?? '')
              .replace(/<+/g, ' ')
              .trim(),
            nationality: String(bestPartial.fields.nationality ?? ''),
            corrected: true,
            vizMatch: true,
            fields: correctedFields,
          }
        }
      }

      // ── Last resort: construct entirely from VIZ if we have doc# + 2 dates ──
      if (viz.docNumber && viz.dates.length >= 2) {
        const sorted = [...viz.dates].sort()
        const dob = sorted[0]
        const expiry = sorted[sorted.length - 1]
        addDebug(`VIZ-only fallback: ${viz.docNumber}|${dob}|${expiry}`)
        return {
          docNumber: viz.docNumber,
          birthDate: dob,
          expiryDate: expiry,
          firstName: '',
          lastName: '',
          nationality: '',
          corrected: true,
          vizMatch: true,
          fields: { documentNumber: viz.docNumber, birthDate: dob, expirationDate: expiry },
        }
      }

      // Log what we saw for debugging
      const allSanitized = rawLines.map(sanitizeMrzLine)
      const longLines = allSanitized.filter(l => l.length >= 20)
      if (longLines.length > 0) {
        addDebug('Longest lines:')
        longLines.slice(0, 4).forEach(l => addDebug(`  [${l.length}] ${l.substring(0, 50)}`))
      }

      return null
    },
    [mrzParser, addDebug],
  )

  const onCapture = useCallback(async () => {
    if (!cameraRef.current) return

    // Take the photo BEFORE changing state — switching step unmounts the Camera
    let photo
    try {
      photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(`Failed to capture photo: ${msg}`)
      setStep('failed')
      return
    }

    const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`
    setPhotoUri(uri)
    setStep('processing')
    setProgress('Reading text from photo...')
    setDebugLines([])
    setExtracted(null)
    setErrorMsg('')
    addDebug(`Photo: ${photo.width}x${photo.height}`)

    try {
      const ocrResult = await PhotoRecognizer({ uri })

      if (!ocrResult?.resultText) {
        addDebug('No text detected')
        setStep('failed')
        setErrorMsg(
          'No text found in the photo. Make sure the passport page is well-lit and in focus.',
        )
        return
      }

      const ocrAny = ocrResult as { resultText: string; blocks?: Record<string, unknown>[] }
      const blockCount = ocrAny.blocks?.length ?? 0
      const lineCount = ocrResult.resultText.split('\n').length
      addDebug(`OCR: ${lineCount} lines, ${blockCount} blocks`)

      setProgress('Extracting passport data...')

      const data = extractFromOcr(ocrAny)

      if (data) {
        setExtracted(data)
        setStep('result')
      } else {
        setStep('failed')
        setErrorMsg(
          'Could not read the MRZ (the two lines of <<< text at the bottom). ' +
            'Make sure the entire passport data page is visible and well-lit.',
        )
      }
    } catch (error) {
      ErrorHandler.processWithoutFeedback(error)
      const msg = error instanceof Error ? error.message : String(error)
      addDebug(`Error: ${msg}`)
      setStep('failed')
      setErrorMsg('Failed to process the photo. Please try again.')
    }
  }, [addDebug, extractFromOcr])

  const onConfirm = useCallback(() => {
    if (!extracted) return
    bus.emit(DefaultBusEvents.success, { message: 'MRZ Detected' })
    setTempMrz(extracted.fields)
  }, [extracted, setTempMrz])

  const onRetry = useCallback(() => {
    setStep('camera')
    setPhotoUri(null)
    setExtracted(null)
    setErrorMsg('')
    setProgress('')
    setDebugLines([])
  }, [])

  const docLabel = docType === DocType.ID ? 'ID Card' : 'Passport'

  // ─── Camera screen ───
  if (step === 'camera') {
    return (
      <View style={styles.container}>
        {isActive && hasPermission && device ? (
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isActive}
            photo={true}
          />
        ) : null}

        {/* Guide overlay */}
        <View style={StyleSheet.absoluteFill} pointerEvents='none'>
          <View style={[styles.overlaySection, { height: GUIDE_TOP }]} />
          <View style={styles.overlayMiddleRow}>
            <View style={styles.overlaySide} />
            <View style={styles.guideCutout}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <View style={styles.overlaySide} />
          </View>
          <View style={[styles.overlaySection, { flex: 1 }]} />
        </View>

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={() => navigation.navigate('App', { screen: 'Tabs' })}
            style={styles.backButton}
          >
            <UiIcon customIcon='arrowLeftIcon' size={20} className='color-white' />
          </Pressable>
          <Text style={styles.title}>Scan {docLabel}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Instructions */}
        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionText}>
            Place your {docLabel.toLowerCase()} data page{'\n'}
            inside the frame
          </Text>
          <Text style={styles.hintText}>Make sure the full page is visible and in focus</Text>
        </View>

        {/* Capture button */}
        <View style={[styles.bottomArea, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable onPress={onCapture} style={styles.captureButton}>
            <View style={styles.captureButtonInner} />
          </Pressable>
        </View>

        {/* Permission fallback */}
        {isActive && !hasPermission && (
          <View style={styles.permissionContainer}>
            <UiIcon customIcon='warningIcon' size={48} className='color-white' />
            <Text style={styles.permissionText}>Camera permission required</Text>
            <UiButton onPress={requestPermission} title='Grant Permission' className='mt-4' />
          </View>
        )}
      </View>
    )
  }

  // ─── Processing / Result / Failed screens ───
  return (
    <View className='flex-1' style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Top bar */}
      <View style={styles.resultTopBar}>
        <Text className='typography-h5 text-textPrimary'>
          {step === 'processing'
            ? 'Processing...'
            : step === 'result'
              ? 'Verify Data'
              : 'Scan Failed'}
        </Text>
        <Pressable
          onPress={() => {
            navigation.navigate('App', { screen: 'Tabs' })
          }}
        >
          <View className='h-10 w-10 items-center justify-center rounded-full bg-componentPrimary'>
            <UiIcon customIcon='closeIcon' size={20} className='color-textPrimary' />
          </View>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.resultScroll} showsVerticalScrollIndicator={false}>
        {/* Photo thumbnail */}
        {photoUri && (
          <View style={styles.photoContainer}>
            <Image source={{ uri: photoUri }} style={styles.photoThumb} resizeMode='cover' />
          </View>
        )}

        {/* Processing state */}
        {step === 'processing' && (
          <View style={styles.processingCard}>
            <ActivityIndicator size='large' className='color-primaryMain' />
            <Text className='typography-body2 mt-4 text-center text-textPrimary'>{progress}</Text>
          </View>
        )}

        {/* Result state — show extracted data */}
        {step === 'result' && extracted && (
          <View className='mx-5 rounded-2xl bg-componentPrimary p-4'>
            <Text className='typography-subtitle3 mb-3 text-textPrimary'>
              Extracted Passport Data
            </Text>

            {extracted.vizMatch && (
              <View className='bg-successMain/10 mb-3 rounded-lg px-3 py-2'>
                <Text className='typography-body4 text-successMain'>
                  Data verified against passport text
                </Text>
              </View>
            )}
            {extracted.corrected && (
              <View className='bg-warningMain/10 mb-3 rounded-lg px-3 py-2'>
                <Text className='typography-body4 text-warningMain'>
                  Some characters were auto-corrected
                </Text>
              </View>
            )}

            <DataRow label='Document #' value={extracted.docNumber} mono />
            <DataRow label='Date of Birth' value={formatDateDisplay(extracted.birthDate)} />
            <DataRow label='Expiry Date' value={formatDateDisplay(extracted.expiryDate)} />
            {extracted.firstName ? (
              <DataRow label='Name' value={`${extracted.firstName} ${extracted.lastName}`} />
            ) : null}
            {extracted.nationality ? (
              <DataRow label='Nationality' value={extracted.nationality} />
            ) : null}

            <Text className='typography-body4 mt-3 text-textSecondary'>
              Please verify this matches your passport. If incorrect, retake the photo.
            </Text>
          </View>
        )}

        {/* Failed state */}
        {step === 'failed' && (
          <View className='bg-errorMain/10 mx-4 rounded-xl p-4'>
            <Text className='typography-body2 text-center text-errorMain'>{errorMsg}</Text>
          </View>
        )}

        {/* Debug log */}
        {debugLines.length > 0 && (
          <View style={styles.debugContainer}>
            <Text style={styles.debugTitle}>Debug Log</Text>
            {debugLines.map((line, i) => (
              <Text key={i} style={styles.debugLine} numberOfLines={2}>
                {line}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom buttons */}
      <View style={styles.resultButtons}>
        {step === 'result' && (
          <>
            <UiButton onPress={onConfirm} title='Confirm & Continue' className='w-full' />
            <UiButton
              onPress={onRetry}
              title='Retake Photo'
              variant='outlined'
              className='mt-3 w-full'
            />
          </>
        )}
        {step === 'failed' && <UiButton onPress={onRetry} title='Try Again' className='w-full' />}
      </View>
    </View>
  )
}

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className='flex-row justify-between py-1.5'>
      <Text className='typography-body3 text-textSecondary'>{label}</Text>
      <Text className={`typography-subtitle5 text-textPrimary${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </Text>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  bottomArea: {
    alignItems: 'center',
    bottom: 0,
    left: 0,
    paddingHorizontal: 24,
    position: 'absolute',
    right: 0,
  },
  captureButton: {
    alignItems: 'center',
    borderColor: '#fff',
    borderRadius: 38,
    borderWidth: 4,
    height: 76,
    justifyContent: 'center',
    marginBottom: 8,
    width: 76,
  },
  captureButtonInner: {
    backgroundColor: '#fff',
    borderRadius: 31,
    height: 62,
    width: 62,
  },
  container: {
    backgroundColor: '#000',
    flex: 1,
  },
  corner: {
    borderColor: '#fff',
    height: 24,
    position: 'absolute',
    width: 24,
  },
  cornerBL: {
    borderBottomLeftRadius: 12,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: -1,
    left: -1,
  },
  cornerBR: {
    borderBottomRightRadius: 12,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: -1,
    right: -1,
  },
  cornerTL: { borderLeftWidth: 3, borderTopLeftRadius: 12, borderTopWidth: 3, left: -1, top: -1 },
  cornerTR: {
    borderRightWidth: 3,
    borderTopRightRadius: 12,
    borderTopWidth: 3,
    right: -1,
    top: -1,
  },
  debugContainer: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 10,
  },
  debugLine: {
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
    opacity: 0.6,
  },
  debugTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
    opacity: 0.5,
    textTransform: 'uppercase',
  },
  guideCutout: {
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 12,
    borderWidth: 2,
    height: GUIDE_HEIGHT,
    width: GUIDE_WIDTH,
  },
  hintText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  instructionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'center',
  },
  instructionsContainer: {
    alignItems: 'center',
    left: 0,
    paddingHorizontal: 24,
    position: 'absolute',
    right: 0,
    top: '12%',
  },
  overlayMiddleRow: {
    flexDirection: 'row',
    height: GUIDE_HEIGHT,
  },
  overlaySection: {
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlaySide: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    flex: 1,
  },
  permissionContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  photoContainer: {
    borderRadius: 12,
    height: 180,
    marginBottom: 16,
    marginHorizontal: 20,
    overflow: 'hidden',
  },
  photoThumb: {
    height: '100%',
    width: '100%',
  },
  processingCard: {
    alignItems: 'center',
    marginHorizontal: 20,
    paddingVertical: 40,
  },
  resultButtons: {
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  resultScroll: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  resultTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingBottom: 8,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    top: 0,
  },
})
