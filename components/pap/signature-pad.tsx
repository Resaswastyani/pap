'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Eraser, ImageUp, Undo2 } from 'lucide-react'

// Bidang tanda tangan: gambar dengan jari / stylus / mouse (pointer events), garis halus, tajam di layar HiDPI,
// urungkan / hapus, atau unggah foto tanda tangan. Hasil: PNG transparan (dipotong rapi ke area coretan).

export type SignaturePadHandle = { toDataUrl: () => string | null; isEmpty: () => boolean; clear: () => void; load: (dataUrl: string) => void }
type Point = { x: number; y: number; p: number }

export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void; disabled?: boolean }>(function SignaturePad({ onChange, disabled }, ref) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const strokes = useRef<Point[][]>([])
  const image = useRef<HTMLImageElement | null>(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const redraw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const ratio = window.devicePixelRatio || 1
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    const w = c.width / ratio
    const h = c.height / ratio
    if (image.current) {
      const img = image.current
      const scale = Math.min((w - 24) / img.width, (h - 24) / img.height, 1)
      ctx.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale)
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#14215a'
    for (const s of strokes.current) {
      if (s.length === 1) {
        ctx.beginPath()
        ctx.arc(s[0].x, s[0].y, 1.4, 0, Math.PI * 2)
        ctx.fillStyle = '#14215a'
        ctx.fill()
        continue
      }
      // Kurva kuadratik antar titik tengah agar garis halus; tebal mengikuti tekanan stylus
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]
        const b = s[i]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const prevMid = i > 1 ? { x: (s[i - 2].x + a.x) / 2, y: (s[i - 2].y + a.y) / 2 } : a
        ctx.lineWidth = 1.6 + 1.6 * (b.p || 0.5)
        ctx.beginPath()
        ctx.moveTo(prevMid.x, prevMid.y)
        ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y)
        ctx.stroke()
      }
    }
  }, [])

  // Ukuran kanvas mengikuti lebar kotak (responsif) dengan resolusi sesuai layar
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const fit = () => {
      const box = c.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      c.width = Math.max(1, Math.round(box.width * ratio))
      c.height = Math.max(1, Math.round(box.height * ratio))
      redraw()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    return () => ro.disconnect()
  }, [redraw])

  const update = useCallback(() => {
    const e = !strokes.current.length && !image.current
    setEmpty(e)
    onChange?.(e)
  }, [onChange])

  const point = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top, p: e.pointerType === 'pen' ? e.pressure : 0.5 }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    strokes.current.push([point(e)])
    redraw()
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    e.preventDefault()
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
    const box = e.currentTarget.getBoundingClientRect()
    const s = strokes.current[strokes.current.length - 1]
    for (const ev of events) s.push({ x: ev.clientX - box.left, y: ev.clientY - box.top, p: ev.pointerType === 'pen' ? ev.pressure : 0.5 })
    redraw()
  }
  function up() {
    if (!drawing.current) return
    drawing.current = false
    update()
  }
  function clear() {
    strokes.current = []
    image.current = null
    redraw()
    update()
  }
  function undo() {
    if (strokes.current.length) strokes.current.pop()
    else image.current = null
    redraw()
    update()
  }
  function loadImage(src: string, removeBackground = false) {
    const img = new Image()
    img.onload = () => {
      let ready: HTMLImageElement = img
      if (removeBackground) {
        // Foto tanda tangan di kertas: latar terang dibuat transparan, tinta dipertahankan
        const scale = Math.min(1, 1200 / Math.max(img.width, img.height))
        const tmp = document.createElement('canvas')
        tmp.width = Math.round(img.width * scale)
        tmp.height = Math.round(img.height * scale)
        const t = tmp.getContext('2d')!
        t.drawImage(img, 0, 0, tmp.width, tmp.height)
        const px = t.getImageData(0, 0, tmp.width, tmp.height)
        for (let i = 0; i < px.data.length; i += 4) {
          const lum = 0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2]
          px.data[i + 3] = lum > 175 ? 0 : lum > 120 ? Math.round(((175 - lum) / 55) * 255) : 255
        }
        t.putImageData(px, 0, 0)
        ready = new Image()
        ready.onload = () => { image.current = ready; strokes.current = []; redraw(); update() }
        ready.src = tmp.toDataURL('image/png')
        return
      }
      image.current = ready
      strokes.current = []
      redraw()
      update()
    }
    img.src = src
  }
  function upload(file: File | undefined) {
    if (!file || !/^image\//.test(file.type)) return
    const reader = new FileReader()
    reader.onload = () => loadImage(String(reader.result), true)
    reader.readAsDataURL(file)
  }

  // Ekspor PNG dipotong ke area yang berisi tanda tangan (+ margin), lebar maks 600 px
  function toDataUrl() {
    const c = canvas.current
    if (!c || (!strokes.current.length && !image.current)) return null
    const ctx = c.getContext('2d')!
    const { width, height } = c
    const data = ctx.getImageData(0, 0, width, height).data
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (data[(y * width + x) * 4 + 3] > 16) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null
    const pad = 12 * (window.devicePixelRatio || 1)
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
    maxX = Math.min(width, maxX + pad); maxY = Math.min(height, maxY + pad)
    const w = maxX - minX
    const h = maxY - minY
    const scale = Math.min(1, 600 / w)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(w * scale))
    out.height = Math.max(1, Math.round(h * scale))
    out.getContext('2d')!.drawImage(c, minX, minY, w, h, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  useImperativeHandle(ref, () => ({ toDataUrl, isEmpty: () => !strokes.current.length && !image.current, clear, load: loadImage }))

  return (
    <div className={`pap-sigpad ${disabled ? 'disabled' : ''}`}>
      <div className="pap-sigpad-area">
        <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} aria-label="Area tanda tangan: gambar tanda tangan di sini" role="img" />
        <div className="pap-sigpad-line" aria-hidden><span>×</span></div>
        {empty && <div className="pap-sigpad-hint" aria-hidden>Tanda tangan di sini</div>}
      </div>
      <div className="pap-sigpad-tools">
        <button type="button" className="pap-btn" onClick={undo} disabled={empty || disabled}><Undo2 /> Urungkan</button>
        <button type="button" className="pap-btn" onClick={clear} disabled={empty || disabled}><Eraser /> Hapus</button>
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={() => fileInput.current?.click()} disabled={disabled}><ImageUp /> Unggah foto ttd</button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </div>
  )
})
