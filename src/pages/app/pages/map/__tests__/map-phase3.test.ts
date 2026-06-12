/// <reference types="jest" />

import fs from 'fs'
import path from 'path'

import {
  MAP_CELL_SCHEME,
  MAP_CONTRACT_VERSION,
  type MapMarker,
} from '@/api/modules/map'
import { ProposalStatus } from '@/pages/app/pages/poll/types'

import { offsetCoordinateForMapPrivacy } from '../expoMapAdapter'
import {
  getInitialMapRegion,
  getMapMarkerColor,
  mergeMapCatalogMetadata,
  shouldLoadMapMarkers,
} from '../utils'

const mapScreenSource = fs.readFileSync(path.join(__dirname, '..', 'index.tsx'), 'utf8')
const nativeCanvasSource = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'MapCanvas.native.tsx'),
  'utf8',
)
const homeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'home', 'index.tsx'),
  'utf8',
)
const appNavigatorSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'index.tsx'),
  'utf8',
)

const marker = (overrides: Partial<MapMarker> = {}): MapMarker => ({
  contractVersion: MAP_CONTRACT_VERSION,
  proposalId: '1',
  questionIndex: 0,
  cellScheme: MAP_CELL_SCHEME,
  cellId: 'cell-1',
  cellResolution: 6,
  parentCellId: 'parent',
  latitude: 35.7,
  longitude: 51.4,
  totalMappedVotes: 10,
  optionBreakdown: [
    { optionIndex: 0, count: 6, percentage: 0.6 },
    { optionIndex: 1, count: 4, percentage: 0.4 },
  ],
  breakdownSuppressed: false,
  privacy: {
    thresholdK: 5,
    policyVersion: 1,
    mergedCellCount: 1,
    maxMergeDepth: 0,
    publicationWindowSeconds: 900,
  },
  ...overrides,
})

const distanceMeters = (
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) => {
  const radians = (value: number) => (value * Math.PI) / 180
  const latitudeDistance = radians(right.latitude - left.latitude)
  const longitudeDistance = radians(right.longitude - left.longitude)
  const a =
    Math.sin(latitudeDistance / 2) ** 2 +
    Math.cos(radians(left.latitude)) *
      Math.cos(radians(right.latitude)) *
      Math.sin(longitudeDistance / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

describe('Phase 3 read-only map', () => {
  it('registers Map directly after Proposals on Home and in the app navigator', () => {
    const proposalsPosition = homeSource.indexOf("route: 'Proposals'")
    const mapPosition = homeSource.indexOf("route: 'Map'")
    const hubPosition = homeSource.indexOf("route: 'Hub'")

    expect(proposalsPosition).toBeGreaterThan(-1)
    expect(mapPosition).toBeGreaterThan(proposalsPosition)
    expect(hubPosition).toBeGreaterThan(mapPosition)
    expect(appNavigatorSource).toContain("name='Map'")
  })

  it('does not load markers before proposal and question selection', () => {
    expect(
      shouldLoadMapMarkers({
        proposalId: null,
        questionIndex: null,
        locationMode: 'optional',
      }),
    ).toBe(false)
    expect(
      shouldLoadMapMarkers({
        proposalId: '1',
        questionIndex: null,
        locationMode: 'optional',
      }),
    ).toBe(false)
    expect(
      shouldLoadMapMarkers({
        proposalId: '1',
        questionIndex: 0,
        locationMode: 'disabled',
      }),
    ).toBe(false)
    expect(
      shouldLoadMapMarkers({
        proposalId: '1',
        questionIndex: 0,
        locationMode: 'optional',
      }),
    ).toBe(true)
  })

  it('never requests or displays device location in the read-only screen', () => {
    expect(mapScreenSource).not.toContain('expo-location')
    expect(mapScreenSource).not.toMatch(/request.*Permission/i)
    expect(nativeCanvasSource).toContain('showsUserLocation={false}')
    expect(nativeCanvasSource).toContain('showsMyLocationButton={false}')
    expect(nativeCanvasSource).not.toContain('onUserLocationChange')
  })

  it('always offsets coordinates passed to the future location adapter', () => {
    const source = { latitude: 35.6892, longitude: 51.389 }
    const minimumOffset = offsetCoordinateForMapPrivacy(source, () => 0)
    const maximumOffset = offsetCoordinateForMapPrivacy(source, () => 1)

    expect(distanceMeters(source, minimumOffset)).toBeCloseTo(350, 0)
    expect(distanceMeters(source, maximumOffset)).toBeCloseTo(2_000, 0)
    expect(minimumOffset).not.toEqual(source)
  })

  it('uses public centroids to frame markers and colors the leading answer', () => {
    const first = marker()
    const second = marker({
      cellId: 'cell-2',
      latitude: 36.7,
      longitude: 52.4,
      optionBreakdown: [
        { optionIndex: 0, count: 5, percentage: 0.5 },
        { optionIndex: 1, count: 5, percentage: 0.5 },
      ],
    })

    expect(getInitialMapRegion([first, second])).toMatchObject({
      latitude: 36.2,
      longitude: 51.9,
    })
    expect(getMapMarkerColor(first)).toBe('#006EB2')
  })

  it('uses shared on-chain metadata only when the question shape matches', () => {
    const mapCatalog = [
      {
        proposalId: '1',
        title: 'Seed title',
        description: 'Seed description',
        questions: [{ title: 'Seed question', variants: ['One', 'Two'] }],
      },
    ]
    const proposalCatalog = [
      {
        id: 1,
        title: 'On-chain title',
        description: 'IPFS description',
        metadata: {
          title: 'On-chain title',
          description: 'IPFS description',
          acceptedOptions: [{ title: 'Real question', variants: ['Yes', 'No'] }],
        },
        status: ProposalStatus.Started,
        startTimestamp: 0,
        duration: 0,
        nationalities: [],
        totalVotes: 0,
      },
    ]

    expect(mergeMapCatalogMetadata(mapCatalog, proposalCatalog)[0]).toMatchObject({
      title: 'On-chain title',
      questions: [{ title: 'Real question', variants: ['Yes', 'No'] }],
    })
  })
})
