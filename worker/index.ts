/** Runtime entry point for RoomManager. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { generateReminders } from "../db/reminders";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  /**
   * Chạy theo lịch cron khai báo trong vite.config.ts.
   *
   * Chỉ rà và soạn lời nhắc, không tự gửi tin cho khách: gửi cần dịch vụ bên
   * ngoài chưa có. Chủ nhà mở trang Nhắc nợ là thấy danh sách đã soạn sẵn.
   */
  async scheduled(event: ScheduledEvent, _env: Env, ctx: ExecutionContext): Promise<void> {
    // Lấy ngày theo giờ Việt Nam, không theo UTC: cron chạy 01:00 UTC nghĩa là
    // 08:00 cùng ngày ở Việt Nam, nhưng UTC vẫn còn ở ngày đó nên trùng nhau.
    // Vẫn cộng bù múi giờ cho chắc, phòng khi đổi giờ chạy.
    const vietnamNow = new Date(event.scheduledTime + 7 * 60 * 60 * 1000);
    const today = vietnamNow.toISOString().slice(0, 10);

    ctx.waitUntil(
      generateReminders(today).then(
        (result) =>
          console.log(
            `[nhac-no] ${result.today}: tạo ${result.created}, bỏ qua ${result.skipped}`,
          ),
        (error) => console.error("[nhac-no] lỗi:", error),
      ),
    );
  },
};

export default worker;
