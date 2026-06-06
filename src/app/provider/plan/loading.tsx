import Navbar from '@/components/layout/Navbar'

export default function ProviderPlanLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
            <div className="h-8 w-40 animate-pulse rounded-lg bg-slate-200" />
          </div>
          <div className="space-y-4">
            <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
            <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
            <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white shadow-sm" />
          </div>
        </div>
      </main>
    </>
  )
}
