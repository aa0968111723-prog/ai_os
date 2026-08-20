package app.aios.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 桌面 Widget 的狀態橋（Web → 原生單向寫入）。必須在 super.onCreate 之前註冊，
        // 否則 bridge 建好時外掛還不在註冊表裡，Web 端第一次呼叫會拿到 "not implemented"。
        registerPlugin(OrbWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
