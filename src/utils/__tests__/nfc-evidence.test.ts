import type { NidNfcProbeResult } from '@iland/nid-verification'
import type { PassportNfcReadResult } from '@iland/passport-verification'

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

import {
  appendNfcEvidence,
  buildNfcCompatibilityMatrix,
  clearNfcEvidence,
  createNfcEvidenceExport,
  createNidProbeEvidence,
  createPassportReadEvidence,
  normalizeNfcEvidenceLabel,
} from '../nfc-evidence'

describe('NFC compatibility evidence', () => {
  beforeEach(async () => {
    await clearNfcEvidence()
  })

  it('rejects labels that look like document identifiers', () => {
    expect(normalizeNfcEvidenceLabel('card 1234567890')).toBe('unlabeled-sample')
    expect(normalizeNfcEvidenceLabel('NID Generation B')).toBe('nid-generation-b')
  })

  it('normalizes a redacted NID probe result', () => {
    const result: NidNfcProbeResult = {
      status: 'probe_success',
      platform: 'android',
      sessionId: 'session-sensitive-correlation-id',
      durationMs: 1200,
      selectedProfile: 'pardis-signing',
      detectedStandard: 'iso-dep-iso7816',
      tag: {
        technologies: ['NfcA', 'IsoDep'],
        isoDepSupported: true,
      },
      attempts: [
        {
          profile: 'pardis-signing',
          command: 'select',
          outcome: 'ok',
          durationMs: 20,
          optional: false,
          statusWord: '9000',
        },
      ],
      standardAttempts: [],
    }

    const evidence = createNidProbeEvidence(result, 'generation-b')
    const serialized = JSON.stringify(evidence)

    expect(evidence.runtimeCapabilities).toEqual(['IsoDep', 'NfcA'])
    expect(evidence.statusWords).toEqual(['9000'])
    expect(evidence.readerStrategy).toBe('pardis-signing')
    expect(serialized).not.toContain(result.sessionId)
  })

  it('does not copy passport holder data or raw file payloads', () => {
    const result: PassportNfcReadResult = {
      finalStatus: 'success',
      backend: 'native-ios',
      files: {
        DG1: {
          status: 'ok',
          data: {
            documentNumber: 'SECRET123',
            firstName: 'PRIVATE',
          },
        },
        SOD: {
          status: 'ok',
          data: {
            rawHex: 'DEADBEEF',
          },
        },
      },
      accessControl: {
        method: 'BAC',
      },
      normalized: {
        documentNumber: 'SECRET123',
        firstName: 'PRIVATE',
      },
    }

    const evidence = createPassportReadEvidence(result, 'passport-generation-a')
    const serialized = JSON.stringify(evidence)

    expect(evidence.fullReadSucceeded).toBe(true)
    expect(evidence.fileStatuses).toEqual({ DG1: 'ok', SOD: 'ok' })
    expect(serialized).not.toContain('SECRET123')
    expect(serialized).not.toContain('PRIVATE')
    expect(serialized).not.toContain('DEADBEEF')
  })

  it('aggregates repeated attempts into compatibility rows', () => {
    const base = {
      schemaVersion: 1 as const,
      testLabel: 'generation-b',
      documentFlow: 'nid' as const,
      source: 'read' as const,
      platform: 'android' as const,
      deviceModel: 'test-device',
      osVersion: '26',
      appVersion: '1',
      validation: 'passed' as const,
      probeTechnology: 'iso-dep-iso7816',
      runtimeCapabilities: ['IsoDep'],
      readerStrategy: 'pardis-signing',
      authentication: 'none',
      statusWords: [],
    }
    const matrix = buildNfcCompatibilityMatrix([
      {
        ...base,
        id: '1',
        recordedAt: '2026-06-06T10:00:00.000Z',
        outcome: 'success',
        fullReadSucceeded: true,
        durationMs: 1000,
      },
      {
        ...base,
        id: '2',
        recordedAt: '2026-06-06T10:01:00.000Z',
        outcome: 'failed',
        validation: 'failed',
        fullReadSucceeded: false,
        durationMs: 2000,
        errorCode: 'READ_FAILED',
      },
    ])

    expect(matrix).toHaveLength(1)
    expect(matrix[0]).toMatchObject({
      attemptCount: 2,
      successCount: 1,
      successRate: 0.5,
      medianDurationMs: 1500,
      validatedCount: 1,
    })
  })

  it('persists only normalized evidence records', async () => {
    const result: NidNfcProbeResult = {
      status: 'probe_partial',
      platform: 'ios',
      sessionId: 'must-not-be-stored',
      durationMs: 500,
      detectedStandard: 'iso14443-a-b',
      tag: {
        technologies: ['iso7816'],
        isoDepSupported: true,
      },
      attempts: [],
      standardAttempts: [],
    }

    await appendNfcEvidence(createNidProbeEvidence(result, 'sample-c'))
    const exported = await createNfcEvidenceExport()

    expect(exported.recordCount).toBe(1)
    expect(JSON.stringify(exported)).not.toContain(result.sessionId)
  })
})
