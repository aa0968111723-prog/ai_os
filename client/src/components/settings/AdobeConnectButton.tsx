import type { AdobeConnectionView } from "@shared/adobe";
import { Icon } from "../Icon";
import { ConfirmButton } from "../interactions";

/**
 * Adobe 連結／重新連結／中斷（#224 PR2）。
 *
 * 授權入口是瀏覽器重導（Express 端點），所以是 <a> 而不是按鈕送 mutation——
 * 與 Google 雲端連結同一心智模型；中斷則走 tRPC（會在 Adobe 端盡力撤銷並刪掉本地憑證）。
 */
export function AdobeConnectButton({
  data,
  startUrl,
  onDisconnect,
  disconnecting,
}: {
  data: AdobeConnectionView | null;
  startUrl: string;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  if (!data || !data.configured) return null;

  // 與相鄰的「連結 Google 雲端」逐字相同的 class：<a className="btn-sm"> 沒有 .btn 基底，
  // 換成 <Button as="a"> 會多疊一層 btn（真的視覺改變，見 check-ui-primitives 的結構性豁免）。
  if (!data.connected || data.status === "error") {
    return (
      <a className="btn-sm primary" href={startUrl} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="Plus" size={14} /> {data.status === "error" ? "重新連結 Adobe 帳號" : "連結 Adobe 帳號"}
      </a>
    );
  }

  return (
    <ConfirmButton
      onConfirm={onDisconnect}
      message="中斷 Adobe 連結？會撤銷授權（你 Adobe 帳號裡的檔案不受任何影響）。"
      triggerClassName="btn-sm"
      disabled={disconnecting}
    >
      中斷連結
    </ConfirmButton>
  );
}
