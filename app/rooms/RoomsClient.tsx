"use client";

import {
  BedDouble, Building2, ChevronDown, Grid2X2, HousePlus, LayoutGrid, List,
  MoreHorizontal, SlidersHorizontal, UserRound, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell, Modal, PageHeader, StatusBadge } from "../components/AppShell";
import { formatDate, money } from "../lib/format";
import type { SessionUser } from "../../db/auth";
import type { PropertyOption, RoomStatus, RoomTypeOption, RoomView } from "../../db/queries";

const tones: Record<RoomStatus, "green" | "blue" | "gold" | "gray"> = {
  "Đang thuê": "green",
  Trống: "blue",
  "Đã giữ": "gold",
  "Bảo trì": "gray",
};

const ALL_PROPERTIES = "Tất cả nhà";
const ALL_STATUSES = "Tất cả trạng thái";

type Props = {
  rooms: RoomView[];
  properties: PropertyOption[];
  roomTypes: RoomTypeOption[];
  currentUser: SessionUser;
};

export function RoomsClient({ rooms, properties, roomTypes, currentUser }: Props) {
  const router = useRouter();
  const [addingProperty, setAddingProperty] = useState(false);
  const [addingRoomType, setAddingRoomType] = useState(false);
  const [query, setQuery] = useState("");
  const [propertyName, setPropertyName] = useState(ALL_PROPERTIES);
  const [status, setStatus] = useState(ALL_STATUSES);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<RoomView | null>(null);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rooms.filter(
      (room) =>
        (propertyName === ALL_PROPERTIES || room.propertyName === propertyName) &&
        (status === ALL_STATUSES || room.status === status) &&
        `${room.code} ${room.number} ${room.tenantName ?? ""} ${room.roomTypeName}`
          .toLowerCase()
          .includes(needle),
    );
  }, [propertyName, query, rooms, status]);

  const counts = useMemo(
    () => ({
      occupied: rooms.filter((room) => room.status === "Đang thuê").length,
      vacant: rooms.filter((room) => room.status === "Trống").length,
      attention: rooms.filter(
        (room) => room.status === "Bảo trì" || room.status === "Đã giữ",
      ).length,
    }),
    [rooms],
  );

  const perProperty = useMemo(
    () =>
      properties.map((property) => {
        const own = rooms.filter((room) => room.propertyId === property.id);
        const occupied = own.filter((room) => room.status === "Đang thuê").length;
        return {
          ...property,
          total: own.length,
          occupied,
          rate: own.length ? Math.round((occupied / own.length) * 100) : 0,
        };
      }),
    [properties, rooms],
  );

  return (
    <AppShell
      currentUser={currentUser}
      searchValue={query}
      onSearch={setQuery}
      searchPlaceholder="Tìm số phòng, khách thuê..."
      actionLabel="Thêm phòng"
      onAction={() => setAdding(true)}
    >
      <div className="content">
        <PageHeader
          eyebrow="TÀI SẢN"
          title="Nhà & phòng"
          description={`Quản lý ${rooms.length} phòng tại ${properties.length} địa điểm.`}
        >
          <div className="heading-actions">
            <div className="header-mini-stats">
              <span><b>{counts.occupied}</b> đang thuê</span>
              <span><b>{counts.vacant}</b> phòng trống</span>
              <span><b>{counts.attention}</b> cần xử lý</span>
            </div>
            {currentUser.role === "owner" && (
              <>
                <button className="secondary-button" type="button" onClick={() => setAddingRoomType(true)}>
                  <LayoutGrid size={15} /> Thêm loại phòng
                </button>
                <button className="secondary-button" type="button" onClick={() => setAddingProperty(true)}>
                  <HousePlus size={15} /> Thêm nhà
                </button>
              </>
            )}
          </div>
        </PageHeader>

        <section className="property-strip">
          {perProperty.map((property) => (
            <button
              type="button"
              className={`property-card ${propertyName === property.name ? "selected" : ""}`}
              key={property.id}
              onClick={() =>
                setPropertyName((current) =>
                  current === property.name ? ALL_PROPERTIES : property.name,
                )
              }
            >
              <div className={`property-visual property-${property.code.toLowerCase()}`}>
                <Building2 size={24} />
              </div>
              <div>
                <span>{property.name}</span>
                <strong>{property.occupied}/{property.total} phòng đang thuê</strong>
                <small>{property.address}</small>
              </div>
              <b>{property.rate}%</b>
            </button>
          ))}
        </section>

        <div className="filter-bar">
          <label>
            <Building2 size={15} />
            <select value={propertyName} onChange={(event) => setPropertyName(event.target.value)}>
              <option>{ALL_PROPERTIES}</option>
              {properties.map((property) => (
                <option key={property.id}>{property.name}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <label>
            <SlidersHorizontal size={15} />
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option>{ALL_STATUSES}</option>
              <option>Đang thuê</option>
              <option>Trống</option>
              <option>Đã giữ</option>
              <option>Bảo trì</option>
            </select>
            <ChevronDown size={14} />
          </label>
          <span className="result-count">{filtered.length} phòng</span>
          <div className="view-switch">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Dạng lưới"><Grid2X2 size={15} /></button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="Dạng danh sách"><List size={16} /></button>
          </div>
        </div>

        {view === "grid" ? (
          <section className="room-card-grid">
            {filtered.map((room) => (
              <button className="room-card" key={room.id} onClick={() => setSelected(room)}>
                <div className="room-card-top">
                  <span className="room-number">{room.number}</span>
                  <StatusBadge tone={tones[room.status]}>{room.status}</StatusBadge>
                </div>
                <div className="room-card-icon"><BedDouble size={24} /></div>
                <h3>Phòng {room.number}</h3>
                <p>{room.roomTypeName} · {room.area}m² · Tầng {room.floor}</p>
                <div className="room-card-person">
                  <UserRound size={14} />
                  <span>{room.tenantName ?? "Chưa có khách thuê"}</span>
                </div>
                <div className="room-card-bottom">
                  <strong>{money.format(room.price)}đ<small>/tháng</small></strong>
                  <MoreHorizontal size={17} />
                </div>
              </button>
            ))}
            {filtered.length === 0 && <div className="empty-state">Không tìm thấy phòng phù hợp.</div>}
          </section>
        ) : (
          <section className="panel data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Phòng</th><th>Nhà</th><th>Loại phòng</th><th>Khách thuê</th>
                  <th>Giá thuê</th><th>Công nợ</th><th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((room) => (
                  <tr key={room.id} onClick={() => setSelected(room)}>
                    <td><strong>{room.code}</strong></td>
                    <td>{room.propertyName}</td>
                    <td>{room.roomTypeName} · {room.area}m²</td>
                    <td>{room.tenantName ?? "—"}</td>
                    <td>{money.format(room.price)}đ</td>
                    <td className={room.outstanding > 0 ? "debt" : "paid"}>
                      {room.outstanding > 0 ? `${money.format(room.outstanding)}đ` : "—"}
                    </td>
                    <td><StatusBadge tone={tones[room.status]}>{room.status}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="empty-state">Không tìm thấy phòng phù hợp.</div>}
          </section>
        )}
      </div>

      <RoomDetailModal room={selected} onClose={() => setSelected(null)} />
      <AddPropertyModal
        open={addingProperty}
        onClose={() => setAddingProperty(false)}
        onCreated={() => {
          setAddingProperty(false);
          router.refresh();
        }}
      />
      <AddRoomTypeModal
        open={addingRoomType}
        properties={properties}
        onClose={() => setAddingRoomType(false)}
        onCreated={() => {
          setAddingRoomType(false);
          router.refresh();
        }}
      />
      <AddRoomModal
        open={adding}
        properties={properties}
        roomTypes={roomTypes}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false);
          router.refresh();
        }}
      />
    </AppShell>
  );
}

