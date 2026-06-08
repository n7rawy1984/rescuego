import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'Roadside Recovery Ras Al Khaimah',
  description: 'Car breakdown in Ras Al Khaimah? Find a roadside recovery provider near you fast. Tow truck, battery, flat tire service in RAK. Free for drivers.',
  alternates: { canonical: 'https://rescuego.ae/recovery/ras-al-khaimah' },
}

const schema = { '@context': 'https://schema.org', '@type': ['Service', 'EmergencyService'], name: 'RescueGo Ras Al Khaimah', description: 'Roadside recovery service in Ras Al Khaimah', url: 'https://rescuego.ae/recovery/ras-al-khaimah', areaServed: 'Ras Al Khaimah', serviceType: 'Roadside Assistance', provider: { '@id': 'https://rescuego.ae/#organization' }, address: { '@type': 'PostalAddress', addressLocality: 'Ras Al Khaimah', addressCountry: 'AE' } }

export default function RasAlKhaimahPage() {
  return (
    <>
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-20">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl md:text-5xl font-bold mb-4">Roadside Recovery Ras Al Khaimah</h1>
            <p className="text-slate-300 text-lg mb-8 max-w-2xl">Broken down in RAK? Whether in the city, on mountain roads, or near the beaches, RescueGo connects you to a verified recovery provider fast.</p>
            <Link href="/customer/request" className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors">Request Recovery in RAK</Link>
          </div>
        </section>
        <section className="py-12 px-4 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Roadside Recovery in Ras Al Khaimah</h2>
            <p className="text-slate-600 leading-relaxed mb-8">RAK&apos;s mix of city roads, coastal highways, and mountain areas requires versatile recovery services. RescueGo providers in RAK are experienced with all terrain types including off-road desert and mountain recovery.</p>
            <div className="bg-[#E1F5EE] border border-[#DDE7EE] rounded-xl p-6">
              <h3 className="font-bold text-slate-900 mb-2">Coverage Areas in Ras Al Khaimah</h3>
              <p className="text-slate-600 text-sm">RAK City · Al Hamra · Al Marjan Island · Khuzam · Al Nakheel · Dafan Al Nakheel · Wadi Shawka · Al Dhaya · Jebel Jais area</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
