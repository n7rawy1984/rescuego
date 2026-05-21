import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pricing', '/about', '/recovery/', '/provider/register'],
        disallow: ['/admin/', '/provider/dashboard', '/customer/', '/auth/', '/api/'],
      },
    ],
    sitemap: 'https://rescuego.ae/sitemap.xml',
  }
}
