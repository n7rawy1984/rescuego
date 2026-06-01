import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

type Props = {
  title: string
  subtitle: string
  creditNote?: string | null
  href: string
  label: string
}

export default function ProviderUpgradeNotice({
  title,
  subtitle,
  creditNote,
  href,
  label,
}: Props) {
  return (
    <div className="mb-6 rounded-xl border border-[#9FE1CB] bg-[#E1F5EE] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-[#0F6E56]">{title}</p>
          <p className="text-sm text-slate-600">{subtitle}</p>
          {creditNote ? (
            <p className="text-xs text-[#0F6E56]/80">{creditNote}</p>
          ) : null}
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#1D9E75]/30 bg-white px-4 py-2.5 text-sm font-medium text-[#0F6E56] transition-colors hover:bg-[#1D9E75] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D9E75]"
        >
          {label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
