// Program Training Tahunan: rencana training per tahun (Staff / Produksi), CRUD oleh HRD, realisasi dari sesi Jadwal Training.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

type Row = RowDataPacket & Record<string, unknown>

export const PROGRAM_STATUS = { rencana: 'Rencana', berjalan: 'Berjalan', selesai: 'Selesai', ditunda: 'Ditunda', batal: 'Batal' } as const
export const PROGRAM_KELOMPOK = { staff: 'Staff', produksi: 'Produksi', semua: 'Staff & Produksi' } as const
export const PROGRAM_JENIS = { wajib: 'Wajib', pengembangan: 'Pengembangan', sertifikasi: 'Sertifikasi', penyegaran: 'Penyegaran', induksi: 'Induksi karyawan baru' } as const
export const PROGRAM_METODE = { internal: 'Internal', eksternal: 'Eksternal', online: 'Online', on_the_job: 'On the job' } as const
export const PROGRAM_FREKUENSI = { sekali: 'Sekali', bulanan: 'Bulanan', triwulan: 'Triwulan', semester: 'Semester', tahunan: 'Tahunan' } as const
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

// thousands: titik = pemisah ribuan (Rupiah, jumlah orang); selain itu koma / titik = desimal (durasi)
const num = (v: unknown, label: string, max = 1e13, thousands = true) => {
  if (v === '' || v === null || v === undefined) return null
  const t = String(v).trim()
  const n = Number(thousands ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > max) fail(400, `${label} tidak valid.`)
  return n
}
const pick = <T extends Record<string, string>>(map: T, v: unknown, fallback: keyof T | null) => (String(v) in map ? (String(v) as keyof T) : fallback)

export function readProgram(body: Record<string, unknown>) {
  const nama = str(body.nama, 200) || fail(400, 'Nama program training wajib diisi.')
  const tahun = Number(body.tahun)
  if (!Number.isInteger(tahun) || tahun < 2020 || tahun > 2100) fail(400, 'Tahun program tidak valid.')
  const bulan = (Array.isArray(body.bulan) ? body.bulan : String(body.bulan ?? '').split(','))
    .map((b) => Number(b)).filter((b) => Number.isInteger(b) && b >= 1 && b <= 12)
  // Tanggal rencana per bulan (YYYY-MM-DD, tahun program); bulannya otomatis ikut terpilih
  const tanggal = (Array.isArray(body.tanggal) ? body.tanggal : String(body.tanggal ?? '').split(','))
    .map((t) => String(t).trim()).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)))
  if (tanggal.some((t) => Number(t.slice(0, 4)) !== tahun)) fail(400, `Tanggal rencana harus di tahun ${tahun}.`)
  for (const t of tanggal) bulan.push(Number(t.slice(5, 7)))
  const divisi = (Array.isArray(body.divisi) ? body.divisi.map((d) => str(d, 100)) : String(body.divisi ?? '').split(',').map((d) => d.trim())).filter(Boolean)
  return {
    tahun, nama: nama!, kategori: str(body.kategori, 80) || null,
    jenis: pick(PROGRAM_JENIS, body.jenis, 'wajib') as string,
    kelompok: pick(PROGRAM_KELOMPOK, body.kelompok, 'semua') as string,
    divisi: [...new Set(divisi)].join(', ').slice(0, 500) || null,
    tujuan: str(body.tujuan, 3000) || null,
    bulan: [...new Set(bulan)].sort((a, b) => a - b).join(',') || null,
    tanggal: [...new Set(tanggal)].sort().join(',').slice(0, 400) || null,
    frekuensi: pick(PROGRAM_FREKUENSI, body.frekuensi, null) as string | null,
    durasi_jam: num(body.durasi_jam, 'Durasi', 9999, false),
    metode: pick(PROGRAM_METODE, body.metode, null) as string | null,
    penyelenggara: str(body.penyelenggara, 200) || null,
    target_peserta: num(body.target_peserta, 'Target peserta', 100000),
    anggaran: num(body.anggaran, 'Anggaran'),
    realisasi_biaya: num(body.realisasi_biaya, 'Realisasi biaya'),
    indikator: str(body.indikator, 500) || null,
    status: pick(PROGRAM_STATUS, body.status, 'rencana') as string,
    module_id: Number(body.module_id) > 0 ? Number(body.module_id) : null,
    catatan: str(body.catatan, 3000) || null,
  }
}
export type ProgramInput = ReturnType<typeof readProgram>

