/**
 * Đóng gói ZIP tối giản, không nén (phương thức "store").
 *
 * Viết trực tiếp thay vì thêm thư viện: file xlsx chỉ là ZIP chứa vài file XML,
 * mà thư viện đọc/ghi Excel phổ biến nặng gần một megabyte — đủ để chạm giới
 * hạn kích thước bundle của Cloudflare Workers.
 *
 * Không nén nên file to hơn, nhưng bảng vài trăm dòng vẫn chỉ vài chục KB, và
 * đổi lại không phải cài thêm bộ nén nào.
 */

/** Bảng tra CRC-32, dựng một lần rồi dùng lại. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipFile = { name: string; content: string };

/**
 * Ghép các file thành một kho ZIP.
 *
 * Dùng dấu thời gian cố định thay vì giờ hiện tại: cùng dữ liệu vào thì cùng
 * byte ra, nên bài kiểm thử so sánh được và file không đổi vô cớ.
 */
export function createZip(files: ZipFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  // 1980-01-01 00:00 theo định dạng MS-DOS.
  const dosTime = 0;
  const dosDate = 33;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true); // chữ ký local file header
    view.setUint16(4, 20, true); // phiên bản cần để giải nén
    view.setUint16(6, 0x0800, true); // cờ: tên file mã hóa UTF-8
    view.setUint16(8, 0, true); // phương thức nén: 0 = store
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // độ dài phần mở rộng
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true); // chữ ký central directory
    centralView.setUint16(4, 20, true); // phiên bản tạo file
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true); // vị trí local header
    centralHeader.set(nameBytes, 46);

    central.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // chữ ký end of central directory
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);

  let cursor = 0;
  for (const part of all) {
    output.set(part, cursor);
    cursor += part.length;
  }

  return output;
}
