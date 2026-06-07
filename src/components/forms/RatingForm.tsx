'use client'
import { useState } from 'react'
import Button from '@/components/ui/Button'
import { CheckCircle2, Star } from 'lucide-react'

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
    if (loading) return
    if (!stars) {
      setError('Please select a star rating')
      return
    }

    setLoading(true)
    setError('')
    try {
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

      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError(result?.error ?? 'Unable to submit rating right now.')
        setLoading(false)
        return
      }

      setLoading(false)
      setSubmitted(true)
      onComplete?.()
    } catch {
      setError('Connection lost. Please check your internet connection and try again.')
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="rounded-3xl border border-[#9FE1CB] bg-[#E1F5EE] px-5 py-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#0F6E56] ring-1 ring-[#9FE1CB]">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="font-semibold text-slate-950">Rating submitted. Thank you!</p>
        <p className="mt-1 text-sm text-[#0F6E56]">Your feedback keeps RescueGo providers accountable.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
        How was your recovery provider? Your rating helps other drivers choose confidently.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">Rating <span className="text-red-500">*</span></p>
          <div className="flex justify-center gap-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:justify-start" role="group" aria-label="Star rating">
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
                  className="rounded-xl p-1.5 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                >
                  <Star
                    className={`h-9 w-9 transition-colors ${isFilled ? 'fill-amber-400 text-amber-400' : 'fill-none text-slate-300'}`}
                    strokeWidth={isFilled ? 0 : 1.6}
                    aria-hidden="true"
                  />
                </button>
              )
            })}
          </div>
          {stars > 0 && (
            <p className="mt-2 text-center text-sm font-medium text-slate-600 sm:text-start">
              {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][stars]}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="comment" className="text-sm font-semibold text-slate-700">Comment (optional)</label>
          <textarea
            id="comment"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Tell others about your experience..."
            className="min-h-[112px] w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
          />
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-500">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="min-h-12 w-full">
          {loading ? 'Submitting...' : 'Submit Rating'}
        </Button>
      </form>
    </div>
  )
}
