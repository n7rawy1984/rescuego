'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, AlertTriangle } from 'lucide-react'

interface Props {
  acceptedAt: string
  slaDeadlineMinutes?: number
  slaWarningMinutes?: number
}

export default function SlaTimer({
  acceptedAt,
  slaDeadlineMinutes = 20,
  slaWarningMinutes = 10,
}: Props) {
  const t = useTranslations('components.slaTimer')

  function getRemaining(at: string, deadlineMin: number): number {
    const deadline = new Date(at).getTime() + deadlineMin * 60 * 1000
    return Math.max(0, deadline - Date.now())
  }

  const [remainingMs, setRemainingMs] = useState(() => getRemaining(acceptedAt, slaDeadlineMinutes))

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingMs(getRemaining(acceptedAt, slaDeadlineMinutes))
    }, 1000)
    return () => clearInterval(interval)
  }, [acceptedAt, slaDeadlineMinutes])

  const totalMinutes = Math.floor(remainingMs / 60000)
  const seconds = Math.floor((remainingMs % 60000) / 1000)
  const isExpired = remainingMs <= 0
  const isWarning = !isExpired && remainingMs <= slaWarningMinutes * 60 * 1000

  if (isExpired) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('slaBreached')}</span>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 ${
      isWarning
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-slate-50 text-slate-600 ring-slate-200'
    }`}>
      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {isWarning ? t('hurryUp') : t('timeRemaining')}
        {': '}
        {totalMinutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
      </span>
    </div>
  )
}
