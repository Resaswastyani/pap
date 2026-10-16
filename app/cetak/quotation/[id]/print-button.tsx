'use client'

// Tombol cetak (tidak ikut tercetak). Di dialog cetak pilih "Simpan sebagai PDF" untuk mendapatkan file PDF.
export function PrintButton() {
  return (
    <div className="pap-print-bar">
      <span>Pilih <b>Simpan sebagai PDF</b> di dialog cetak untuk mengirim ke customer.</span>
      <button className="pap-primary-button" onClick={() => window.print()}>Cetak / Simpan PDF</button>
    </div>
  )
}
