package app.aios.mobile;

import android.net.Uri;

import java.util.regex.Pattern;

/**
 * aios:// 自訂 scheme → 站內 https 路徑（Java 端，MainActivity 轉譯用）。
 *
 * <h2>為什麼在 Java 轉譯而不是 JS</h2>
 *
 * Capacitor 的深連結處理只認「host 等於 server.url」的 https 連結——收到後
 * 直接讓 WebView 載入該路徑，App Links 因此零 JS 就能運作。aios:// 不在
 * 這條路上；與其為它引入 @capacitor/app 依賴＋一條 JS 監聽鏈，不如在
 * intent 進門時就把它翻譯成等價的 https 連結，讓它走與 App Links
 * 完全相同的既有路徑。
 *
 * <h2>白名單解析</h2>
 *
 * scheme intent 任何 App 都能發。host/path 過白名單、UUID 過格式，
 * 對不上一律回 null（呼叫端不動 intent＝App 照常開首頁）。
 * 與 shared/companionDeepLink.ts 的 parseAiosUri 同一份對照表——兩邊要一起改。
 */
final class AiosSchemeRouter {

    private static final Pattern UUID_RE =
            Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);

    private AiosSchemeRouter() {}

    /** aios://project/<uuid> → "/p/<uuid>"；認不得回 null。 */
    static String webPathFor(Uri uri) {
        if (uri == null || !"aios".equalsIgnoreCase(uri.getScheme())) return null;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        String id = firstSegment(uri);
        switch (host) {
            case "project":
                return isUuid(id) ? "/p/" + id : null;
            case "storyboard":
                return isUuid(id) ? "/p/" + id + "#stage-board" : null;
            case "studio":
                return isUuid(id) ? "/studio/" + id : null;
            case "generation":
                // 生成細節的既有落點是協作中心；不自創一條沒人維護的網址
                return isUuid(id) ? "/collab" : null;
            case "voice":
                return "/?voice=1";
            case "tasks":
                return "/?tab=tasks";
            case "home":
                return "/";
            default:
                return null;
        }
    }

    private static String firstSegment(Uri uri) {
        return uri.getPathSegments().isEmpty() ? null : uri.getPathSegments().get(0);
    }

    private static boolean isUuid(String value) {
        return value != null && UUID_RE.matcher(value).matches();
    }
}
