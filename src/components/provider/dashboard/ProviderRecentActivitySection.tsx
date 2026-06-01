import { BriefcaseBusiness, History, MapPin } from 'lucide-react'
import Badge from '@/components/ui/Badge'

type ActivityItem = {
  id: string
  problemLabel: string
  badgeLabel: string
  badgeVariant: 'success' | 'warning' | 'danger' | 'info' | 'default'
  location: string
  amount: string
  date: string
}

type Props = {
  items: ActivityItem[]
}

export default function ProviderRecentActivitySection({ items }: Props) {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
        <History className="h-5 w-5 text-[#0F6E56]" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-950">Recent Activity</h2>
      </div>
      <div className="p-2">
        <p className="px-3 py-2 text-xs text-slate-500">
          Completed jobs, customer cancellations, and released requests.
        </p>

        {items.length > 0 ? (
          <div className="mt-2 divide-y divide-slate-200">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 px-3 py-3 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-950">{item.problemLabel}</span>
                    <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
                  </div>
                  <p className="flex min-w-0 items-center gap-1 text-sm text-slate-500">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.location}</span>
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-semibold text-slate-900">{item.amount}</p>
                  <p className="text-xs text-slate-500">{item.date}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-semibold text-slate-800">No recent activity yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              Completed jobs, customer cancellations, and releases will appear here.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
