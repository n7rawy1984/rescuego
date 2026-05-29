import type { Coordinates } from '@/lib/geo'

type LocationSource = {
  location_address?: string | null
  location?: unknown
}

export type ProviderLocationDisplay = {
  label: string
  detail: string | null
  coordinates: Coordinates | null
}

const gpsAddressPattern = /current gps location\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i
const compactHexPattern = /^[0-9a-f]{24,}$/i

function normalizeCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Number(value.toFixed(5))
}

function coordinatesFromUnknown(location: unknown): Coordinates | null {
  if (!location) return null

  if (typeof location === 'string') {
    if (compactHexPattern.test(location.trim())) return null

    try {
      return coordinatesFromUnknown(JSON.parse(location))
    } catch {
      return null
    }
  }

  if (typeof location !== 'object') return null

  const maybePoint = location as { coordinates?: unknown }
  if (!Array.isArray(maybePoint.coordinates) || maybePoint.coordinates.length < 2) return null

  const lng = normalizeCoordinate(maybePoint.coordinates[0])
  const lat = normalizeCoordinate(maybePoint.coordinates[1])
  if (lat === null || lng === null) return null

  return { lat, lng }
}

function coordinatesFromAddress(address: string | null | undefined): Coordinates | null {
  if (!address) return null

  const match = address.match(gpsAddressPattern)
  if (!match) return null

  const lat = normalizeCoordinate(Number(match[1]))
  const lng = normalizeCoordinate(Number(match[2]))
  if (lat === null || lng === null) return null

  return { lat, lng }
}

function isRawGeometryText(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  return compactHexPattern.test(trimmed) || /^01010000/i.test(trimmed)
}

export function formatCoordinates(coords: Coordinates): string {
  return `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
}

export function googleMapsSearchUrl(coords: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatCoordinates(coords))}`
}

export function getProviderLocationDisplay(source: LocationSource): ProviderLocationDisplay {
  const address = source.location_address?.trim() ?? ''
  const addressCoordinates = coordinatesFromAddress(address)
  const storedCoordinates = coordinatesFromUnknown(source.location)
  const coordinates = addressCoordinates ?? storedCoordinates

  if (addressCoordinates) {
    return {
      label: 'GPS location',
      detail: formatCoordinates(addressCoordinates),
      coordinates,
    }
  }

  if (address && !isRawGeometryText(address)) {
    return {
      label: address,
      detail: coordinates ? formatCoordinates(coordinates) : null,
      coordinates,
    }
  }

  if (coordinates) {
    return {
      label: 'GPS location',
      detail: formatCoordinates(coordinates),
      coordinates,
    }
  }

  return {
    label: 'Location details unavailable',
    detail: null,
    coordinates: null,
  }
}
