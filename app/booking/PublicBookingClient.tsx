"use client";

import {
  ArrowRight, Bath, BedDouble, Building2, CalendarDays, Check, ChevronDown,
  Clock3, MapPin, Menu, Phone, ShieldCheck, Sparkles, Users, Wifi, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../components/AppShell";
import { money } from "../lib/format";
import type { PublicProperty, PublicRoom } from "../../db/queries-extra";

const ALL = "Tất cả vị trí";

/** Nền trang trí cho thẻ phòng, xoay vòng theo thứ tự hiển thị. */
const PHOTO_THEMES = ["room-photo-one", "room-photo-two", "room-photo-three"];

export function PublicBookingClient({
  rooms, properties, orgName, phone, email,
}: {
  rooms: PublicRoom[];
  properties: PublicProperty[];
  orgName: string;
  phone: string;
  email: string;
}) {
  const [menu, setMenu] = useState(false);
  const [place, setPlace] = useState(ALL);
  const [selected, setSelected] = useState<PublicRoom | null>(null);

  const visible = useMemo(
    () => rooms.filter((room) => place === ALL || room.propertyName === place),
    [place, rooms],
  );

  const telHref = `tel:${phone.replace(/\s+/g, "")}`;

  return (
    <main className="public-site">
      <header className="public-header">
        <a className="public-brand" href="/booking"><span><BedDouble size={20} /></span>{orgName}</a>
        <nav className={menu ? "open" : ""}>
          <a href="#rooms">Phòng trống</a>
          <a href="#properties">Vị trí</a>
          <a href="#process">Cách đặt phòng</a>
          {phone && <a href={telHref} className="public-phone"><Phone size={15} /> {phone}</a>}
        </nav>
        <button className="public-menu" onClick={() => setMenu(!menu)} aria-label="Mở menu">
          {menu ? <X /> : <Menu />}
        </button>
      </header>

      <section className="public-hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <Sparkles size={14} />
            {rooms.length > 0 ? `${rooms.length} phòng sẵn sàng nhận khách` : "Hiện đã kín phòng"}
          </span>
          <h1>Tìm một căn phòng<br />để <em>thật sự sống.</em></h1>
          <p>Phòng sạch, đủ tiện nghi, giá rõ ràng. Đặt lịch xem phòng trực tiếp với chủ nhà, không qua trung gian.</p>
          <div className="hero-actions">
            <a href="#rooms" className="public-primary">Xem phòng đang trống <ArrowRight size={17} /></a>
            {phone && <a href={telHref} className="public-secondary"><Phone size={17} /> Gọi chủ nhà</a>}
          </div>
          <div className="hero-trust">
            <span><ShieldCheck size={17} /> Hợp đồng minh bạch</span>
            <span><Clock3 size={17} /> Phản hồi trong 2 giờ</span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="building-shape">
            <span className="building-sun" />
            <div className="building-top" />
            <div className="building-body">
              {Array.from({ length: 12 }, (_, index) => <i key={index} className={index === 5 ? "lit" : ""} />)}
            </div>
            <div className="building-door" />
          </div>
          <div className="floating-card">
            <span><MapPin size={15} /></span>
            <div>
              <strong>{properties.length} vị trí thuận tiện</strong>
              <small>{properties.map((property) => property.name).join(" · ")}</small>
            </div>
          </div>
        </div>
      </section>

      <section className="public-benefits">
        <div><Wifi size={21} /><span><strong>Wifi tốc độ cao</strong><small>Có sẵn trong mỗi phòng</small></span></div>
        <div><ShieldCheck size={21} /><span><strong>An ninh 24/7</strong><small>Camera và khóa vân tay</small></span></div>
        <div><Bath size={21} /><span><strong>Tiện nghi riêng</strong><small>Bếp và nhà vệ sinh riêng</small></span></div>
        <div><Users size={21} /><span><strong>Không phí môi giới</strong><small>Làm việc thẳng với chủ nhà</small></span></div>
      </section>

      <section className="public-section" id="rooms">
        <div className="public-section-heading">
          <div>
            <span>PHÒNG ĐANG TRỐNG</span>
            <h2>Chọn căn phòng hợp với bạn</h2>
            <p>Cập nhật theo thời gian thực · Giá đã bao gồm phí quản lý.</p>
          </div>
          <label>
            <Building2 size={15} />
            <select value={place} onChange={(event) => setPlace(event.target.value)}>
              <option>{ALL}</option>
              {properties.map((property) => (
                <option key={property.id}>{property.name}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>

        <div className="available-grid">
          {visible.map((room, index) => (
            <article className="available-card" key={room.id}>
              <div className={`room-photo ${PHOTO_THEMES[index % PHOTO_THEMES.length]}`}>
                <span className="available-label">Còn trống</span>
                <span className="room-photo-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="photo-room-art"><BedDouble size={40} /><i /><i /></div>
              </div>
              <div className="available-body">
                <div className="available-title">
                  <div>
                    <span>{room.propertyName} · Tầng {room.floor}</span>
                    <h3>{room.roomTypeName} {room.code}</h3>
                  </div>
                  <strong>{money.format(room.price)}đ<small>/tháng</small></strong>
                </div>
                <p className="room-area">{room.area}m² · Tối đa {room.maxOccupants} người</p>
                <div className="feature-tags">
                  {room.amenities.map((amenity) => (
                    <span key={amenity}><Check size={12} />{amenity}</span>
                  ))}
                </div>
                <button onClick={() => setSelected(room)}>Đặt lịch xem phòng <ArrowRight size={16} /></button>
              </div>
            </article>
          ))}
          {visible.length === 0 && (
            <div className="empty-state">
              Hiện chưa có phòng trống ở khu vực này. {phone && `Gọi ${phone} để được báo khi có phòng.`}
            </div>
          )}
        </div>
      </section>

      <section className="properties-showcase" id="properties">
        {properties.slice(0, 2).map((property, index) => (
          <div key={property.id} style={{ order: index * 2 }}>
            <span className="section-index">{String(index + 1).padStart(2, "0")}</span>
            <h2>{property.name}</h2>
            <p>{property.address}</p>
            <strong>{property.totalRooms} phòng · còn trống {property.vacantRooms}</strong>
          </div>
        ))}
        {properties.slice(0, 2).map((property, index) => (
          <div
            className={`property-art property-art-${index === 0 ? "one" : "two"}`}
            key={`${property.id}-art`}
            style={{ order: index * 2 + 1 }}
          >
            <Building2 size={54} />
          </div>
        ))}
      </section>

      <section className="booking-process" id="process">
        <div className="process-heading"><span>ĐẶT PHÒNG DỄ DÀNG</span><h2>Ba bước để nhận phòng</h2></div>
        <div className="process-steps">
          <article><b>1</b><CalendarDays size={24} /><h3>Gửi yêu cầu</h3><p>Chọn phòng và thời gian bạn muốn đến xem.</p></article>
          <article><b>2</b><Phone size={24} /><h3>Chủ nhà xác nhận</h3><p>Chúng tôi gọi lại trong vòng 2 giờ để chốt lịch.</p></article>
          <article><b>3</b><Check size={24} /><h3>Xem và giữ phòng</h3><p>Xem thực tế, đọc hợp đồng rồi mới quyết định đặt cọc.</p></article>
        </div>
      </section>

      <footer className="public-footer">
        <div>
          <a className="public-brand" href="/booking"><span><BedDouble size={20} /></span>{orgName}</a>
          <p>Phòng trọ tử tế cho những ngày sống thật thoải mái.</p>
        </div>
        <div>
          <strong>Liên hệ</strong>
          {phone && <a href={telHref}>{phone}</a>}
          {email && <a href={`mailto:${email}`}>{email}</a>}
        </div>
        <div>
          <strong>Địa điểm</strong>
          {properties.map((property) => <span key={property.id}>{property.address}</span>)}
        </div>
      </footer>

      <BookingModal room={selected} onClose={() => setSelected(null)} />
    </main>
  );
}

function BookingModal({ room, onClose }: { room: PublicRoom | null; onClose: () => void }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room) return;

    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/booking-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          phone: form.get("phone"),
          roomId: room.id,
          preferredMoveIn: form.get("preferredMoveIn"),
          occupants: form.get("occupants"),
          message: form.get("message"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không gửi được yêu cầu, vui lòng thử lại.");
        return;
      }
      setSent(true);
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setSent(false);
    setError("");
    onClose();
  }

  return (
    <Modal open={!!room} onClose={close}>
      {sent ? (
        <div className="booking-success">
          <span><Check size={28} /></span>
          <h2>Đã nhận yêu cầu!</h2>
          <p>Chủ nhà sẽ liên hệ với bạn trong vòng 2 giờ để xác nhận lịch xem phòng {room?.code}.</p>
          <button className="public-primary" onClick={close}>Hoàn tất</button>
        </div>
      ) : (
        <>
          <div className="modal-heading">
            <div>
              <span className="modal-kicker">ĐẶT LỊCH XEM PHÒNG</span>
              <h2>{room?.roomTypeName} {room?.code}</h2>
              <p>{room?.propertyName} · {room ? money.format(room.price) : ""}đ/tháng</p>
            </div>
            <button className="icon-button" onClick={close} aria-label="Đóng"><X size={20} /></button>
          </div>
          <form onSubmit={submit}>
            <label>Họ và tên<input name="fullName" required placeholder="Tên của bạn" /></label>
            <label>Số điện thoại<input name="phone" required inputMode="tel" placeholder="09xxxxxxxx" /></label>
            <div className="form-grid">
              <label>
                Ngày muốn xem
                <input name="preferredMoveIn" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </label>
              <label>
                Số người ở
                <select name="occupants" defaultValue="1">
                  {Array.from({ length: room?.maxOccupants ?? 2 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>{index + 1} người</option>
                  ))}
                </select>
              </label>
            </div>
            <label>Lời nhắn<textarea name="message" placeholder="Khung giờ thuận tiện hoặc nhu cầu của bạn..." /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="submit-button" type="submit" disabled={busy}>
              {busy ? "Đang gửi..." : "Gửi yêu cầu xem phòng"}
            </button>
            <small className="privacy-note">Thông tin chỉ được dùng để liên hệ về yêu cầu này.</small>
          </form>
        </>
      )}
    </Modal>
  );
}
