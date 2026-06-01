import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'Roadside Assistance Sharjah | RescueGo',
  description: 'Car breakdown in Sharjah? Find a nearby roadside recovery provider fast. Tow truck, battery, tire service in Sharjah. Free for drivers.',
  alternates: { canonical: 'https://rescuego.ae/recovery/sharjah' },
}

const schema = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'RescueGo Sharjah', description: 'Roadside recovery service in Sharjah', url: 'https://rescuego.ae/recovery/sharjah', areaServed: 'Sharjah', serviceType: 'Roadside Assistance', address: { '@type': 'PostalAddress', addressLocality: 'Sharjah', addressCountry: 'AE' } }

export default function SharjahPage() {
  return (
    <>
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-20">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl md:text-5xl font-bold mb-4">Roadside Assistance Sharjah</h1>
            <p className="text-slate-300 text-lg mb-8 max-w-2xl">Broken down in Sharjah? Get connected to a verified recovery provider fast — across Al Nahda, Al Qasimia, and all Sharjah areas.</p>
            <Link href="/customer/request" className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors">Request Recovery in Sharjah</Link>
          </div>
        </section>
        <section className="py-12 px-4 bg-white">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Recovery Services in Sharjah</h2>
            <p className="text-slate-600 leading-relaxed mb-8">Sharjah&apos;s busy roads connecting to Dubai and the northern emirates make roadside assistance critical. RescueGo covers all of Sharjah including the eastern and western coastal areas.</p>
            <div className="bg-[#E1F5EE] border border-[#DDE7EE] rounded-xl p-6">
              <h3 className="font-bold text-slate-900 mb-2">Coverage Areas in Sharjah</h3>
              <p className="text-slate-600 text-sm">Al Nahda · Al Qasimia · Al Majaz · Al Taawun · Al Khan · Industrial Area · Muwailih · Al Jurainah · Khorfakkan · Kalba</p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
