'use client'

import { useEffect } from 'react'

const A4_WIDTH = 794

// Tombol cetak & unduh Word (tidak ikut tercetak). Di dialog cetak pilih "Simpan sebagai PDF" untuk mendapatkan file PDF.
export function PrintButton({ wordUrl, hint = 'untuk mengirim ke customer' }: { wordUrl?: string; hint?: string }) {
  // Di layar sempit (HP) lembar A4 diperkecil agar muat selebar layar; ukuran cetak tetap A4
  useEffect(() => {
    const fit = () => {
      const zoom = Math.min(1, (window.innerWidth - 16) / A4_WIDTH)
      document.documentElement.style.setProperty('--pap-sheet-zoom', zoom.toFixed(3))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <div className="pap-print-bar">
      <span>Pilih <b>Simpan sebagai PDF</b> di dialog cetak {hint}.</span>
      <span className="pap-print-actions">
        {wordUrl && <a className="pap-btn" href={wordUrl}>Unduh Word</a>}
        <button className="pap-primary-button" onClick={() => window.print()}>Cetak / Simpan PDF</button>
      </span>
    </div>
  )
}
