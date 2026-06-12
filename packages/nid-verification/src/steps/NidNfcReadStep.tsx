import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import type { NidNfcReadResult } from '../types'
import type { NidNfcProbeResult } from '../nfc'
import { NidDemoBanner } from './NidDemoBanner'

function formatNfcDebug(result: NidNfcReadResult): string {
  const debug = result.debug ?? {}
  return JSON.stringify(
    {
      authCertLength: result.authCertHex?.length ?? 0,
      backend: typeof debug.backend === 'string' ? debug.backend : undefined,
      hasAuthCert: Boolean(result.authCertHex),
      hasSigningCert: Boolean(result.signingCertHex),
      mocked: debug.mocked === true,
      readAt: typeof debug.readAt === 'number' ? debug.readAt : undefined,
      signingCertLength: result.signingCertHex?.length ?? 0,
      status: result.status,
    },
    null,
    2,
  )
}

export type NidNfcReadStepProps = {
  stepIndex: number
  totalSteps: number
  busy?: boolean
  blockingErrors?: string[]
  errorMessage?: string
  mismatches?: string[]
  nfcResult?: NidNfcReadResult
  onContinue?: () => void
  onRead: () => void
  onBack: () => void
  onCancel?: () => void
  probeEnabled?: boolean
  probeBusy?: boolean
  probeResult?: NidNfcProbeResult
  onProbe?: () => void
  evidenceLabel?: string
  evidenceSummary?: string
  onEvidenceLabelChange?: (value: string) => void
  onLogEvidence?: () => void
  onClearEvidence?: () => void
  demoMessage?: string
}

