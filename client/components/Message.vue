<template>
	<div
		:id="'msg-' + message.id"
		:class="[
			'msg',
			{
				self: message.self,
				highlight: (message.highlight && store.state.settings.highlightMessages) || focused,
				pending: message.pending,
				'previous-source': isPreviousSource,
			},
		]"
		:data-type="message.type"
		:data-command="message.command"
		:data-from="message.from && message.from.nick"
	>
		<span
			aria-hidden="true"
			:aria-label="messageTimeLocale"
			class="time tooltipped tooltipped-e"
			><span class="only-copy">[</span>{{ messageTime }}<span class="only-copy">]&nbsp;</span>
		</span>
		<template v-if="message.type === 'unhandled'">
			<span class="from">[{{ message.command }}]</span>
			<span class="content">
				<span v-for="(param, id) in message.params" :key="id">{{
					`&#32;${param}&#32;`
				}}</span>
			</span>
		</template>
		<template v-else-if="isAction()">
			<span class="from"><span class="only-copy" aria-hidden="true">***&nbsp;</span></span>
			<component :is="messageComponent" :network="network" :message="message" />
		</template>
		<template v-else-if="message.type === 'action'">
			<span class="from"><span class="only-copy">*&nbsp;</span></span>
			<span class="content" dir="auto">
				<button
					v-if="message.replyTo"
					type="button"
					class="msg-reply-quote"
					:class="{unknown: !quote}"
					:aria-label="quoteLabel"
					:title="quote ? quote.text : undefined"
					@click="jumpToParent"
				>
					<span class="msg-reply-arrow" aria-hidden="true">↩</span>
					<template v-if="quote"
						><span class="msg-reply-nick">{{ quote.nick }}</span
						>&#32;<span class="msg-reply-text">{{ quote.text }}</span></template
					>
					<span v-else class="msg-reply-text">(unknown message)</span>
				</button>
				<StatusmsgMarker :group="message.statusmsgGroup" />
				<Username
					:user="message.from"
					:network="network"
					:channel="channel"
					dir="auto"
				/>&#32;<button
					v-if="message.redacted && !revealed"
					type="button"
					class="msg-redacted"
					aria-label="Deleted message, click to reveal"
					@click="revealed = true"
				>
					{{ redactedLabel }}</button
				><span
					v-else-if="message.redacted"
					class="msg-redacted-revealed"
					title="Click to hide again"
					@click="hideRevealed"
					><ParsedMessage :message="message" />
					<span class="msg-redacted-note">{{ redactedLabel }}</span></span
				><ParsedMessage v-else :message="message" />
				<span v-if="message.editOf" class="msg-edited" :title="editedTitle">(edited)</span>
				<!-- A deleted message hides its previews with its text: the
				placeholder would otherwise sit above the very image it deleted.
				Revealing the text brings them back. -->
				<template v-if="!message.redacted || revealed">
					<LinkPreview
						v-for="preview in message.previews"
						:key="preview.link"
						:keep-scroll-position="keepScrollPosition"
						:link="preview"
						:channel="channel"
					/>
				</template>
				<MessageReactions :message="message" :channel="channel" :network="network" />
			</span>
		</template>
		<template v-else>
			<span v-if="message.type === 'message'" class="from">
				<template v-if="message.from && message.from.nick">
					<span class="only-copy" aria-hidden="true">&lt;</span>
					<Username :user="message.from" :network="network" :channel="channel" />
					<span class="only-copy" aria-hidden="true">&gt;&nbsp;</span>
				</template>
			</span>
			<span v-else-if="message.type === 'plugin'" class="from">
				<template v-if="message.from && message.from.nick">
					<span class="only-copy" aria-hidden="true">[</span>
					{{ message.from.nick }}
					<span class="only-copy" aria-hidden="true">]&nbsp;</span>
				</template>
			</span>
			<span v-else class="from">
				<template v-if="message.from && message.from.nick">
					<span class="only-copy" aria-hidden="true">-</span>
					<Username :user="message.from" :network="network" :channel="channel" />
					<span class="only-copy" aria-hidden="true">-&nbsp;</span>
				</template>
			</span>
			<span class="content" dir="auto">
				<span
					v-if="message.showInActive"
					aria-label="This message was shown in your active channel"
					class="msg-shown-in-active tooltipped tooltipped-e"
					><span></span
				></span>
				<button
					v-if="message.replyTo"
					type="button"
					class="msg-reply-quote"
					:class="{unknown: !quote}"
					:aria-label="quoteLabel"
					:title="quote ? quote.text : undefined"
					@click="jumpToParent"
				>
					<span class="msg-reply-arrow" aria-hidden="true">↩</span>
					<template v-if="quote"
						><span class="msg-reply-nick">{{ quote.nick }}</span
						>&#32;<span class="msg-reply-text">{{ quote.text }}</span></template
					>
					<span v-else class="msg-reply-text">(unknown message)</span>
				</button>
				<StatusmsgMarker :group="message.statusmsgGroup" />
				<button
					v-if="message.redacted && !revealed"
					type="button"
					class="msg-redacted"
					aria-label="Deleted message, click to reveal"
					@click="revealed = true"
				>
					{{ redactedLabel }}</button
				><span
					v-else-if="message.redacted"
					class="msg-redacted-revealed"
					title="Click to hide again"
					@click="hideRevealed"
					><ParsedMessage :network="network" :message="message" />
					<span class="msg-redacted-note">{{ redactedLabel }}</span></span
				><ParsedMessage v-else :network="network" :message="message" />
				<span v-if="message.editOf" class="msg-edited" :title="editedTitle">(edited)</span>
				<!-- A deleted message hides its previews with its text: the
				placeholder would otherwise sit above the very image it deleted.
				Revealing the text brings them back. -->
				<template v-if="!message.redacted || revealed">
					<LinkPreview
						v-for="preview in message.previews"
						:key="preview.link"
						:keep-scroll-position="keepScrollPosition"
						:link="preview"
						:channel="channel"
					/>
				</template>
				<MessageReactions :message="message" :channel="channel" :network="network" />
			</span>
		</template>
		<MessageActions
			v-if="canAct && channel"
			:message="message"
			:channel="channel"
			:network="network"
		/>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, PropType, ref} from "vue";
