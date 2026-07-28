/**
 * TD-07b：依 PROCESS_ROLE 決定 HTTP 對外表面。
 *
 * worker 仍會 listen HTTP（給 deploy 的 health／ready 探針），
 * 但不掛載產品 SPA 靜態檔與 catch-all。
 * web／all 行為與既有預設相同。
 */
import type { ProcessRole } from "../services/processRole";
import { shouldRunHttp } from "../services/processRole";

export type HttpSurfaceFlags = {
  /** 是否提供產品 SPA（express.static + index.html fallback） */
  serveSpa: boolean;
};

/** Pure: flags for which HTTP surface to mount for a process role. */
export function httpSurfaceForRole(role: ProcessRole): HttpSurfaceFlags {
  return {
    serveSpa: shouldRunHttp(role),
  };
}
