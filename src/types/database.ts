export type UserRole = 'customer' | 'provider' | 'admin'
export type ProviderPlan = 'starter' | 'pro' | 'business' | 'pay_per_job'
export type ProviderStatus = 'pending' | 'active' | 'suspended'
export type RequestStatus = 'open' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' | 'expired'
export type ProblemType = 'flat_tire' | 'battery' | 'tow' | 'other'

export interface User {
  id: string
  name: string
  phone: string
  email: string
  role: UserRole
  created_at: string
}

export interface Provider {
  id: string
  plan: ProviderPlan
  status: ProviderStatus
  rating: number
  jobs_this_month: number
  verified_badge: boolean
  documents: {
    emirates_id_url?: string
    license_url?: string
    vehicle_photo_url?: string
  } | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_current_period_start: string | null
  stripe_current_period_end: string | null
  jobs_reset_at: string | null
  created_at: string
}

export interface ProviderWithUser extends Provider {
  users: User
}

export interface ProviderLocation {
  provider_id: string
  location: { type: 'Point'; coordinates: [number, number] }
  updated_at: string
}

export interface Request {
  id: string
  customer_id: string
  location: { type: 'Point'; coordinates: [number, number] }
  location_address: string | null
  problem_type: ProblemType
  note: string | null
  status: RequestStatus
  accepted_by: string | null
  price_estimate_min: number | null
  price_estimate_max: number | null
  final_price: number | null
  created_at: string
}

export interface RequestWithCustomer extends Request {
  users: Pick<User, 'id' | 'name' | 'phone'>
}

export interface Job {
  id: string
  request_id: string
  provider_id: string
  commission_rate: number | null
  commission_amount: number | null
  stripe_payment_intent_id: string | null
  completed_at: string | null
}

export interface Rating {
  id: string
  job_id: string
  provider_id: string
  stars: number
  comment: string | null
  created_at: string
}

export interface RequestLock {
  request_id: string
  provider_id: string
  locked_until: string
}

export interface PriceEstimate {
  problem_type: ProblemType
  min_aed: number
  max_aed: number
}

export interface NearbyProvider {
  id: string
  plan: ProviderPlan
  rating: number
  distance_meters: number
}
