import { getMapMarkers, getProposalMapPolicy } from '../client'

describe('map API mock backend client', () => {
  it('loads seeded policies through the Phase 2 endpoint boundary', async () => {
    await expect(getProposalMapPolicy('1')).resolves.toMatchObject({
      proposalId: '1',
      location: { mode: 'optional' },
    })
    await expect(getProposalMapPolicy('2')).resolves.toMatchObject({
      proposalId: '2',
      location: { mode: 'required' },
    })
    await expect(getProposalMapPolicy('3')).resolves.toMatchObject({
      proposalId: '3',
      location: { mode: 'disabled' },
    })
  })

  it('loads privacy-safe seeded markers through GET /v1/map/markers', async () => {
    const markers = await getMapMarkers({ proposalId: '1', questionIndex: 0 })

    expect(markers.length).toBeGreaterThan(0)
    expect(markers.every(marker => marker.totalMappedVotes >= 5)).toBe(true)
    expect(JSON.stringify(markers)).not.toContain('nullifier')
    expect(JSON.stringify(markers)).not.toContain('transactionHash')
  })
})
