import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "../../../../db/auth";

export async function POST() {
  const store = await cookies();
  await destroySession(store.get(SESSION_COOKIE)?.value);

  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    },
  );
}
