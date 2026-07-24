/**
 * NVIDIA NIM 連線自檢:確認 NVIDIA_NIM_API_KEY / NVIDIA_NIM_ENDPOINT 設定有效。
 * 用法:npx tsx scripts/check-nim.ts
 */
import { checkNimStatus, NIM_DEFAULT_MODEL } from "../server/services/nvidia-nim";

const status = await checkNimStatus();
if (status.ok) {
  console.log(`✅ NVIDIA NIM 連線正常(探測模型:${status.model};後端預設模型:${NIM_DEFAULT_MODEL})`);
} else {
  console.error(`❌ NVIDIA NIM 連線失敗:${status.error}`);
  process.exitCode = 1;
}
