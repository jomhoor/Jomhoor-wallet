import type { MapMarker, MapProposalCatalogItem } from '@/api/modules/map'
import type { ProposalLocationPolicy } from '@/api/modules/map'
import type { ProposalCatalogItem } from '@/api/modules/proposals'

export const MAP_OPTION_COLORS = [
  '#006EB2',
  '#38C793',
  '#F17B2C',
  '#A972CA',
  '#DF1C41',
  '#607D8B',
] as const

export const getMapOptionColor = (optionIndex: number): string =>
  MAP_OPTION_COLORS[optionIndex % MAP_OPTION_COLORS.length]

export const getMapMarkerColor = (marker: MapMarker): string => {
  const leadingOption = marker.optionBreakdown.reduce<MapMarker['optionBreakdown'][number] | null>(
    (leading, option) => (!leading || option.count > leading.count ? option : leading),
    null,
  )

  return leadingOption ? getMapOptionColor(leadingOption.optionIndex) : MAP_OPTION_COLORS[0]
}

export const shouldLoadMapMarkers = ({
  proposalId,
  questionIndex,
  locationMode,
}: {
  proposalId: string | null
  questionIndex: number | null
  locationMode: ProposalLocationPolicy['mode'] | undefined
}): boolean => proposalId !== null && questionIndex !== null && locationMode !== 'disabled'

export const mergeMapCatalogMetadata = (
  mapCatalog: readonly MapProposalCatalogItem[],
  proposalCatalog: readonly ProposalCatalogItem[],
): MapProposalCatalogItem[] =>
  mapCatalog.map(mapProposal => {
    const proposal = proposalCatalog.find(
      candidate => String(candidate.id) === mapProposal.proposalId,
    )
    if (!proposal) return mapProposal

    return {
      ...mapProposal,
      title: proposal.title,
      description: proposal.description,
      questions:
        proposal.metadata.acceptedOptions.length === mapProposal.questions.length
          ? proposal.metadata.acceptedOptions
          : mapProposal.questions,
    }
  })

export const getInitialMapRegion = (markers: readonly MapMarker[]) => {
  if (markers.length === 0) {
    return {
      latitude: 32.4279,
      longitude: 53.688,
      latitudeDelta: 18,
      longitudeDelta: 18,
    }
  }

  const latitudes = markers.map(marker => marker.latitude)
  const longitudes = markers.map(marker => marker.longitude)
  const minimumLatitude = Math.min(...latitudes)
  const maximumLatitude = Math.max(...latitudes)
  const minimumLongitude = Math.min(...longitudes)
  const maximumLongitude = Math.max(...longitudes)

  return {
    latitude: (minimumLatitude + maximumLatitude) / 2,
    longitude: (minimumLongitude + maximumLongitude) / 2,
    latitudeDelta: Math.max(maximumLatitude - minimumLatitude, 0.5) * 1.6,
    longitudeDelta: Math.max(maximumLongitude - minimumLongitude, 0.5) * 1.6,
  }
}
