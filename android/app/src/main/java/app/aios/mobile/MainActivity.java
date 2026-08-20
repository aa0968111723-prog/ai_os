package app.aios.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** 與 capacitor.config.ts 的 server.url 同一個站；scheme 轉譯的目的地 */
    private static final String APP_ORIGIN = "https://ai-os-app.zeabur.app";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 外掛必須在 super.onCreate 之前註冊，否則 bridge 建好時不在註冊表裡
        registerPlugin(OrbWidgetPlugin.class);
        registerPlugin(AiosSpeechPlugin.class);
        translateAiosScheme(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // singleTask：App 已開時的深連結走這裡。先轉譯再交給 Capacitor 的既有深連結處理。
        translateAiosScheme(intent);
        super.onNewIntent(intent);
    }

    /**
     * aios:// → 等價的 https 站內連結。轉譯後 Capacitor 的深連結路徑
     * （host == server.url → WebView 載入該路徑）原樣接手；認不得的
     * scheme 內容不動 intent，App 照常開首頁。
     */
    private void translateAiosScheme(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        String webPath = AiosSchemeRouter.webPathFor(intent.getData());
        if (webPath != null) {
            intent.setData(Uri.parse(APP_ORIGIN + webPath));
        }
    }
}
