/**
 * 來源素材「明顯不相容」過濾表（前端來源下拉 + 後端 generation.submit 共用）。
 * 嚴格依模型需求篩選；doc 僅供 ZIP／LoRA 類來源使用，避免把不相容素材送去 Fal 才失敗。
 *
 * 單一真相：client generationGates 與 server generationCore 都從此匯入，
 * 避免 WB-00 前兩端各抄一份造成漂移。
 */
export const SOURCE_INCOMPAT: Record<string, readonly string[]> = {
  image: ["audio", "video", "doc"],
  audio: ["image", "doc"], // 影片放行：Whisper/Scribe 類轉錄端點普遍接受影片容器（自動抽音軌）
  video: ["audio", "image", "doc"],
  zip: ["audio", "image", "video"], // ZIP／LoRA .safetensors 在素材庫都歸為 doc
};
