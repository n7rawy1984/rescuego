import NavbarSkeleton from '@/components/layout/NavbarSkeleton'

export default function AdminPerformanceLoading() {
  return (
    <>
      <NavbarSkeleton />
      <main className="min-h-screen bg-slate-50 px-4 py-8 pt-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="space-y-3">
              <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
              <div className="h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-5">
              <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
            </div>
            <div className="divide-y divide-slate-100">
              {[1, 2, 3, 4, 5, 6].map((row) => (
                <div key={row} className="h-16 animate-pulse bg-white" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