function RoomDetailModal({ room, onClose }: { room: RoomView | null; onClose: () => void }) {
  return (
    <Modal open={!!room} onClose={onClose}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">CHI TIẾT PHÒNG</span>
          <h2>Phòng {room?.number}</h2>
          <p>{room?.propertyName} · Tầng {room?.floor}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      {room && (
        <>
          <div className="detail-hero">
            <div><BedDouble size={28} /></div>
            <span>{room.roomTypeName}<small>{room.area}m² · {money.format(room.price)}đ/tháng</small></span>
            <StatusBadge tone={tones[room.status]}>{room.status}</StatusBadge>
          </div>
          <div className="detail-list">
            <div><span>Khách thuê</span><strong>{room.tenantName ?? "Chưa có"}</strong></div>
            <div><span>Mã phòng</span><strong>{room.code}</strong></div>
            <div><span>Hạn thanh toán gần nhất</span><strong>{formatDate(room.dueDate)}</strong></div>
            <div>
              <span>Còn nợ</span>
              <strong className={room.outstanding > 0 ? "debt" : "paid"}>
                {room.outstanding > 0 ? `${money.format(room.outstanding)}đ` : "Không nợ"}
              </strong>
            </div>
          </div>
          {room.note && <div className="note-box"><strong>Ghi chú</strong><p>{room.note}</p></div>}
        </>
      )}
    </Modal>
  );
}

