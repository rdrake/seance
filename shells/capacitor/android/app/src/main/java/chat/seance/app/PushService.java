package chat.seance.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.UnifiedPush;
import org.unifiedpush.android.connector.data.PublicKeySet;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

/**
 * Where the ircd's Web Push lands. The app is a UnifiedPush client, one
 * registration (instance) per network uuid, made with that network's VAPID
 * key: on a phone with Google Play services and no other distributor the
 * embedded FCM distributor registers it with FCM, which accepts the ircd's
 * VAPID-signed RFC 8291 pushes directly (no Firebase project, no relay); a
 * phone with a distributor app (ntfy, …) uses that instead. The connector
 * decrypts, so a message arrives here as the IRC line the ircd sent.
 *
 * Runs with no page — the app may have been swiped away — so everything a
 * notification needs is here: the line ({@link PushLine}), one MessagingStyle
 * notification per conversation whose messages merge as the service worker's
 * do ({@link PushMerge}). The message list rides on the notification's own
 * extras, so it is exactly what the shade shows: a swiped notification
 * starts over, and a process Android killed between two pushes loses
 * nothing. A MARKREAD from another device takes away what it read. While
 * the app is in the foreground its own connection shows the message, so a
 * push only closes things then.
 */
public class PushService extends org.unifiedpush.android.connector.PushService {

    private static final String TAG = "SeancePush";
    static final String CHANNEL_ID = "messages";
    static final String ACTION_TAP = "chat.seance.app.PUSH_TAP";
    /** Every push notification's tag starts with this; the rest is its conversation key. */
    static final String TAG_PREFIX = "push\n";
    private static final String EXTRA_NETWORK = "seance.network";
    private static final String EXTRA_ENTRIES = "seance.entries";

    /** The activity is resumed: the page has the conversation live. */
    static volatile boolean foreground = false;

    /** One read-merge-post at a time: two pushes for a conversation must not both start from the same list. */
    private static final Object lock = new Object();

    /**
     * What this process last posted per conversation, and when. Android
     * posts asynchronously, so for a moment after notify() the shade does
     * not show it yet: a second push read from the shade alone would start
     * from the older list and drop the first. The shade stays the record
     * across process deaths and swipes; this only bridges that moment.
     */
    private static final Map<String, Posted> posted = new HashMap<>();
    /** How long a post may take to reach the shade before it is taken as dismissed. */
    private static final long POSTING_MS = 5_000;

    private static final class Posted {
        final List<PushMerge.Entry> entries;
        final long at;

        Posted(List<PushMerge.Entry> entries, long at) {
            this.entries = entries;
            this.at = at;
        }
    }

    @Override
    public void onNewEndpoint(@NonNull PushEndpoint endpoint, @NonNull String network) {
        PublicKeySet keys = endpoint.getPubKeySet();
        if (keys == null) {
            // The ircd cannot push to an endpoint without encryption keys,
            // and nothing would ever own this registration: drop it.
            UnifiedPush.unregister(this, network);
            NativePushPlugin.registrationDone(network, null, "no keys");
            return;
        }
        if (!PushSubscriptions.wanted(this, network)) {
            // Unsubscribed while the registration was in flight.
            UnifiedPush.unregister(this, network);
            return;
        }
        PushSubscriptions.put(this, network, endpoint.getUrl(), keys.getPubKey(), keys.getAuth());
        NativePushPlugin.registrationDone(network, PushSubscriptions.get(this, network), null);
    }

    @Override
    public void onRegistrationFailed(@NonNull FailedReason reason, @NonNull String network) {
        Log.w(TAG, "registration failed: " + reason);
        NativePushPlugin.registrationDone(network, null, reason.name());
    }

    @Override
    public void onUnregistered(@NonNull String network) {
        PushSubscriptions.remove(this, network);
        cancelAll(this, network);
        NativePushPlugin.unregistered(network);
    }

