# Nhật ký thay đổi

Các thay đổi đáng chú ý của dự án được ghi ở đây. Định dạng theo
[Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo
[Semantic Versioning](https://semver.org/lang/vi/).

## [Chưa phát hành]

## [0.1.0] - 2026-11-18

Bản công khai đầu tiên. Đây là bản thử nghiệm: có bộ kiểm thử tự động nhưng
chưa được dùng lâu dài với một nhà trọ thật.

### Có trong bản này

- Quản lý nhiều nhà, loại phòng và phòng; trạng thái phòng suy ra từ hợp đồng,
  giữ chỗ và bảo trì.
- Hồ sơ khách thuê và hợp đồng: tạo, sửa, trả phòng kèm đơn chốt tháng cuối,
  chốt chỉ số điện và tất toán tiền cọc.
- Lập đơn thu theo kỳ với chỉ số điện nhập tay, tiền phòng chia theo ngày, hạn
  thanh toán tính theo ngày lập đơn.
- Ghi nhận thanh toán một phần hoặc toàn phần, hủy và lập lại đơn.
- Sổ thu chi với thu chi vận hành tách khỏi tiền cọc.
- Nhắc nợ tự động mỗi ngày, soạn sẵn nội dung tin nhắn.
- Xuất Excel danh sách khách thuê, đơn thu và sổ thu chi.
- Trang đặt phòng công khai và bảng duyệt yêu cầu.
- Tài khoản chủ nhà và nhân viên với phân quyền; xác thực hai bước (TOTP) kèm
  mã khôi phục; đặt lại mật khẩu bằng link dùng một lần; nhật ký thao tác.
- Chạy trên máy cá nhân (`chay-server`) với sao lưu trước khi cập nhật cấu trúc
  dữ liệu, tùy chọn chỉ nhận kết nối nội bộ và chế độ đứng sau proxy HTTPS.
- Chạy trên Cloudflare Workers + D1, kèm lệnh kiểm tra an toàn sau deploy.

[Chưa phát hành]: https://github.com/2ez4gcx/RoomManager/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/2ez4gcx/RoomManager/releases/tag/v0.1.0
