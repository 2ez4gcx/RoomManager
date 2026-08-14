import { requireUser } from "../lib/session";
import { listProperties } from "../../db/queries";
import { getSettings } from "../../db/settings";
import { twoFactorStatus } from "../../db/two-factor";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const [settings, properties, twoFactor] = await Promise.all([
    getSettings(),
    listProperties(),
    twoFactorStatus(user.id),
  ]);

  return (
    <SettingsClient
      settings={settings}
      properties={properties}
      twoFactor={twoFactor}
      currentUser={user}
    />
  );
}
