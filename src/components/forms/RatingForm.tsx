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
    if (!stars) {
      setError('Please select a star rating')
      return
    }

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
      <div className="py-4 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-semibold text-slate-900">Rating submitted - thank you!</p>
        <p className="text-sm text-slate-500 mt-1">Your feedback keeps RescueGo providers accountable.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-slate-500 text-sm mb-6">How was your recovery provider? Your rating helps other drivers.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Rating <span className="text-red-500">*</span></p>
          <div className="flex gap-1" role="group" aria-label="Star rating">
            {[1, 2, 3, 4, 5].map((star) => {
              const isFilled = star <= (hoveredStar || stars)
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => setStars(star)}
                  onMouseEnter={() => setHoveredStar(star)}
                  onMouseLeave={() => setHoveredStar(0)}
                  aria-label={`Rate ${star} out of 5 stars`}
                  aria-pressed={stars === star}
                  className="p-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-orange-500 rounded"
                >
                  <svg
                    className={`w-8 h-8 transition-colors ${isFilled ? 'text-amber-400 fill-amber-400' : 'text-slate-300 fill-none'}`}
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={isFilled ? 0 : 1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                    />
                  </svg>
                </button>
              )
            })}
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
