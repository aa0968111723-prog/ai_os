package app.aios.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * 桌面上的 AIOS Orb。
 *
 * <h2>它做什麼</h2>
 *
 * 顯示一顆與 App 內同一個視覺語彙的小球 ＋ 一行現況，點下去開 Companion。
 * 沒有 overlay、沒有背景服務、沒有額外權限——任務書 §9 的紅線：
 * <b>核心功能不得依賴 SYSTEM_ALERT_WINDOW 之類的高風險權限</b>。
 * 浮動泡泡若日後要做，也只能是 optional enhancement。
 *
 * <h2>兩個去處</h2>
 *
 * <ul>
 *   <li>點球身 → 開 App 首頁（Companion）</li>
 *   <li>點「說一句話」→ 開 App 並帶 {@code ?voice=1}，Web 端據此直接進語音模式</li>
 * </ul>
 *
 * 兩者都只是把使用者送進 App，沒有任何原生層的資料存取。
 */
public class OrbWidgetProvider extends AppWidgetProvider {

    /** Widget 深連結的基底；與 capacitor.config.ts 的 server.url 同一個站。 */
    private static final String APP_URL = "https://ai-os-app.zeabur.app";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            manager.updateAppWidget(widgetId, buildViews(context));
        }
    }

    /** Web 端狀態變了：把所有實例一次重畫。 */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, OrbWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        RemoteViews views = buildViews(context);
        for (int id : ids) {
            manager.updateAppWidget(id, views);
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_aios_orb);
        String state = OrbWidgetState.readState(context);
        views.setImageViewResource(R.id.orb_widget_orb, orbDrawable(state));
        views.setTextViewText(R.id.orb_widget_label, OrbWidgetState.readLabel(context));
        /*
         * 內容說明要跟著狀態走，否則 TalkBack 永遠唸「AIOS 助手」——
         * 使用者得先打開 App 才知道有沒有事情在等他，Widget 就白做了。
         */
        views.setContentDescription(R.id.orb_widget_orb, describe(state));
        views.setOnClickPendingIntent(R.id.orb_widget_orb, openApp(context, "", 1));
        views.setOnClickPendingIntent(R.id.orb_widget_voice, openApp(context, "?voice=1", 2));
        return views;
    }

    private static PendingIntent openApp(Context context, String query, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL + "/" + query));
        intent.setPackage(context.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // IMMUTABLE 是 Android 12+ 的硬性要求，而且這個 intent 本來就不需要被別人填欄位。
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 狀態 → 背景 drawable。認不得的狀態在 OrbWidgetState 已經收斂成 idle。 */
    private static int orbDrawable(String state) {
        switch (state) {
            case "thinking":
            case "executing":
                return R.drawable.orb_widget_busy;
            case "waiting_confirmation":
            case "notification":
                return R.drawable.orb_widget_attention;
            case "error":
                return R.drawable.orb_widget_error;
            default:
                return R.drawable.orb_widget_idle;
        }
    }

    private static String describe(String state) {
        switch (state) {
            case "thinking":
            case "executing":
                return "AIOS 助手，正在執行任務";
            case "waiting_confirmation":
                return "AIOS 助手，正在等你決定";
            case "notification":
                return "AIOS 助手，有新的提醒";
            case "error":
                return "AIOS 助手，剛才有一件事沒成功";
            default:
                return "AIOS 助手，目前待機";
        }
    }
}
