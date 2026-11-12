// Laporan BPJS per bulan (Guidance HR "pelaporan BPJS"): iuran BPJS Ketenagakerjaan (JHT, JKK, JKM, JP) & Kesehatan per karyawan,
// dari perhitungan gaji yang sama dengan menu Grade & Gaji (dasar upah, batas upah, usia pensiun, ditanggung pegawai / perusahaan).
import { fail } from '@/lib/api'
import { tglId } from '@/lib/attendance-report'
import { hitungPeriode, listPayrolls } from '@/lib/payroll'
import { periodeLabel } from '@/lib/payroll-report'
import type { UserProfile } from '@/lib/users'
import { colName, writeXlsx, type XlsxCell, type XlsxSheet, type XlsxStyle } from '@/lib/xlsx-write'

export function requireBpjs(user: UserProfile) {
  if (!user.menus.includes('bpjs' as never)) fail(403, 'Anda tidak punya akses ke menu Laporan BPJS.')
}

// withNumbers: nomor kepesertaan BPJS (data pribadi) hanya untuk HRD / management
export async function bpjsReport(periode: string, withNumbers: boolean) {
  const data = await hitungPeriode(periode)
  const nomor = new Map((await listPayrolls()).map((p) => [p.nip, { tk: p.no_bpjs_tk, kes: p.no_bpjs_kes }]))
  const items = data.slips.map((s, i) => {
    const b = s.bpjs_rincian
    const tk = b.jht_p + b.jht_k + b.jkk + b.jkm + b.jp_p + b.jp_k
    const kes = b.kes_p + b.kes_k
    const no = nomor.get(s.nip)
    return {
      no: i + 1, nip: s.nip, nama: s.nama, jabatan: s.jabatan, divisi: s.divisi,
      no_bpjs_tk: withNumbers ? no?.tk ?? null : no?.tk ? 'terdaftar' : null, no_bpjs_kes: withNumbers ? no?.kes ?? null : no?.kes ? 'terdaftar' : null,
      ...b, total_tk: tk, total_kes: kes, total: tk + kes,
      // Beban perusahaan = bagian perusahaan + bagian pegawai yang ditanggung perusahaan; potongan gaji = sisanya
      beban_perusahaan: s.bpjs_perusahaan.total, potongan_pegawai: s.potongan_bpjs,
      catatan: s.catatan.filter((c) => /BPJS|JP/.test(c)),
    }
  })
  const sum = (k: keyof (typeof items)[number]) => items.reduce((t, x) => t + (Number(x[k]) || 0), 0)
  const total = {
    peserta_tk: items.filter((x) => x.dasar_tk).length, peserta_kes: items.filter((x) => x.dasar_kes).length,
    jht_p: sum('jht_p'), jht_k: sum('jht_k'), jkk: sum('jkk'), jkm: sum('jkm'), jp_p: sum('jp_p'), jp_k: sum('jp_k'), kes_p: sum('kes_p'), kes_k: sum('kes_k'),
    total_tk: sum('total_tk'), total_kes: sum('total_kes'), total: sum('total'), beban_perusahaan: sum('beban_perusahaan'), potongan_pegawai: sum('potongan_pegawai'),
    belum_tk: items.filter((x) => !x.dasar_tk).length, belum_kes: items.filter((x) => !x.dasar_kes).length,
  }
  const s = data.settings
  const tarif = { kes_p: s.bpjs_kes_perusahaan, kes_k: s.bpjs_kes_pegawai, jht_p: s.bpjs_jht_perusahaan, jht_k: s.bpjs_jht_pegawai, jkk: s.bpjs_jkk, jkm: s.bpjs_jkm, jp_p: s.bpjs_jpn_perusahaan, jp_k: s.bpjs_jpn_pegawai, max_kes: s.max_bpjs_kes, max_jp: s.max_bpjs_jpn, usia_pensiun: s.usia_pensiun }
  return { periode, dari: data.dari, sampai: data.sampai, items, total, tarif }
}

