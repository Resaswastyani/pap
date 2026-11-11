// Penulis XLSX minimal tanpa library (pasangan lib/xlsx-lite.ts): beberapa sheet berisi teks/angka,
// lebar kolom, sel digabung, dan beberapa gaya dasar (judul, kepala tabel, kolom Minggu, catatan).
import { deflateRawSync } from 'node:zlib'

export type XlsxStyle = 'normal' | 'title' | 'head' | 'sunday' | 'note' | 'example' | 'cell' | 'num' | 'off' | 'total' | 'center'
  // Laporan berwarna (mis. Laporan Gaji): kepala kolom per kelompok, angka Rupiah, baris belang (-z), total
  | 'h-id' | 'h-hadir' | 'h-plus' | 'h-minus' | 'h-thp' | 'h-misc' | 'money' | 'money-z' | 'cell-z' | 'center-z' | 'thp' | 'minus' | 'minus-z'
  | 'title2' | 'dec' | 'dec-z' | 'total-label' | 'total-money' | 'total-thp' | 'group'
export type XlsxCell = string | number | null | { v: string | number | null; s?: XlsxStyle }
export type XlsxSheet = { title: string; rows: XlsxCell[][]; widths?: number[]; merges?: string[]; freeze?: { row: number; col: number }; heights?: Record<number, number>; autoFilter?: string }

// Urutan = indeks cellXfs di styles.xml
const STYLE_INDEX: Record<XlsxStyle, number> = {
  normal: 0, title: 1, head: 2, sunday: 3, note: 4, example: 5, cell: 6, num: 7, off: 8, total: 9, center: 10,
  'h-id': 11, 'h-hadir': 12, 'h-plus': 13, 'h-minus': 14, 'h-thp': 15, 'h-misc': 16, money: 17, 'money-z': 18, 'cell-z': 19, 'center-z': 20,
  thp: 21, minus: 22, 'minus-z': 23, title2: 24, dec: 25, 'dec-z': 26, 'total-label': 27, 'total-money': 28, 'total-thp': 29, group: 30,
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function colName(i: number) {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function sheetXml(sheet: XlsxSheet) {
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      const { v, s } = cell !== null && typeof cell === 'object' ? cell : { v: cell, s: undefined }
      const ref = `${colName(c)}${r + 1}`
      const style = s ? ` s="${STYLE_INDEX[s]}"` : ''
      if (v === null || v === '') return s ? `<c r="${ref}"${style}/>` : ''
      if (typeof v === 'number') return `<c r="${ref}"${style}><v>${v}</v></c>`
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
    }).join('')
    const ht = sheet.heights?.[r + 1]
    return `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`
  }).join('')
  const cols = sheet.widths?.length ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  const freeze = sheet.freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${sheet.freeze.col}" ySplit="${sheet.freeze.row}" topLeftCell="${colName(sheet.freeze.col)}${sheet.freeze.row + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : ''
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
  const filter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${rows}</sheetData>${filter}${merges}</worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;Rp&quot; #,##0"/><numFmt numFmtId="165" formatCode="#,##0.0#"/></numFmts>
<fonts count="8"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF0B6B4A"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFC0392B"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF4B2BB0"/><name val="Calibri"/></font></fonts>
<fills count="13"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4DEFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFD6D6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF6D6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFEFD1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCF5E8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE2E1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7C5CFC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7F6FC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECECF2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1DB98A"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBBBBBB"/></left><right style="thin"><color rgb="FFBBBBBB"/></right><top style="thin"><color rgb="FFBBBBBB"/></top><bottom style="thin"><color rgb="FFBBBBBB"/></bottom><diagonal/></border></borders>

<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="31"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="2" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf fontId="3" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fillId="4" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf borderId="1" applyBorder="1"/><xf numFmtId="3" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="2" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf fontId="2" fillId="2" numFmtId="3" borderId="1" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/><xf borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf fontId="2" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="2" fillId="6" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="2" fillId="7" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="2" fillId="8" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="4" fillId="12" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="2" fillId="11" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" borderId="1" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="164" fillId="10" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf fillId="10" borderId="1" applyFill="1" applyBorder="1"/><xf fillId="10" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf fontId="5" fillId="7" numFmtId="164" borderId="1" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="6" numFmtId="164" borderId="1" applyFont="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="6" fillId="10" numFmtId="164" borderId="1" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="7" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="165" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="165" fillId="10" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf fontId="4" fillId="9" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf fontId="2" fillId="2" numFmtId="164" borderId="1" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="4" fillId="12" numFmtId="164" borderId="1" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/><xf fontId="4" fillId="9" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

// ---------- ZIP (deflate) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(files: { name: string; data: string }[]) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8')
    const body = deflateRawSync(raw)
    const name = Buffer.from(f.name, 'utf8')
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10)
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

export function writeXlsx(sheets: XlsxSheet[]) {
  const names = sheets.map((s, i) => esc(s.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`))
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ])
}
