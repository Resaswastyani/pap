import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, logActivity } from '@/lib/marketing'
import { formatWaktu } from '@/lib/notifications'
import {
  canApproveSample, divisionUsers, isPPIC, isProduksi, loadSample, logRequest, notifyRequest, optDate, readSampleRequest, requireRequestMenu,
  saveSampleItems, SAMPLE_STATUS, sampleApprovers, type SampleStatus,
} from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

// Alur: diajukan -(Kepala Produksi / Kepala PPIC / GM setujui & jadwalkan)-> dijadwalkan -(Produksi mulai)-> diproduksi
//       -(Produksi selesai)-> selesai -(kirim)-> dikirim -(customer)-> disetujui | revisi -(sales ajukan ulang dgn spek baru)-> diajukan
// Batal bisa dari tahap mana pun sebelum disetujui; batal oleh penyetuju pada tahap diajukan = pengajuan ditolak.
const NEXT: Record<SampleStatus, SampleStatus[]> = {
  diajukan: ['dijadwalkan', 'batal'],
  dijadwalkan: ['dijadwalkan', 'diproduksi', 'batal'],
  diproduksi: ['selesai', 'batal'],
  selesai: ['dikirim', 'batal'],
  dikirim: ['disetujui', 'revisi'],
  revisi: ['diajukan', 'batal'],
  disetujui: [],
  batal: [],
}

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'sample')
  const item = await loadSample(int((await ctx.params).id) ?? fail(404, 'Request sample tidak ditemukan.'), user)
  const body = await readJson(request)
  const from = item.status as SampleStatus
  const to = str(body.status, 20) as SampleStatus
  if (!(to in SAMPLE_STATUS) || !NEXT[from].includes(to)) fail(400, `Status tidak bisa diubah dari "${SAMPLE_STATUS[from]}" ke "${SAMPLE_STATUS[to] ?? to}".`)
  const catatan = str(body.catatan, 5000) || null
  const requester = item.requested_by === user.id || user.role.isAdmin || canSupervise(user)

  const sets: string[] = ['status = ?']
  const values: unknown[] = [to]
  let note = catatan
  if (to === 'dijadwalkan') {
    if (from === 'diajukan' && !canApproveSample(user)) fail(403, 'Pengajuan sample hanya bisa disetujui Kepala Produksi, Kepala PPIC, atau General Manager.')
    if (from === 'dijadwalkan' && !isPPIC(user) && !canApproveSample(user)) fail(403, 'Hanya PPIC yang dapat mengubah jadwal produksi sample.')
    const jadwal = optDate(body.jadwal_produksi, 'jadwal produksi') ?? fail(400, 'Isi tanggal jadwal produksi sample.')
    sets.push('jadwal_produksi = ?')
    values.push(jadwal)
    note = [`${from === 'diajukan' ? 'Disetujui, jadwal' : 'Jadwal'} produksi ${formatWaktu(jadwal)}`, catatan].filter(Boolean).join('. ')
  } else if (to === 'diproduksi' || to === 'selesai') {
    if (!isProduksi(user) && !isPPIC(user)) fail(403, 'Hanya Produksi / PPIC yang memperbarui proses produksi sample.')
  } else if (to === 'dikirim') {
    if (!requester && !isPPIC(user)) fail(403, 'Pengiriman sample dicatat oleh sales atau PPIC.')
    const pengiriman = str(body.pengiriman, 255) || fail(400, 'Isi info pengiriman (kurir/resi atau diantar sales).')
    sets.push('pengiriman = ?')
    values.push(pengiriman)
    note = [`Dikirim: ${pengiriman}`, catatan].filter(Boolean).join('. ')
  } else if (to === 'disetujui' || to === 'revisi') {
    if (!requester) fail(403, 'Tanggapan customer dicatat oleh sales yang mengajukan.')
    if (to === 'revisi' && !catatan) fail(400, 'Tulis revisi spek yang diminta customer.')
    sets.push('feedback = ?')
    values.push(catatan)
  } else if (to === 'diajukan') {
    if (!requester) fail(403, 'Hanya sales yang mengajukan yang dapat mengajukan ulang.')
    const spec = readSampleRequest(body)
    await saveSampleItems(item.id, spec.items)
    sets.push('nama_produk = ?', 'spesifikasi = ?', 'special_request = ?', 'tenggat = ?')
    values.push(spec.nama_produk, spec.spesifikasi, spec.special_request, spec.tenggat)
    sets.push('revisi_ke = revisi_ke + 1', 'jadwal_produksi = NULL', 'pengiriman = NULL')
    note = `Diajukan ulang (revisi ${Number(item.revisi_ke) + 1})${catatan ? `: ${catatan}` : ''}`
  } else if (to === 'batal') {
    if (from === 'diajukan' && !requester && !canApproveSample(user)) fail(403, 'Pengajuan sample hanya bisa ditolak Kepala Produksi, Kepala PPIC, atau General Manager.')
    if (from !== 'diajukan' && !requester && !isPPIC(user) && !canApproveSample(user)) fail(403, 'Hanya sales pengaju atau PPIC yang dapat membatalkan.')
    if (!catatan) fail(400, 'Tulis alasan pembatalan.')
  }

  await db.query(`UPDATE sample_requests SET ${sets.join(', ')} WHERE id = ? AND status = ?`, [...values, item.id, from])
  const logId = await logRequest({ sampleId: item.id, userId: user.id, from, to, catatan: note })
  if (item.prospect_id && ['dikirim', 'disetujui', 'revisi'].includes(to)) {
    await logActivity(db, { prospectId: item.prospect_id, userId: user.id, jenis: 'catatan', hasil: `Sample ${item.nomor} ${SAMPLE_STATUS[to].toLowerCase()}${note ? `: ${note}` : ''}` })
  }

  // Penerima notifikasi per tahap
  const ppic = await divisionUsers(['ppic'])
  const produksi = await divisionUsers(['produksi'])
  const recipients: Record<SampleStatus, number[]> = {
    diajukan: await sampleApprovers(),
    dijadwalkan: [item.requested_by, ...ppic, ...produksi],
    diproduksi: [item.requested_by],
    selesai: [item.requested_by, ...ppic],
    dikirim: [item.requested_by, ...ppic],
    disetujui: [item.requested_by, ...ppic, ...produksi],
    revisi: [...ppic, ...produksi],
    batal: [item.requested_by, ...ppic, ...(['dijadwalkan', 'diproduksi'].includes(from) ? produksi : [])],
  }
  await notifyRequest(recipients[to], user.id, {
    type: 'sample_update',
    title: `Sample ${item.nomor}: ${SAMPLE_STATUS[to]}`,
    body: [item.nama_produk, item.target_name, note].filter(Boolean).join(' · '),
    sampleId: item.id,
    refKey: `sample:${item.id}:${to}:${Date.now()}`,
  })
  return NextResponse.json({ ok: true, logId })
})
