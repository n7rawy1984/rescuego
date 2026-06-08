import type { Metadata } from 'next'
import Link from 'next/link'
import NavbarServer from '@/components/layout/NavbarServer'
import Footer from '@/components/layout/Footer'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'About RescueGo — UAE Roadside Recovery Marketplace',
  description: "Learn about RescueGo — UAE's first open marketplace connecting drivers to vetted roadside recovery providers across all emirates.",
  alternates: { canonical: 'https://rescuego.ae/about' },
}

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': 'https://rescuego.ae/#organization',
  name: 'RescueGo',
  url: 'https://rescuego.ae',
  logo: 'https://rescuego.ae/logo.png',
  description: "UAE's first open marketplace connecting drivers to vetted roadside recovery providers across all emirates.",
  foundingDate: '2024',
  areaServed: 'AE',
  sameAs: ['https://twitter.com/rescuego_ae'],
}

export default async function AboutPage() {
  const t = await getTranslations('about')

  const beforeItems = [0, 1, 2, 3, 4].map((i) => t(`before.items.${i}`))
  const afterItems = [0, 1, 2, 3, 4].map((i) => t(`after.items.${i}`))

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <NavbarServer />
      <main className="pt-16">
        <section className="bg-slate-950 text-white px-4 py-20 text-center">
          <h1 className="text-3xl md:text-5xl font-bold mb-4">{t('title')}</h1>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto">{t('heroSubtitle')}</p>
        </section>

        <section className="py-16 px-4 bg-white">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-16">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-4">{t('problem.title')}</h2>
                <p className="text-slate-600 leading-relaxed mb-4">{t('problem.p1')}</p>
                <p className="text-slate-600 leading-relaxed">{t('problem.p2')}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
                <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">{t('before.label')}</div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">{t('before.title')}</h3>
                <ul className="flex flex-col gap-2 text-slate-600 text-sm">
                  {beforeItems.map(p => (
                    <li key={p} className="flex items-center gap-2"><span className="text-red-400">x</span>{p}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-16">
              <div className="bg-[#E1F5EE] rounded-2xl p-8 border border-[#DDE7EE] order-2 md:order-1">
                <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#1D9E75]">{t('after.label')}</div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">{t('after.title')}</h3>
                <ul className="flex flex-col gap-2 text-slate-600 text-sm">
                  {afterItems.map(p => (
                    <li key={p} className="flex items-center gap-2"><span className="text-green-500">✓</span>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="order-1 md:order-2">
                <h2 className="text-2xl font-bold text-slate-900 mb-4">{t('solution.title')}</h2>
                <p className="text-slate-600 leading-relaxed mb-4">{t('solution.p1')}</p>
                <p className="text-slate-600 leading-relaxed">{t('solution.p2')}</p>
              </div>
            </div>

            <div className="bg-slate-900 rounded-2xl p-10 text-white mb-16">
              <h2 className="text-2xl font-bold mb-6 text-center">{t('builder.title')}</h2>
              <p className="text-slate-300 text-center leading-relaxed max-w-2xl mx-auto mb-6">{t('builder.description')}</p>
              <div className="text-center">
                <a href="https://elnahrawy.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-6 py-3 rounded-xl font-semibold transition-colors">
                  {t('builder.link')}
                </a>
              </div>
            </div>

            <div className="text-center">
              <h2 className="text-2xl font-bold text-slate-900 mb-4">{t('cta.title')}</h2>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/customer/request" className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-8 py-4 rounded-xl font-semibold transition-colors">{t('cta.requestRecovery')}</Link>
                <Link href="/provider/register" className="border-2 border-slate-800 text-slate-800 hover:bg-slate-800 hover:text-white px-8 py-4 rounded-xl font-semibold transition-colors">{t('cta.joinProvider')}</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
