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

export function distanceKm(a: Coordinates, b: Coordinates): number {
  return distanceMeters(a, b) / 1000
}

export function generateFuzzyCoordinates(coords: Coordinates): Coordinates {
  const offsetKm = 1
  const earthRadiusKm = 6371
  const angle = Math.random() * 2 * Math.PI
  const distance = Math.random() * offsetKm
  const dLat = (distance * Math.cos(angle)) / earthRadiusKm * (180 / Math.PI)
  const dLng = (distance * Math.sin(angle)) / (earthRadiusKm * Math.cos(coords.lat * Math.PI / 180)) * (180 / Math.PI)
  return {
    lat: Number((coords.lat + dLat).toFixed(7)),
    lng: Number((coords.lng + dLng).toFixed(7)),
  }
}

export type DispatchRing = 1 | 2 | 3 | 4

export function getDispatchRing(distanceM: number): DispatchRing {
  if (distanceM <= 5000) return 1
  if (distanceM <= 10000) return 2
  if (distanceM <= 20000) return 3
  return 4
}

export function isTimestampWithinMinutes(timestamp: string | null, minutes: number): boolean {
  if (!timestamp) return false

  const parsed = new Date(timestamp).getTime()
  if (Number.isNaN(parsed)) return false

  return Date.now() - parsed <= minutes * 60 * 1000
}
