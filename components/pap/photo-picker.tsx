'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Image as ImageIcon, RefreshCw, SwitchCamera } from 'lucide-react'
import { Modal, Notice } from './ui'

// Tombol ambil foto dengan dua pilihan: Buka Galeri / Buka Kamera.
// HP & tablet: kamera bawaan lewat <input capture>. Laptop / PC: webcam langsung di SIMPAP (getUserMedia);
// bila webcam tidak tersedia atau ditolak, tampil pesan dan bisa pilih dari galeri.
const isTouchDevice = () => typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))

export function PhotoPicker({ label, onFile, disabled }: { label: string; onFile: (file: File) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [webcam, setWebcam] = useState(false)
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    // Esc menutup menu saja, tidak ikut menutup form di belakangnya
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [open])

  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onFile(file)
  }
  const openCamera = () => {
    setOpen(false)
    const canWebcam = !!navigator.mediaDevices?.getUserMedia
    if (isTouchDevice() || !canWebcam) cameraRef.current?.click()
    else setWebcam(true)
  }

  return (
    <div className="pap-photo-picker" ref={wrapRef}>
      <button type="button" className="pap-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{label}</button>
      {open && (
        <div className="pap-photo-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); galleryRef.current?.click() }}><ImageIcon /> Buka Galeri</button>
          <button type="button" role="menuitem" onClick={openCamera}><Camera /> Buka Kamera</button>
        </div>
      )}
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={picked} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      {webcam && <WebcamDialog onClose={() => setWebcam(false)} onCapture={(f) => { setWebcam(false); onFile(f) }} onGallery={() => { setWebcam(false); galleryRef.current?.click() }} />}
    </div>
  )
}

function WebcamDialog({ onClose, onCapture, onGallery }: { onClose: () => void; onCapture: (file: File) => void; onGallery: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [cams, setCams] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  // Esc menutup jendela kamera saja (form check-in tetap terbuka)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    let alive = true
    setReady(false)
    setError('')
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (stream) => {
        if (!alive) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}) }
        setReady(true)
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        if (alive) setCams(devices.filter((d) => d.kind === 'videoinput').length)
      })
      .catch((err: DOMException) => {
        if (!alive) return
        setError(err?.name === 'NotAllowedError' ? 'Akses kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu coba lagi.'
          : err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'Kamera tidak ditemukan di perangkat ini.'
          : err?.name === 'NotReadableError' ? 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.'
          : 'Kamera tidak bisa dibuka di browser ini.')
      })
    return () => { alive = false; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null }
  }, [facing, attempt])

  function snap() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return setError('Foto gagal diambil, coba lagi.')
      onCapture(new File([blob], `kamera-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  return (
    <Modal title="Buka Kamera" subtitle="Arahkan kamera lalu klik Ambil foto" onClose={onClose}
      footer={<>
        <button type="button" className="pap-btn" onClick={onGallery}><ImageIcon /> Pilih dari galeri</button>
        {cams > 1 && <button type="button" className="pap-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} title="Ganti kamera"><SwitchCamera /></button>}
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        <button type="button" className="pap-primary-button" disabled={!ready} onClick={snap}><Camera /> Ambil foto</button>
      </>}>
      {error
        ? <Notice>{error} <button type="button" className="pap-link-button" onClick={() => setAttempt((n) => n + 1)}><RefreshCw className="pap-inline-icon" /> Coba lagi</button></Notice>
        : <div className="pap-webcam">{!ready && <span>Membuka kamera...</span>}<video ref={videoRef} playsInline muted /></div>}
    </Modal>
  )
}
