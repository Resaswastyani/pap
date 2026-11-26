import { signatureImage } from '@/lib/quotation-signature'
import { taSignatureImage } from '@/lib/tech-analysis-signature'

type Ctx = { params: Promise<{ token: string }> }

// Gambar tanda tangan digital untuk dokumen (penawaran & analisa teknik) (publik lewat token acak; dibutuhkan file Word yang mengambil gambar lewat URL)
export async function GET(_request: Request, ctx: Ctx) {
  // Penawaran, lalu Analisa Teknik (token acak unik di masing-masing tabel)
  const token = (await ctx.params).token
  const img = (await signatureImage(token)) ?? (await taSignatureImage(token))
  if (!img) return new Response('Tidak ditemukan', { status: 404 })
  return new Response(new Uint8Array(img.data), {
    headers: { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  })
}
