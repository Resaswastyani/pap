'use client'

// Tombol cetak & unduh Word (tidak ikut tercetak). Di dialog cetak pilih "Simpan sebagai PDF" untuk mendapatkan file PDF.
export function PrintButton({ wordUrl }: { wordUrl?: string }) {
  return (
    <div className="pap-print-bar">
      <span>Pilih <b>Simpan sebagai PDF</b> di dialog cetak untuk mengirim ke customer.</span>
      <span className="pap-print-actions">
        {wordUrl && <a className="pap-btn" href={wordUrl}>Unduh Word</a>}
        <button className="pap-primary-button" onClick={() => window.print()}>Cetak / Simpan PDF</button>
      </span>
    </div>
  )
}
