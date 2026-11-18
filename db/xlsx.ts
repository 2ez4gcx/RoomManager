/**
 * Sinh file Excel (.xlsx) từ dữ liệu dạng bảng.
 *
 * Định dạng xlsx là một kho ZIP chứa vài file XML theo chuẩn Office Open XML.
 * Ở đây chỉ dựng phần tối thiểu Excel cần: bảng nội dung, quan hệ, workbook,
 * một worksheet và bảng định dạng.
 *
 * Chuỗi được ghi thẳng vào ô (`inlineStr`) thay vì qua bảng chuỗi dùng chung.
 * Tốn thêm dung lượng nhưng bỏ được cả một file XML và một tầng đánh chỉ số.
 */
import { createZip } from "./zip";
import { todayInVietnam } from "./internal";

export type CellValue = string | number | null | undefined;

export type SheetColumn = {
  header: string;
  /** Chiều rộng cột theo đơn vị ký tự của Excel. */
  width?: number;
  /** Định dạng số có phân cách hàng nghìn. Dùng cho cột tiền. */
  money?: boolean;
  /**
   * Cột ngày: giá trị `YYYY-MM-DD` được ghi thành ngày thật của Excel, để sắp
   * xếp và lọc theo ngày được. Giá trị không đúng dạng thì ghi như chữ.
   */
  date?: boolean;
};

export type Sheet = {
  name: string;
  columns: SheetColumn[];
  rows: CellValue[][];
};

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_MONEY = 2;
const STYLE_DATE = 3;

/** `2026-11-18` → số ngày tính từ mốc 30/12/1899 mà Excel dùng. */
function excelSerialDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) return null;
  return Math.round((time - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function escapeXml(value: string) {
  // XML 1.0 cấm hầu hết ký tự điều khiển, kể cả khi đã thoát. Một ký tự như
  // vậy lọt vào ô (dán từ nơi khác) là Excel báo file hỏng và không mở.
  return value
    // eslint-disable-next-line no-control-regex -- chủ ý khớp ký tự điều khiển để loại bỏ
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 0 → A, 25 → Z, 26 → AA. */
function columnName(index: number) {
  let name = "";
  let remaining = index;
  while (remaining >= 0) {
    name = String.fromCharCode((remaining % 26) + 65) + name;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return name;
}

/**
 * Excel không chấp nhận các ký tự này trong tên sheet, và tên tối đa 31 ký tự.
 * Vượt quá là file mở lên báo hỏng.
 */
function safeSheetName(name: string) {
  return (name.replace(/[\\/?*[\]:]/g, " ").trim() || "Sheet1").slice(0, 31);
}

function cellXml(value: CellValue, reference: string, style: number) {
  const styleAttr = style === STYLE_DEFAULT ? "" : ` s="${style}"`;

  if (value === null || value === undefined || value === "") {
    return `<c r="${reference}"${styleAttr}/>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"${styleAttr}><v>${value}</v></c>`;
  }
  return `<c r="${reference}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet) {
  const cols = sheet.columns
    .map((column, index) =>
      column.width
        ? `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`
        : "",
    )
    .join("");

  const header = sheet.columns
    .map((column, index) => cellXml(column.header, `${columnName(index)}1`, STYLE_HEADER))
    .join("");

  const body = sheet.rows
    .map((row, rowIndex) => {
      const cells = sheet.columns
        .map((column, columnIndex) => {
          const reference = `${columnName(columnIndex)}${rowIndex + 2}`;
          const serial = column.date ? excelSerialDate(row[columnIndex]) : null;
          if (serial !== null) return cellXml(serial, reference, STYLE_DATE);
          return cellXml(row[columnIndex], reference, column.money ? STYLE_MONEY : STYLE_DEFAULT);
        })
        .join("");
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
    cols ? `<cols>${cols}</cols>` : ""
  }<sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
}

/** Định dạng: dòng tiêu đề in đậm nền xám, cột tiền có phân cách hàng nghìn, cột ngày dd/mm/yyyy. */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E4DC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function createXlsx(sheets: Sheet[]): Uint8Array {
  const used = sheets.length > 0 ? sheets : [{ name: "Sheet1", columns: [], rows: [] }];

  const sheetEntries = used.map((sheet, index) => ({
    id: index + 1,
    name: safeSheetName(sheet.name),
    path: `xl/worksheets/sheet${index + 1}.xml`,
    xml: sheetXml(sheet),
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetEntries
  .map(
    (sheet) =>
      `<Override PartName="/${sheet.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("\n")}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetEntries
    .map(
      (sheet) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${sheet.id}" r:id="rId${sheet.id}"/>`,
    )
    .join("")}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetEntries
  .map(
    (sheet) =>
      `<Relationship Id="rId${sheet.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.id}.xml"/>`,
  )
  .join("\n")}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return createZip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rootRels },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
    { name: "xl/styles.xml", content: STYLES_XML },
    ...sheetEntries.map((sheet) => ({ name: sheet.path, content: sheet.xml })),
  ]);
}

/**
 * Tên file tải về.
 *
 * Bản xuất theo kỳ đã có kỳ trong tên nên không gắn thêm ngày — `don-thu-
 * 2026-08-2026-08-14.xlsx` có hai ngày dính nhau, rất khó đọc trong thư mục
 * Downloads. Bản chụp toàn bộ danh sách thì gắn ngày để phân biệt các lần xuất.
 */
export function exportFileName(prefix: string, options?: { withDate?: boolean }) {
  const suffix = options?.withDate ? `-${todayInVietnam()}` : "";
  return `${prefix}${suffix}.xlsx`;
}

export function xlsxResponse(bytes: Uint8Array, fileName: string) {
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(bytes.length),
    },
  });
}
