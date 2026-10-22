// Laporan gaji per periode cut off (unduh XLS / cetak PDF) untuk HRD -> Keuangan: rekap per karyawan, rincian jam per minggu.
// Data sama dengan menu Grade & Gaji > Hitung gaji (absensi sampai hari ini, lembur rutin & variabel, BPJS).
import { hitungPeriode, listPayrolls, type SlipGaji } from '@/lib/payroll'
import { tglId } from '@/lib/attendance-report'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

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
  const title = `LAPORAN GAJI KARYAWAN PERIODE ${periodeLabel(periode).toUpperCase()} (${tglId(rep.dari)} s/d ${tglId(rep.sampai)})`
  const head = (v: string) => ({ v, s: 'head' as const })
  const t = (v: string | null) => ({ v, s: 'cell' as const })
  const num = (v: number) => ({ v: Math.round(v * 100) / 100, s: 'num' as const })
  const cols = ['NO', 'NIP', 'Nama', 'Jabatan', 'Tipe', 'Hadir (hari)', 'Jam dibayar', 'Lembur rutin (jam)', 'Lembur variabel (jam)', 'Lembur libur (jam)',
    'Upah', 'Lembur (Rp)', 'Tunjangan & lain', 'Bruto', 'Potongan BPJS', 'Potongan lain', 'Take Home Pay', 'Iuran BPJS perusahaan', ...(withBank ? ['Bank', 'No. rekening', 'Atas nama'] : []), 'Catatan']
  const rekap: XlsxCell[][] = [
    [{ v: title, s: 'title' }],
    [{ v: `Absensi dihitung sampai ${tglId(rep.sampai_data)}. Dicetak dari PAP-MS. PPh 21 belum dihitung.`, s: 'note' }],
    cols.map(head),
    ...rep.slips.map((s) => [
      { v: s.no, s: 'center' as const }, t(s.nip), t(s.nama), t(s.jabatan), t(s.tipe), num(s.hadir), num(s.mingguan?.jam_dibayar ?? 0),
      num(s.lembur_rutin_jam), num(s.mingguan?.lembur_variabel ?? s.lembur_jam), num(s.lembur_libur_jam),
      num(s.upah), num(s.lembur), num(tambahanLain(s)), num(s.bruto), num(s.potongan_bpjs), num(s.potongan_lain), num(s.diterima), num(s.bpjs_perusahaan.total),
      ...(withBank ? [t(s.rekening?.bank ?? null), t(s.rekening?.no_rekening ?? null), t(s.rekening?.nama_pemilik ?? null)] : []), t(s.catatan.join('; ') || null),
    ]),
    [{ v: 'TOTAL', s: 'total' }, ...Array(9).fill({ v: null, s: 'total' }),
      ...[rep.total.upah, rep.total.lembur, rep.total.lain, rep.total.bruto, rep.slips.reduce((x, s) => x + s.potongan_bpjs, 0), rep.slips.reduce((x, s) => x + s.potongan_lain, 0), rep.total.diterima, rep.total.bpjs_perusahaan]
        .map((v) => ({ v: Math.round(v), s: 'total' as const }))],
  ]
  // Rincian per minggu & baris slip
  const weekly: XlsxCell[][] = [
    [{ v: `RINCIAN JAM KERJA & LEMBUR PER MINGGU · ${periodeLabel(periode)}`, s: 'title' }],
    [{ v: 'Minggu dimulai dari hari libur rutin karyawan (Jadwal Shift). Jam dibayar maks 40 jam/minggu; kelebihan = lembur rutin.', s: 'note' }],
    ['NIP', 'Nama', 'Minggu', 'Dari', 'Sampai', 'Jam kerja', 'Jam dibayar', 'Lembur rutin', 'Lembur variabel', 'Lembur libur'].map(head),
    ...rep.slips.flatMap((s) => (s.mingguan?.minggu ?? []).map((m) => [
      t(s.nip), t(s.nama), { v: m.no, s: 'center' as const }, { v: m.dari, s: 'center' as const }, { v: m.sampai, s: 'center' as const },
      num(m.jam_kerja), num(m.jam_dibayar), num(m.lembur_rutin), num(m.lembur_variabel), num(m.lembur_libur),
    ])),
  ]
  const lines: XlsxCell[][] = [
    [{ v: `BARIS SLIP GAJI · ${periodeLabel(periode)}`, s: 'title' }],
    [],
    ['NIP', 'Nama', 'Kelompok', 'Keterangan', 'Nominal'].map(head),
    ...rep.slips.flatMap((s) => [
      ...s.rincian.penghasilan.map((l) => [t(s.nip), t(s.nama), t('Penghasilan'), t(l.label), num(l.nominal)]),
      ...s.rincian.tambahan.map((l) => [t(s.nip), t(s.nama), t('Penghasilan tambahan'), t(l.label), num(l.nominal)]),
      ...s.rincian.potongan.map((l) => [t(s.nip), t(s.nama), t('Potongan'), t(l.label), num(-l.nominal)]),
      [t(s.nip), t(s.nama), { v: 'Take Home Pay', s: 'total' as const }, { v: null, s: 'total' as const }, { v: s.diterima, s: 'total' as const }],
    ]),
  ]
  return {
    filename: `Laporan Gaji ${periode} (${rep.dari} sd ${rep.sampai_data}).xlsx`,
    buffer: writeXlsx([
      { title: 'Rekap Gaji', rows: rekap, widths: [5, 9, 28, 18, 16, 9, 9, 10, 10, 10, 13, 13, 13, 14, 12, 12, 14, 14, ...(withBank ? [16, 18, 22] : []), 36], freeze: { row: 3, col: 3 } },
      { title: 'Per Minggu', rows: weekly, widths: [9, 28, 8, 12, 12, 10, 10, 10, 10, 10], freeze: { row: 3, col: 2 } },
      { title: 'Baris Slip', rows: lines, widths: [9, 28, 22, 36, 14], freeze: { row: 3, col: 2 } },
    ]),
  }
}
