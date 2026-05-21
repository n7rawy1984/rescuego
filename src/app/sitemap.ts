import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://rescuego.ae'
  const lastModified = new Date()

  return [
    { url: baseUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/pricing`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/about`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/provider/register`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/recovery/dubai`, lastModified, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/recovery/abu-dhabi`, lastModified, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/recovery/sharjah`, lastModified, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/recovery/ajman`, lastModified, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/recovery/ras-al-khaimah`, lastModified, changeFrequency: 'weekly', priority: 0.7 },
  ]
}
