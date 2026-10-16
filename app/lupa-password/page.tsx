import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Lupa Password · PAP Management System' }

const SUPPORT_EMAIL = 'informasiteknologi1.igp@gmail.com'
const SUBJECT = 'Lupa Password'
const BODY = 'Halo Tim IT,\n\nSaya lupa password akun PAP Management System. Mohon bantuan untuk reset password.\n\nNama:\nEmail akun:\nDivisi:\n\nTerima kasih.'

// Langsung membuka jendela tulis email di Gmail dengan penerima, subject, dan isi terisi
const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${SUPPORT_EMAIL}&su=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(BODY)}`
// Cadangan untuk aplikasi email lain (mis. di HP tanpa Gmail)
const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(BODY)}`

export default function LupaPasswordPage() {
  return (
    <main className="pap-auth pap-forgot">
      <section className="pap-login-card pap-forgot-card">
        <div className="pap-forgot-head">
          <img className="pap-forgot-logo" src="/logo-pap.png" alt="PT. Pandawa Amerta Packindo" />
          <h1>Lupa password?</h1>
          <p className="pap-forgot-note">PAP Management System</p>
        </div>
        <div className="pap-forgot-body">
          <p>Password tidak dapat direset sendiri. Hubungi admin sistem (Staff IT) untuk bantuan.</p>
          <p>
            Anda dapat menghubungi email{' '}
            <a className="pap-forgot-email" href={gmailUrl} target="_blank" rel="noopener noreferrer">{SUPPORT_EMAIL}</a>{' '}
            dengan subject <strong>&ldquo;{SUBJECT}&rdquo;</strong>.
          </p>
          <div className="pap-forgot-actions">
            <a className="pap-primary-button" href={gmailUrl} target="_blank" rel="noopener noreferrer">Kirim email lewat Gmail</a>
            <Link className="pap-forgot-back" href="/">Kembali ke halaman login</Link>
          </div>
          <p className="pap-forgot-alt">
            Tidak memakai Gmail? <a href={mailtoUrl}>Buka di aplikasi email lain</a>.
          </p>
        </div>
      </section>
    </main>
  )
}
