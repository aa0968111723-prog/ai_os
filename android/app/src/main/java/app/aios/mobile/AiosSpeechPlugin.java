package app.aios.mobile;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

/**
 * 原生語音辨識 bridge（AIOS Companion Native v1）。
 *
 * <h2>為什麼需要它</h2>
 *
 * Web Companion 的語音走 {@code webkitSpeechRecognition}（見 client 的 useVoiceInput），
 * 但 <b>Android WebView 沒有這個 API</b>——在 Capacitor 殼裡按住 Orb 只會拿到
 * {@code supported: false}，退回打字。這支 plugin 用系統的
 * {@link SpeechRecognizer}（裝置端、免費、離線可用視機型）補上這一塊，
 * 是 Native v1 相對於 Web Companion 的第一個「真原生」能力。
 *
 * <h2>介面（與 Web 端 useVoiceInput 同語意）</h2>
 *
 * <ul>
 *   <li>{@code available()} → {@code {available: boolean}}：這台機器有沒有辨識服務。</li>
 *   <li>{@code start({language?})}：開始聆聽。權限不足時自動走系統權限流程，
 *       拒絕即 reject（JS 端會顯示「先用打字的也可以」）。</li>
 *   <li>{@code stop()}：停止聆聽（對應「放開 Orb」）。最終結果仍會經事件送達。</li>
 * </ul>
 *
 * 事件（notifyListeners）：
 * <ul>
 *   <li>{@code partialResult {transcript}}：逐字稿（打斷式 UI 的來源）。</li>
 *   <li>{@code result {transcript}}：最終結果。</li>
 *   <li>{@code rms {level}}：0–1 音量（Orb 的聆聽圈；由 onRmsChanged 的 dB 正規化）。</li>
 *   <li>{@code state {status}}：listening｜idle｜denied｜error。</li>
 * </ul>
 *
 * <h2>安全</h2>
 *
 * 辨識在裝置端執行，音訊不經我們的伺服器；本 plugin 不落地任何錄音檔，
 * 也不把逐字稿寫進 log（隱私＝逐字稿只進 WebView 的記憶體）。
 */
@CapacitorPlugin(
        name = "AiosSpeech",
        permissions = {
                @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
        }
)
public class AiosSpeechPlugin extends Plugin {

    private SpeechRecognizer recognizer;
    private boolean listening = false;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("unavailable");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        beginListening(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginListening(call);
        } else {
            emitState("denied");
            call.reject("denied");
        }
    }

    private void beginListening(PluginCall call) {
        String language = call.getString("language", "zh-TW");
        // SpeechRecognizer 的所有呼叫都要在主執行緒；Capacitor 的 plugin 方法不保證在主緒。
        getActivity().runOnUiThread(() -> {
            stopInternal();
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    listening = true;
                    emitState("listening");
                }

                @Override public void onRmsChanged(float rmsdB) {
                    // onRmsChanged 給的是約 -2..10 dB；正規化成 0–1 餵 Orb 的聆聽圈
                    float level = Math.max(0f, Math.min(1f, (rmsdB + 2f) / 12f));
                    JSObject out = new JSObject();
                    out.put("level", level);
                    notifyListeners("rms", out);
                }

                @Override public void onPartialResults(Bundle partial) {
                    emitTranscript("partialResult", partial);
                }

                @Override public void onResults(Bundle results) {
                    listening = false;
                    emitTranscript("result", results);
                    emitState("idle");
                }

                @Override public void onError(int error) {
                    listening = false;
                    // NO_MATCH／SPEECH_TIMEOUT 是「沒聽到話」不是壞掉；照 idle 收尾即可。
                    if (error == SpeechRecognizer.ERROR_NO_MATCH
                            || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        emitState("idle");
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        emitState("denied");
                        return;
                    }
                    JSObject out = new JSObject();
                    out.put("code", error);
                    notifyListeners("error", out);
                    emitState("error");
                }

                @Override public void onBeginningOfSpeech() {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
            recognizer.startListening(intent);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null && listening) {
                // stopListening（非 cancel）：讓引擎把已收的音訊辨識完，最終結果仍會送 result 事件
                recognizer.stopListening();
            }
            call.resolve();
        });
    }

    private void emitTranscript(String event, Bundle bundle) {
        ArrayList<String> texts = bundle == null
                ? null
                : bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (texts == null || texts.isEmpty()) return;
        JSObject out = new JSObject();
        out.put("transcript", texts.get(0));
        notifyListeners(event, out);
    }

    private void emitState(String status) {
        JSObject out = new JSObject();
        out.put("status", status);
        notifyListeners("state", out);
    }

    private void stopInternal() {
        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (RuntimeException ignored) {
                // 已銷毀
            }
            recognizer = null;
        }
        listening = false;
    }

    @Override
    protected void handleOnPause() {
        // App 進背景：麥克風一定要收——背景錄音是使用者最不能接受的行為
        getActivity().runOnUiThread(this::stopInternal);
        emitState("idle");
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }
}
