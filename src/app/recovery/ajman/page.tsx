import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'Recovery Service Ajman',
  description: 'Car breakdown in Ajman? Find a roadside recovery provider near you fast. Tow truck, battery, flat tire service in Ajman. Free for drivers.',
  alternates: { canonical: 'https://rescuego.ae/recovery/ajman' },
}

const schema = { '@context': 'https://schema.org', '@type': ['Service', 'EmergencyService'], name: 'RescueGo Ajman', description: 'Roadside recovery service in Ajman', url: 'https://rescuego.ae/recovery/ajman', areaServed: 'Ajman', serviceType: 'Roadside Assistance', provider: { '@id': 'https://rescuego.ae/#organization' }, address: { '@type': 'PostalAddress', addressLocality: 'Ajman', addressCountry: 'AE' } }

export default function AjmanPage() {
  return (
    <>
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-20">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl md:text-5xl font-bold mb-4">Recovery Service Ajman</h1>
            <p className="text-slate-300 text-lg mb-8 max-w-2xl">Stuck in Ajman? RescueGo connects you to nearby verified recovery providers — fast, reliable, and free for drivers.</p>
            <Link href="/customer/request" className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors">Request Recovery in Ajman</Link>
          </div>
        </section>
        <section className="py-12 px-4 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Roadside Recovery Services in Ajman</h2>
            <p className="text-slate-600 leading-relaxed mb-8">Ajman&apos;s compact size means recovery providers can reach you quickly. RescueGo covers Ajman city, Al Rumailah, Al Rashidiya, and surrounding areas.</p>
            <div className="bg-[#E1F5EE] border border-[#DDE7EE] rounded-xl p-6">
              <h3 className="font-bold text-slate-900 mb-2">Coverage Areas in Ajman</h3>
              <p className="text-slate-600 text-sm">Ajman City · Al Rashidiya · Al Rumailah · Al Nuaimia · Al Jurf · Al Hamidiya · Masfout · Manama</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
