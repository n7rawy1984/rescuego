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
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(finalPrice)

    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Enter a valid final price in AED.')
      return
    }

    setLoading(true)
    setError('')

    const res = await fetch('/api/provider/jobs/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, final_price: amount }),
    })
    const result = await res.json().catch(() => null) as { error?: string } | null

    if (!res.ok) {
      setError(result?.error ?? 'Failed to complete job')
      setLoading(false)
      return
    }

    router.refresh()
    setLoading(false)
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
      />
      <Button type="submit" loading={loading}>
        Complete Job
      </Button>
      {error && <p className="text-sm text-red-500 sm:pb-2">{error}</p>}
    </form>
  )
}
