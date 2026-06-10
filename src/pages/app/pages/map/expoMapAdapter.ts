export type ApproximateCoordinate = {
  latitude: number
  longitude: number
}

const EARTH_RADIUS_METERS = 6_371_000
const MINIMUM_OFFSET_METERS = 350
const MAXIMUM_OFFSET_METERS = 2_000

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180
const radiansToDegrees = (radians: number): number => (radians * 180) / Math.PI

/**
 * Phase 4 must pass device coordinates through this adapter immediately after
 * acquisition. UI components must never receive or retain the original point.
 */
export const offsetCoordinateForMapPrivacy = (
  coordinate: ApproximateCoordinate,
  random: () => number = Math.random,
): ApproximateCoordinate => {
  const distance =
    MINIMUM_OFFSET_METERS + random() * (MAXIMUM_OFFSET_METERS - MINIMUM_OFFSET_METERS)
  const bearing = random() * Math.PI * 2
  const angularDistance = distance / EARTH_RADIUS_METERS
  const latitude = degreesToRadians(coordinate.latitude)
  const longitude = degreesToRadians(coordinate.longitude)

  const offsetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const offsetLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(offsetLatitude),
    )

  return {
    latitude: radiansToDegrees(offsetLatitude),
    longitude: radiansToDegrees(offsetLongitude),
  }
}
