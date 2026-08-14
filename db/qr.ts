/**
 * Sinh ma trận mã QR.
 *
 * Trả về ma trận điểm chứ không trả chuỗi SVG: phía giao diện tự vẽ bằng React
 * nên không phải chèn HTML thô vào trang.
 *
 * `qrcode-generator` là JavaScript thuần, không đụng API của Node, nên chạy
 * được trong Workers.
 */
import qrcode from "qrcode-generator";

/**
 * Mức sửa lỗi M chịu được khoảng 15% diện tích bị che.
 * Đủ cho màn hình, mà không làm mã dày thêm như mức Q hay H.
 */
const ERROR_CORRECTION = "M";

/**
 * Mỗi hàng là một chuỗi '0'/'1'.
 *
 * Gọn hơn mảng boolean lồng nhau khi truyền qua JSON, và đọc log cũng dễ hơn.
 */
export function qrMatrix(text: string): string[] {
  // 0 = tự chọn phiên bản nhỏ nhất chứa vừa nội dung.
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(text);
  qr.make();

  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (qr.isDark(row, column) ? "1" : "0")).join(""),
  );
}
