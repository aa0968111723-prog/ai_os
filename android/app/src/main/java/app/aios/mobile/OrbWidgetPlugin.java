package app.aios.mobile;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Web → 原生的單向橋：把 Companion 算好的 Orb 狀態寫給桌面 Widget。
 *
 * <h2>介面刻意極小</h2>
 *
 * 只有一個方法、兩個字串參數。這是唯一需要跨到原生層的東西——狀態機、
 * 優先序、文案全部在 {@code shared/companionOrb.ts}，原生層不重新推導任何一項。
 * 多一個方法就多一份會與 Web 端漂移的邏輯。
 *
 * <h2>沒有讀取方向</h2>
 *
 * 不提供 {@code getState()}：Web 端本來就有權威狀態，從原生讀回去只會讓
 * 「哪一份才算數」變成一個要爭論的問題。
 */
@CapacitorPlugin(name = "AiosOrbWidget")
public class OrbWidgetPlugin extends Plugin {

    @PluginMethod
    public void setState(PluginCall call) {
        String state = call.getString("state");
        String label = call.getString("label");
        OrbWidgetState.write(getContext(), state, label);
        OrbWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
