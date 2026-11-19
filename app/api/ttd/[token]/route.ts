import { signatureImage } from '@/lib/quotation-signature'

type Ctx = { params: Promise<{ token: string }> }

// Gambar tanda tangan digital untuk dokumen (publik lewat token acak; dibutuhkan file Word yang mengambil gambar lewat URL)
export async function GET(_request: Request, ctx: Ctx) {
  const img = await signatureImage((await ctx.params).token)
  if (!img) return new Response('Tidak ditemukan', { status: 404 })
  return new Response(new Uint8Array(img.data), {
    headers: { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  })
}
