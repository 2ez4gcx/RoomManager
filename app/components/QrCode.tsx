/**
 * Vẽ mã QR từ ma trận điểm do máy chủ sinh.
 *
 * Vẽ bằng React thay vì nhận chuỗi SVG rồi chèn thẳng vào trang: không phải
 * dùng dangerouslySetInnerHTML, nên không có đường nào để HTML lạ lọt vào.
 */
export function QrCode({ matrix, size = 200 }: { matrix: string[]; size?: number }) {
  const modules = matrix.length;
  if (modules === 0) return null;

  // Vùng trắng quanh mã theo chuẩn QR; thiếu nó nhiều máy quét không nhận.
  const quiet = 4;
  const total = modules + quiet * 2;

  return (
    <svg
      className="qr-code"
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Mã QR cài đặt xác thực hai bước"
    >
      <rect width={total} height={total} fill="#ffffff" />
      {matrix.map((row, rowIndex) =>
        [...row].map((cell, columnIndex) =>
          cell === "1" ? (
            <rect
              key={`${rowIndex}-${columnIndex}`}
              x={columnIndex + quiet}
              y={rowIndex + quiet}
              width={1}
              height={1}
              fill="#14372f"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