function AddRoomModal({
  open, properties, roomTypes, onClose, onCreated,
}: {
  open: boolean;
  properties: PropertyOption[];
  roomTypes: RoomTypeOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const typesForProperty = roomTypes.filter((type) => type.propertyId === propertyId);
  const activeTypeId = typesForProperty.some((type) => type.id === roomTypeId)
    ? roomTypeId
    : typesForProperty[0]?.id ?? "";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId,
          roomTypeId: activeTypeId,
          number: form.get("number"),
          floor: form.get("floor"),
          price: form.get("price"),
          area: form.get("area"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không lưu được phòng.");
        return;
      }
      onCreated();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">TÀI SẢN MỚI</span>
          <h2>Thêm phòng</h2>
          <p>Tạo một phòng mới trong danh mục.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Nhà
            <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
          </label>
          <label>Số phòng<input name="number" required placeholder="Ví dụ: 401" /></label>
        </div>
        <div className="form-grid">
          <label>
            Loại phòng
            <select value={activeTypeId} onChange={(event) => setRoomTypeId(event.target.value)}>
              {typesForProperty.map((type) => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </label>
          <label>Tầng<input name="floor" type="number" min={1} defaultValue={1} /></label>
        </div>
        <div className="form-grid">
          <label>Diện tích<input name="area" type="number" min={0} placeholder="m²" /></label>
          <label>
            Giá thuê
            <div className="money-input"><input name="price" type="number" min={0} placeholder="Theo loại phòng" /><span>VNĐ</span></div>
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" type="submit" disabled={saving}>
          {saving ? "Đang lưu..." : "Thêm phòng"}
        </button>
      </form>
    </Modal>
  );
}

function AddPropertyModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    // Ba loại phòng mặc định; bỏ trống giá thì loại đó không được tạo.
    const roomTypes = ["studio", "loft", "balcony"]
      .map((key) => ({
        name: String(form.get(`${key}Name`) ?? "").trim(),
        basePrice: Number(form.get(`${key}Price`) ?? 0),
        area: Number(form.get(`${key}Area`) ?? 0),
      }))
      .filter((type) => type.name && type.basePrice > 0);

    try {
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          code: form.get("code"),
          address: form.get("address"),
          roomTypes,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không tạo được nhà mới.");
        return;
      }
      onCreated();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">TÀI SẢN MỚI</span>
          <h2>Thêm nhà trọ</h2>
          <p>Tạo một địa điểm mới kèm danh mục loại phòng ban đầu.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Tên nhà<input name="name" required placeholder="Nhà Hướng Dương" /></label>
          <label>
            Mã nhà
            <input name="code" required placeholder="HD" maxLength={6} style={{ textTransform: "uppercase" }} />
          </label>
        </div>
        <label>Địa chỉ<input name="address" placeholder="Số nhà, đường, quận, thành phố" /></label>

        <div className="form-section-title">Loại phòng ban đầu</div>
        <p className="modal-hint">Bỏ trống giá của dòng nào thì loại phòng đó không được tạo. Có thể thêm loại khác sau.</p>
        {[
          { key: "studio", name: "Studio", price: 3400000, area: 22 },
          { key: "loft", name: "Gác lửng", price: 3800000, area: 28 },
          { key: "balcony", name: "Ban công", price: 4200000, area: 24 },
        ].map((preset) => (
          <div className="form-grid form-grid-three" key={preset.key}>
            <label>Tên loại<input name={`${preset.key}Name`} defaultValue={preset.name} /></label>
            <label>
              Giá niêm yết
              <div className="money-input"><input name={`${preset.key}Price`} type="number" min={0} defaultValue={preset.price} /><span>VNĐ</span></div>
            </label>
            <label>Diện tích<input name={`${preset.key}Area`} type="number" min={0} defaultValue={preset.area} /></label>
          </div>
        ))}

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" type="submit" disabled={busy}>
          <HousePlus size={16} /> {busy ? "Đang tạo..." : "Tạo nhà trọ"}
        </button>
      </form>
    </Modal>
  );
}

function AddRoomTypeModal({
  open, properties, onClose, onCreated,
}: {
  open: boolean;
  properties: PropertyOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/room-types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId: form.get("propertyId"),
          name: form.get("name"),
          basePrice: form.get("basePrice"),
          area: form.get("area"),
          maxOccupants: form.get("maxOccupants"),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Không tạo được loại phòng.");
        return;
      }
      onCreated();
    } catch {
      setError("Không kết nối được máy chủ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-heading">
        <div>
          <span className="modal-kicker">DANH MỤC</span>
          <h2>Thêm loại phòng</h2>
          <p>Giá niêm yết dùng làm mặc định khi thêm phòng mới.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <form onSubmit={submit}>
        <label>
          Nhà
          <select name="propertyId">
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}</option>
            ))}
          </select>
        </label>
        <label>Tên loại phòng<input name="name" required placeholder="Ví dụ: Phòng đôi" /></label>
        <div className="form-grid">
          <label>
            Giá niêm yết
            <div className="money-input"><input name="basePrice" type="number" min={1} required placeholder="3.500.000" /><span>VNĐ</span></div>
          </label>
          <label>Diện tích<input name="area" type="number" min={0} placeholder="m²" /></label>
        </div>
        <label>Số người tối đa<input name="maxOccupants" type="number" min={1} defaultValue={2} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="submit-button" type="submit" disabled={busy}>
          {busy ? "Đang lưu..." : "Thêm loại phòng"}
        </button>
      </form>
    </Modal>
  );
}
