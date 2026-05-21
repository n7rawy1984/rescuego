import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'Roadside Recovery Dubai — Fast & Trusted | RescueGo',
  description: 'Broken down in Dubai? Find a trusted roadside recovery provider near you in minutes. Tow truck, battery, flat tire service across Dubai. Free for drivers.',
  alternates: { canonical: 'https://rescuego.ae/recovery/dubai' },
  keywords: ['roadside recovery Dubai', 'tow truck Dubai', 'car breakdown Dubai', 'سطحة دبي', 'recovery truck Dubai'],
}

const dubaiSchema = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'RescueGo Dubai',
  description: 'Roadside recovery service in Dubai — connecting drivers to trusted providers',
  url: 'https://rescuego.ae/recovery/dubai',
  areaServed: 'Dubai',
  serviceType: 'Roadside Assistance',
  address: { '@type': 'PostalAddress', addressLocality: 'Dubai', addressCountry: 'AE' },
}

export default function DubaiPage() {
  return (
    <>
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dubaiSchema) }} />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-20">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl md:text-5xl font-bold mb-4">Roadside Recovery Dubai — Fast &amp; Trusted</h1>
            <p className="text-slate-300 text-lg mb-8 max-w-2xl">Broken down in Dubai? RescueGo connects you to verified roadside recovery providers across all Dubai areas — from Downtown to Deira, JBR to Al Qusais.</p>
            <Link href="/customer/request" className="inline-block bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors">Request Recovery in Dubai</Link>
          </div>
        </section>

        <section className="py-12 px-4 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Roadside Recovery Services in Dubai</h2>
            <p className="text-slate-600 leading-relaxed mb-8">Dubai&apos;s fast-paced roads demand quick, reliable roadside assistance. Whether you&apos;re stuck on Sheikh Zayed Road, the Al Khail Road, or inside a mall parking lot, RescueGo connects you to a nearby, Emirates ID-verified provider within minutes. Services include tow trucks, battery jump start, flat tire change, and more.</p>
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
              <h3 className="font-bold text-slate-900 mb-2">Coverage Areas in Dubai</h3>
              <p className="text-slate-600 text-sm">Downtown Dubai · Dubai Marina · JBR · Deira · Bur Dubai · Al Qusais · Jumeirah · Business Bay · DIFC · Dubai Hills · Al Barsha · Mirdif · Al Quoz · Dubai Silicon Oasis · Dubai South</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
