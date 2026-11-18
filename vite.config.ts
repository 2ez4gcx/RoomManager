import vinext from "vinext";
import { defineConfig } from "vite";

/** Mã D1 giả cho bản chạy ở máy; Miniflare không cần mã thật. */
const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

// Khi deploy lên tài khoản Cloudflare của chính mình, đặt hai biến này để bản
// build trỏ vào D1 thật. Không đặt thì giữ giá trị giả và `npm run dev` chạy
// với D1 cục bộ của Miniflare như thường.
// Xem docs/DEPLOY-CLOUDFLARE.md.
const d1DatabaseName = process.env.CF_D1_DATABASE_NAME ?? "room-manager-local";
const d1DatabaseId = process.env.CF_D1_DATABASE_ID ?? LOCAL_DATABASE_ID;

// Tên Worker. Bản demo PHẢI đặt tên khác bản thật (workflow deploy-demo đặt
// `room-manager-demo`): cùng tên thì deploy demo ghi đè luôn Worker đang chạy
// thật và nối nó sang cơ sở dữ liệu demo.
const workerName = process.env.CF_WORKER_NAME;

const localBindingConfig = {
  ...(workerName ? { name: workerName } : {}),
  main: "./worker/index.ts",
  // Ghim ngày tương thích thay vì để plugin tự lấy ngày build. Hai lý do: bản
  // build hôm nay và bản build tháng sau phải chạy giống hệt nhau, và ngày này
  // phải khớp với ngày bộ kiểm thử dùng (tests/rendered-html.test.mjs) để các
  // bài kiểm thử nói về đúng runtime sẽ chạy thật. Ngày tự sinh còn vượt quá
  // workerd đi kèm wrangler đang cài, làm `wrangler dev` không chạy nổi bản
  // build ở máy. Muốn nâng thì nâng cả hai chỗ rồi chạy lại kiểm thử.
  compatibility_date: "2026-05-15",
  compatibility_flags: ["nodejs_compat"],
  // Rà nhắc nợ mỗi ngày. 01:00 UTC là 08:00 giờ Việt Nam — đầu giờ làm việc,
  // để chủ nhà mở máy lên là đã có danh sách cần nhắc.
  triggers: { crons: ["0 1 * * *"] },
  d1_databases: [
    {
      binding: "DB",
      database_name: d1DatabaseName,
      database_id: d1DatabaseId,
      // Để `wrangler d1 migrations apply` tìm được SQL do drizzle sinh ra.
      // Viết theo gốc dự án: plugin Cloudflare tự đổi sang đường dẫn tính từ
      // dist/server/wrangler.json. Viết sẵn "../../drizzle" thì bị đổi thêm lần
      // nữa và trỏ ra ngoài thư mục dự án.
      migrations_dir: "drizzle",
    },
  ],
};

export default defineConfig(async () => {
  // Giữ log và trạng thái của Wrangler/Miniflare trong thư mục dự án.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler đọc đường dẫn log ngay lúc plugin Cloudflare được nạp, nên phải
  // đặt biến môi trường ở trên trước khi import.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