export async function nextProgramKode(tahun: number) {
  const [[row]] = await db.query<Row[]>("SELECT MAX(CAST(SUBSTRING_INDEX(kode, '-', -1) AS UNSIGNED)) AS n FROM training_programs WHERE kode LIKE ?", [`TP-${tahun}-%`])
  return `TP-${tahun}-${String(Number(row?.n ?? 0) + 1).padStart(3, '0')}`
}

// Program + realisasi dari sesi Jadwal Training yang terhubung
const SELECT = `SELECT p.*, m.judul AS modul, uc.name AS dibuat_oleh, uu.name AS diubah_oleh,
    (SELECT COUNT(*) FROM training_sessions s WHERE s.program_id = p.id AND s.status <> 'batal') AS sesi,
    (SELECT COUNT(*) FROM training_sessions s WHERE s.program_id = p.id AND s.status = 'selesai') AS sesi_selesai,
    (SELECT COUNT(*) FROM training_session_participants sp JOIN training_sessions s ON s.id = sp.session_id WHERE s.program_id = p.id AND sp.kehadiran = 'hadir') AS peserta_hadir,
    (SELECT GROUP_CONCAT(DISTINCT MONTH(s.tanggal)) FROM training_sessions s WHERE s.program_id = p.id AND s.status = 'selesai') AS bulan_realisasi
  FROM training_programs p LEFT JOIN training_modules m ON m.id = p.module_id
  LEFT JOIN users uc ON uc.id = p.created_by LEFT JOIN users uu ON uu.id = p.updated_by`

const serialize = (r: Row) => ({
  id: Number(r.id), kode: String(r.kode), tahun: Number(r.tahun), nama: String(r.nama), kategori: (r.kategori as string) ?? null, jenis: String(r.jenis),
  kelompok: String(r.kelompok), divisi: r.divisi ? String(r.divisi).split(',').map((d) => d.trim()).filter(Boolean) : [],
  tujuan: (r.tujuan as string) ?? null, bulan: r.bulan ? String(r.bulan).split(',').map(Number) : [], tanggal: r.tanggal ? String(r.tanggal).split(',').filter(Boolean) : [], frekuensi: (r.frekuensi as string) ?? null,
  durasi_jam: r.durasi_jam === null ? null : Number(r.durasi_jam), metode: (r.metode as string) ?? null, penyelenggara: (r.penyelenggara as string) ?? null,
  target_peserta: r.target_peserta === null ? null : Number(r.target_peserta), anggaran: r.anggaran === null ? null : Number(r.anggaran),
  realisasi_biaya: r.realisasi_biaya === null ? null : Number(r.realisasi_biaya), indikator: (r.indikator as string) ?? null, status: String(r.status),
  module_id: r.module_id === null ? null : Number(r.module_id), modul: (r.modul as string) ?? null, catatan: (r.catatan as string) ?? null,
  sesi: Number(r.sesi ?? 0), sesi_selesai: Number(r.sesi_selesai ?? 0), peserta_hadir: Number(r.peserta_hadir ?? 0),
  bulan_realisasi: r.bulan_realisasi ? String(r.bulan_realisasi).split(',').map(Number) : [],
  dibuat_oleh: (r.dibuat_oleh as string) ?? null, diubah_oleh: (r.diubah_oleh as string) ?? null, updated_at: String(r.updated_at ?? ''),
})
export type TrainingProgram = ReturnType<typeof serialize>

