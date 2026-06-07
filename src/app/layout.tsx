import type { Metadata, Viewport } from 'next'
import { Cairo } from 'next/font/google'
import './globals.css'
import { validateEnv } from '@/lib/env'

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  display: 'swap',
  variable: '--font-cairo',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://rescuego.ae'),
  title: {
    default: 'RescueGo - Roadside Recovery UAE',
    template: '%s | RescueGo UAE',
  },
  description: 'Broken down in the UAE? Find a trusted nearby recovery provider in minutes. Roadside assistance, tow truck, battery, and tire service across Dubai, Abu Dhabi, Sharjah, and all emirates.',
  keywords: [
    'roadside recovery Dubai',
    'tow truck UAE',
    'car breakdown service Dubai',
    'roadside assistance Abu Dhabi',
    'recovery truck Sharjah',
    'سطحة دبي',
    'خدمة ريكفري دبي',
    'مساعدة سيارات الإمارات',
  ],
  authors: [{ name: 'Mohamed Elnahrawy', url: 'https://elnahrawy.com' }],
  creator: 'Mohamed Elnahrawy',
  openGraph: {
    type: 'website',
    locale: 'en_AE',
    url: 'https://rescuego.ae',
    siteName: 'RescueGo',
    title: 'RescueGo - Roadside Recovery UAE',
    description: 'Broken down? Find a trusted recovery provider near you in minutes.',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630, alt: 'RescueGo - UAE Roadside Recovery' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RescueGo - Roadside Recovery UAE',
    description: 'Broken down? Find a trusted recovery provider near you in minutes.',
    images: ['/og-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  alternates: { canonical: 'https://rescuego.ae' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'RescueGo',
  description: "UAE's roadside recovery marketplace connecting drivers to trusted recovery providers",
  url: 'https://rescuego.ae',
  logo: 'https://rescuego.ae/logo.png',
  areaServed: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'UAE'],
  serviceType: 'Roadside Assistance',
  priceRange: 'Free for drivers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Run on every server render - Next.js caches this. Will throw at build time if envs are missing.
  if (process.env.NODE_ENV !== 'test') {
    validateEnv()
  }

  return (
    <html lang="ar" dir="ltr" className={cairo.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
        )}
      </head>
      <body className={cairo.className}>{children}</body>
    </html>
  )
}
