import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { canShowInstallUi, dismissInstallBanner, isIosDevice, isStandaloneApp, promptInstall, subscribeInstallUi } from "../pwa";
import { Button, Card, Hint } from "./ui";

export function InstallAppBanner() {
  const [, bump] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeInstallUi(() => bump((n) => n + 1)), []);
  if (isStandaloneApp() || !canShowInstallUi()) return null;
  const ios = isIosDevice();
  const onInstall = async () => {
    setBusy(true);
    try { await promptInstall(); } finally { setBusy(false); bump((n) => n + 1); }
  };
  return (
    <Card as="aside" className="install-app" role="region" aria-label="安裝 Aios 應用程式">
      <div className="install-app__row">
        <img src="/icons/icon-v2-192.png" alt="" width={48} height={48} className="install-app__icon" />
        <div className="install-app__body">
          <strong>把 Aios 裝成應用程式</strong>
          <Hint style={{ margin: "4px 0 0" }}>
            {ios ? "加入主畫面後可全螢幕使用，並在 iOS 上啟用推播通知。" : "安裝後從桌面／開始選單開啟，獨立視窗、更快進入工作。"}
          </Hint>
          {ios && (
            <ol className="install-app__ios">
              <li>用 Safari 開啟本站</li>
              <li>點底部分享按鈕</li>
              <li>選擇「加入主畫面」</li>
              <li>從主畫面圖示開啟 Aios</li>
            </ol>
          )}
        </div>
      </div>
      <div className="install-app__actions">
        {!ios && <button type="button" className="primary" disabled={busy} onClick={() => void onInstall()}>{busy ? "請稍候…" : "安裝 Aios"}</button>}
        <Button variant="ghost" type="button" onClick={() => { dismissInstallBanner(); bump((n) => n + 1); }}>稍後</Button>
      </div>
    </Card>
  );
}
