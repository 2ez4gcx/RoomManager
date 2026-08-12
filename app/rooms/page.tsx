import { requireUser } from "../lib/session";
import { listProperties, listRoomTypes, listRooms } from "../../db/queries";
import { RoomsClient } from "./RoomsClient";

/** Danh sách phòng đổi theo hợp đồng và giữ chỗ nên không cache được. */
export const dynamic = "force-dynamic";

export default async function RoomsPage() {
  const user = await requireUser();
  const [rooms, properties, roomTypes] = await Promise.all([
    listRooms(),
    listProperties(),
    listRoomTypes(),
  ]);

  return (
    <RoomsClient
      rooms={rooms}
      properties={properties}
      roomTypes={roomTypes}
      currentUser={user}
    />
  );
}
