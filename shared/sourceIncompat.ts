/**
 * 來源素材「明顯不相容」過濾表（前端來源下拉 + 後端 generation.submit 共用）。
 * 寬鬆原則——只擋確定會失敗的組合，doc/zip 等不確定的保留。
 *
 * 單一真相：client generationGates 與 server generationCore 都從此匯入，
 * 避免 WB-00 前兩端各抄一份造成漂移。
 */
export const SOURCE_INCOMPAT: Record<string, readonly string[]> = {
  image: ["audio"],
  audio: ["image"], // 影片放行：Whisper/Scribe 類轉錄端點普遍接受影片容器（自動抽音軌）
  video: ["audio"],
};
