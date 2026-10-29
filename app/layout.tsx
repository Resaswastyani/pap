import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PAP Management System',
  description: 'Sistem manajemen operasional PT Pandawa Amerta Packindo — produsen kantong plastik HD, PP, PE dan mika rigid. Focus on Quality.',
  // Sistem internal: jangan diindeks mesin pencari (lihat juga X-Robots-Tag di next.config.mjs & app/robots.ts)
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true, 'max-snippet': 0, 'max-image-preview': 'none' } },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: '/apple-icon.png',
  },
  appleWebApp: { capable: true, title: 'PAP-MS', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* Buka koneksi ke reCAPTCHA lebih awal agar widget & centang checkbox lebih cepat */}
        <link rel="preconnect" href="https://www.google.com" />
        <link rel="preconnect" href="https://www.gstatic.com" />
        {/* Splash logo hanya sekali per pembukaan aplikasi (sesi); dijalankan sebelum halaman tampil */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(sessionStorage.getItem('pap-splash'))document.documentElement.classList.add('pap-no-splash');else sessionStorage.setItem('pap-splash','1')}catch(e){}" }} />
      </head>
      <body className="antialiased">
        {/* Splash logo di HP (Android & iOS) selama 3 detik sebelum login. Murni CSS agar langsung tampil tanpa menunggu JavaScript. */}
        <div className="pap-splash" aria-hidden="true">
          <img src="/logo-pap.png" alt="" />
          <span>Focus on Quality</span>
        </div>
        {children}
      </body>
    </html>
  )
}
