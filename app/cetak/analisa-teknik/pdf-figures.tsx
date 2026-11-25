'use client'

import { useEffect } from 'react'
import { pdfFirstPage } from '@/components/pap/pdf-preview'

declare global { interface Window { papPrintReady?: Promise<unknown> } }

// Lembar cetak Analisa Teknik: lampiran PDF ([data-pdf]) dirender halaman pertamanya menjadi gambar,
// menggantikan kartu "Pratinjau tidak tersedia". Cetak otomatis (?print=1) menunggu sampai selesai.
export function PdfFigures() {
  useEffect(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('[data-pdf]')].filter((el) => !el.dataset.done)
    if (!boxes.length) return
    window.papPrintReady = Promise.allSettled(boxes.map(async (box) => {
      box.dataset.done = '1'
      const { src, pages } = await pdfFirstPage(box.dataset.pdf!)
      const img = document.createElement('img')
      img.src = src
      img.alt = box.dataset.name ?? 'PDF'
      box.replaceChildren(img)
      const card = box.nextElementSibling as HTMLElement | null
      if (card?.classList.contains('ta1-filecard')) card.style.display = 'none'
      if (pages > 1) {
        const note = document.createElement('p')
        note.className = 'ta1-pdfnote'
        note.textContent = `Halaman 1 dari ${pages} halaman PDF · halaman lain lewat link di bawah`
        box.append(note)
      }
    }))
  }, [])
  return null
}
