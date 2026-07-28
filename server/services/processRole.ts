/**
 * PROCESS_ROLE（TD-07）：Web / Worker 執行邊界。
 *
 * - web：只提供 HTTP／API，不啟動背景 Runner
 * - worker：只跑背景工作（部署上可另開實例；本 monorepo 映像暫仍共用 process）
 * - all：預設，單一實例兼兩者（開發／小部署）
 *
 * 單值環境變數；非法值回退 all 並 log。
 */
export type ProcessRole = "web" | "worker" | "all";

export function readProcessRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const raw = (env.PROCESS_ROLE ?? "all").trim().toLowerCase();
  // 未設或空白 → all（開發／小部署預設）；非法字面值才 warn
  if (!raw || raw === "all") return "all";
  if (raw === "web" || raw === "worker") return raw;
  console.warn(`[processRole] 未知 PROCESS_ROLE=${raw}，改用 all`);
  return "all";
}

export function shouldRunHttp(role: ProcessRole = readProcessRole()): boolean {
  return role === "web" || role === "all";
}

export function shouldRunWorkers(role: ProcessRole = readProcessRole()): boolean {
  return role === "worker" || role === "all";
}
