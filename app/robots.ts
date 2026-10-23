import type { MetadataRoute } from 'next'

// Sistem internal. Halaman utama tetap boleh dirayapi agar Google membaca tag noindex (X-Robots-Tag & meta robots)
// dan menghapusnya dari hasil pencarian; API & dokumen cetak tidak perlu dirayapi sama sekali.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/cetak/', '/dev/'] },
      // Crawler AI / scraper: tolak seluruhnya
      { userAgent: ['GPTBot', 'ChatGPT-User', 'CCBot', 'Google-Extended', 'anthropic-ai', 'ClaudeBot', 'PerplexityBot', 'Bytespider', 'Amazonbot'], disallow: '/' },
    ],
  }
}
