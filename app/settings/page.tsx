import { requireUser } from "../lib/session";
import { listProperties } from "../../db/queries";
import { getSettings } from "../../db/settings";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const [settings, properties] = await Promise.all([getSettings(), listProperties()]);

  return <SettingsClient settings={settings} properties={properties} currentUser={user} />;
}
