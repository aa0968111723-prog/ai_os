/** Deterministic, local intent gate for opening the existing editing handoff UI. */
export function detectEditingHandoffRequest(text: string): boolean {
  const editorOrTask = /(lumafusion|luma\s*fusion|剪輯|後製|外部編輯)/i.test(text);
  const handoff = /(交給|交接|送去|準備|建立|開啟|handoff|edit)/i.test(text);
  return editorOrTask && handoff;
}
