import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'About RescueGo — UAE Roadside Recovery Marketplace',
  description: "Learn about RescueGo — UAE's first open marketplace connecting drivers to vetted roadside recovery providers across all emirates.",
  alternates: { canonical: 'https://rescuego.ae/about' },
}

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-20 text-center">
          <h1 className="text-3xl md:text-5xl font-bold mb-4">About RescueGo</h1>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto">The UAE&apos;s first open marketplace for roadside recovery. Built for drivers, powered by providers.</p>
        </section>

        <section className="py-16 px-4 bg-white">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-16">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-4">The Problem We Solve</h2>
                <p className="text-slate-600 leading-relaxed mb-4">In the UAE, when your car breaks down — whether on Sheikh Zayed Road, the Abu Dhabi highway, or in the desert — you have no reliable way to find a nearby, trusted recovery provider quickly.</p>
                <p className="text-slate-600 leading-relaxed">Existing solutions are fragmented: phone calls, WhatsApp groups, or apps tied to a single company. No open marketplace exists. Until now.</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
                <div className="text-4xl mb-4">🚗</div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">Before RescueGo</h3>
                <ul className="flex flex-col gap-2 text-slate-600 text-sm">
                  {['Call 10 numbers to find someone available', 'No idea if provider is legitimate', 'No tracking — just wait and hope', 'Price negotiated on the spot', 'No way to rate or review'].map(p => (
                    <li key={p} className="flex items-center gap-2"><span className="text-red-400">✗</span>{p}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-16">
              <div className="bg-orange-50 rounded-2xl p-8 border border-orange-200 order-2 md:order-1">
                <div className="text-4xl mb-4">✅</div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">With RescueGo</h3>
                <ul className="flex flex-col gap-2 text-slate-600 text-sm">
                  {['One tap — providers notified instantly', 'Emirates ID verified providers only', 'Live GPS tracking on map', 'Price range shown before you request', 'Mandatory ratings after every job'].map(p => (
                    <li key={p} className="flex items-center gap-2"><span className="text-green-500">✓</span>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="order-1 md:order-2">
                <h2 className="text-2xl font-bold text-slate-900 mb-4">The RescueGo Solution</h2>
                <p className="text-slate-600 leading-relaxed mb-4">RescueGo connects drivers with broken-down vehicles to nearby, vetted recovery providers in real time. Providers pay to access the platform — customers use it completely free.</p>
                <p className="text-slate-600 leading-relaxed">We never touch customer money. You pay the provider directly, cash or card. We just connect you.</p>
              </div>
            </div>

            <div className="bg-slate-900 rounded-2xl p-10 text-white mb-16">
              <h2 className="text-2xl font-bold mb-6 text-center">Built by Mohamed Elnahrawy</h2>
              <p className="text-slate-300 text-center leading-relaxed max-w-2xl mx-auto mb-6">RescueGo was designed and built as a production-grade SaaS product for the UAE market. The platform uses modern technology — Supabase, Next.js, Stripe, and Google Maps — to deliver a real-time, reliable experience for both drivers and providers.</p>
              <div className="text-center">
                <a href="https://elnahrawy.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-semibold transition-colors">
                  Visit elnahrawy.com
                </a>
              </div>
            </div>

            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-900 mb-4">Ready to get started?</h2>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/customer/request" className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-xl font-semibold transition-colors">Request Recovery (Free)</Link>
                <Link href="/provider/register" className="border-2 border-slate-800 text-slate-800 hover:bg-slate-800 hover:text-white px-8 py-4 rounded-xl font-semibold transition-colors">Join as Provider</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
