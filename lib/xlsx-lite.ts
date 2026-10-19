// Pembaca XLSX minimal tanpa library (zip + XML sederhana), cukup untuk ekspor Google Sheet:
// semua tab (kecuali tersembunyi) -> baris teks. Sel tanggal tetap berupa angka seri Excel (lihat parseSheetDate).
import { inflateRawSync } from 'node:zlib'

type ZipEntry = { name: string; method: number; size: number; offset: number }

function zipEntries(buf: Buffer) {
  // End of central directory: dicari dari belakang (komentar zip maks 64 KB)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('File XLSX tidak valid.')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { name, method, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readEntry(buf: Buffer, e: ZipEntry | undefined) {
  if (!e) return ''
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28)
  const data = buf.subarray(start, start + e.size)
  return (e.method === 8 ? inflateRawSync(data) : data).toString('utf8')
}

const decode = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, x: string) =>
    x === 'lt' ? '<' : x === 'gt' ? '>' : x === 'quot' ? '"' : x === 'apos' ? "'" : x === 'amp' ? '&'
      : String.fromCodePoint(x[1] === 'x' || x[1] === 'X' ? parseInt(x.slice(2), 16) : Number(x.slice(1))))
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
// Teks dalam elemen (gabungan semua <t>, termasuk rich text)
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('')

function colIndex(ref: string) {
  let n = 0
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function readXlsx(buf: Buffer): { title: string; rows: string[][] }[] {
  const zip = zipEntries(buf)
  const shared = [...readEntry(buf, zip.get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]))
  const rels = new Map([...readEntry(buf, zip.get('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]))
  const sheets = [...readEntry(buf, zip.get('xl/workbook.xml')).matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0])
  const out: { title: string; rows: string[][] }[] = []
  for (const tag of sheets) {
    if (attr(tag, 'state') === 'hidden' || attr(tag, 'state') === 'veryHidden') continue
    const target = rels.get(attr(tag, 'r:id'))
    if (!target) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const xml = readEntry(buf, zip.get(path))
    const rows: string[][] = []
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const index = Number(attr(r[1], 'r') ?? rows.length + 1) - 1
      const row: string[] = []
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r')
        const type = attr(c[1], 't')
        const body = c[2] ?? ''
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        let value = ''
        if (type === 's') value = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') value = texts(body)
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
        else value = v === undefined ? '' : decode(v)
        const col = ref ? colIndex(ref) : row.length
        while (row.length < col) row.push('')
        row[col] = value
      }
      while (rows.length < index) rows.push([])
      rows[index] = row
    }
    out.push({ title: decode(attr(tag, 'name') ?? `Sheet${out.length + 1}`), rows })
  }
  return out
}
