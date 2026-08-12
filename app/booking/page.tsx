import { getSettings } from "../../db/settings";
import { listPublicProperties, listPublicVacantRooms } from "../../db/queries-extra";
import { PublicBookingClient } from "./PublicBookingClient";

/** Phòng trống đổi liên tục theo hợp đồng và giữ chỗ nên không cache được. */
export const dynamic = "force-dynamic";

export default async function PublicBookingPage() {
  const [rooms, properties, settings] = await Promise.all([
    listPublicVacantRooms(),
    listPublicProperties(),
    getSettings(),
  ]);

  return (
    <PublicBookingClient
      rooms={rooms}
      properties={properties}
      orgName={settings["org.name"] || "Nhà trọ"}
      phone={settings["org.phone"]}
      email={settings["org.email"]}
    />
  );
}
