import type { ProposalMetadata } from '@/pages/app/pages/poll/types'

const isProposalMetadata = (value: unknown): value is ProposalMetadata => {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Partial<ProposalMetadata>

  return (
    typeof metadata.title === 'string' &&
    typeof metadata.description === 'string' &&
    Array.isArray(metadata.acceptedOptions) &&
    metadata.acceptedOptions.every(
      question =>
        question &&
        typeof question.title === 'string' &&
        Array.isArray(question.variants) &&
        question.variants.every(variant => typeof variant === 'string'),
    )
  )
}

export const buildFallbackProposalMetadata = (
  proposalId: number,
  voteResults: readonly (readonly number[])[],
  description: string,
): ProposalMetadata => ({
  title: `Proposal #${proposalId}`,
  description,
  acceptedOptions: voteResults.map((question, questionIndex) => ({
    title: `Question ${questionIndex + 1}`,
    variants: question.map((_, optionIndex) => `Option ${optionIndex + 1}`),
  })),
})

export const parseInlineProposalMetadata = (cid: string): ProposalMetadata | null => {
  try {
    const parsed: unknown = JSON.parse(cid)
    return isProposalMetadata(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const validateProposalMetadata = (value: unknown): ProposalMetadata | null =>
  isProposalMetadata(value) ? value : null
