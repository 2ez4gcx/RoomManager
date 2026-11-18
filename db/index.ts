import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Không có binding D1 `DB`. Kiểm tra `d1_databases` trong vite.config.ts, hoặc cấu hình D1 của Worker trên Cloudflare.",
    );
  }

  return drizzle(env.DB, { schema });
}
