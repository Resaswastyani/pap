'use client'

// Pratinjau PDF di browser: halaman pertama dirender (pdf.js) menjadi gambar JPEG agar bisa tampil & ikut tercetak.
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> }
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> }

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
  return pdfjs
}

// width: lebar gambar hasil (px). Hasil: data URL JPEG + jumlah halaman PDF
export async function pdfFirstPage(url: string, width = 1400) {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`PDF tidak bisa dibuka (${res.status})`)
  const data = new Uint8Array(await res.arrayBuffer())
  const pdfjs = await loadPdfJs()
  // aislop-ignore-next-line ai-slop/double-type-assertion -- tipe pdf.js diringkas ke bagian yang dipakai saja (sama seperti training-materi)
  const doc = (await pdfjs.getDocument({ data }).promise) as unknown as PdfDoc
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: width / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return { src: canvas.toDataURL('image/jpeg', 0.9), pages: doc.numPages }
  } finally {
    await doc.destroy()
  }
}
