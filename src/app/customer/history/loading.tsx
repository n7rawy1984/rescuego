import Navbar from '@/components/layout/Navbar'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export default function CustomerHistoryLoading() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-slate-50 pt-16 px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8">
            <div className="h-8 w-56 rounded bg-slate-100" />
            <div className="mt-3 h-4 w-72 rounded bg-slate-100" />
          </div>
          <Card>
            <CardHeader>
              <div className="h-5 w-32 rounded bg-slate-100" />
            </CardHeader>
            <CardBody>
              <div className="space-y-4">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="rounded-xl border border-slate-100 p-4">
                    <div className="h-5 w-40 rounded bg-slate-100" />
                    <div className="mt-2 h-4 w-full max-w-sm rounded bg-slate-100" />
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
