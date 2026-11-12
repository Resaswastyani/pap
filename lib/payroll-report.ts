// Laporan gaji per periode cut off (unduh XLS / cetak PDF) untuk HRD -> Keuangan: rekap per karyawan, rincian jam per minggu.
// Data sama dengan menu Grade & Gaji > Hitung gaji (absensi sampai hari ini, lembur rutin & variabel, BPJS).
import { hitungPeriode, listPayrolls, type SlipGaji } from '@/lib/payroll'
import { tglId } from '@/lib/attendance-report'
import { colName, writeXlsx, type XlsxCell, type XlsxStyle } from '@/lib/xlsx-write'

export const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const periodeLabel = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const tambahanLain = (s: SlipGaji) => s.tunjangan + s.pendapatan_lain + s.pendapatan_harian + s.cuti_dibayar

// withBank: nomor rekening hanya untuk HRD (data pribadi)
export async function payrollReport(periode: string, withBank: boolean) {
  const data = await hitungPeriode(periode)
  const bank = withBank ? new Map((await listPayrolls()).map((p) => [p.nip, { bank: p.bank, no_rekening: p.no_rekening, nama_pemilik: p.nama_pemilik }])) : null
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const slips = data.slips.map((s, i) => ({ ...s, no: i + 1, rekening: bank?.get(s.nip) ?? null }))
  const sum = (f: (s: SlipGaji) => number) => slips.reduce((t, s) => t + f(s), 0)
  return {
    periode, dari: data.dari, sampai: data.sampai, sampai_data: today < data.sampai ? today : data.sampai, slips,
    total: {
      upah: sum((s) => s.upah), lembur: sum((s) => s.lembur), lain: sum(tambahanLain), bruto: sum((s) => s.bruto),
      potongan: sum((s) => s.potongan_bpjs + s.potongan_lain), diterima: sum((s) => s.diterima), bpjs_perusahaan: sum((s) => s.bpjs_perusahaan.total),
    },
  }
}

