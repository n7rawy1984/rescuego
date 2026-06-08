import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function Footer() {
  const t = await getTranslations('footer')
  const tLanding = await getTranslations('landing')
  const tNav = await getTranslations('nav')

  return (
    <footer className="bg-[#07122B] text-slate-400 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <Link href="/" className="flex items-center gap-2 mb-4" aria-label="RescueGo home">
              <div className="w-8 h-8 bg-[#1D9E75] rounded-lg flex items-center justify-center" aria-hidden="true">
                <span className="text-white font-bold text-sm">R</span>
              </div>
              <span className="font-bold text-xl text-white">RescueGo</span>
            </Link>
            <p className="text-sm leading-relaxed">{tLanding('hero.subtitle')}</p>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">{t('forDrivers')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/customer/request" className="hover:text-[#1D9E75] transition-colors">{tNav('request')}</Link></li>
              <li><Link href="/customer/history" className="hover:text-[#1D9E75] transition-colors">{tNav('history')}</Link></li>
              <li><Link href="/about" className="hover:text-[#1D9E75] transition-colors">{tNav('about')}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">{t('forProviders')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/provider/register" className="hover:text-[#1D9E75] transition-colors">{tLanding('hero.ctaProvider')}</Link></li>
              <li><Link href="/pricing" className="hover:text-[#1D9E75] transition-colors">{tNav('pricing')}</Link></li>
              <li><Link href="/provider/dashboard" className="hover:text-[#1D9E75] transition-colors">{tNav('dashboard')}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">{tLanding('coverage.title')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/recovery/dubai" className="hover:text-[#1D9E75] transition-colors">{tLanding('coverage.dubai')}</Link></li>
              <li><Link href="/recovery/abu-dhabi" className="hover:text-[#1D9E75] transition-colors">{tLanding('coverage.abuDhabi')}</Link></li>
              <li><Link href="/recovery/sharjah" className="hover:text-[#1D9E75] transition-colors">{tLanding('coverage.sharjah')}</Link></li>
              <li><Link href="/recovery/ajman" className="hover:text-[#1D9E75] transition-colors">{tLanding('coverage.ajman')}</Link></li>
              <li><Link href="/recovery/ras-al-khaimah" className="hover:text-[#1D9E75] transition-colors">{tLanding('coverage.rasAlKhaimah')}</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800 pt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          <p>{t('copyright', { year: new Date().getFullYear() })}</p>
          <p>{t.rich('builtBy', { link: (chunks) => <a href="https://elnahrawy.com" target="_blank" rel="noopener noreferrer" className="text-[#F59E0B] hover:text-[#9FE1CB]">{chunks}</a> })}</p>
        </div>
      </div>
    </footer>
  )
}
