import { Text, View } from 'react-native'
import { Marker } from 'react-native-maps'

import type { MapMarker } from '@/api/modules/map'

import { getMapMarkerColor } from '../utils'

type Props = {
  marker: MapMarker
  selected: boolean
  onPress: () => void
}

export default function MapMarkerView({ marker, selected, onPress }: Props) {
  const size = Math.min(64, 34 + Math.log2(marker.totalMappedVotes) * 4)

  return (
    <Marker
      coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
      onPress={onPress}
      tracksViewChanges={selected}
    >
      <View
        className='items-center justify-center rounded-full border-2 border-baseWhite'
        style={{
          width: size,
          height: size,
          backgroundColor: getMapMarkerColor(marker),
          opacity: selected ? 1 : 0.88,
          transform: [{ scale: selected ? 1.12 : 1 }],
        }}
      >
        <Text className='typography-caption font-bold text-baseWhite'>
          {marker.totalMappedVotes}
        </Text>
      </View>
    </Marker>
  )
}
