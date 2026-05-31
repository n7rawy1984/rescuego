import Navbar from '@/components/layout/Navbar'

export default function AdminRequestsLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 px-4 py-8 pt-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 space-y-3">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-5">
              <div className="h-6 w-44 animate-pulse rounded bg-slate-200" />
            </div>
            <div className="divide-y divide-slate-100">
              {[1, 2, 3, 4, 5].map((item) => (
                <div key={item} className="h-20 animate-pulse bg-white" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
