'use client'

import { useEffect } from 'react'

const A4_WIDTH = 794

// Tombol cetak & unduh Word (tidak ikut tercetak). Di dialog cetak pilih "Simpan sebagai PDF" untuk mendapatkan file PDF.
export function PrintButton({ wordUrl, hint = 'untuk mengirim ke customer', embed = false, autoPrint = false }: { wordUrl?: string; hint?: string; embed?: boolean; autoPrint?: boolean }) {
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
  // Dibuka dari tombol Cetak (?print=1): dialog cetak langsung muncul setelah lembar & logo termuat
  useEffect(() => {
    if (!autoPrint) return
    // Tunggu render tambahan (mis. pratinjau lampiran PDF di Analisa Teknik) bila ada
    const run = () => setTimeout(() => { Promise.resolve(window.papPrintReady).finally(() => window.print()) }, 300)
    if (document.readyState === 'complete') run()
    else window.addEventListener('load', run, { once: true })
  }, [autoPrint])
  // Mode pratinjau di dalam SIMPAP (iframe): tanpa bar, tombol cetak ada di jendela pratinjau
  if (embed) return null
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
