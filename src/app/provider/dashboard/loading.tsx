import NavbarSkeleton from '@/components/layout/NavbarSkeleton'

export default function ProviderDashboardLoading() {
  return (
    <>
      <NavbarSkeleton />
      <main className="min-h-screen bg-slate-50 px-4 py-8 pt-20">
        <div className="mx-auto max-w-6xl">
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-3">
                <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
                <div className="h-9 w-64 animate-pulse rounded-lg bg-slate-200" />
                <div className="flex gap-2">
                  <div className="h-7 w-20 animate-pulse rounded-full bg-slate-200" />
                  <div className="h-7 w-24 animate-pulse rounded-full bg-slate-200" />
                </div>
              </div>
              <div className="h-20 w-full animate-pulse rounded-xl bg-slate-100 sm:w-48" />
            </div>
          </section>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      </main>
    </>
  )
}
