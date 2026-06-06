import Navbar from '@/components/layout/Navbar'

export default function ProviderPendingLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 space-y-2">
            <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