export async function listPrograms(tahun: number) {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE p.tahun = ? ORDER BY FIELD(p.status, 'berjalan', 'rencana', 'ditunda', 'selesai', 'batal'), p.kode`, [tahun])
  return rows.map(serialize)
}

export async function loadProgram(id: number) {
  const [[row]] = await db.query<Row[]>(`${SELECT} WHERE p.id = ?`, [id])
  if (!row) fail(404, 'Program training tidak ditemukan.')
  const [sessions] = await db.query<Row[]>(
    `SELECT s.id, s.judul, s.batch, DATE_FORMAT(s.tanggal, '%Y-%m-%d') AS tanggal, s.jam_mulai, s.jam_selesai, s.tempat, s.pemateri, s.status,
       (SELECT COUNT(*) FROM training_session_participants sp WHERE sp.session_id = s.id) AS peserta,
       (SELECT COUNT(*) FROM training_session_participants sp WHERE sp.session_id = s.id AND sp.kehadiran = 'hadir') AS hadir
     FROM training_sessions s WHERE s.program_id = ? ORDER BY s.tanggal DESC`,
    [id],
  )
  return { ...serialize(row), sessions: sessions.map((s) => ({ ...s, peserta: Number(s.peserta), hadir: Number(s.hadir) })) }
}

export async function programYears() {
  const [rows] = await db.query<Row[]>('SELECT DISTINCT tahun FROM training_programs ORDER BY tahun DESC')
  return rows.map((r) => Number(r.tahun))
}

// Tanggal rencana pindah tahun (29 Feb -> 28 Feb bila bukan kabisat)
const shiftYear = (list: string | null, year: number) => list ? list.split(',').filter(Boolean).map((t) => {
  const d = new Date(Date.UTC(year, Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10))))
  return d.getUTCMonth() === Number(t.slice(5, 7)) - 1 ? d.toISOString().slice(0, 10) : `${year}-02-28`
}).join(',') : null

// Salin semua program dari satu tahun ke tahun lain sebagai rencana baru (biaya realisasi & status direset)
export async function copyPrograms(dari: number, ke: number, userId: number) {
  const [rows] = await db.query<Row[]>("SELECT * FROM training_programs WHERE tahun = ? AND status <> 'batal' ORDER BY kode", [dari])
  if (!rows.length) fail(400, `Belum ada program training di tahun ${dari}.`)
  const [[exist]] = await db.query<Row[]>('SELECT COUNT(*) AS n FROM training_programs WHERE tahun = ?', [ke])
  let added = 0
  for (const r of rows) {
    const [[dup]] = await db.query<Row[]>('SELECT id FROM training_programs WHERE tahun = ? AND nama = ? LIMIT 1', [ke, r.nama])
    if (dup) continue
    await db.query(
      `INSERT INTO training_programs (kode, tahun, nama, kategori, jenis, kelompok, divisi, tujuan, bulan, tanggal, frekuensi, durasi_jam, metode, penyelenggara, target_peserta, anggaran, indikator, status, module_id, catatan, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rencana', ?, ?, ?, ?)`,
      [await nextProgramKode(ke), ke, r.nama, r.kategori, r.jenis, r.kelompok, r.divisi, r.tujuan, r.bulan, shiftYear(r.tanggal as string | null, ke), r.frekuensi, r.durasi_jam, r.metode, r.penyelenggara, r.target_peserta, r.anggaran, r.indikator, r.module_id, r.catatan, userId, userId],
    )
    added++
  }
  return { added, sudahAda: Number(exist?.n ?? 0) }
}

