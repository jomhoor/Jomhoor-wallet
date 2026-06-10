import { useNetInfo } from '@react-native-community/netinfo'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  getMapMarkers,
  getMapProposalCatalog,
  getProposalMapPolicy,
  type MapMarker,
} from '@/api/modules/map'
import { useProposalCatalog } from '@/hooks/useProposalCatalog'
import AppContainer from '@/pages/app/components/AppContainer'
import type { AppStackScreenProps } from '@/route-types'
import { useAppPaddings, useAppTheme } from '@/theme'
import { UiButton, UiCard, UiIcon, UiScreenScrollable } from '@/ui'

import MapCanvas from './components/MapCanvas'
import MapControls from './components/MapControls'
import MapMarkerDetails from './components/MapMarkerDetails'
import { mergeMapCatalogMetadata, shouldLoadMapMarkers } from './utils'

export default function JomhoorMapScreen({}: AppStackScreenProps<'Map'>) {
  const insets = useSafeAreaInsets()
  const appPaddings = useAppPaddings()
  const { palette } = useAppTheme()
  const { t } = useTranslation()
  const network = useNetInfo()
  const proposalCatalogQuery = useProposalCatalog()
  const mapCatalogQuery = useQuery({
    queryKey: ['mapProposalCatalog'],
    queryFn: getMapProposalCatalog,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const proposals = useMemo(
    () => mergeMapCatalogMetadata(mapCatalogQuery.data ?? [], proposalCatalogQuery.data ?? []),
    [mapCatalogQuery.data, proposalCatalogQuery.data],
  )

  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null)

  const selectedProposal = proposals.find(proposal => proposal.proposalId === selectedProposalId)
  const selectedQuestion =
    selectedQuestionIndex === null
      ? null
      : (selectedProposal?.questions[selectedQuestionIndex] ?? null)

  const policyQuery = useQuery({
    queryKey: ['mapProposalPolicy', selectedProposalId],
    queryFn: () => getProposalMapPolicy(selectedProposalId as string),
    enabled: selectedProposalId !== null,
  })

  const markersQuery = useQuery({
    queryKey: ['mapMarkers', selectedProposalId, selectedQuestionIndex],
    queryFn: () =>
      getMapMarkers({
        proposalId: selectedProposalId as string,
        questionIndex: selectedQuestionIndex as number,
      }),
    enabled: shouldLoadMapMarkers({
      proposalId: selectedProposalId,
      questionIndex: selectedQuestionIndex,
      locationMode: policyQuery.data?.location.mode,
    }),
  })

  const handleSelectProposal = (proposalId: string) => {
    setSelectedProposalId(proposalId)
    setSelectedQuestionIndex(null)
    setSelectedMarker(null)
  }

  const handleSelectQuestion = (questionIndex: number) => {
    setSelectedQuestionIndex(questionIndex)
    setSelectedMarker(null)
  }

  const showOfflineState = network.isConnected === false
  const markers = markersQuery.data ?? []

  return (
    <AppContainer>
      <UiScreenScrollable
        style={{
          paddingTop: insets.top,
          paddingLeft: appPaddings.left,
          paddingRight: appPaddings.right,
          paddingBottom: insets.bottom + 24,
        }}
        className='gap-4'
      >
        <View>
          <Text className='typography-h4 pt-2 leading-[52px] text-textPrimary'>
            {t('map.title')}
          </Text>
          <Text className='typography-body3 text-textSecondary'>{t('map.subtitle')}</Text>
        </View>

        {showOfflineState ? (
          <UiCard className='flex-row items-center gap-3 bg-warningLight'>
            <UiIcon
              libIcon='Ionicons'
              name='cloud-offline-outline'
              size={20}
              color={palette.warningMain}
            />
            <Text className='typography-body3 flex-1 text-textPrimary'>{t('map.offline')}</Text>
          </UiCard>
        ) : null}

        {mapCatalogQuery.isLoading ? (
          <View className='items-center justify-center gap-3 py-16'>
            <ActivityIndicator color={palette.primaryMain} />
            <Text className='typography-body3 text-textSecondary'>
              {t('map.loading-proposals')}
            </Text>
          </View>
        ) : mapCatalogQuery.isError ? (
          <UiCard className='items-center gap-3 py-8'>
            <UiIcon customIcon='warningIcon' className='size-10 text-errorMain' />
            <Text className='typography-body3 text-center text-textPrimary'>
              {t('map.proposals-error')}
            </Text>
            <UiButton title={t('map.retry')} onPress={() => mapCatalogQuery.refetch()} />
          </UiCard>
        ) : proposals.length === 0 ? (
          <UiCard className='items-center gap-2 py-8'>
            <UiIcon customIcon='mapPinIcon' className='size-10 text-textSecondary' />
            <Text className='typography-body3 text-center text-textPrimary'>
              {t('map.no-proposals')}
            </Text>
          </UiCard>
        ) : (
          <MapControls
            proposals={proposals}
            selectedProposalId={selectedProposalId}
            selectedQuestionIndex={selectedQuestionIndex}
            onSelectProposal={handleSelectProposal}
            onSelectQuestion={handleSelectQuestion}
          />
        )}

        {!selectedProposalId ? (
          <UiCard className='items-center gap-2 py-8'>
            <UiIcon customIcon='mapPinIcon' className='size-10 text-primaryMain' />
            <Text className='typography-subtitle2 text-center text-textPrimary'>
              {t('map.select-proposal-prompt')}
            </Text>
            <Text className='typography-body3 text-center text-textSecondary'>
              {t('map.no-location-required')}
            </Text>
          </UiCard>
        ) : policyQuery.isLoading ? (
          <ActivityIndicator color={palette.primaryMain} />
        ) : policyQuery.isError ? (
          <UiCard className='items-center gap-3 py-8'>
            <Text className='typography-body3 text-center text-textPrimary'>
              {t('map.policy-error')}
            </Text>
            <UiButton title={t('map.retry')} onPress={() => policyQuery.refetch()} />
          </UiCard>
        ) : policyQuery.data?.location.mode === 'disabled' ? (
          <UiCard className='items-center gap-2 py-8'>
            <UiIcon customIcon='mapPinIcon' className='size-10 text-textSecondary' />
            <Text className='typography-subtitle2 text-center text-textPrimary'>
              {t('map.disabled')}
            </Text>
          </UiCard>
        ) : selectedQuestionIndex === null ? (
          <UiCard className='items-center gap-2 py-8'>
            <Text className='typography-body3 text-center text-textSecondary'>
              {t('map.select-question-prompt')}
            </Text>
          </UiCard>
        ) : markersQuery.isLoading ? (
          <View className='items-center justify-center gap-3 py-16'>
            <ActivityIndicator color={palette.primaryMain} />
            <Text className='typography-body3 text-textSecondary'>{t('map.loading-markers')}</Text>
          </View>
        ) : markersQuery.isError ? (
          <UiCard className='items-center gap-3 py-8'>
            <UiIcon customIcon='warningIcon' className='size-10 text-errorMain' />
            <Text className='typography-body3 text-center text-textPrimary'>
              {t('map.markers-error')}
            </Text>
            <UiButton title={t('map.retry')} onPress={() => markersQuery.refetch()} />
          </UiCard>
        ) : markers.length === 0 ? (
          <UiCard className='items-center gap-2 py-8'>
            <UiIcon customIcon='mapPinIcon' className='size-10 text-textSecondary' />
            <Text className='typography-subtitle2 text-center text-textPrimary'>
              {t('map.no-markers')}
            </Text>
            <Text className='typography-body3 text-center text-textSecondary'>
              {t('map.no-markers-detail')}
            </Text>
          </UiCard>
        ) : (
          <>
            <MapCanvas
              markers={markers}
              selectedMarkerId={selectedMarker?.cellId ?? null}
              onSelectMarker={setSelectedMarker}
            />
            {selectedMarker && selectedQuestion ? (
              <MapMarkerDetails marker={selectedMarker} question={selectedQuestion} />
            ) : null}
          </>
        )}

        <UiCard className='gap-2 bg-primaryLighter'>
          <View className='flex-row items-center gap-2'>
            <UiIcon
              libIcon='Ionicons'
              name='shield-checkmark-outline'
              size={20}
              color={palette.primaryMain}
            />
            <Text className='typography-subtitle2 flex-1 text-textPrimary'>
              {t('map.privacy-title')}
            </Text>
          </View>
          <Text className='typography-body3 text-textSecondary'>
            {t('map.privacy-description')}
          </Text>
        </UiCard>
      </UiScreenScrollable>
    </AppContainer>
  )
}