    @Override
    public void onMessage(@NonNull PushMessage message, @NonNull String network) {
        if (!message.getDecrypted() || !PushSubscriptions.has(this, network)) {
            return;
        }

        String payload = new String(message.getContent(), StandardCharsets.UTF_8).replaceFirst("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]+$", "");
        PushLine line = PushLine.fromJson(payload);
        if (line == null) {
            line = PushLine.parse(payload);
        }
        if (line == null) {
            return;
        }

        if (line.command.equals("MARKREAD")) {
            markRead(this, network, line.target, line.timestamp);
            return;
        }

        if ((line.command.equals("PRIVMSG") || line.command.equals("NOTICE")) && !foreground) {
            show(network, line);
        }
    }

    private void show(String network, PushLine line) {
        boolean channel = PushLine.isChannel(line.target);
        String conversation = channel ? line.target : line.nick;
        String key = key(network, conversation);

        synchronized (lock) {
            PushMerge.Result merged = PushMerge.add(shownEntries(this, key), line, System.currentTimeMillis(), PushMerge.KEEP);
            if (!merged.changed) {
                return; // delivered twice
            }
            // A later line of a message already shown grows it in place without a second alert.
            post(this, network, conversation, merged.entries, !merged.isNew);
        }
    }

    /**
     * Another device (or this one's page) read `target` up to `timestamp`:
     * what it read goes, what came after stays, quietly. No timestamp reads
     * everything.
     */
    static void markRead(Context context, String network, String target, String timestamp) {
        String key = key(network, target);
        synchronized (lock) {
            List<PushMerge.Entry> shown = shownEntries(context, key);
            if (shown.isEmpty()) {
                return;
            }
            List<PushMerge.Entry> unread = PushMerge.unreadAfter(shown, PushLine.parseTime(timestamp));
            if (unread.isEmpty()) {
                posted.remove(key);
                NotificationManagerCompat.from(context).cancel(TAG_PREFIX + key, 0);
            } else if (unread.size() < shown.size()) {
                post(context, network, target, unread, true);
            }
        }
    }