export function NidNfcReadStep({
  stepIndex,
  totalSteps,
  busy,
  blockingErrors,
  errorMessage,
  mismatches,
  nfcResult,
  onContinue,
  onRead,
  onBack,
  onCancel,
  probeEnabled,
  probeBusy,
  probeResult,
  onProbe,
  evidenceLabel,
  evidenceSummary,
  onEvidenceLabelChange,
  onLogEvidence,
  onClearEvidence,
  demoMessage,
}: NidNfcReadStepProps): JSX.Element {
  const hasNfcSuccess = nfcResult?.status === 'success'
  const hasBlockingErrors = Boolean(blockingErrors && blockingErrors.length > 0)
  const nfcDebugText = nfcResult ? formatNfcDebug(nfcResult) : undefined

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps='handled'
      nestedScrollEnabled
      style={styles.screen}
    >
      {demoMessage ? <NidDemoBanner message={demoMessage} /> : null}
      <Text style={styles.stepCounter}>{`Step ${stepIndex + 1}/${totalSteps}`}</Text>
      <Text style={styles.title}>Read NID NFC Chip</Text>
      <Text style={styles.subtitle}>
        This step uses the configured NFC reader and validates certificate availability.
      </Text>

      {busy ? <Text style={styles.info}>Reading NFC chip...</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable
        style={[styles.primaryButton, busy ? styles.disabledButton : null]}
        onPress={onRead}
        disabled={busy}
      >
        <Text style={styles.primaryButtonText}>{busy ? 'Reading...' : 'Start NFC Read'}</Text>
      </Pressable>

      {probeEnabled && onProbe ? (
        <>
          <View style={styles.evidenceCard}>
            <Text style={styles.evidenceTitle}>Compatibility evidence</Text>
            <Text style={styles.evidenceHint}>
              Use a non-sensitive label. Do not enter a national ID or card number.
            </Text>
            <TextInput
              autoCapitalize='none'
              autoCorrect={false}
              maxLength={48}
              onChangeText={onEvidenceLabelChange}
              placeholder='nid-generation-sample'
              style={styles.evidenceInput}
              value={evidenceLabel}
            />
            {evidenceSummary ? <Text style={styles.evidenceSummary}>{evidenceSummary}</Text> : null}
            <View style={styles.row}>
              {onLogEvidence ? (
                <Pressable style={styles.evidenceAction} onPress={onLogEvidence}>
                  <Text style={styles.evidenceActionText}>Log matrix</Text>
                </Pressable>
              ) : null}
              {onClearEvidence ? (
                <Pressable style={styles.evidenceAction} onPress={onClearEvidence}>
                  <Text style={styles.evidenceActionText}>Clear evidence</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <Pressable
            style={[styles.probeButton, probeBusy ? styles.disabledButton : null]}
            onPress={onProbe}
            disabled={probeBusy || busy}
          >
            <Text style={styles.probeButtonText}>
              {probeBusy ? 'Running NFC Probe...' : 'Run Development NFC Probe'}
            </Text>
          </Pressable>
        </>
      ) : null}

      {probeResult ? (
        <View style={styles.debugCard}>
          <Text style={styles.debugTitle}>Development Probe Report</Text>
          <ScrollView
            style={styles.probeReportScroll}
            contentContainerStyle={styles.probeReportContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <Text selectable style={styles.debugValue}>
              {JSON.stringify(probeResult, null, 2)}
            </Text>
          </ScrollView>
        </View>
      ) : null}

      {nfcDebugText ? (
        <View style={styles.debugCard}>
          <Text style={styles.debugTitle}>NFC Debug Data</Text>
          <Text style={styles.debugValue}>{nfcDebugText}</Text>
        </View>
      ) : null}

      {mismatches && mismatches.length > 0 ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Mismatches</Text>
          <Text style={styles.warningValue}>{mismatches.join('\n')}</Text>
        </View>
      ) : null}

      {blockingErrors && blockingErrors.length > 0 ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorCardTitle}>Blocking Errors</Text>
          <Text style={styles.errorCardValue}>{blockingErrors.join('\n')}</Text>
        </View>
      ) : null}

      {hasNfcSuccess && onContinue && !hasBlockingErrors ? (
        <Pressable style={styles.primaryButton} onPress={onContinue}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
      ) : null}

      <View style={styles.row}>
        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
        {onCancel ? (
          <Pressable style={styles.secondaryButton} onPress={onCancel}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: 12,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  debugCard: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  debugTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  debugValue: {
    color: '#374151',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 17,
  },
  disabledButton: {
    opacity: 0.6,
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  errorCardTitle: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorCardValue: {
    color: '#991B1B',
    fontSize: 12,
    lineHeight: 17,
  },
  evidenceAction: {
    alignItems: 'center',
    borderColor: '#99F6E4',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 8,
  },
  evidenceActionText: {
    color: '#115E59',
    fontSize: 12,
    fontWeight: '600',
  },
  evidenceCard: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  evidenceHint: {
    color: '#0F766E',
    fontSize: 11,
    lineHeight: 16,
  },
  evidenceInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#5EEAD4',
    borderRadius: 8,
    borderWidth: 1,
    color: '#134E4A',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  evidenceSummary: {
    color: '#115E59',
    fontSize: 12,
  },
  evidenceTitle: {
    color: '#134E4A',
    fontSize: 13,
    fontWeight: '700',
  },
  info: {
    color: '#0F766E',
    fontSize: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    marginTop: 8,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  probeButton: {
    alignItems: 'center',
    borderColor: '#0F766E',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
  },
  probeButtonText: {
    color: '#0F766E',
    fontSize: 14,
    fontWeight: '600',
  },
  probeReportContent: {
    paddingBottom: 8,
  },
  probeReportScroll: {
    maxHeight: 280,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  screen: {
    flex: 1,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#D1D5DB',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '500',
  },
  stepCounter: {
    color: '#6B7280',
    fontSize: 12,
  },
  subtitle: {
    color: '#4B5563',
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '700',
  },
  warningCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  warningTitle: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  warningValue: {
    color: '#92400E',
    fontSize: 12,
    lineHeight: 17,
  },
})
