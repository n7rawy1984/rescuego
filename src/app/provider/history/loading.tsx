import Navbar from '@/components/layout/Navbar'

export default function ProviderHistoryLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
            <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0">
                <div className="space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded-full bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
