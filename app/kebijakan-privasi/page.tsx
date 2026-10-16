import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Kebijakan Privasi · PAP Management System' }

const SUPPORT_EMAIL = 'informasiteknologi1.igp@gmail.com'

// Halaman publik: diwajibkan Google untuk aplikasi yang memakai login Google (akses Google Drive desain)
export default function KebijakanPrivasiPage() {
  return (
    <main className="pap-auth pap-forgot">
      <section className="pap-login-card pap-policy-card">
        <img className="pap-forgot-logo" src="/logo-pap.png" alt="PT. Pandawa Amerta Packindo" />
        <h1>Kebijakan Privasi</h1>
        <p className="pap-forgot-note">PAP Management System (PAP-MS) · PT. Pandawa Amerta Packindo</p>

        <h2>Tentang aplikasi</h2>
        <p>PAP-MS adalah sistem internal PT. Pandawa Amerta Packindo untuk mengelola data operasional perusahaan. Aplikasi ini hanya dipakai oleh karyawan yang memiliki akun.</p>

        <h2>Akses Google Drive</h2>
        <p>Admin dapat menghubungkan satu akun Google agar PAP-MS dapat menampilkan logo dan desain cetak dari folder Google Drive milik perusahaan. Akses yang diminta hanya <strong>melihat (read-only)</strong> file Google Drive dan alamat email akun tersebut.</p>
        <ul>
          <li>PAP-MS hanya membaca daftar file, nama, tanggal, dan gambar pratinjau dari folder desain yang ditentukan perusahaan.</li>
          <li>PAP-MS <strong>tidak</strong> mengubah, menghapus, mengunggah, atau membagikan file Google Drive.</li>
          <li>Token akses disimpan terenkripsi dan hanya dipakai server PAP-MS. Data tidak dijual atau dibagikan ke pihak ketiga.</li>
          <li>Admin dapat memutuskan akun kapan saja dari menu Master Data, atau mencabut izin melalui pengaturan akun Google (myaccount.google.com/permissions).</li>
        </ul>

        <h2>Data yang disimpan</h2>
        <p>PAP-MS menyimpan data akun pengguna, aktivitas kerja, serta data operasional (customer, produk, produksi, marketing) di server perusahaan untuk keperluan internal, dan menghapusnya sesuai kebijakan perusahaan.</p>

        <h2>Kontak</h2>
        <p>Pertanyaan tentang privasi dapat dikirim ke <a className="pap-forgot-email" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        <p className="pap-forgot-alt">Terakhir diperbarui: 16 Oktober 2026</p>
        <Link className="pap-forgot-back" href="/">Kembali ke PAP-MS</Link>
      </section>
    </main>
  )
}
