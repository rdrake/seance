package chat.seance.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashMap;
import java.util.Map;
import kotlin.Unit;
import org.json.JSONObject;
import org.unifiedpush.android.connector.UnifiedPush;

/**
 * `NativePush`, the page's Push API in the Android shell
 * (client/js/helpers/nativePush.ts). The WebView has no PushManager, so a
 * subscription here is a UnifiedPush registration ({@link PushService}),
 * one per network, made with that network's VAPID key — and it hands the
 * page the same `{endpoint, keys}` a browser would, which webpush.ts
 * REGISTERs with the ircd unchanged.
 *
 * - `status()`: `{available, permission}` — available = a distributor is
 *   there (the embedded FCM one needs Google Play services); permission =
 *   "granted" | "denied" | "prompt".
 * - `subscribe({network, name, vapid})`: asks for POST_NOTIFICATIONS on 13+,
 *   picks the distributor (Android may ask which, when the phone has more
 *   than one), registers, and resolves `{endpoint, keys: {p256dh, auth}}`.
 * - `subscription({network})`: the stored one (with the `vapid` it was made
 *   for), or `{endpoint: null}`.
 * - `unsubscribe({network})`, `clear({network?, target?})`.
 * - `seen({msgid})`: the page took this message while the user was looking
 *   at it; its push shows nothing ({@link PushSeen}).
 * - `takeTap()` / event `tap`: `{network, target}` of a tapped notification.
 * - event `endpoint`: `{network}` — the distributor changed or dropped a
 *   network's endpoint on its own; the page re-reads and re-registers.
 */
