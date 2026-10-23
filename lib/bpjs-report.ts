// Laporan BPJS per bulan (Guidance HR "pelaporan BPJS"): iuran BPJS Ketenagakerjaan (JHT, JKK, JKM, JP) & Kesehatan per karyawan,
// dari perhitungan gaji yang sama dengan menu Grade & Gaji (dasar upah, batas upah, usia pensiun, ditanggung pegawai / perusahaan).
import { fail } from '@/lib/api'
import { tglId } from '@/lib/attendance-report'
import { hitungPeriode, listPayrolls } from '@/lib/payroll'
import { periodeLabel } from '@/lib/payroll-report'
import type { UserProfile } from '@/lib/users'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

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
  const head = (v: string) => ({ v, s: 'head' as const })
  const t = (v: string | null) => ({ v, s: 'cell' as const })
  const num = (v: number) => ({ v: Math.round(v), s: 'num' as const })
  const tot = (v: number | string) => ({ v: typeof v === 'number' ? Math.round(v) : v, s: 'total' as const })
  const tr = rep.tarif
  const title = `LAPORAN IURAN BPJS PERIODE ${periodeLabel(periode).toUpperCase()} (${tglId(rep.dari)} s/d ${tglId(rep.sampai)})`
  const tkCols = ['NO', 'NIP', 'Nama', 'Jabatan', 'No. BPJS TK', 'Upah dilaporkan', `JHT perusahaan ${tr.jht_p}%`, `JHT pegawai ${tr.jht_k}%`, `JKK ${tr.jkk}%`, `JKM ${tr.jkm}%`,
    'Dasar JP', `JP perusahaan ${tr.jp_p}%`, `JP pegawai ${tr.jp_k}%`, 'Total iuran TK', 'Ditanggung']
  const kesCols = ['NO', 'NIP', 'Nama', 'Jabatan', 'No. BPJS Kesehatan', 'Upah dilaporkan', `Perusahaan ${tr.kes_p}%`, `Pegawai ${tr.kes_k}%`, 'Total iuran Kesehatan', 'Ditanggung']
  const tk = rep.items.filter((x) => x.dasar_tk)
  const kes = rep.items.filter((x) => x.dasar_kes)
  const note = { v: `Dicetak dari PAP-MS. Batas upah JP Rp ${tr.max_jp.toLocaleString('id-ID')}, BPJS Kesehatan Rp ${tr.max_kes.toLocaleString('id-ID')}; JP berhenti di usia ${tr.usia_pensiun} tahun.`, s: 'note' as const }
  const ditanggung = (v: string) => (v === 'perusahaan' ? 'Perusahaan' : 'Pegawai')
  const tkRows: XlsxCell[][] = [
    [{ v: `${title} — BPJS KETENAGAKERJAAN`, s: 'title' }], [note], tkCols.map(head),
    ...tk.map((x, i) => [{ v: i + 1, s: 'center' as const }, t(x.nip), t(x.nama), t(x.jabatan), t(x.no_bpjs_tk), num(x.dasar_tk), num(x.jht_p), num(x.jht_k), num(x.jkk), num(x.jkm),
      num(x.dasar_jp), num(x.jp_p), num(x.jp_k), num(x.total_tk), t(ditanggung(x.tk_ditanggung))]),
    [tot(''), tot(''), tot(`TOTAL ${tk.length} peserta`), tot(''), tot(''), tot(tk.reduce((a, x) => a + x.dasar_tk, 0)), tot(rep.total.jht_p), tot(rep.total.jht_k), tot(rep.total.jkk), tot(rep.total.jkm),
      tot(''), tot(rep.total.jp_p), tot(rep.total.jp_k), tot(rep.total.total_tk), tot('')],
  ]
  const kesRows: XlsxCell[][] = [
    [{ v: `${title} — BPJS KESEHATAN`, s: 'title' }], [note], kesCols.map(head),
    ...kes.map((x, i) => [{ v: i + 1, s: 'center' as const }, t(x.nip), t(x.nama), t(x.jabatan), t(x.no_bpjs_kes), num(x.dasar_kes), num(x.kes_p), num(x.kes_k), num(x.total_kes), t(ditanggung(x.kes_ditanggung))]),
    [tot(''), tot(''), tot(`TOTAL ${kes.length} peserta`), tot(''), tot(''), tot(kes.reduce((a, x) => a + x.dasar_kes, 0)), tot(rep.total.kes_p), tot(rep.total.kes_k), tot(rep.total.total_kes), tot('')],
  ]
  const belum = rep.items.filter((x) => !x.dasar_tk || !x.dasar_kes)
  const sheets = [
    { title: 'BPJS Ketenagakerjaan', rows: tkRows, widths: [5, 12, 26, 18, 16, 14, 13, 13, 11, 11, 14, 13, 13, 15, 12], freeze: { row: 3, col: 3 } },
    { title: 'BPJS Kesehatan', rows: kesRows, widths: [5, 12, 26, 18, 18, 14, 14, 14, 16, 12], freeze: { row: 3, col: 3 } },
  ]
  if (belum.length) {
    sheets.push({
      title: 'Belum terdaftar', widths: [5, 12, 26, 18, 22, 22, 30],
      rows: [[{ v: 'KARYAWAN BELUM TERDAFTAR BPJS', s: 'title' }], ['NO', 'NIP', 'Nama', 'Jabatan', 'BPJS TK', 'BPJS Kesehatan', 'Catatan'].map(head),
        ...belum.map((x, i) => [{ v: i + 1, s: 'center' as const }, t(x.nip), t(x.nama), t(x.jabatan), t(x.dasar_tk ? 'Terdaftar' : 'Belum'), t(x.dasar_kes ? 'Terdaftar' : 'Belum'), t(x.catatan.join('; '))])],
    } as (typeof sheets)[number])
  }
  return { filename: `Laporan_BPJS_${periode}.xlsx`, buffer: writeXlsx(sheets) }
}
