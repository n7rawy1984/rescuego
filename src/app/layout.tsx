import type { Metadata, Viewport } from 'next'
import { Cairo } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
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
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RescueGo - Roadside Recovery UAE',
    description: 'Broken down? Find a trusted recovery provider near you in minutes.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  alternates: {
    canonical: 'https://rescuego.ae',
    languages: {
      'ar-AE': 'https://rescuego.ae',
      'en-AE': 'https://rescuego.ae',
    },
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': ['LocalBusiness', 'EmergencyService'],
  '@id': 'https://rescuego.ae/#organization',
  name: 'RescueGo',
  description: "UAE's roadside recovery marketplace connecting drivers to trusted recovery providers",
  url: 'https://rescuego.ae',
  logo: 'https://rescuego.ae/logo.png',
  telephone: '+971-50-000-0000',
  areaServed: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'UAE'],
  serviceType: 'Roadside Assistance',
  priceRange: 'Free for drivers',
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Dubai',
    addressRegion: 'Dubai',
    addressCountry: 'AE',
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: 25.2048,
    longitude: 55.2708,
  },
  openingHoursSpecification: {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: '00:00',
    closes: '23:59',
  },
  sameAs: [
    'https://twitter.com/rescuego_ae',
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'test') {
    validateEnv()
  }

  const messages = await getMessages()
  const locale = await getLocale()

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={cairo.variable} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
        )}
      </head>
      <body className={cairo.className} suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
