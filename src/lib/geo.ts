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

export type UaeLocation = {
  emirate: string
  emirateAr: string
  area: string | null
  areaAr: string | null
}

type BoundingBox = {
  minLat: number; maxLat: number; minLng: number; maxLng: number
}

type AreaEntry = BoundingBox & { name: string; nameAr: string }

type EmirateEntry = BoundingBox & {
  name: string
  nameAr: string
  areas: AreaEntry[]
}

const UAE_REGIONS: EmirateEntry[] = [
  {
    name: 'Dubai', nameAr: 'دبي',
    minLat: 24.79, maxLat: 25.36, minLng: 54.89, maxLng: 55.63,
    areas: [
      { name: 'Deira', nameAr: 'ديرة', minLat: 25.24, maxLat: 25.30, minLng: 55.27, maxLng: 55.38 },
      { name: 'Bur Dubai', nameAr: 'بر دبي', minLat: 25.22, maxLat: 25.27, minLng: 55.26, maxLng: 55.33 },
      { name: 'Downtown Dubai', nameAr: 'وسط مدينة دبي', minLat: 25.18, maxLat: 25.23, minLng: 55.26, maxLng: 55.31 },
      { name: 'Business Bay', nameAr: 'الخليج التجاري', minLat: 25.17, maxLat: 25.21, minLng: 55.27, maxLng: 55.33 },
      { name: 'Al Barsha', nameAr: 'البرشاء', minLat: 25.09, maxLat: 25.14, minLng: 55.17, maxLng: 55.24 },
      { name: 'JBR / Marina', nameAr: 'جي بي آر / المارينا', minLat: 25.07, maxLat: 25.12, minLng: 55.12, maxLng: 55.17 },
      { name: 'Jumeirah', nameAr: 'جميرا', minLat: 25.16, maxLat: 25.23, minLng: 55.20, maxLng: 55.30 },
      { name: 'Al Qusais', nameAr: 'القصيص', minLat: 25.26, maxLat: 25.31, minLng: 55.36, maxLng: 55.42 },
      { name: 'Mirdif', nameAr: 'مردف', minLat: 25.21, maxLat: 25.26, minLng: 55.41, maxLng: 55.47 },
      { name: 'Dubai Silicon Oasis', nameAr: 'واحة دبي للسيليكون', minLat: 25.11, maxLat: 25.15, minLng: 55.37, maxLng: 55.43 },
      { name: 'Al Nahda', nameAr: 'النهدة', minLat: 25.28, maxLat: 25.33, minLng: 55.37, maxLng: 55.43 },
      { name: 'International City', nameAr: 'المدينة الدولية', minLat: 25.15, maxLat: 25.20, minLng: 55.40, maxLng: 55.46 },
      { name: 'Motor City / Sports City', nameAr: 'موتور سيتي / مدينة الرياضة', minLat: 25.03, maxLat: 25.07, minLng: 55.21, maxLng: 55.27 },
      { name: 'Al Quoz', nameAr: 'القوز', minLat: 25.13, maxLat: 25.18, minLng: 55.22, maxLng: 55.28 },
      { name: 'Oud Metha', nameAr: 'عود ميثاء', minLat: 25.22, maxLat: 25.25, minLng: 55.31, maxLng: 55.34 },
    ],
  },
  {
    name: 'Abu Dhabi', nameAr: 'أبوظبي',
    minLat: 22.63, maxLat: 24.45, minLng: 51.30, maxLng: 55.07,
    areas: [
      { name: 'Abu Dhabi Island', nameAr: 'جزيرة أبوظبي', minLat: 24.41, maxLat: 24.51, minLng: 54.32, maxLng: 54.44 },
      { name: 'Al Reem Island', nameAr: 'جزيرة الريم', minLat: 24.48, maxLat: 24.52, minLng: 54.39, maxLng: 54.43 },
      { name: 'Al Mushrif', nameAr: 'المشرف', minLat: 24.43, maxLat: 24.46, minLng: 54.38, maxLng: 54.43 },
      { name: 'Khalidiyah', nameAr: 'الخالدية', minLat: 24.45, maxLat: 24.49, minLng: 54.34, maxLng: 54.39 },
      { name: 'Mussafah', nameAr: 'مصفح', minLat: 24.32, maxLat: 24.40, minLng: 54.47, maxLng: 54.56 },
      { name: 'Al Ain', nameAr: 'العين', minLat: 24.10, maxLat: 24.35, minLng: 55.55, maxLng: 55.85 },
      { name: 'Yas Island', nameAr: 'جزيرة ياس', minLat: 24.47, maxLat: 24.50, minLng: 54.59, maxLng: 54.63 },
      { name: 'Saadiyat Island', nameAr: 'جزيرة السعديات', minLat: 24.52, maxLat: 24.56, minLng: 54.41, maxLng: 54.46 },
      { name: 'Al Raha', nameAr: 'الراحة', minLat: 24.44, maxLat: 24.48, minLng: 54.58, maxLng: 54.64 },
    ],
  },
  {
    name: 'Sharjah', nameAr: 'الشارقة',
    minLat: 25.10, maxLat: 25.59, minLng: 55.38, maxLng: 55.70,
    areas: [
      { name: 'Al Nabba', nameAr: 'النبة', minLat: 25.35, maxLat: 25.39, minLng: 55.39, maxLng: 55.43 },
      { name: 'Al Khan', nameAr: 'الخان', minLat: 25.32, maxLat: 25.36, minLng: 55.37, maxLng: 55.41 },
      { name: 'Al Majaz', nameAr: 'المجاز', minLat: 25.34, maxLat: 25.38, minLng: 55.37, maxLng: 55.41 },
      { name: 'Industrial Area', nameAr: 'المنطقة الصناعية', minLat: 25.30, maxLat: 25.36, minLng: 55.43, maxLng: 55.51 },
      { name: 'Muweilah', nameAr: 'مويلح', minLat: 25.28, maxLat: 25.33, minLng: 55.48, maxLng: 55.54 },
      { name: 'Al Nahda', nameAr: 'النهضة', minLat: 25.28, maxLat: 25.32, minLng: 55.41, maxLng: 55.46 },
    ],
  },
  {
    name: 'Ajman', nameAr: 'عجمان',
    minLat: 25.38, maxLat: 25.50, minLng: 55.42, maxLng: 55.58,
    areas: [
      { name: 'Ajman Downtown', nameAr: 'وسط عجمان', minLat: 25.40, maxLat: 25.44, minLng: 55.43, maxLng: 55.47 },
      { name: 'Al Rashidiya', nameAr: 'الراشدية', minLat: 25.41, maxLat: 25.45, minLng: 55.48, maxLng: 55.54 },
      { name: 'Al Jurf', nameAr: 'الجرف', minLat: 25.38, maxLat: 25.42, minLng: 55.48, maxLng: 55.54 },
    ],
  },
  {
    name: 'Ras Al Khaimah', nameAr: 'رأس الخيمة',
    minLat: 25.55, maxLat: 26.20, minLng: 55.68, maxLng: 56.15,
    areas: [
      { name: 'RAK City', nameAr: 'مدينة رأس الخيمة', minLat: 25.78, maxLat: 25.82, minLng: 55.93, maxLng: 55.97 },
      { name: 'Al Nakheel', nameAr: 'النخيل', minLat: 25.82, maxLat: 25.86, minLng: 55.95, maxLng: 55.99 },
      { name: 'Al Hamra', nameAr: 'الحمراء', minLat: 25.68, maxLat: 25.72, minLng: 55.76, maxLng: 55.80 },
    ],
  },
  {
    name: 'Fujairah', nameAr: 'الفجيرة',
    minLat: 25.05, maxLat: 25.40, minLng: 56.20, maxLng: 56.55,
    areas: [
      { name: 'Fujairah City', nameAr: 'مدينة الفجيرة', minLat: 25.11, maxLat: 25.16, minLng: 56.33, maxLng: 56.38 },
      { name: 'Dibba', nameAr: 'دبا', minLat: 25.57, maxLat: 25.62, minLng: 56.25, maxLng: 56.30 },
    ],
  },
  {
    name: 'Umm Al Quwain', nameAr: 'أم القيوين',
    minLat: 25.50, maxLat: 25.60, minLng: 55.55, maxLng: 55.72,
    areas: [],
  },
]

function inBox(lat: number, lng: number, box: BoundingBox): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng
}

export function getUaeLocation(lat: number, lng: number): UaeLocation | null {
  for (const emirate of UAE_REGIONS) {
    if (!inBox(lat, lng, emirate)) continue
    for (const area of emirate.areas) {
      if (inBox(lat, lng, area)) return { emirate: emirate.name, emirateAr: emirate.nameAr, area: area.name, areaAr: area.nameAr }
    }
    return { emirate: emirate.name, emirateAr: emirate.nameAr, area: null, areaAr: null }
  }
  return null
}

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
