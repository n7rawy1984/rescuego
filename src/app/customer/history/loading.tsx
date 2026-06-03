import Navbar from '@/components/layout/Navbar'

export default function CustomerHistoryLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-8 pt-24">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-6 rounded-3xl border border-[#DDE7EE] bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-6">
            <div className="h-3 w-36 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-4 h-8 w-64 animate-pulse rounded-xl bg-slate-200" />
            <div className="mt-4 h-4 w-full max-w-xl animate-pulse rounded-full bg-slate-200" />
            <div className="mt-2 h-4 w-3/4 animate-pulse rounded-full bg-slate-200" />
          </div>

          <div className="overflow-hidden rounded-3xl border border-[#DDE7EE] bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5 sm:p-6">
              <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-4 w-48 animate-pulse rounded bg-slate-200" />
            </div>
            <div className="divide-y divide-slate-100">
              {[1, 2, 3].map((item) => (
                <div key={item} className="flex gap-3 p-5 sm:p-6">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-200" />
                  <div className="min-w-0 flex-1">
                    <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
                    <div className="mt-3 h-4 w-full max-w-md animate-pulse rounded bg-slate-200" />
                    <div className="mt-3 h-3 w-28 animate-pulse rounded bg-slate-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
