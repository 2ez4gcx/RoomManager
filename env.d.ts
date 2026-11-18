/**
 * Binding của Cloudflare Worker.
 *
 * `cloudflare:workers` lấy kiểu từ `Cloudflare.Env`, nên khai báo ở đây để
 * `env.DB` có kiểu thật thay vì `any`.
 */
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    ALLOW_DEV_SETUP?: string;
    DEV_SETUP_TOKEN?: string;
    NODE_ENV?: string;
  }
}
