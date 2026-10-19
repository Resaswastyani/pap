import type { MetadataRoute } from 'next'

// Manifest PWA: aplikasi bisa dipasang ke Home Screen. Di iPhone ini syarat agar notifikasi push bisa masuk.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PAP Management System',
    short_name: 'PAP-MS',
    description: 'Sistem manajemen operasional PT Pandawa Amerta Packindo',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff', // sama dengan latar splash logo di HP
    theme_color: '#23264b',
    lang: 'id',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      // Ikon status bar notifikasi saat aplikasi terpasang di Android: siluet logo putih, latar transparan.
      // Tanpa ini Android memakai siluet ikon di atas (opak) sehingga tampil sebagai kotak putih.
      { src: '/icon-monochrome-192.png', sizes: '192x192', type: 'image/png', purpose: 'monochrome' },
      { src: '/icon-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
    ],
  }
}
