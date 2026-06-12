import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

import type { MapMarker, MapProposalCatalogQuestion } from '@/api/modules/map'
import { UiCard } from '@/ui'

import { getMapOptionColor } from '../utils'

type Props = {
  marker: MapMarker
  question: MapProposalCatalogQuestion
}

export default function MapMarkerDetails({ marker, question }: Props) {
  const { t } = useTranslation()

  return (
    <UiCard className='gap-3'>
      <View className='flex-row items-center justify-between'>
        <Text className='typography-subtitle2 text-textPrimary'>{t('map.selected-area')}</Text>
        <Text className='typography-body3 text-textSecondary'>
          {t('map.mapped-votes', { count: marker.totalMappedVotes })}
        </Text>
      </View>

      {marker.breakdownSuppressed ? (
        <Text className='typography-body3 text-textSecondary'>{t('map.breakdown-suppressed')}</Text>
      ) : (
        marker.optionBreakdown.map(option => (
          <View key={option.optionIndex} className='flex-row items-center gap-3'>
            <View
              className='size-3 rounded-full'
              style={{ backgroundColor: getMapOptionColor(option.optionIndex) }}
            />
            <Text className='typography-body3 flex-1 text-textPrimary'>
              {question.variants[option.optionIndex] ??
                t('map.option-number', { number: option.optionIndex + 1 })}
            </Text>
            <Text className='typography-body3 text-textSecondary'>
              {option.count} ({Math.round(option.percentage * 100)}%)
            </Text>
          </View>
        ))
      )}
    </UiCard>
  )
}
