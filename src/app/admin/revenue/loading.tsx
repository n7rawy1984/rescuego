import Navbar from '@/components/layout/Navbar'

export default function AdminRevenueLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 px-4 py-8 pt-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-3">
                <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
                <div className="h-8 w-44 animate-pulse rounded-lg bg-slate-200" />
                <div className="h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
              </div>
              <div className="h-10 w-40 animate-pulse rounded-lg bg-slate-200" />
            </div>
          </div>
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {[1, 2].map((item) => (
              <div key={item} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 p-5">
                  <div className="h-6 w-44 animate-pulse rounded bg-slate-200" />
                </div>
                <div className="divide-y divide-slate-100">
                  {[1, 2, 3].map((row) => (
                    <div key={row} className="h-16 animate-pulse bg-white" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
