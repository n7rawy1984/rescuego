export const notificationEvents = {
  requestExpired: 'request_expired',
  overageFailed: 'overage_payment_failed',
  webhookFailed: 'stripe_webhook_failed',
  providerNeedsApproval: 'provider_needs_approval',
  subscriptionRequiresAttention: 'subscription_requires_attention',
} as const

export type NotificationEvent = (typeof notificationEvents)[keyof typeof notificationEvents]

// Future notification adapters should use these event names for email, SMS,
// WhatsApp, or in-app delivery. Phase C3 only logs operational events.
