package app.aios.mobile;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 桌面 Widget 上那顆小 Orb 的狀態。
 *
 * <h2>為什麼狀態存在 SharedPreferences，而不是 Widget 自己去查 API</h2>
 *
 * Widget 跑在 launcher 的行程裡，拿不到 WebView 的 cookie，也就拿不到登入 session。
 * 要讓它自己查 API，就得在原生層再實作一次登入與 token 保管——那正是任務書 §14
 * 明令禁止的「為 App 另建一套後端」。
 *
 * 所以流向是單向的：**Web 端算好狀態 → 經 Capacitor plugin 寫進 SharedPreferences
 * → 通知 Widget 重畫**。Widget 只是一個顯示器，沒有任何自己的資料來源、
 * 沒有網路權限需求、也不持有任何憑證。
 *
 * <h2>代價（誠實記載）</h2>
 *
 * App 從來沒被打開過時，Widget 顯示的是預設的 idle。這是刻意的取捨：
 * 一顆偶爾稍舊的球，勝過在 launcher 行程裡放一份使用者的登入憑證。
 */
final class OrbWidgetState {
    private static final String PREFS = "aios_orb_widget";
    private static final String KEY_STATE = "state";
    private static final String KEY_LABEL = "label";
    private static final String KEY_UPDATED_AT = "updated_at";

    /** 與 shared/companionOrb.ts 的八態同名；認不得的一律當 idle。 */
    static final String DEFAULT_STATE = "idle";
    static final String DEFAULT_LABEL = "點一下跟 Aios 說話";

    private OrbWidgetState() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void write(Context context, String state, String label) {
        prefs(context).edit()
                .putString(KEY_STATE, normalizeState(state))
                .putString(KEY_LABEL, normalizeLabel(label))
                .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
                .apply();
    }

    static String readState(Context context) {
        return prefs(context).getString(KEY_STATE, DEFAULT_STATE);
    }

    static String readLabel(Context context) {
        return prefs(context).getString(KEY_LABEL, DEFAULT_LABEL);
    }

    /**
     * 只接受已知的狀態名。
     *
     * 這個值會決定 Widget 畫哪一個 drawable；讓未知字串直接進來的話，
     * 之後 Web 端改名就會變成一顆沒有背景的透明方塊，而且沒有人看得出原因。
     */
    static String normalizeState(String state) {
        if (state == null) {
            return DEFAULT_STATE;
        }
        switch (state) {
            case "idle":
            case "listening":
            case "thinking":
            case "executing":
            case "waiting_confirmation":
            case "success":
            case "error":
            case "notification":
                return state;
            default:
                return DEFAULT_STATE;
        }
    }

    /** Widget 一行字放不下長句；截斷比讓 launcher 自己省略號好控制。 */
    static String normalizeLabel(String label) {
        if (label == null || label.trim().isEmpty()) {
            return DEFAULT_LABEL;
        }
        String trimmed = label.trim();
        return trimmed.length() <= 40 ? trimmed : trimmed.substring(0, 40);
    }
}
