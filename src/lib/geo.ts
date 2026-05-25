export type Coordinates = {
  lat: number
  lng: number
}

export const UAE_BOUNDS = {
  minLng: 51,
  maxLng: 57,
  minLat: 22,
  maxLat: 27,
}

export function isWithinUaeBounds(coords: Coordinates): boolean {
  return (
    coords.lng >= UAE_BOUNDS.minLng &&
    coords.lng <= UAE_BOUNDS.maxLng &&
    coords.lat >= UAE_BOUNDS.minLat &&
    coords.lat <= UAE_BOUNDS.maxLat
  )
}

export function roundDispatchCoordinate(value: number): number {
  return Number(value.toFixed(5))
}

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const earthRadiusMeters = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h))
}

export function isTimestampWithinMinutes(timestamp: string | null, minutes: number): boolean {
  if (!timestamp) return false

  const parsed = new Date(timestamp).getTime()
  if (Number.isNaN(parsed)) return false

  return Date.now() - parsed <= minutes * 60 * 1000
}
