import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export default function CustomerHistoryLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
            <div className="mt-3 h-4 w-72 animate-pulse rounded bg-slate-200" />
          </div>
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader>
              <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
            </CardHeader>
            <CardBody>
              <div className="space-y-4">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="rounded-xl border border-slate-100 p-4">
                    <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
                    <div className="mt-2 h-4 w-full max-w-sm animate-pulse rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  )
}
