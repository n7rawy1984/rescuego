import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <Link href="/" className="flex items-center gap-2 mb-4" aria-label="RescueGo home">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center" aria-hidden="true">
                <span className="text-white font-bold text-sm">R</span>
              </div>
              <span className="font-bold text-xl text-white">RescueGo</span>
            </Link>
            <p className="text-sm leading-relaxed">UAE&apos;s roadside recovery marketplace. Fast. Trusted. Available 24/7.</p>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">For Drivers</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/customer/request" className="hover:text-orange-400 transition-colors">Request Help</Link></li>
              <li><Link href="/customer/history" className="hover:text-orange-400 transition-colors">My Requests</Link></li>
              <li><Link href="/about" className="hover:text-orange-400 transition-colors">How It Works</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">For Providers</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/provider/register" className="hover:text-orange-400 transition-colors">Join as Provider</Link></li>
              <li><Link href="/pricing" className="hover:text-orange-400 transition-colors">Pricing Plans</Link></li>
              <li><Link href="/provider/dashboard" className="hover:text-orange-400 transition-colors">Dashboard</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-3">Coverage</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/recovery/dubai" className="hover:text-orange-400 transition-colors">Dubai</Link></li>
              <li><Link href="/recovery/abu-dhabi" className="hover:text-orange-400 transition-colors">Abu Dhabi</Link></li>
              <li><Link href="/recovery/sharjah" className="hover:text-orange-400 transition-colors">Sharjah</Link></li>
              <li><Link href="/recovery/ajman" className="hover:text-orange-400 transition-colors">Ajman</Link></li>
              <li><Link href="/recovery/ras-al-khaimah" className="hover:text-orange-400 transition-colors">Ras Al Khaimah</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800 pt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          <p>&copy; {new Date().getFullYear()} RescueGo. All rights reserved.</p>
          <p>Built by <a href="https://elnahrawy.com" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Mohamed Elnahrawy</a></p>
        </div>
      </div>
    </footer>
  )
}
