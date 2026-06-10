import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'

import type { MapMarker } from '@/api/modules/map'

import { getMapMarkerColor } from '../utils'

type Props = {
  markers: MapMarker[]
  selectedMarkerId: string | null
  onSelectMarker: (marker: MapMarker) => void
}

export default function MapCanvas({ markers, selectedMarkerId, onSelectMarker }: Props) {
  const { t } = useTranslation()

  return (
    <View className='gap-2 rounded-3xl bg-backgroundContainer p-4'>
      <Text className='typography-body3 text-textSecondary'>{t('map.native-only')}</Text>
      {markers.map(marker => (
        <Pressable
          key={marker.cellId}
          onPress={() => onSelectMarker(marker)}
          className={`flex-row items-center gap-3 rounded-2xl p-3 ${
            selectedMarkerId === marker.cellId ? 'bg-componentSelected' : 'bg-backgroundPrimary'
          }`}
        >
          <View
            className='size-4 rounded-full'
            style={{ backgroundColor: getMapMarkerColor(marker) }}
          />
          <Text className='typography-body3 flex-1 text-textPrimary'>
            {t('map.mapped-votes', { count: marker.totalMappedVotes })}
          </Text>
          <Text className='typography-caption text-textSecondary'>
            {t('map.cell-label', { cellId: marker.cellId })}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}