export async function payrollXlsx(periode: string, withBank: boolean) {
  const rep = await payrollReport(periode, withBank)
  const title = `LAPORAN GAJI KARYAWAN · ${periodeLabel(periode).toUpperCase()}`
  const sub = `Periode ${tglId(rep.dari)} s/d ${tglId(rep.sampai)} · absensi dihitung sampai ${tglId(rep.sampai_data)} · ${rep.slips.length} karyawan · dicetak dari SIMPAP (PPh 21 belum dihitung)`
  // Sel bergaya; z = baris genap (belang) agar mudah dibaca
  const txt = (v: string | number | null, z: boolean) => ({ v, s: (z ? 'cell-z' : 'cell') as XlsxStyle })
  const mid = (v: string | number | null, z: boolean) => ({ v, s: (z ? 'center-z' : 'center') as XlsxStyle })
  const rp = (v: number, z: boolean) => ({ v: Math.round(v), s: (z ? 'money-z' : 'money') as XlsxStyle })
  const minus = (v: number, z: boolean) => ({ v: v ? -Math.round(v) : 0, s: (z ? 'minus-z' : 'minus') as XlsxStyle })
  const jam = (v: number, z: boolean) => ({ v: Math.round(v * 100) / 100, s: (z ? 'dec-z' : 'dec') as XlsxStyle })

  // ---------- Rekap: kolom dikelompokkan & diberi warna ----------
  const groups: { label: string; style: XlsxStyle; cols: string[] }[] = [
    { label: 'DATA KARYAWAN', style: 'h-id', cols: ['No', 'NIP', 'Nama', 'Jabatan', 'Tipe'] },
    { label: 'KEHADIRAN & JAM', style: 'h-hadir', cols: ['Hadir (hari)', 'Jam dibayar', 'Lembur rutin', 'Lembur variabel', 'Lembur libur'] },
    { label: 'PENGHASILAN', style: 'h-plus', cols: ['Upah', 'Lembur', 'Tunjangan & lain', 'Bruto'] },
    { label: 'POTONGAN', style: 'h-minus', cols: ['BPJS karyawan', 'Potongan lain'] },
    { label: 'DITERIMA', style: 'h-thp', cols: ['Take Home Pay'] },
    { label: 'LAIN-LAIN', style: 'h-misc', cols: ['BPJS perusahaan', ...(withBank ? ['Bank', 'No. rekening', 'Atas nama'] : []), 'Catatan'] },
  ]
  const width = groups.reduce((n, g) => n + g.cols.length, 0)
  const last = colName(width - 1)
  const merges = [`A1:${last}1`, `A2:${last}2`]
  let c = 0
  const groupRow: XlsxCell[] = []
  for (const g of groups) {
    groupRow.push({ v: g.label, s: 'group' }, ...Array(g.cols.length - 1).fill({ v: null, s: 'group' }))
    if (g.cols.length > 1) merges.push(`${colName(c)}4:${colName(c + g.cols.length - 1)}4`)
    c += g.cols.length
  }
  const rekap: XlsxCell[][] = [
    [{ v: title, s: 'title2' }],
    [{ v: sub, s: 'note' }],
    [],
    groupRow,
    groups.flatMap((g) => g.cols.map((v) => ({ v, s: g.style }))),
    ...rep.slips.map((sl, i) => {
      const z = i % 2 === 1
      return [
        mid(sl.no, z), mid(sl.nip, z), txt(sl.nama, z), txt(sl.jabatan, z), mid(sl.tipe, z),
        jam(sl.hadir, z), jam(sl.mingguan?.jam_dibayar ?? 0, z), jam(sl.lembur_rutin_jam, z), jam(sl.mingguan?.lembur_variabel ?? sl.lembur_jam, z), jam(sl.lembur_libur_jam, z),
        rp(sl.upah, z), rp(sl.lembur, z), rp(tambahanLain(sl), z), rp(sl.bruto, z),
        minus(sl.potongan_bpjs, z), minus(sl.potongan_lain, z),
        { v: Math.round(sl.diterima), s: 'thp' as XlsxStyle },
        rp(sl.bpjs_perusahaan.total, z),
        ...(withBank ? [txt(sl.rekening?.bank ?? null, z), mid(sl.rekening?.no_rekening ?? null, z), txt(sl.rekening?.nama_pemilik ?? null, z)] : []),
        txt(sl.catatan.join('; ') || null, z),
      ]
    }),
    [
      { v: `TOTAL ${rep.slips.length} KARYAWAN`, s: 'total-label' }, ...Array(9).fill({ v: null, s: 'total-label' }),
      ...[rep.total.upah, rep.total.lembur, rep.total.lain, rep.total.bruto].map((v) => ({ v: Math.round(v), s: 'total-money' as XlsxStyle })),
      ...[rep.slips.reduce((x, sl) => x + sl.potongan_bpjs, 0), rep.slips.reduce((x, sl) => x + sl.potongan_lain, 0)].map((v) => ({ v: v ? -Math.round(v) : 0, s: 'total-money' as XlsxStyle })),
      { v: Math.round(rep.total.diterima), s: 'total-thp' },
      { v: Math.round(rep.total.bpjs_perusahaan), s: 'total-money' },
      ...Array((withBank ? 3 : 0) + 1).fill({ v: null, s: 'total-money' }),
    ],
  ]
  const totalRow = rekap.length
  merges.push(`A${totalRow}:J${totalRow}`)

  // ---------- Per minggu: belang per karyawan ----------
  const weekly: XlsxCell[][] = [
    [{ v: `RINCIAN JAM KERJA & LEMBUR PER MINGGU · ${periodeLabel(periode).toUpperCase()}`, s: 'title2' }],
    [{ v: 'Minggu dimulai dari hari libur rutin karyawan (Jadwal Shift). Jam dibayar maks 40 jam/minggu; kelebihan = lembur rutin.', s: 'note' }],
    [],
    ['NIP', 'Nama', 'Minggu ke-', 'Dari', 'Sampai'].map((v) => ({ v, s: 'h-id' as XlsxStyle })).concat(['Jam kerja', 'Jam dibayar', 'Lembur rutin', 'Lembur variabel', 'Lembur libur'].map((v) => ({ v, s: 'h-hadir' as XlsxStyle }))),
    ...rep.slips.flatMap((sl, i) => (sl.mingguan?.minggu ?? []).map((m) => {
      const z = i % 2 === 1
      return [mid(sl.nip, z), txt(sl.nama, z), mid(m.no, z), mid(m.dari, z), mid(m.sampai, z), jam(m.jam_kerja, z), jam(m.jam_dibayar, z), jam(m.lembur_rutin, z), jam(m.lembur_variabel, z), jam(m.lembur_libur, z)]
    })),
  ]

  // ---------- Baris slip: penghasilan (hijau), potongan (merah), take home pay ----------
  const lines: XlsxCell[][] = [
    [{ v: `RINCIAN SLIP GAJI · ${periodeLabel(periode).toUpperCase()}`, s: 'title2' }],
    [{ v: 'Penghasilan, penghasilan tambahan, dan potongan per karyawan; baris hijau = take home pay.', s: 'note' }],
    [],
    ['NIP', 'Nama'].map((v) => ({ v, s: 'h-id' as XlsxStyle })).concat([{ v: 'Kelompok', s: 'h-misc' }, { v: 'Keterangan', s: 'h-misc' }, { v: 'Nominal', s: 'h-plus' }]),
    ...rep.slips.flatMap((sl, i) => {
      const z = i % 2 === 1
      return [
        ...sl.rincian.penghasilan.map((l) => [mid(sl.nip, z), txt(sl.nama, z), txt('Penghasilan', z), txt(l.label, z), rp(l.nominal, z)]),
        ...sl.rincian.tambahan.map((l) => [mid(sl.nip, z), txt(sl.nama, z), txt('Penghasilan tambahan', z), txt(l.label, z), rp(l.nominal, z)]),
        ...sl.rincian.potongan.map((l) => [mid(sl.nip, z), txt(sl.nama, z), txt('Potongan', z), txt(l.label, z), minus(l.nominal, z)]),
        [mid(sl.nip, z), txt(sl.nama, z), { v: 'Take Home Pay', s: 'thp' as XlsxStyle }, { v: null, s: 'thp' as XlsxStyle }, { v: Math.round(sl.diterima), s: 'thp' as XlsxStyle }],
      ]
    }),
  ]
  const widthsRekap = [5, 11, 24, 18, 10, 8, 9, 9, 9, 9, 14, 13, 14, 15, 13, 13, 15, 14, ...(withBank ? [12, 17, 20] : []), 28]
  return {
    filename: `Laporan Gaji ${periode} (${rep.dari} sd ${rep.sampai_data}).xlsx`,
    buffer: writeXlsx([
      { title: 'Rekap Gaji', rows: rekap, widths: widthsRekap, merges, freeze: { row: 5, col: 3 }, heights: { 1: 26, 2: 30, 4: 20, 5: 34, [totalRow]: 22 }, autoFilter: `A5:${last}${5 + rep.slips.length}` },
      { title: 'Per Minggu', rows: weekly, widths: [11, 24, 9, 12, 12, 10, 10, 10, 11, 10], merges: ['A1:J1', 'A2:J2'], freeze: { row: 4, col: 2 }, heights: { 1: 24, 2: 28, 4: 30 } },
      { title: 'Rincian Slip', rows: lines, widths: [11, 24, 20, 34, 15], merges: ['A1:E1', 'A2:E2'], freeze: { row: 4, col: 2 }, heights: { 1: 24, 2: 22, 4: 24 } },
    ]),
  }
}
