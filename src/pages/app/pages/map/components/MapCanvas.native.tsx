import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import MapView from 'react-native-maps'

import type { MapMarker } from '@/api/modules/map'

import { getInitialMapRegion } from '../utils'
import MapMarkerView from './MapMarkerView.native'

type Props = {
  markers: MapMarker[]
  selectedMarkerId: string | null
  onSelectMarker: (marker: MapMarker) => void
}

export default function MapCanvas({ markers, selectedMarkerId, onSelectMarker }: Props) {
  const mapRef = useRef<MapView>(null)

  useEffect(() => {
    if (markers.length === 0) return
    mapRef.current?.fitToCoordinates(
      markers.map(marker => ({
        latitude: marker.latitude,
        longitude: marker.longitude,
      })),
      {
        animated: true,
        edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
      },
    )
  }, [markers])

  return (
    <View className='h-96 overflow-hidden rounded-3xl'>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={getInitialMapRegion(markers)}
        loadingEnabled
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {markers.map(marker => (
          <MapMarkerView
            key={marker.cellId}
            marker={marker}
            selected={selectedMarkerId === marker.cellId}
            onPress={() => onSelectMarker(marker)}
          />
        ))}
      </MapView>
    </View>
  )
}
