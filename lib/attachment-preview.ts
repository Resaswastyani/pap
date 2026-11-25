// Pratinjau lampiran (dipakai di browser & server): file gambar, link Google Drive, link gambar langsung,
// atau kartu nama file / link untuk format lain (PDF, CDR, AI, link katalog, dll.).
export type PreviewAttachment = { id: number; kind: 'file' | 'link'; name: string; url: string | null; mime: string | null }
export type AttachmentPreview = { name: string; src: string | null; href: string; type: string; isLink: boolean }

// Id file dari link Google Drive / Docs ("/file/d/<id>", "open?id=<id>", "uc?id=<id>"); folder tidak punya pratinjau
export function attachmentDriveId(url: string) {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (!/(^|\.)(drive|docs)\.google\.com$/.test(u.hostname) || u.pathname.includes('/folders/')) return null
  const m = u.pathname.match(/\/d\/([a-zA-Z0-9_-]{20,})/)
  return m ? m[1] : (u.searchParams.get('id')?.match(/^[a-zA-Z0-9_-]{20,}$/)?.[0] ?? null)
}

const isImageUrl = (url: string) => /^https?:\/\/[^\s]+\.(png|jpe?g|webp|gif)(\?[^\s]*)?$/i.test(url)
const extOf = (name: string) => name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toUpperCase() ?? ''

// fileBase: awalan URL lampiran (mis. "/api/notes/attachments", atau absolut untuk Word)
export function attachmentPreview(a: PreviewAttachment, fileBase = '/api/notes/attachments'): AttachmentPreview {
  if (a.kind === 'link') {
    const url = a.url ?? ''
    const drive = attachmentDriveId(url)
    return {
      name: a.name || url, href: url, isLink: true,
      src: drive ? `${fileBase}/${a.id}/thumb?s=1200` : isImageUrl(url) ? url : null,
      type: drive ? 'Google Drive' : 'Link',
    }
  }
  const image = /^image\/(jpeg|png|webp|gif)$/.test(a.mime ?? '')
  return {
    name: a.name, href: `${fileBase}/${a.id}`, isLink: false,
    src: image ? `${fileBase}/${a.id}` : null,
    type: image ? 'Gambar' : a.mime === 'application/pdf' ? 'PDF' : extOf(a.name) || 'File',
  }
}