@CapacitorPlugin(
    name = "NativePush",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class NativePushPlugin extends Plugin {

    private static final long REGISTER_TIMEOUT_MS = 30_000;

    // Plugin methods run on Capacitor's plugin thread, the permission and
    // distributor callbacks and PushService's reports on others: every
    // field below is touched on the main thread only, and everything that
    // reaches them is posted there.
    private static final Handler main = new Handler(Looper.getMainLooper());
    /** The live instance; null between activities. */
    private static NativePushPlugin instance;
    /** A tap that arrived before the page could hear it (a cold start). */
    private static JSObject pendingTap;
    /** subscribe() calls waiting for their endpoint, by network. */
    private static final Map<String, Waiting> waiting = new HashMap<>();

    /**
     * A subscribe() call waiting for its endpoint. Answering it lets the
     * bridge go of it too: the permission request saved it with the bridge
     * (Bridge.savePermissionCall), and nothing else ever releases it.
     */
    private static final class Waiting {
        final PluginCall call;
        final Bridge bridge;

        Waiting(PluginCall call, Bridge bridge) {
            this.call = call;
            this.bridge = bridge;
        }

        void resolve(JSObject result) {
            call.resolve(result);
            call.release(bridge);
        }

        void reject(String message) {
            call.reject(message);
            call.release(bridge);
        }

        void reject(String message, Exception e) {
            call.reject(message, e);
            call.release(bridge);
        }
    }

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
    }

    /** From MainActivity: an intent that may be a notification tap. */
    static void onIntent(Intent intent) {
        if (intent == null || intent.getAction() == null || !intent.getAction().startsWith(PushService.ACTION_TAP + "\n")) {
            return;
        }

        // Consumed: an activity recreated with this intent (a configuration
        // change it does not declare) must not open the conversation again.
        intent.setAction(null);

        // Relaunched from Recents after the process died: Android hands back
        // the intent that started the task, which is this old tap, and
        // setAction(null) above did not outlive the process.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            return;
        }

        JSObject tap = new JSObject();
        tap.put("network", intent.getStringExtra("network"));
        tap.put("target", intent.getStringExtra("target"));

        if (instance != null && instance.hasListeners("tap")) {
            instance.notifyListeners("tap", tap);
        } else {
            pendingTap = tap;
        }
    }

    /** From PushService: a registration finished, with its subscription or why not. */
    static void registrationDone(String network, JSONObject subscription, String failure) {
        main.post(() -> {
            Waiting call = waiting.remove(network);
            if (call == null) {
                // Nobody asked: the distributor renewed the endpoint by itself.
                notifyEndpoint(network);
                return;
            }
            if (subscription == null) {
                call.reject(failure != null ? failure : "registration failed");
                return;
            }
            try {
                call.resolve(JSObject.fromJSONObject(subscription));
            } catch (org.json.JSONException e) {
                call.reject("bad subscription", e);
            }
        });
    }

    /** From PushService: the distributor dropped a network's registration. */
    static void unregistered(String network) {
        main.post(() -> notifyEndpoint(network));
    }

    private static void notifyEndpoint(String network) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("network", network);
            instance.notifyListeners("endpoint", data);
        }
    }

    @PluginMethod
    public void takeTap(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("tap", pendingTap);
            pendingTap = null;
            call.resolve(result);
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", available());
        result.put("permission", permission());
        call.resolve(result);
    }

    @PluginMethod
    public void subscribe(PluginCall call) {
        if (!available()) {
            call.reject("no UnifiedPush distributor on this device");
            return;
        }
        if (!"granted".equals(permission())) {
            requestPermissionForAlias("notifications", call, "permissionAnswered");
            return;
        }
        register(call);
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        if (!"granted".equals(permission())) {
            new Waiting(call, getBridge()).reject("denied");
            return;
        }
        register(call);
    }

    private void register(PluginCall call) {
        Waiting answer = new Waiting(call, getBridge());
        String network = call.getString("network");
        String vapid = call.getString("vapid");

        if (network == null || vapid == null) {
            answer.reject("network and vapid are required");
            return;
        }

        PushSubscriptions.setName(getContext(), network, call.getString("name"));
        main.post(() -> start(network, vapid, answer));
    }

    /** On the main thread. */
    private void start(String network, String vapid, Waiting answer) {
        Waiting previous = waiting.put(network, answer);
        if (previous != null) {
            previous.reject("superseded");
        }

        boolean renewing = PushSubscriptions.has(getContext(), network);

        // Armed before the distributor is chosen: the connector keeps the
        // chooser's callback in one static field (LinkActivity), which a
        // second chooser replaces and a chooser closed without a result
        // never calls, so the answer may never come.
        main.postDelayed(() -> {
            if (waiting.get(network) != answer) {
                return; // answered, superseded or withdrawn
            }
            waiting.remove(network);
            answer.reject("timed out waiting for the push endpoint");
            // A first registration the page has given up on would be owned
            // by nothing if it completed later: drop it. A renewal is left
            // to finish; its endpoint reaches the page as a renewal
            // (`endpoint`), with the key it was made for.
            if (!renewing) {
                UnifiedPush.unregister(getContext(), network);
                PushSubscriptions.remove(getContext(), network);
            }
        }, REGISTER_TIMEOUT_MS);

        UnifiedPush.tryUseCurrentOrDefaultDistributor(getActivity(), ok -> {
            main.post(() -> distributorChosen(network, vapid, answer, ok));
            return Unit.INSTANCE;
        });
    }

    /** On the main thread. */
    private void distributorChosen(String network, String vapid, Waiting answer, boolean ok) {
        if (waiting.get(network) != answer) {
            return; // timed out, superseded or withdrawn meanwhile
        }
        if (!ok) {
            waiting.remove(network);
            answer.reject("no UnifiedPush distributor chosen");
            return;
        }

        // The VAPID key binds the endpoint to this network's server: FCM
        // only accepts pushes signed with it.
        PushSubscriptions.setVapid(getContext(), network, vapid);
        UnifiedPush.register(getContext(), network, null, vapid.replace("=", ""));
    }

    @PluginMethod
    public void subscription(PluginCall call) {
        String network = call.getString("network");
        JSONObject sub = network == null ? null : PushSubscriptions.get(getContext(), network);

        if (sub == null) {
            JSObject none = new JSObject();
            none.put("endpoint", null);
            call.resolve(none);
            return;
        }
        try {
            call.resolve(JSObject.fromJSONObject(sub));
        } catch (org.json.JSONException e) {
            call.reject("bad subscription", e);
        }
    }

    @PluginMethod
    public void unsubscribe(PluginCall call) {
        String network = call.getString("network");
        if (network != null) {
            // Withdrawn first: an endpoint already on its way is then dropped
            // (PushService.onNewEndpoint), and a subscribe still waiting for
            // one is told no instead of resolving after this.
            PushSubscriptions.remove(getContext(), network);
            UnifiedPush.unregister(getContext(), network);
            PushService.cancelAll(getContext(), network);
            main.post(() -> {
                Waiting pending = waiting.remove(network);
                if (pending != null) {
                    pending.reject("unsubscribed");
                }
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void seen(PluginCall call) {
        String msgid = call.getString("msgid");
        if (msgid != null && !msgid.isEmpty()) {
            PushService.recordSeen(getContext(), msgid);
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        String network = call.getString("network");
        String target = call.getString("target");
        if (network != null && target != null) {
            PushService.cancel(getContext(), network, target);
        } else {
            PushService.cancelAll(getContext(), network);
        }
        call.resolve();
    }

    private boolean available() {
        return !UnifiedPush.getDistributors(getContext()).isEmpty();
    }

    private String permission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
        }
        PermissionState state = getPermissionState("notifications");
        return state == PermissionState.GRANTED ? "granted" : state == PermissionState.DENIED ? "denied" : "prompt";
    }
}
