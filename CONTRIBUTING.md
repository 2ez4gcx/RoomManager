# Đóng góp cho RoomManager

Cảm ơn bạn đã quan tâm. Dự án do cá nhân duy trì trong thời gian rảnh, nên
phản hồi có thể chậm; issue và pull request rõ ràng, nhỏ gọn sẽ được xem nhanh
hơn.

## Báo lỗi

Mở [issue](https://github.com/2ez4gcx/RoomManager/issues/new/choose) và cho biết:

- Bạn đang chạy kiểu nào: xem thử (`start.bat` / `npm run dev`), server trên
  máy (`chay-server.bat`), hay Cloudflare.
- Các bước để gặp lại lỗi, điều bạn mong đợi và điều thực tế xảy ra.
- Phiên bản hoặc mã commit đang dùng.

**Đừng dán dữ liệu thật** của khách thuê (tên, số điện thoại, số CCCD) vào
issue. Che đi hoặc tái hiện bằng dữ liệu mẫu.

**Lỗ hổng bảo mật thì không mở issue công khai.** Xem [SECURITY.md](SECURITY.md).

## Chuẩn bị môi trường

Cần Node.js 22.18 trở lên.

```bash
git clone https://github.com/2ez4gcx/RoomManager.git
cd RoomManager
npm install
npm run dev          # http://localhost:3000
npm run db:setup     # dựng bảng và nạp dữ liệu mẫu
```

Đăng nhập bằng tài khoản mẫu `quanly@example.com` / `roommanager`.

## Trước khi gửi pull request

```bash
npm test             # typecheck + build + toàn bộ bài kiểm thử
npm run lint
```

Cả hai phải sạch; CI chạy lại đúng các lệnh này.

- **Một việc mỗi pull request.** Sửa lỗi và dọn dẹp không liên quan thì tách ra.
- **Thay đổi hành vi phải kèm bài kiểm thử.** Bộ kiểm thử trong `tests/` chạy
  trên bản build thật với workerd và D1; thêm bài vào đó thay vì giả lập.
- **Đổi schema** thì chạy `npm run db:generate` và commit cả file SQL sinh ra
  trong `drizzle/`. Migration phải chạy lại nhiều lần vẫn an toàn (xem
  `db/migrate.ts`).
- **Giao diện và thông báo lỗi viết bằng tiếng Việt.** Chú thích trong mã cũng
  bằng tiếng Việt, và giải thích *vì sao* chứ không nhắc lại mã làm gì.

## Quy ước trong mã

Vài nguyên tắc đang được giữ xuyên suốt; thay đổi đi ngược chúng cần lý do rõ:

- **Tiền là số nguyên VNĐ.** Không dùng số thực, không tự làm tròn số người
  dùng gõ — sai thì báo lỗi.
- **D1 không có transaction tương tác.** Thao tác nhiều bước có đụng tới tiền
  phải dùng một câu `UPDATE` có điều kiện để "giành" trước, rồi ghi phần còn
  lại trong một `db.batch` (xem `db/finance.ts`, `db/move-out.ts`).
- **D1 giới hạn 100 tham số mỗi câu lệnh.** Không truyền danh sách id dài vào
  `inArray`; dùng `selectInChunks` hoặc `chunkRows` trong `db/internal.ts`.
- **"Hôm nay" là theo giờ Việt Nam** (`todayInVietnam()`), không phải UTC.
- **Mọi route API tự kiểm tra quyền** bằng `requireApiUser()` hoặc
  `requireOwner()`. `proxy.ts` chỉ lo điều hướng, không phải lớp bảo vệ.
- **Trang công khai không được lộ dữ liệu khách thuê.** Có bài kiểm thử canh
  điều này; đừng nới nó.

## Giấy phép

Đóng góp của bạn được phát hành theo [giấy phép MIT](LICENSE) của dự án.
