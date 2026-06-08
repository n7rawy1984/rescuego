import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://rescuego.ae'

  return [
    { url: baseUrl, lastModified: '2025-06-01', changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/pricing`, lastModified: '2025-06-01', changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/about`, lastModified: '2025-05-15', changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/provider/register`, lastModified: '2025-06-01', changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/recovery/dubai`, lastModified: '2025-06-01', changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/recovery/abu-dhabi`, lastModified: '2025-06-01', changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/recovery/sharjah`, lastModified: '2025-06-01', changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/recovery/ajman`, lastModified: '2025-06-01', changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/recovery/ras-al-khaimah`, lastModified: '2025-06-01', changeFrequency: 'weekly', priority: 0.7 },
  ]
}
