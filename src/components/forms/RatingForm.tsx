'use client'
import { useState } from 'react'
import Button from '@/components/ui/Button'

interface Props {
  jobId: string
  providerId: string
  onComplete?: () => void
}

export default function RatingForm({ jobId, providerId, onComplete }: Props) {
  const [stars, setStars] = useState(0)
  const [hoveredStar, setHoveredStar] = useState(0)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stars) { setError('Please select a star rating'); return }
    setLoading(true)
    setError('')
    const res = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
      job_id: jobId,
      provider_id: providerId,
      stars,
      comment: comment || null,
      }),
    })
    const result = await res.json().catch(() => null) as { error?: string } | null

    if (!res.ok) {
      setError(result?.error ?? 'Failed to submit rating')
      setLoading(false)
      return
    }

    setLoading(false)
    setSubmitted(true)
    onComplete?.()
  }

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md mx-auto">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Thanks for your rating</h2>
        <p className="text-slate-500 text-sm">Your feedback helps keep RescueGo providers accountable.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md mx-auto">
      <h2 className="text-xl font-bold text-slate-900 mb-2">Rate Your Experience</h2>
      <p className="text-slate-500 text-sm mb-6">How was your recovery provider? Your rating helps other drivers.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Rating <span className="text-red-500">*</span></p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setStars(star)}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                className="text-3xl transition-transform hover:scale-110"
              >
                {star <= (hoveredStar || stars) ? '⭐' : '☆'}
              </button>
            ))}
          </div>
          {stars > 0 && (
            <p className="text-sm text-slate-500 mt-1">
              {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][stars]}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="comment" className="text-sm font-medium text-slate-700">Comment (optional)</label>
          <textarea
            id="comment"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Tell others about your experience..."
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 min-h-[80px] resize-none"
          />
        </div>
        {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">Submit Rating</Button>
      </form>
    </div>
  )
}
