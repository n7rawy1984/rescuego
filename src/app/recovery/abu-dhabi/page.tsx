import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'Car Breakdown Recovery Abu Dhabi | RescueGo',
  description: 'Broken down in Abu Dhabi? Find a trusted roadside recovery provider near you in minutes. Tow truck, battery, flat tire service across Abu Dhabi. Free for drivers.',
  alternates: { canonical: 'https://rescuego.ae/recovery/abu-dhabi' },
  keywords: ['roadside recovery Abu Dhabi', 'tow truck Abu Dhabi', 'car breakdown Abu Dhabi', 'recovery truck Abu Dhabi'],
}

const schema = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'RescueGo Abu Dhabi', description: 'Roadside recovery service in Abu Dhabi', url: 'https://rescuego.ae/recovery/abu-dhabi', areaServed: 'Abu Dhabi', serviceType: 'Roadside Assistance', address: { '@type': 'PostalAddress', addressLocality: 'Abu Dhabi', addressCountry: 'AE' } }

export default function AbuDhabiPage() {
  return (
    <>
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-20">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl md:text-5xl font-bold mb-4">Car Breakdown Recovery Abu Dhabi</h1>
            <p className="text-slate-300 text-lg mb-8 max-w-2xl">Stuck on the Abu Dhabi Corniche, Khalifa City, or Yas Island? RescueGo connects you to verified recovery providers across Abu Dhabi in minutes.</p>
            <Link href="/customer/request" className="inline-block bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors">Request Recovery in Abu Dhabi</Link>
          </div>
        </section>
        <section className="py-12 px-4 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Roadside Assistance Services in Abu Dhabi</h2>
            <p className="text-slate-600 leading-relaxed mb-8">Abu Dhabi&apos;s wide highways and long inter-emirate routes mean breakdowns can happen far from help. RescueGo ensures a verified provider reaches you quickly whether you&apos;re in the city centre, Al Reem Island, or on the way to Al Ain.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[["🔧",'Flat Tire','80–200 AED'],['⚡','Battery Jump','100–250 AED'],['🚛','Tow Truck','200–800 AED'],['🔍','Other','150–500 AED']].map(([icon, label, price]) => (
                <div key={label} className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-center">
                  <div className="text-3xl mb-2">{icon}</div>
                  <div className="font-semibold text-slate-800">{label}</div>
                  <div className="text-sm text-orange-600 mt-1">{price}</div>
                </div>
              ))}
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
              <h3 className="font-bold text-slate-900 mb-2">Coverage Areas in Abu Dhabi</h3>
              <p className="text-slate-600 text-sm">Abu Dhabi City · Khalifa City · Yas Island · Al Reem Island · Mohammed Bin Zayed City · Al Ain · Al Mushrif · Al Shamkha · Masdar City · Al Raha Beach</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
