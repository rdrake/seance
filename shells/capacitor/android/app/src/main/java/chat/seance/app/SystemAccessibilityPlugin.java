package chat.seance.app;

import android.app.UiModeManager;
import android.content.ContentResolver;
import android.content.Context;
import android.database.ContentObserver;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * `SystemAccessibility`: Android's contrast and animation settings, raw, for
 * client/js/helpers/systemAccessibility.ts, which turns them into the page's
 * Increase Contrast and Reduce Motion with Chromium's own rule.
 *
 * The WebView would answer `prefers-contrast` and `prefers-reduced-motion`
 * itself, but only with the values its process started with: Chromium
 * watches these settings in WebView only behind WebViewObserveAccessibilityState,
 * off by default (its cost to WebView startup), and {@link ConnectionService}
 * keeps the process for as long as the user stays connected. So the shell
 * watches them and tells the page.
 *
 * - `status()`: `{highTextContrast, contrast, animatorDurationScale}`.
 * - event `changed`: the same, whenever one of them changes.
 */
@CapacitorPlugin(name = "SystemAccessibility")
public class SystemAccessibilityPlugin extends Plugin {

    /** Settings.Secure.ACCESSIBILITY_HIGH_TEXT_CONTRAST_ENABLED, hidden from the SDK. */
    private static final String HIGH_TEXT_CONTRAST = "high_text_contrast_enabled";

    private ContentObserver settingsObserver;
    private UiModeManager.ContrastChangeListener contrastListener;

    @Override
    public void load() {
        ContentResolver resolver = getContext().getContentResolver();
        settingsObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange, Uri uri) {
                notifyListeners("changed", status());
            }
        };
        resolver.registerContentObserver(Settings.Secure.getUriFor(HIGH_TEXT_CONTRAST), false, settingsObserver);
        resolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            settingsObserver
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            contrastListener = (contrast) -> notifyListeners("changed", status());
            uiModeManager().addContrastChangeListener(getContext().getMainExecutor(), contrastListener);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        ContentResolver resolver = getContext().getContentResolver();
        JSObject result = new JSObject();
        result.put("highTextContrast", Settings.Secure.getInt(resolver, HIGH_TEXT_CONTRAST, 0));
        result.put(
            "contrast",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? uiModeManager().getContrast() : 0f
        );
        result.put(
            "animatorDurationScale",
            Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        );
        return result;
    }

    private UiModeManager uiModeManager() {
        return (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
    }

    @Override
    protected void handleOnDestroy() {
        if (settingsObserver != null) {
            getContext().getContentResolver().unregisterContentObserver(settingsObserver);
            settingsObserver = null;
        }

        if (contrastListener != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            uiModeManager().removeContrastChangeListener(contrastListener);
            contrastListener = null;
        }
    }
}