    private static void post(Context context, String network, String conversation, List<PushMerge.Entry> entries, boolean quiet) {
        boolean channel = PushLine.isChannel(conversation);
        String key = key(network, conversation);

        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(new Person.Builder().setName("You").build());
        if (channel) {
            style.setConversationTitle(conversation);
            style.setGroupConversation(true);
        }
        for (PushMerge.Entry e : entries) {
            String text = PushLine.isAction(e.text) ? "* " + e.from + " " + PushLine.notificationText(e.text) : PushLine.notificationText(e.text);
            style.addMessage(text, e.time > 0 ? e.time : e.arrived, new Person.Builder().setName(e.from).build());
        }

        Bundle extras = new Bundle();
        extras.putString(EXTRA_NETWORK, network);
        extras.putString(EXTRA_ENTRIES, toJson(entries));

        NotificationCompat.Builder builder = base(context, network, conversation)
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setSubText(PushSubscriptions.name(context, network))
            .setOnlyAlertOnce(quiet)
            .addExtras(extras);

        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) {
            return;
        }
        try {
            manager.notify(TAG_PREFIX + key, 0, builder.build());
            posted.put(key, new Posted(entries, System.currentTimeMillis()));
        } catch (SecurityException e) {
            Log.w(TAG, "notification permission withdrawn", e);
        }
    }

    private static NotificationCompat.Builder base(Context context, String network, String target) {
        ensureChannel(context);

        Intent tap = new Intent(context, MainActivity.class)
            .setAction(ACTION_TAP)
            .putExtra("network", network)
            .putExtra("target", target)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // One PendingIntent per conversation: they differ only in extras, so
        // the request code is what keeps them apart (no data URI: Capacitor
        // reads any intent's data as a launch link).
        PendingIntent content = PendingIntent.getActivity(
            context,
            PushSubscriptions.requestCode(context, key(network, target)),
            tap,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_seance)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(content);
    }

    static void ensureChannel(Context context) {
        NotificationManagerCompat.from(context).createNotificationChannel(
            new NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName("Messages")
                .setDescription("Mentions and private messages while the app is closed")
                .build()
        );
    }

    /** Conversation key: network and target, case-folded like IRC names. */
    static String key(String network, String target) {
        return network + "\n" + target.toLowerCase(Locale.ROOT);
    }

    /**
     * The messages the conversation's notification shows now; empty when
     * none is showing. Called under {@link #lock}.
     */
    private static List<PushMerge.Entry> shownEntries(Context context, String key) {
        Posted mine = posted.get(key);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        for (StatusBarNotification n : manager.getActiveNotifications()) {
            if ((TAG_PREFIX + key).equals(n.getTag())) {
                // Showing: what this process posted last is at least as new.
                return mine != null ? mine.entries : fromJson(n.getNotification().extras.getString(EXTRA_ENTRIES));
            }
        }
        // Not showing: still on its way to the shade, or swiped / tapped away.
        if (mine != null && System.currentTimeMillis() - mine.at < POSTING_MS) {
            return mine.entries;
        }
        posted.remove(key);
        return new ArrayList<>();
    }

    private static String toJson(List<PushMerge.Entry> entries) {
        JSONArray list = new JSONArray();
        try {
            for (PushMerge.Entry e : entries) {
                JSONObject o = new JSONObject()
                    .put("from", e.from)
                    .put("text", e.text)
                    .put("time", e.time)
                    .put("arrived", e.arrived)
                    .putOpt("msgid", e.msgid)
                    .putOpt("batch", e.batch);
                if (e.lines != null) {
                    JSONObject lines = new JSONObject();
                    for (Map.Entry<Integer, PushMerge.Line> l : e.lines.entrySet()) {
                        lines.put(String.valueOf(l.getKey()), new JSONObject().put("text", l.getValue().text).put("concat", l.getValue().concat));
                    }
                    o.put("lines", lines).put("sent", e.sent).put("total", e.total);
                }
                list.put(o);
            }
        } catch (JSONException e) {
            Log.w(TAG, "could not keep the message list", e);
        }
        return list.toString();
    }

    private static List<PushMerge.Entry> fromJson(String json) {
        List<PushMerge.Entry> entries = new ArrayList<>();
        if (json == null) {
            return entries;
        }
        try {
            JSONArray list = new JSONArray(json);
            for (int i = 0; i < list.length(); i++) {
                JSONObject o = list.getJSONObject(i);
                PushMerge.Entry e = new PushMerge.Entry();
                e.from = o.optString("from");
                e.text = o.optString("text");
                e.time = o.optLong("time");
                e.arrived = o.optLong("arrived");
                e.msgid = o.has("msgid") ? o.getString("msgid") : null;
                e.batch = o.has("batch") ? o.getString("batch") : null;
                JSONObject lines = o.optJSONObject("lines");
                if (lines != null) {
                    e.lines = new TreeMap<>();
                    for (Iterator<String> it = lines.keys(); it.hasNext(); ) {
                        String index = it.next();
                        JSONObject l = lines.getJSONObject(index);
                        e.lines.put(Integer.parseInt(index), new PushMerge.Line(l.optString("text"), l.optBoolean("concat")));
                    }
                    e.sent = o.optInt("sent");
                    e.total = o.optInt("total");
                }
                entries.add(e);
            }
        } catch (JSONException | NumberFormatException e) {
            Log.w(TAG, "unreadable message list; starting over", e);
            return new ArrayList<>();
        }
        return entries;
    }

    /** Close a conversation's notification (read here, or the page opened it). */
    static void cancel(Context context, String network, String target) {
        String key = key(network, target);
        synchronized (lock) {
            posted.remove(key);
            NotificationManagerCompat.from(context).cancel(TAG_PREFIX + key, 0);
        }
    }

    /** Close every push notification (the app was opened), or one network's. */
    static void cancelAll(Context context, String network) {
        synchronized (lock) {
            posted.keySet().removeIf(key -> network == null || key.startsWith(network + "\n"));
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            for (StatusBarNotification n : manager.getActiveNotifications()) {
                String owner = n.getNotification().extras.getString(EXTRA_NETWORK);
                if (n.getTag() != null && n.getTag().startsWith(TAG_PREFIX) && (network == null || network.equals(owner))) {
                    manager.cancel(n.getTag(), n.getId());
                }
            }
        }
    }
}