// Excel program tahunan: tabel lengkap + kalender bulan (x = rencana, v = terlaksana)
export async function programsXlsx(tahun: number) {
  const items = await listPrograms(tahun)
  const head = ['Kode', 'Program', 'Kategori', 'Jenis', 'Kelompok', 'Divisi sasaran', 'Bulan', 'Tanggal rencana', 'Frekuensi', 'Durasi (jam)', 'Metode', 'Penyelenggara', 'Target peserta',
    'Peserta hadir', 'Sesi selesai', 'Anggaran', 'Realisasi biaya', 'Status', 'Indikator keberhasilan', 'Tujuan', 'Catatan']
  const L = <T extends Record<string, string>>(map: T, v: string | null) => (v ? (map[v as keyof T] ?? v) : '')
  const rows: XlsxCell[][] = items.map((p, i) => {
    const z = i % 2 === 1
    const t = (v: string | number | null) => ({ v, s: (z ? 'cell-z' : 'cell') as 'cell' | 'cell-z' })
    const m = (v: number | null) => ({ v, s: (z ? 'money-z' : 'money') as 'money' | 'money-z' })
    return [t(p.kode), t(p.nama), t(p.kategori), t(L(PROGRAM_JENIS, p.jenis)), t(L(PROGRAM_KELOMPOK, p.kelompok)), t(p.divisi.join(', ')), t(p.bulan.map((b) => MONTHS[b - 1]).join(', ')),
      t(p.tanggal.map((d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`).join(', ')), t(L(PROGRAM_FREKUENSI, p.frekuensi)), t(p.durasi_jam), t(L(PROGRAM_METODE, p.metode)), t(p.penyelenggara), t(p.target_peserta), t(p.peserta_hadir), t(`${p.sesi_selesai}/${p.sesi}`),
      m(p.anggaran), m(p.realisasi_biaya), t(L(PROGRAM_STATUS, p.status)), t(p.indikator), t(p.tujuan), t(p.catatan)]
  })
  const total = (k: 'anggaran' | 'realisasi_biaya') => items.reduce((n, p) => n + (p[k] ?? 0), 0)
  const kalender: XlsxCell[][] = items.map((p) => [{ v: p.kode, s: 'cell' }, { v: p.nama, s: 'cell' },
    ...MONTHS.map((_, i) => ({ v: p.bulan_realisasi.includes(i + 1) ? 'v' : p.bulan.includes(i + 1) ? (p.tanggal.filter((d) => Number(d.slice(5, 7)) === i + 1).map((d) => Number(d.slice(8, 10))).join(',') || 'x') : '', s: (p.bulan_realisasi.includes(i + 1) ? 'sh-2' : p.bulan.includes(i + 1) ? 'sh-normal' : 'center') as 'center' }))])
  return writeXlsx([
    {
      title: `Program ${tahun}`, widths: [13, 34, 16, 14, 16, 22, 18, 22, 12, 10, 12, 22, 10, 10, 10, 16, 16, 11, 30, 34, 26], freeze: { row: 4, col: 2 }, heights: { 1: 26 },
      rows: [
        [{ v: `PROGRAM TRAINING TAHUNAN ${tahun}`, s: 'title2' }],
        [{ v: `${items.length} program · anggaran Rp ${total('anggaran').toLocaleString('id-ID')} · realisasi biaya Rp ${total('realisasi_biaya').toLocaleString('id-ID')} · dicetak dari SIMPAP`, s: 'note' }],
        [],
        head.map((v) => ({ v, s: 'head' })),
        ...rows,
        ...(items.length ? [[{ v: 'TOTAL', s: 'total-label' }, ...Array(14).fill({ v: null, s: 'total-label' }), { v: total('anggaran'), s: 'total-money' }, { v: total('realisasi_biaya'), s: 'total-money' }, ...Array(4).fill({ v: null, s: 'total-label' })] as XlsxCell[]] : []),
      ],
      merges: items.length ? [`A${rows.length + 5}:O${rows.length + 5}`] : [],
    },
    {
      title: 'Kalender', widths: [13, 34, ...MONTHS.map(() => 6)], freeze: { row: 3, col: 2 },
      rows: [
        [{ v: `KALENDER TRAINING ${tahun}  (x = rencana, v = terlaksana)`, s: 'title2' }],
        [],
        [{ v: 'Kode', s: 'head' }, { v: 'Program', s: 'head' }, ...MONTHS.map((m) => ({ v: m, s: 'head' as const }))],
        ...kalender,
      ],
    },
  ])
}
