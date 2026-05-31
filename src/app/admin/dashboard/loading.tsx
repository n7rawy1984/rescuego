import Navbar from '@/components/layout/Navbar'

export default function AdminDashboardLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 px-4 py-8 pt-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 space-y-3">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
          </div>
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