export async function bpjsXlsx(periode: string, withNumbers: boolean) {
  const rep = await bpjsReport(periode, withNumbers)
  const tr = rep.tarif
  const sub = `Periode ${tglId(rep.dari)} s/d ${tglId(rep.sampai)} · batas upah JP Rp ${tr.max_jp.toLocaleString('id-ID')}, BPJS Kesehatan Rp ${tr.max_kes.toLocaleString('id-ID')} · JP berhenti di usia ${tr.usia_pensiun} tahun · dicetak dari SIMPAP`
  // Sel bergaya; z = baris genap (belang)
  const txt = (v: string | number | null, z: boolean) => ({ v, s: (z ? 'cell-z' : 'cell') as XlsxStyle })
  const mid = (v: string | number | null, z: boolean) => ({ v, s: (z ? 'center-z' : 'center') as XlsxStyle })
  const rp = (v: number, z: boolean) => ({ v: Math.round(v), s: (z ? 'money-z' : 'money') as XlsxStyle })
  const ditanggung = (v: string) => (v === 'perusahaan' ? 'Perusahaan' : 'Pegawai')
  type Group = { label: string; style: XlsxStyle; cols: string[] }
  // Lembar berkelompok: judul, keterangan, baris kelompok (digabung), judul kolom berwarna, isi belang, total
  function build(judul: string, groups: Group[], body: XlsxCell[][], total: XlsxCell[], empty: string) {
    const width = groups.reduce((n, g) => n + g.cols.length, 0)
    const merges: string[] = []
    let c = 0
    const groupRow: XlsxCell[] = []
    for (const g of groups) {
      groupRow.push({ v: g.label, s: 'group' }, ...Array(g.cols.length - 1).fill({ v: null, s: 'group' }))
      if (g.cols.length > 1) merges.push(`${colName(c)}4:${colName(c + g.cols.length - 1)}4`)
      c += g.cols.length
    }
    const rows: XlsxCell[][] = [
      [{ v: judul, s: 'title2' }],
      [{ v: sub, s: 'note' }],
      [],
      groupRow,
      groups.flatMap((g) => g.cols.map((v) => ({ v, s: g.style }))),
      ...(body.length ? body : [[{ v: empty, s: 'note' as XlsxStyle }]]),
    ]
    if (body.length) {
      rows.push(total)
      merges.push(`A${rows.length}:E${rows.length}`)
    } else merges.push(`A6:${colName(width - 1)}6`)
    return { rows, merges, last: colName(width - 1), count: body.length }
  }
  const tk = rep.items.filter((x) => x.dasar_tk)
  const kes = rep.items.filter((x) => x.dasar_kes)
  const sumTot = (v: number): XlsxCell => ({ v: Math.round(v), s: 'total-money' })
  const label = (text: string): XlsxCell[] => [{ v: text, s: 'total-label' }, ...Array(4).fill({ v: null, s: 'total-label' })]

  const tkSheet = build(`LAPORAN IURAN BPJS KETENAGAKERJAAN · ${periodeLabel(periode).toUpperCase()}`, [
    { label: 'DATA KARYAWAN', style: 'h-id', cols: ['No', 'NIP', 'Nama', 'Jabatan', 'No. BPJS TK'] },
    { label: 'DASAR', style: 'h-hadir', cols: ['Upah dilaporkan'] },
    { label: 'JAMINAN HARI TUA (JHT)', style: 'h-plus', cols: [`Perusahaan ${tr.jht_p}%`, `Pegawai ${tr.jht_k}%`] },
    { label: 'JKK & JKM', style: 'h-plus', cols: [`JKK ${tr.jkk}%`, `JKM ${tr.jkm}%`] },
    { label: 'JAMINAN PENSIUN (JP)', style: 'h-minus', cols: ['Dasar JP', `Perusahaan ${tr.jp_p}%`, `Pegawai ${tr.jp_k}%`] },
    { label: 'TOTAL', style: 'h-thp', cols: ['Total iuran TK'] },
    { label: 'KET.', style: 'h-misc', cols: ['Ditanggung'] },
  ], tk.map((x, i) => {
    const z = i % 2 === 1
    return [mid(i + 1, z), mid(x.nip, z), txt(x.nama, z), txt(x.jabatan, z), mid(x.no_bpjs_tk, z), rp(x.dasar_tk, z), rp(x.jht_p, z), rp(x.jht_k, z), rp(x.jkk, z), rp(x.jkm, z),
      rp(x.dasar_jp, z), rp(x.jp_p, z), rp(x.jp_k, z), { v: Math.round(x.total_tk), s: 'thp' as XlsxStyle }, mid(ditanggung(x.tk_ditanggung), z)]
  }), [...label(`TOTAL ${tk.length} PESERTA`), sumTot(tk.reduce((a, x) => a + x.dasar_tk, 0)), sumTot(rep.total.jht_p), sumTot(rep.total.jht_k), sumTot(rep.total.jkk), sumTot(rep.total.jkm),
    { v: null, s: 'total-money' }, sumTot(rep.total.jp_p), sumTot(rep.total.jp_k), { v: Math.round(rep.total.total_tk), s: 'total-thp' }, { v: null, s: 'total-money' }],
  'Belum ada karyawan yang terdaftar BPJS Ketenagakerjaan pada periode ini.')

  const kesSheet = build(`LAPORAN IURAN BPJS KESEHATAN · ${periodeLabel(periode).toUpperCase()}`, [
    { label: 'DATA KARYAWAN', style: 'h-id', cols: ['No', 'NIP', 'Nama', 'Jabatan', 'No. BPJS Kesehatan'] },
    { label: 'DASAR', style: 'h-hadir', cols: ['Upah dilaporkan'] },
    { label: 'IURAN', style: 'h-plus', cols: [`Perusahaan ${tr.kes_p}%`, `Pegawai ${tr.kes_k}%`] },
    { label: 'TOTAL', style: 'h-thp', cols: ['Total iuran Kesehatan'] },
    { label: 'KET.', style: 'h-misc', cols: ['Ditanggung'] },
  ], kes.map((x, i) => {
    const z = i % 2 === 1
    return [mid(i + 1, z), mid(x.nip, z), txt(x.nama, z), txt(x.jabatan, z), mid(x.no_bpjs_kes, z), rp(x.dasar_kes, z), rp(x.kes_p, z), rp(x.kes_k, z), { v: Math.round(x.total_kes), s: 'thp' as XlsxStyle }, mid(ditanggung(x.kes_ditanggung), z)]
  }), [...label(`TOTAL ${kes.length} PESERTA`), sumTot(kes.reduce((a, x) => a + x.dasar_kes, 0)), sumTot(rep.total.kes_p), sumTot(rep.total.kes_k), { v: Math.round(rep.total.total_kes), s: 'total-thp' }, { v: null, s: 'total-money' }],
  'Belum ada karyawan yang terdaftar BPJS Kesehatan pada periode ini.')

  const heights = (count: number) => ({ 1: 26, 2: 30, 4: 20, 5: 34, [6 + count]: 22 })
  const sheets: XlsxSheet[] = [
    { title: 'BPJS Ketenagakerjaan', rows: tkSheet.rows, merges: tkSheet.merges, widths: [5, 11, 24, 18, 16, 15, 14, 14, 12, 12, 14, 14, 14, 16, 12], freeze: { row: 5, col: 3 }, heights: heights(tkSheet.count) },
    { title: 'BPJS Kesehatan', rows: kesSheet.rows, merges: kesSheet.merges, widths: [5, 11, 24, 18, 18, 15, 15, 15, 17, 12], freeze: { row: 5, col: 3 }, heights: heights(kesSheet.count) },
  ]
  const belum = rep.items.filter((x) => !x.dasar_tk || !x.dasar_kes)
  if (belum.length) {
    const status = (ok: boolean, z: boolean): XlsxCell => ({ v: ok ? 'Terdaftar' : 'Belum', s: (ok ? (z ? 'center-z' : 'center') : 'sh-off') as XlsxStyle })
    sheets.push({
      title: 'Belum terdaftar', widths: [5, 11, 24, 18, 14, 16, 36], freeze: { row: 4, col: 3 }, heights: { 1: 26, 2: 22, 4: 24 },
      rows: [
        [{ v: 'KARYAWAN BELUM TERDAFTAR BPJS', s: 'title2' }],
        [{ v: `${belum.length} karyawan belum lengkap BPJS-nya per ${periodeLabel(periode)}. Lengkapi di Grade & Gaji › data gaji karyawan.`, s: 'note' }],
        [],
        [...['No', 'NIP', 'Nama', 'Jabatan'].map((v) => ({ v, s: 'h-id' as XlsxStyle })), { v: 'BPJS TK', s: 'h-minus' }, { v: 'BPJS Kesehatan', s: 'h-minus' }, { v: 'Catatan', s: 'h-misc' }],
        ...belum.map((x, i) => {
          const z = i % 2 === 1
          return [mid(i + 1, z), mid(x.nip, z), txt(x.nama, z), txt(x.jabatan, z), status(!!x.dasar_tk, z), status(!!x.dasar_kes, z), txt(x.catatan.join('; ') || null, z)]
        }),
      ],
    })
  }
  return { filename: `Laporan_BPJS_${periode}.xlsx`, buffer: writeXlsx(sheets) }
}
