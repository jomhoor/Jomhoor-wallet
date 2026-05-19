// New-release detection.
//
// Fetches a small static manifest from jomhoor.org and decides whether the
// current wallet binary is:
//   - up to date          → status: 'ok'
//   - behind `latest`     → status: 'soft' (dismissible "Update available" banner)
//   - below `minSupported`→ status: 'hard' (blocking screen, no dismiss)
//
// The manifest is fetched best-effort: any network/parse error is silently
// treated as 'ok' so a brief outage cannot brick app launch.

import Constants from 'expo-constants'
import { useCallback, useEffect, useState } from 'react'
import { AppState, Platform } from 'react-native'

import { storage } from '@/core'

const MANIFEST_URL = 'https://jomhoor.org/wallet/latest.json'
const FETCH_TIMEOUT_MS = 3000
const FOREGROUND_RECHECK_MS = 6 * 60 * 60 * 1000 // 6h
const DISMISSED_KEY = 'updateCheck.dismissedVersion'

type Platform_ = 'ios' | 'android'

type ManifestPlatform = {
  latest: string
  minSupported: string
  url: string
}

type Manifest = {
  ios: ManifestPlatform
  android: ManifestPlatform
  releaseNotes?: Record<string, string>
}

export type UpdateStatus =
  | { status: 'ok' }
  | {
      status: 'soft' | 'hard'
      current: string
      latest: string
      url: string
      releaseNotes?: string
    }

/** Compare two dot-separated version strings. Non-numeric segments compare as 0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0)
  const pb = b.split('.').map(s => parseInt(s, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da < db ? -1 : 1
  }
  return 0
}

function currentVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0'
}

async function fetchManifest(): Promise<Manifest | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(MANIFEST_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return (await res.json()) as Manifest
  } catch {
    return null
  }
}

function evaluate(manifest: Manifest | null): UpdateStatus {
  if (!manifest) return { status: 'ok' }
  const os = (Platform.OS === 'ios' ? 'ios' : 'android') as Platform_
  const entry = manifest[os]
  if (!entry?.latest || !entry?.minSupported || !entry?.url) {
    return { status: 'ok' }
  }
  const current = currentVersion()
  const releaseNotes = manifest.releaseNotes?.en

  if (compareVersions(current, entry.minSupported) < 0) {
    return {
      status: 'hard',
      current,
      latest: entry.latest,
      url: entry.url,
      releaseNotes,
    }
  }
  if (compareVersions(current, entry.latest) < 0) {
    // Honor user's previous "Later" dismissal for THIS exact latest version.
    const dismissed = storage.getString(DISMISSED_KEY)
    if (dismissed === entry.latest) return { status: 'ok' }
    return {
      status: 'soft',
      current,
      latest: entry.latest,
      url: entry.url,
      releaseNotes,
    }
  }
  return { status: 'ok' }
}

export function useUpdateCheck(): {
  state: UpdateStatus
  dismissSoft: () => void
} {
  const [state, setState] = useState<UpdateStatus>({ status: 'ok' })

  const run = useCallback(async () => {
    const manifest = await fetchManifest()
    setState(evaluate(manifest))
  }, [])

  useEffect(() => {
    void run()

    let lastCheckedAt = Date.now()
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active' && Date.now() - lastCheckedAt > FOREGROUND_RECHECK_MS) {
        lastCheckedAt = Date.now()
        void run()
      }
    })
    return () => sub.remove()
  }, [run])

  const dismissSoft = useCallback(() => {
    if (state.status === 'soft') {
      storage.set(DISMISSED_KEY, state.latest)
      setState({ status: 'ok' })
    }
  }, [state])

  return { state, dismissSoft }
}
