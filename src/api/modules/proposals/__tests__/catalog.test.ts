import {
  buildFallbackProposalMetadata,
  parseInlineProposalMetadata,
} from '../metadata'

describe('proposal catalog metadata', () => {
  it('parses valid inline proposal metadata', () => {
    expect(
      parseInlineProposalMetadata(
        JSON.stringify({
          title: 'Proposal',
          description: 'Description',
          acceptedOptions: [{ title: 'Question', variants: ['Yes', 'No'] }],
        }),
      ),
    ).toMatchObject({ title: 'Proposal' })
  })

  it('rejects malformed inline metadata and builds question-compatible fallbacks', () => {
    expect(parseInlineProposalMetadata('{"title":"missing fields"}')).toBeNull()
    expect(buildFallbackProposalMetadata(7, [[0, 0], [0, 0, 0]], 'cid')).toMatchObject({
      title: 'Proposal #7',
      acceptedOptions: [
        { title: 'Question 1', variants: ['Option 1', 'Option 2'] },
        { title: 'Question 2', variants: ['Option 1', 'Option 2', 'Option 3'] },
      ],
    })
  })
})
