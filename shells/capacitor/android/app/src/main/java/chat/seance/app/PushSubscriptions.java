package chat.seance.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What this device is subscribed to, by network uuid (the UnifiedPush
 * instance): the endpoint and keys the distributor last gave
 * {@link PushService}, the VAPID key the registration was asked for with
 * (the endpoint is bound to it, and a renewal that completes late must say
 * which key it answers), and the network's name for the notification's
 * subtext. The keys themselves (private half included) are UnifiedPush's;
 * only the public ones the ircd needs are copied here.
 */
final class PushSubscriptions {

    private static final String PREFS = "seance.push";
    private static final String NAME_PREFIX = "name.";
    private static final String SUB_PREFIX = "sub.";
    private static final String VAPID_PREFIX = "vapid.";

    private PushSubscriptions() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** `{endpoint, keys: {p256dh, auth}, vapid}`, or null when the network has none. */
    static JSONObject get(Context context, String network) {
        String raw = prefs(context).getString(SUB_PREFIX + network, null);
        if (raw == null) {
            return null;
        }
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    static boolean has(Context context, String network) {
        return prefs(context).contains(SUB_PREFIX + network);
    }

    static void put(Context context, String network, String endpoint, String p256dh, String auth) {
        try {
            JSONObject keys = new JSONObject().put("p256dh", p256dh).put("auth", auth);
            JSONObject sub = new JSONObject()
                .put("endpoint", endpoint)
                .put("keys", keys)
                .putOpt("vapid", prefs(context).getString(VAPID_PREFIX + network, null));
            prefs(context).edit().putString(SUB_PREFIX + network, sub.toString()).apply();
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    static void remove(Context context, String network) {
        prefs(context).edit().remove(SUB_PREFIX + network).remove(NAME_PREFIX + network).remove(VAPID_PREFIX + network).apply();
    }

    /**
     * A registration was asked for and not withdrawn since: set by
     * {@link #setVapid} when one starts, cleared by {@link #remove}. An
     * endpoint arriving without it answers a registration nobody wants.
     */
    static boolean wanted(Context context, String network) {
        return prefs(context).contains(VAPID_PREFIX + network);
    }

    /**
     * A notification tap's PendingIntent request code for a conversation,
     * allocated once and kept, so two conversations never share one (their
     * intents differ only in extras, which PendingIntent identity ignores).
     */
    static synchronized int requestCode(Context context, String conversation) {
        SharedPreferences codes = context.getSharedPreferences(PREFS + ".codes", Context.MODE_PRIVATE);
        int code = codes.getInt(conversation, -1);
        if (code == -1) {
            code = codes.getInt("\nnext", 1);
            codes.edit().putInt(conversation, code).putInt("\nnext", code + 1).apply();
        }
        return code;
    }

    /** The VAPID key the network's (re)registration is being made with. */
    static void setVapid(Context context, String network, String vapid) {
        prefs(context).edit().putString(VAPID_PREFIX + network, vapid).apply();
    }

    static void setName(Context context, String network, String name) {
        if (name != null && !name.isEmpty()) {
            prefs(context).edit().putString(NAME_PREFIX + network, name).apply();
        }
    }

    /** The network's name as the page last told it. */
    static String name(Context context, String network) {
        return prefs(context).getString(NAME_PREFIX + network, null);
    }
}
