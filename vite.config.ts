import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// Khi deploy lên tài khoản Cloudflare của chính mình, đặt hai biến này để bản
// build trỏ vào D1 thật. Không đặt thì giữ giá trị giả và `npm run dev` chạy
// với D1 cục bộ của Miniflare như thường.
// Xem docs/DEPLOY-CLOUDFLARE.md.
const d1DatabaseName = process.env.CF_D1_DATABASE_NAME ?? "site-creator-d1";
const d1DatabaseId =
  process.env.CF_D1_DATABASE_ID ?? SITE_CREATOR_PLACEHOLDER_DATABASE_ID;

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  // Ghim ngày tương thích thay vì để plugin tự lấy ngày build. Hai lý do: bản
  // build hôm nay và bản build tháng sau phải chạy giống hệt nhau, và ngày này
  // phải khớp với ngày bộ kiểm thử dùng (tests/rendered-html.test.mjs) để 132
  // bài kiểm thử nói về đúng runtime sẽ chạy thật. Ngày tự sinh còn vượt quá
  // workerd đi kèm wrangler đang cài, làm `wrangler dev` không chạy nổi bản
  // build ở máy. Muốn nâng thì nâng cả hai chỗ rồi chạy lại kiểm thử.
  compatibility_date: "2026-05-15",
  compatibility_flags: ["nodejs_compat"],
  // Rà nhắc nợ mỗi ngày. 01:00 UTC là 08:00 giờ Việt Nam — đầu giờ làm việc,
  // để chủ nhà mở máy lên là đã có danh sách cần nhắc.
  triggers: { crons: ["0 1 * * *"] },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: d1DatabaseName,
          database_id: d1DatabaseId,
          // Để `wrangler d1 migrations apply` tìm được SQL do drizzle sinh ra.
          // Đường dẫn tính từ file cấu hình trong dist/server.
          migrations_dir: "../../drizzle",
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
