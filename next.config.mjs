/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Minta browser (Chrome/Edge/Samsung Internet) mengirim model HP & versi OS pada request berikutnya,
  // dipakai log aktivitas untuk mencatat merek perangkat (User-Agent Android modern menyembunyikan model).
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Accept-CH', value: 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version' },
      // Semua halaman, API, PDF & file: jangan diindeks / diarsipkan mesin pencari
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet, noimageindex' },
    ] }]
  },
}

export default nextConfig
