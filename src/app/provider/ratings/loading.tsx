import Navbar from '@/components/layout/Navbar'

export default function ProviderRatingsLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
            <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-200" />
          </div>
          <div className="mb-6 h-36 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2 border-b border-slate-100 px-5 py-4 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                  </div>
                  <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
                </div>
                <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
