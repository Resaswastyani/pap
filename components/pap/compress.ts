// Kompres gambar di browser sebelum diunggah: gambar (JPG/PNG/WEBP) > 2 MB diperkecil otomatis sampai <= 2 MB.
// File selain gambar (PDF, Office, dll.) tidak bisa dikompres di browser, jadi dikirim apa adanya (batas server tetap berlaku).
export const COMPRESS_TARGET_BYTES = 2 * 1024 * 1024

export const isCompressibleImage = (file: File) => /^image\/(jpeg|png|webp)$/.test(file.type)

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

// Foto profil: potong tengah jadi persegi 512 px, JPEG (kecil, cukup tajam untuk avatar)
export async function avatarImage(file: File): Promise<File> {
  if (!isCompressibleImage(file)) throw new Error('Foto profil harus berupa gambar JPG, PNG, atau WEBP.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`${file.name}: gambar tidak dapat dibaca.`))
      el.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const size = Math.min(512, side)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    const blob = await toBlob(canvas, 'image/jpeg', 0.85)
    if (!blob) throw new Error('Foto tidak dapat diproses.')
    return new File([blob], 'foto-profil.jpg', { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function compressImage(file: File, maxBytes = COMPRESS_TARGET_BYTES): Promise<File> {
  if (file.size <= maxBytes || !isCompressibleImage(file)) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`${file.name}: gambar tidak dapat dibaca.`))
      el.src = url
    })
    const base = file.name.replace(/\.\w+$/, '')
    // PNG/WEBP (bisa transparan) dicoba WEBP dulu agar transparansi tetap; selain itu / bila browser tak mendukung WEBP -> JPEG
    const keepAlpha = file.type !== 'image/jpeg'
    for (const [maxSide, quality] of [[4096, 0.85], [3000, 0.82], [2048, 0.8], [1600, 0.75], [1280, 0.7], [1024, 0.65]] as const) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')!
      if (keepAlpha) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const webp = await toBlob(canvas, 'image/webp', quality)
        if (webp?.type === 'image/webp' && webp.size <= maxBytes) return new File([webp], `${base}.webp`, { type: 'image/webp' })
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      // JPEG tidak mendukung transparansi: latar putih
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const jpeg = await toBlob(canvas, 'image/jpeg', quality)
      if (jpeg && jpeg.size <= maxBytes) return new File([jpeg], `${base}.jpg`, { type: 'image/jpeg' })
    }
    throw new Error(`${file.name}: gambar terlalu besar walau sudah diperkecil.`)
  } finally {
    URL.revokeObjectURL(url)
  }
}
