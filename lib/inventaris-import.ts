// Impor inventaris dari Excel (format "Data Asset PAP.xlsx"): sheet Asset, Kendaraan, Pajak Kendaraan,
// Record Service Kendaraan, Record Service AC. Barang dengan kode yang sudah ada dilewati; riwayat tidak digandakan.
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import type { InvKondisi } from '@/lib/inventaris'

type Sheet = { title: string; rows: string[][] }
export type ImportItem = {
  kode: string; nama: string; kategori: string | null; lokasi: string | null; jumlah: number; kondisi: InvKondisi; pemegang: string | null
  nomorSeri: string | null; tahun: number | null; pajakTahunan: string | null; pajakLimaTahunan: string | null; ujiKir: string | null; catatan: string | null
}
export type ImportLog = { kode: string; tanggal: string | null; keterangan: string; biaya: number | null }

const BULAN: Record<string, number> = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12 }
const KONDISI: Record<string, InvKondisi> = { baik: 'baik', rusak: 'rusak', sedang: 'perlu_perbaikan', 'perlu perbaikan': 'perlu_perbaikan', hilang: 'hilang' }
const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim() || null
const norm = (v: string | undefined) => (clean(v) ?? '').toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`

// Tanggal dari sel Excel: nomor seri, "2026-11-18", "03 Mei 2027", "Juli 2027" (tgl 1), "November" (tanpa tahun -> kosong + catatan)
function parseDate(v: string | undefined): { date: string | null; note: string | null } {
  const s = clean(v)
  if (!s) return { date: null, note: null }
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400e3))
    return { date: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), note: null }
  }
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return { date: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, note: null }
  const low = s.toLowerCase()
  let m = low.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/)
  if (m && BULAN[m[2]]) return { date: iso(Number(m[3]), BULAN[m[2]], Number(m[1])), note: null }
  m = low.match(/^([a-z]+) (\d{4})$/)
  if (m && BULAN[m[1]]) return { date: iso(Number(m[2]), BULAN[m[1]], 1), note: `di Excel hanya "${s}" (tanggal tidak tercantum, dipakai tgl 1)` }
  return { date: null, note: `di Excel "${s}" (tahun tidak tercantum, perlu dilengkapi)` }
}
function money(v: string | undefined) {
  const s = clean(v)
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s))
  const digits = s.replace(/\D/g, '')
  return digits ? Number(digits) : null
}
const int = (v: string | undefined) => {
  const n = Number(clean(v))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

// Sheet by nama (tanpa spasi berlebih, tidak peka huruf besar)
const findSheet = (sheets: Sheet[], name: string) => sheets.find((s) => norm(s.title) === name)
// Baris header: baris pertama yang memuat semua kata kunci; kembalikan index kolom per kata kunci
function header(rows: string[][], keys: Record<string, RegExp>) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols = (rows[r] ?? []).map(norm)
    const map: Record<string, number> = {}
    for (const [k, re] of Object.entries(keys)) {
      const i = cols.findIndex((c) => re.test(c))
      if (i >= 0) map[k] = i
    }
    if (Object.keys(map).length === Object.keys(keys).length) return { row: r, col: map }
  }
  return null
}

export function parseAssetWorkbook(sheets: Sheet[]) {
  const items = new Map<string, ImportItem>()
  const logs: ImportLog[] = []
  const report: string[] = []
  const add = (it: ImportItem) => {
    if (items.has(it.kode)) report.push(`Kode ganda ${it.kode} (${it.nama}) di Excel dilewati.`)
    else items.set(it.kode, it)
  }

  // ---- Asset ----
  const asset = findSheet(sheets, 'asset')
  if (asset) {
    const h = header(asset.rows, { kode: /^kode/, nama: /^nama/, kategori: /^kategori/, lokasi: /^lokasi/, jumlah: /^jumlah/, kondisi: /^kondisi/, pj: /penanggung/, ket: /^keterangan/ })
    if (!h) report.push('Sheet Asset: header kolom tidak dikenali (Kode Barang, Nama Aset, Kategori, Lokasi, Jumlah, Kondisi, Penanggung Jawab, Keterangan).')
    else for (const row of asset.rows.slice(h.row + 1)) {
      const kode = clean(row[h.col.kode])?.toUpperCase()
      if (!kode) continue
      const k = norm(row[h.col.kondisi]) || 'baik'
      const ket = clean(row[h.col.ket])
      let catatan = ket && ket.toLowerCase() !== 'normal' ? ket : null
      if (k === 'sedang') catatan = ['Kondisi di Excel: Sedang', catatan].filter(Boolean).join('; ')
      add({
        kode, nama: clean(row[h.col.nama]) ?? kode, kategori: clean(row[h.col.kategori]), lokasi: clean(row[h.col.lokasi]), jumlah: int(row[h.col.jumlah]) ?? 1,
        kondisi: KONDISI[k] ?? 'baik', pemegang: clean(row[h.col.pj]), nomorSeri: null, tahun: null, pajakTahunan: null, pajakLimaTahunan: null, ujiKir: null, catatan,
      })
    }
  }

  // ---- Pajak Kendaraan (dua tabel: pajak, lalu uji KIR) ----
  const pajak = new Map<string, { plat?: string | null; tahunan?: string | null; lima?: string | null; kir?: string | null; catatan: string[] }>()
  const pajakSheet = findSheet(sheets, 'pajak kendaraan')
  if (pajakSheet) {
    let mode: 'pajak' | 'kir' | null = null
    let col: Record<string, number> = {}
    for (const row of pajakSheet.rows) {
      const cells = (row ?? []).map(norm)
      if (cells.some((c) => /^kode/.test(c)) && cells.some((c) => /^no\.? ?polisi/.test(c))) {
        mode = cells.some((c) => /uji kir/.test(c)) ? 'kir' : 'pajak'
        col = {
          kode: cells.findIndex((c) => /^kode/.test(c)), plat: cells.findIndex((c) => /^no\.? ?polisi/.test(c)), status: cells.findIndex((c) => /^status/.test(c)),
          tahunan: cells.findIndex((c) => /tahunan aktif|^pajak tahunan/.test(c)), lima: cells.findIndex((c) => /5 tahunan/.test(c)), kir: cells.findIndex((c) => /uji kir/.test(c)),
        }
        continue
      }
      const kode = clean(row?.[col.kode])?.toUpperCase()
      if (!mode || !kode) continue
      const p = pajak.get(kode) ?? { catatan: [] }
      pajak.set(kode, p)
      const status = clean(row[col.status])
      if (mode === 'pajak') {
        p.plat = clean(row[col.plat])
        const t = parseDate(row[col.tahunan]), l = parseDate(row[col.lima])
        p.tahunan = t.date
        p.lima = l.date
        if (t.note) p.catatan.push(`Pajak tahunan ${t.note}`)
        if (l.note) p.catatan.push(`Pajak 5 tahunan ${l.note}`)
        if (status) p.catatan.push(`Status pajak: ${status}`)
        const extra = row.slice(Math.max(col.tahunan, col.lima) + 1).map(clean).filter(Boolean)
        p.catatan.push(...(extra as string[]))
      } else {
        const k = parseDate(row[col.kir])
        p.kir = k.date
        if (k.note) p.catatan.push(`Uji KIR ${k.note}`)
        if (status) p.catatan.push(`Status uji KIR: ${status}`)
      }
    }
  }

  // ---- Kendaraan ----
  const kendaraan = findSheet(sheets, 'kendaraan')
  if (kendaraan) {
    const h = header(kendaraan.rows, { kode: /^kode/, nama: /^nama/, plat: /^no\.? ?polisi/, tahun: /^tahun/, status: /^status|^kondisi/, pj: /penanggung/ })
    if (!h) report.push('Sheet Kendaraan: header kolom tidak dikenali (Kode Aset, Nama Kendaraan, No. Polisi, Tahun, Status, Penanggung Jawab).')
    else for (const row of kendaraan.rows.slice(h.row + 1)) {
      let kode = clean(row[h.col.kode])?.toUpperCase()
      const nama = clean(row[h.col.nama])
      const plat = clean(row[h.col.plat])
      if (!kode) continue
      if (!/-\d+$/.test(kode)) {
        // Kode tidak lengkap (mis. "PAP-MBL"): cari pasangannya di sheet Pajak Kendaraan lewat No. Polisi
        const match = [...pajak.entries()].find(([, p]) => p.plat && plat && p.plat.replace(/\s/g, '') === plat.replace(/\s/g, ''))
        if (match) {
          report.push(`${nama}: kode "${kode}" dilengkapi menjadi ${match[0]} (sesuai sheet Pajak Kendaraan).`)
          kode = match[0]
        }
      }
      const p = pajak.get(kode) ?? { catatan: [] }
      if (p.plat && plat && p.plat.replace(/\s/g, '') !== plat.replace(/\s/g, '')) {
        report.push(`${nama}: No. Polisi beda antar sheet (Kendaraan ${plat}, Pajak ${p.plat}); dipakai ${plat}.`)
        p.catatan.push(`No. Polisi di sheet Pajak Kendaraan: ${p.plat} (perlu dicek)`)
      }
      for (const c of p.catatan) if (/tahun tidak tercantum/.test(c)) report.push(`${nama}: ${c}.`)
      add({
        kode, nama: nama ?? kode, kategori: 'Kendaraan', lokasi: null, jumlah: 1, kondisi: KONDISI[norm(row[h.col.status])] ?? 'baik', pemegang: clean(row[h.col.pj]),
        nomorSeri: plat, tahun: int(row[h.col.tahun]), pajakTahunan: p.tahunan ?? null, pajakLimaTahunan: p.lima ?? null, ujiKir: p.kir ?? null,
        catatan: p.catatan.join('; ') || null,
      })
    }
  }

  // ---- Record Service AC ----
  const ac = findSheet(sheets, 'record service ac')
  if (ac) {
    const h = header(ac.rows, { kode: /^kode/, nama: /^nama/, lokasi: /^lokasi/, tanggal: /tanggal/, status: /^status/ })
    if (h) for (const row of ac.rows.slice(h.row + 1)) {
      const kode = clean(row[h.col.kode])?.toUpperCase()
      if (!kode) continue
      const status = clean(row[h.col.status])
      if (!items.has(kode)) {
        report.push(`${kode} ${clean(row[h.col.nama]) ?? ''} hanya ada di sheet Record Service AC; ditambahkan sebagai barang baru.`)
        add({
          kode, nama: clean(row[h.col.nama]) ?? kode, kategori: 'Elektronik', lokasi: clean(row[h.col.lokasi]), jumlah: 1, kondisi: KONDISI[norm(status ?? '')] ?? 'baik',
          pemegang: null, nomorSeri: null, tahun: null, pajakTahunan: null, pajakLimaTahunan: null, ujiKir: null, catatan: null,
        })
      }
      logs.push({ kode, tanggal: parseDate(row[h.col.tanggal]).date, keterangan: `Service rutin AC${status ? ` · status setelah service: ${status}` : ''}`, biaya: null })
    }
  }

  // ---- Record Service Kendaraan ----
  const svc = findSheet(sheets, 'record service kendaraan')
  if (svc) {
    const h = header(svc.rows, { kendaraan: /^jenis kendaraan|^kendaraan|^nama kendaraan/, km: /^km saat/, jenis: /^jenis service|^jenis perbaikan/, part: /^sparepart/, bengkel: /^bengkel/, jasa: /^biaya jasa/, spare: /^biaya sparepart/, ppn: /^ppn/, total: /^total/, next: /berikutnya/, pic: /^pic/, tanggal: /^tanggal/ })
    const vehicles = [...items.values()].filter((i) => i.kategori === 'Kendaraan')
    const byName = (name: string) => {
      const n = name.toLowerCase()
      return vehicles.find((v) => v.nama.toLowerCase() === n) ?? (vehicles.filter((v) => v.nama.toLowerCase().endsWith(` ${n}`)).length === 1 ? vehicles.find((v) => v.nama.toLowerCase().endsWith(` ${n}`)) : undefined)
    }
    if (h) for (const row of svc.rows.slice(h.row + 1)) {
      const name = clean(row[h.col.kendaraan])
      if (!name) continue
      const v = byName(name)
      if (!v) { report.push(`Service "${name}" tidak cocok dengan kendaraan mana pun, dilewati.`); continue }
      const parts = [`${clean(row[h.col.jenis]) ?? 'Service'}${clean(row[h.col.part]) ? `: ${clean(row[h.col.part])}` : ''}`]
      const bengkel = clean(row[h.col.bengkel])
      if (bengkel) parts.push(/^bengkel/i.test(bengkel) ? bengkel : `Bengkel ${bengkel}`)
      const km = int(row[h.col.km])
      if (km) parts.push(`KM ${km.toLocaleString('id-ID')}`)
      if (clean(row[h.col.next])) parts.push(`Berikutnya ${clean(row[h.col.next])}`)
      const rincian = ([['jasa', h.col.jasa], ['sparepart', h.col.spare], ['PPN', h.col.ppn]] as const).flatMap(([l, c]) => (money(row[c]) ? [`${l} ${rupiah(money(row[c])!)}`] : []))
      if (rincian.length) parts.push(`Rincian: ${rincian.join(', ')}`)
      if (clean(row[h.col.pic])) parts.push(`PIC ${clean(row[h.col.pic])}`)
      const total = money(row[h.col.total]) ?? (rincian.length ? [h.col.jasa, h.col.spare, h.col.ppn].reduce((s, c) => s + (money(row[c]) ?? 0), 0) : null)
      logs.push({ kode: v.kode, tanggal: parseDate(row[h.col.tanggal]).date, keterangan: parts.join(' · '), biaya: total })
    }
  }
  return { items: [...items.values()], logs, report }
}

// Simpan hasil parsing: barang baru saja (kode yang sudah ada dilewati), riwayat servis tanpa duplikat
export async function importAssetWorkbook(parsed: ReturnType<typeof parseAssetWorkbook>, userId: number, fileName: string) {
  let added = 0
  const skipped: string[] = []
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  for (const it of parsed.items) {
    const [res] = await db.query<ResultSetHeader>(
      `INSERT IGNORE INTO ga_inventaris (kode, nama, kategori, nomor_seri, jumlah, lokasi, pemegang_lain, tahun, pajak_tahunan, pajak_lima_tahunan, uji_kir, kondisi, catatan, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [it.kode, it.nama, it.kategori, it.nomorSeri, it.jumlah, it.lokasi, it.pemegang, it.tahun, it.pajakTahunan, it.pajakLimaTahunan, it.ujiKir, it.kondisi, it.catatan, userId],
    )
    if (res.affectedRows) {
      added++
      await db.query("INSERT INTO ga_inventaris_logs (item_id, tanggal, jenis, keterangan, created_by) VALUES (?, ?, 'tambah', ?, ?)", [res.insertId, today, `Diimpor dari ${fileName}`, userId])
    } else skipped.push(it.kode)
  }
  let logsAdded = 0
  for (const l of parsed.logs) {
    const keterangan = l.tanggal ? l.keterangan : `${l.keterangan} (tanggal servis tidak tercatat di Excel)`
    const [[item]] = await db.query<RowDataPacket[]>('SELECT id FROM ga_inventaris WHERE kode = ?', [l.kode])
    if (!item) continue
    const [res] = await db.query<ResultSetHeader>(
      `INSERT INTO ga_inventaris_logs (item_id, tanggal, jenis, keterangan, biaya, created_by)
       SELECT ?, ?, 'perbaikan', ?, ?, ? FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM ga_inventaris_logs WHERE item_id = ? AND jenis = 'perbaikan' AND keterangan = ?)`,
      [item.id, l.tanggal ?? today, keterangan, l.biaya, userId, item.id, keterangan],
    )
    logsAdded += res.affectedRows
  }
  return { added, skipped, logsAdded }
}
