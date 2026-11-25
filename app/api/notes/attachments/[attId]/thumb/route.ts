import { fail, handle, int, requireUser } from '@/lib/api'
import { attachmentResponse, getNoteAttachment } from '@/lib/attachments'
import { attachmentDriveId } from '@/lib/attachment-preview'
import { driveEnabled, fetchThumbnail } from '@/lib/drive'
import { noteAccess } from '@/lib/note-access'

type Ctx = { params: Promise<{ attId: string }> }

// Pratinjau gambar lampiran: file gambar = isinya; link Google Drive = thumbnail Drive (akun Google di Master Data,
// atau thumbnail publik bila file dibagikan "siapa saja yang memiliki link"). Selain itu 404. ?s=1200
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const row = await getNoteAttachment(int((await ctx.params).attId) ?? fail(404, 'Lampiran tidak ditemukan.'))
  await noteAccess(row.owner_type, row.owner_id, user)
  if (row.kind === 'file') {
    if (/^image\/(jpeg|png|webp|gif)$/.test(row.mime ?? '')) return attachmentResponse(row, false)
    fail(404, 'Preview tidak tersedia.')
  }
  const fileId = attachmentDriveId(row.url ?? '') ?? fail(404, 'Preview tidak tersedia.')
  const size = Math.min(1600, Math.max(120, int(new URL(request.url).searchParams.get('s')) ?? 1200))
  let thumb = (await driveEnabled().catch(() => false)) ? await fetchThumbnail(fileId, size).catch(() => null) : null
  if (!thumb) {
    // aislop-ignore-next-line ai-slop/hardcoded-url -- endpoint thumbnail publik Google Drive (bukan URL lingkungan)
    const res = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`, { redirect: 'follow' }).catch(() => null)
    const type = res?.headers.get('content-type') ?? ''
    if (res?.ok && type.startsWith('image/')) thumb = { data: Buffer.from(await res.arrayBuffer()), type }
  }
  if (!thumb) fail(404, 'Preview tidak tersedia (file Drive belum dibagikan).')
  return new Response(new Uint8Array(thumb!.data), {
    headers: { 'Content-Type': thumb!.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  })
})
