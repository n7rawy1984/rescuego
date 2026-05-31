import Navbar from '@/components/layout/Navbar'

export default function CustomerRequestLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 px-4 py-8 pt-20">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 space-y-3">
            <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-4 w-full max-w-md animate-pulse rounded bg-slate-200" />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 h-5 w-40 animate-pulse rounded bg-slate-200" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
            <div className="mt-6 h-11 animate-pulse rounded-lg bg-slate-200" />
          </div>
        </div>
      </main>
    </>
  )
}