import dayjs from "dayjs";

import constants from "../js/constants";
import localetime from "../js/helpers/localetime";
import Username from "./Username.vue";
import LinkPreview from "./LinkPreview.vue";
import ParsedMessage from "./ParsedMessage.vue";
import MessageTypes from "./MessageTypes";
import StatusmsgMarker from "./StatusmsgMarker.vue";
import MessageActions from "./MessageActions.vue";
import MessageReactions from "./MessageReactions.vue";
import {replyQuote} from "../js/helpers/messageUpdates";
import {MessageType} from "../../shared/types/msg";

import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";
import {useStore} from "../js/store";

MessageTypes.ParsedMessage = ParsedMessage;
MessageTypes.LinkPreview = LinkPreview;
MessageTypes.Username = Username;

export default defineComponent({
	name: "Message",
	components: {
		...MessageTypes,
		StatusmsgMarker,
		MessageActions,
		MessageReactions,
	},
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: false},
		network: {type: Object as PropType<ClientNetwork>, required: true},
		keepScrollPosition: Function as PropType<() => void>,
		isPreviousSource: Boolean,
		focused: Boolean,
	},
	setup(props) {
		const store = useStore();

		const timeFormat = computed(() => {
			let format: keyof typeof constants.timeFormats;

			if (store.state.settings.use12hClock) {
				format = store.state.settings.showSeconds ? "msg12hWithSeconds" : "msg12h";
			} else {
				format = store.state.settings.showSeconds ? "msgWithSeconds" : "msgDefault";
			}

			return constants.timeFormats[format];
		});

		const messageTime = computed(() => {
			return dayjs(props.message.time).format(timeFormat.value);
		});

		const messageTimeLocale = computed(() => {
			return localetime(props.message.time);
		});

		// An edit keeps its original's time (msg:edit); when it was made is editedAt.
		const editedTitle = computed(() => {
			return props.message.editedAt
				? `Edited ${localetime(props.message.editedAt)}`
				: "This message was edited";
		});

		const messageComponent = computed(() => {
			return "message-" + (props.message.type || "invalid"); // TODO: force existence of type in sharedmsg
		});

		const isAction = () => {
			if (!props.message.type) {
				return false;
			}

			return typeof MessageTypes["message-" + props.message.type] !== "undefined";
		};

		// --- replies, reactions, deletion, edits (bus-contract §1.4) ---

		// Parent of a reply, resolved from the loaded messages by msgid.
		const quote = computed(() => {
			if (!props.message.replyTo || !props.channel) {
				return undefined;
			}

			return replyQuote(props.channel.messages, props.message.replyTo);
		});

		const quoteLabel = computed(() =>
			quote.value
				? `Replying to ${quote.value.nick}: ${quote.value.text}. Jump to that message.`
				: "Replying to a message that is not loaded"
		);

		const jumpToParent = () => {
			if (!quote.value) {
				return;
			}

			const el = document.getElementById("msg-" + quote.value.id);

			if (!el) {
				return;
			}

			el.scrollIntoView({block: "center", inline: "nearest"});

			if (typeof el.animate === "function") {
				el.animate(
					[
						{backgroundColor: "var(--highlight-bg-color)"},
						{backgroundColor: "transparent"},
					],
					{duration: 1500, easing: "ease-out"}
				);
			}
		};

		// Deleted messages keep their text; the placeholder toggles it.
		const revealed = ref(false);

		const redactedLabel = computed(() => {
			const r = props.message.redacted;

			if (!r) {
				return "";
			}

			return r.reason
				? `[Message deleted by ${r.by}: ${r.reason}]`
				: `[Message deleted by ${r.by}]`;
		});

		const hideRevealed = (e: MouseEvent) => {
			// Let links inside the revealed text keep working.
			if ((e.target as HTMLElement | null)?.closest("a")) {
				return;
			}

			revealed.value = false;
		};

		// Hover action bar: only for real chat lines we can address by msgid,
		// and only while the network is connected.
		const canAct = computed(
			() =>
				(props.message.type === MessageType.MESSAGE ||
					props.message.type === MessageType.ACTION) &&
				!!props.message.msgid &&
				!props.message.redacted &&
				props.network.status.connected
		);

		return {
			store,
			timeFormat,
			messageTime,
			messageTimeLocale,
			editedTitle,
			messageComponent,
			isAction,
			quote,
			quoteLabel,
			jumpToParent,
			revealed,
			redactedLabel,
			hideRevealed,
			canAct,
		};
	},
});
</script>
