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
  activeReady: boolean
  firstIncompleteStep: 'profile' | 'documents' | 'plan' | 'review' | 'ready'
  missingDocuments: MissingDocumentKey[]
}

export const REQUIRED_PROVIDER_DOCUMENTS: { key: MissingDocumentKey; label: string }[] = [
  { key: 'emirates_id_url', label: 'Emirates ID' },
  { key: 'license_url', label: 'UAE driving license' },
  { key: 'vehicle_photo_url', label: 'Vehicle photo with visible plate' },
]

export function missingProviderDocuments(documents: ProviderDocuments): MissingDocumentKey[] {
  return REQUIRED_PROVIDER_DOCUMENTS
    .filter((document) => !documents?.[document.key])
    .map((document) => document.key)
}

export function providerDocumentLabel(key: MissingDocumentKey): string {
  return REQUIRED_PROVIDER_DOCUMENTS.find((document) => document.key === key)?.label ?? key
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
    activeReady,
    firstIncompleteStep,
    missingDocuments,
  }
}
