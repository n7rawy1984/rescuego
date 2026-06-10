import type { ProviderPlan, ProviderStatus } from '@/types'

export type ProviderDocuments = {
  emirates_id_url?: string
  license_url?: string
  vehicle_photo_url?: string
} | null

export type MissingDocumentKey = 'emirates_id_url' | 'license_url' | 'vehicle_photo_url'

export type ProviderOnboardingState = {
  profileComplete: boolean
  documentsComplete: boolean
  planComplete: boolean
  pendingApproval: boolean
  underReview: boolean
  rejected: boolean
  activeReady: boolean
  firstIncompleteStep: 'profile' | 'documents' | 'plan' | 'review' | 'ready'
  missingDocuments: MissingDocumentKey[]
}

export const ALL_PROVIDER_DOCUMENTS: { key: MissingDocumentKey; label: string }[] = [
  { key: 'emirates_id_url', label: 'Emirates ID' },
  { key: 'license_url', label: 'UAE Driving License' },
  { key: 'vehicle_photo_url', label: 'Vehicle Registration / Mulkiya' },
]

export function providerDocumentLabel(key: MissingDocumentKey): string {
  return ALL_PROVIDER_DOCUMENTS.find((d) => d.key === key)?.label ?? key
}

export function hasMinimumDocument(documents: ProviderDocuments): boolean {
  if (!documents) return false
  return Boolean(documents.emirates_id_url || documents.license_url || documents.vehicle_photo_url)
}

export function missingProviderDocuments(documents: ProviderDocuments): MissingDocumentKey[] {
  if (hasMinimumDocument(documents)) return []
  return ['emirates_id_url', 'license_url', 'vehicle_photo_url']
}

export function getProviderOnboardingState(input: {
  name: string | null
  email: string | null
  phone: string | null
  plan: ProviderPlan | null
  status: ProviderStatus | null
  documents: ProviderDocuments
}): ProviderOnboardingState {
  const missingDocuments = missingProviderDocuments(input.documents)
  const profileComplete = Boolean(input.name && input.email && input.phone)
  const documentsComplete = missingDocuments.length === 0
  const planComplete = Boolean(input.plan)
  const activeReady = profileComplete && documentsComplete && planComplete && input.status === 'active'
  const pendingApproval = profileComplete && documentsComplete && planComplete && input.status === 'pending'
  const underReview = profileComplete && documentsComplete && planComplete && input.status === 'under_review'
  const rejected = input.status === 'rejected'

  let firstIncompleteStep: ProviderOnboardingState['firstIncompleteStep'] = 'ready'
  if (!profileComplete) firstIncompleteStep = 'profile'
  else if (!documentsComplete) firstIncompleteStep = 'documents'
  else if (!planComplete) firstIncompleteStep = 'plan'
  else if (!activeReady) firstIncompleteStep = 'review'

  return {
    profileComplete,
    documentsComplete,
    planComplete,
    pendingApproval,
    underReview,
    rejected,
    activeReady,
    firstIncompleteStep,
    missingDocuments,
  }
}
