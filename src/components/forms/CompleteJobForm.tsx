'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

interface Props {
  requestId: string
}

export default function CompleteJobForm({ requestId }: Props) {
  const router = useRouter()
  const [finalPrice, setFinalPrice] = useState('')
  const [loading, setLoading] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || completed) return
    const amount = Number(finalPrice)

    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Enter a valid final price in AED.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/provider/jobs/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, final_price: amount }),
      })
      const result = await res.json().catch(() => null) as { error?: string } | null

      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(result?.error ?? 'Unable to complete job right now.')
        setLoading(false)
        return
      }

      setCompleted(true)
      router.refresh()
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
      setLoading(false)
    }
  }

  if (completed) {
    return (
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-green-800">Job completed. Refreshing dashboard...</p>
        <p className="mt-1 text-xs text-green-700">
          This job will move from Active Job to Recent Completed Jobs once the dashboard refresh finishes.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <Input
        id={`final-price-${requestId}`}
        type="number"
        min={1}
        max={10000}
        label="Final price (AED)"
        value={finalPrice}
        onChange={(event) => setFinalPrice(event.target.value)}
        placeholder="250"
        disabled={loading}
      />
      <Button type="submit" loading={loading}>
        {loading ? 'Completing job...' : 'Complete Job'}
      </Button>
      {error && <p className="text-sm text-red-500 sm:pb-2">{error}</p>}
    </form>
  )
}
