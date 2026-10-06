<template>
	<div>
		<h2>Messages</h2>
		<div>
			<label class="opt">
				<input :checked="store.state.settings.motd" type="checkbox" name="motd" />
				Show <abbr title="Message Of The Day">MOTD</abbr>
			</label>
		</div>
		<div>
			<label class="opt">
				<input :checked="store.state.settings.markdown" type="checkbox" name="markdown" />
				Render Markdown formatting (bold, code, spoilers…)
			</label>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.showSeconds"
					type="checkbox"
					name="showSeconds"
				/>
				Include seconds in timestamp
			</label>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.use12hClock"
					type="checkbox"
					name="use12hClock"
				/>
				Use 12-hour timestamps
			</label>
		</div>
		<h2 id="label-own-messages">Your own messages</h2>
		<div role="group" aria-labelledby="label-own-messages" class="own-messages-options">
			<label v-for="style in ownMessageStyles" :key="style" class="opt">
				<input
					:checked="ownMessages === style"
					type="radio"
					name="ownMessages"
					:value="style"
				/>
				{{ ownMessageStyleLabels[style] }}
				<span class="own-messages-hint">{{ ownMessageHints[style] }}</span>
			</label>
		</div>
		<h2 id="label-media-previews">Media previews</h2>
		<div role="group" aria-labelledby="label-media-previews">
			<label class="opt">
				<input :checked="store.state.settings.media" type="checkbox" name="media" />
				Preview images, video and audio links inline
			</label>
			<div
				role="group"
				aria-label="When to load previews"
				:class="['media-reveal-options', {disabled: !store.state.settings.media}]"
			>
				<label class="opt">
					<input
						:checked="store.state.settings.mediaReveal === 'click'"
						:disabled="!store.state.settings.media"
						type="radio"
						name="mediaReveal"
						value="click"
					/>
					Click to reveal — nothing is fetched from the media site until you ask to see it
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.mediaReveal === 'always'"
						:disabled="!store.state.settings.media"
						type="radio"
						name="mediaReveal"
						value="always"
					/>
					Show automatically — the media site sees your address as soon as a link appears
				</label>
			</div>
			<div
				v-if="store.state.settings.media && store.state.settings.mediaReveal === 'click'"
				class="trusted-hosts"
			>
				<div class="trusted-hosts-head">
					<span class="trusted-hosts-title">Always shown</span>
					<button
						v-if="trustedCount > 0"
						type="button"
						class="trusted-hosts-clear"
						@click="clearTrusted()"
					>
						Clear all
					</button>
				</div>
				<p class="trusted-hosts-help">
					Media in these scopes loads without asking. Add one with
					<em>Always show</em> on any preview.
				</p>
				<template v-for="group in trustedGroups" :key="group.kind">
					<div v-if="group.entries.length > 0" class="trusted-group">
						<span class="trusted-group-title">{{ group.title }}</span>
						<ul class="trusted-host-list">
							<li
								v-for="entry in group.entries"
								:key="entry.key"
								:class="['trusted-host', 'trusted-' + group.kind]"
							>
								<span class="trusted-host-name">{{ entry.name }}</span>
								<span v-if="entry.network" class="trusted-host-network">{{
									entry.network
								}}</span>
								<button
									type="button"
									class="trusted-host-remove"
									:aria-label="`Stop always showing ${group.verb} ${entry.name}`"
									:title="`Stop always showing ${group.verb} ${entry.name}`"
									@click="untrust(group.kind, entry.key)"
								></button>
							</li>
						</ul>
					</div>
				</template>
				<p v-if="trustedCount === 0" class="trusted-hosts-empty">Nothing yet.</p>
			</div>
		</div>
		<h2 id="label-status-messages">
			Status messages
			<span
				class="tooltipped tooltipped-n tooltipped-no-delay"
				aria-label="Joins, parts, quits, kicks, nick changes, and mode changes"
			>
				<button class="extra-help" />
			</span>
		</h2>
		<div role="group" aria-labelledby="label-status-messages">
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'shown'"
					type="radio"
					name="statusMessages"
					value="shown"
				/>
				Show all status messages individually
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'condensed'"
					type="radio"
					name="statusMessages"
					value="condensed"
				/>
				Condense status messages together
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'hidden'"
					type="radio"
					name="statusMessages"
					value="hidden"
				/>
				Hide all status messages
			</label>
		</div>
		<h2>Visual Aids</h2>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.coloredNicks"
					type="checkbox"
					name="coloredNicks"
				/>
				Enable colored nicknames
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.autocomplete"
					type="checkbox"
					name="autocomplete"
				/>
				Enable autocomplete
			</label>
		</div>
		<div>
			<label class="opt">
				<label for="nickPostfix" class="opt">
					Nick autocomplete postfix
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						aria-label="Nick autocomplete postfix (for example a comma)"
					>
						<button class="extra-help" />
					</span>
				</label>
				<input
					id="nickPostfix"
					:value="store.state.settings.nickPostfix"
					type="text"
					name="nickPostfix"
					class="input"
					placeholder="Nick autocomplete postfix (e.g. ', ')"
				/>
			</label>
		</div>

		<h2 id="label-font-size">Font size</h2>
		<div role="group" aria-labelledby="label-font-size" class="font-size-setting">
			<!-- No `name`: the window's generic @change handler would store the
			     raw slider index. While the slider moves only the sample below
			     follows it; the setting is applied when it is let go. -->
			<span class="font-size-slider">
				<input
					type="range"
					min="0"
					:max="fontSizes.length - 1"
					step="1"
					list="font-size-stops"
					:value="shownIndex"
					:aria-valuetext="shownLabel"
					aria-label="Message font size"
					@input="onFontSizeInput"
					@change="onFontSizeChange"
				/>
			</span>
			<datalist id="font-size-stops">
				<option
					v-for="(size, index) in fontSizes"
					:key="size"
					:value="index"
					:label="fontSizeLabels[size]"
				></option>
			</datalist>
			<span class="font-size-value" aria-hidden="true">{{ shownLabel }}</span>
		</div>
		<div class="font-size-sample" :style="{fontSize: sampleFontSize}" aria-hidden="true">
			<div v-for="line in sampleLines" :key="line.from" class="line">
				<span class="time">{{ line.time }}</span>
				<span class="from user" :class="line.color">{{ line.from }}</span>
				<span class="text">{{ line.text }}</span>
			</div>
		</div>

		<h2>Theme</h2>
		<div>
			<label for="theme-select" class="sr-only">Theme</label>
			<select
				id="theme-select"
				:value="store.state.settings.theme"
				name="theme"
				class="input"
			>
				<option
					v-for="theme in store.state.serverConfiguration?.themes"
					:key="theme.name"
					:value="theme.name"
				>
					{{ themeOptionLabel(theme.name, theme.displayName) }}
				</option>
			</select>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.matchSystemAppearance"
					type="checkbox"
					name="matchSystemAppearance"
				/>
				Match the system's light or dark mode
			</label>
			<p class="theme-pair-hint">{{ themePairHint }}</p>
		</div>

		<div>
			<h2>Custom Stylesheet</h2>
			<label for="user-specified-css-input" class="sr-only">
				Custom stylesheet. You can override any style with CSS here.
			</label>
			<textarea
				id="user-specified-css-input"
				:value="store.state.settings.userStyles"
				class="input"
				name="userStyles"
				placeholder="/* You can override any style with CSS here */"
			/>
		</div>
	</div>
</template>

<style>
textarea#user-specified-css-input {
	height: 100px;
}

.own-messages-options .own-messages-hint {
	color: var(--body-color-muted);
}

.theme-pair-hint {
	color: var(--body-color-muted);
	margin: 0.25rem 0 0;
}

.own-messages-options .own-messages-hint::before {
	content: " — ";
}

.font-size-setting {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
}

/*
 * The one deliberate px island in the chrome: the slider is the control that
 * changes the scale, so it must not change size with it. Nothing else moves
 * while it is dragged either — only the sample below renders the new step,
 * and the page takes the scale when the slider is let go.
 */
.font-size-setting .font-size-slider {
	flex: 0 0 auto;
	width: 256px;
	height: 24px;
}

.font-size-setting input[type="range"] {
	display: block;
	width: 100%;
	height: 100%;
	margin: 0;
	font-size: 16px;
}

.font-size-setting .font-size-value {
	min-width: 90px;
	color: var(--body-color-muted);
}

/* A few lines of chat at the step under the slider. Everything in it is em,
 * so the inline font-size — the step's percentage of the browser default,
 * whatever the page is at — is the whole preview. */
.font-size-sample {
	margin-top: 10px;
	padding: 0.4em 0.6em;
	border: 1px solid var(--body-color-muted);
	border-radius: 0.3em;
	background: var(--window-bg-color);
	line-height: 1.4;
	overflow: hidden;
}

.font-size-sample .line {
	display: flex;
	align-items: flex-start;
}

.font-size-sample .time {
	flex: 0 0 auto;
	margin-right: 0.6em;
	color: var(--body-color-muted);
	font-variant-numeric: tabular-nums;
}

.font-size-sample .from {
	flex: 0 0 auto;
	margin-right: 0.6em;
	font-weight: bold;
}

.font-size-sample .text {
	flex: 1 1 auto;
	min-width: 0;
	word-break: break-word;
}
</style>

<script lang="ts">
import {computed, defineComponent, ref} from "vue";
import {useStore} from "../../js/store";
import {themePartner} from "../../js/helpers/themeAppearance";
import {
	fontSizeLabels,
	fontSizeScale,
	fontSizes,
	normalizeFontSize,
	type FontSize,
} from "../../js/helpers/fontSize";
import {
	normalizeOwnMessageStyle,
	ownMessageStyleLabels,
	ownMessageStyles,
	OwnMessageStyle,
} from "../../js/helpers/ownMessages";
import {
	clearTrusted,
	splitKey,
	trustedMedia,
	untrust,
	type TrustKind,
} from "../../js/helpers/mediaTrust";

type TrustedEntry = {key: string; name: string; network: string};

export default defineComponent({
	name: "AppearanceSettings",
	setup() {
		const store = useStore();

		// Channel and account keys carry the network uuid; show its name.
		const networkName = (uuid: string) =>
			store.getters.findNetwork(uuid)?.name ?? uuid.slice(0, 8);

		const entriesOf = (kind: TrustKind): TrustedEntry[] =>
			trustedMedia(kind).map((key) => {
				if (kind === "host") {
					return {key, name: key, network: ""};
				}

				const {network, name} = splitKey(key);
				return {key, name, network: network ? networkName(network) : ""};
			});

		const trustedGroups = computed(() => [
			{kind: "host" as TrustKind, title: "Sites", verb: "from", entries: entriesOf("host")},
			{
				kind: "account" as TrustKind,
				title: "People",
				verb: "from",
				entries: entriesOf("account"),
			},
			{
				kind: "channel" as TrustKind,
				title: "Channels",
				verb: "in",
				entries: entriesOf("channel"),
			},
		]);
		const trustedCount = computed(() =>
			trustedGroups.value.reduce((n, g) => n + g.entries.length, 0)
		);

		const fontSize = computed(() => normalizeFontSize(store.state.settings.fontSize));

		const ownMessages = computed(() =>
			normalizeOwnMessageStyle(store.state.settings.ownMessages)
		);
		const ownMessageHints: Record<OwnMessageStyle, string> = {
			muted: "the text in the muted colour, as before",
			band: "the row on a lighter or darker band, the text like everyone else's",
			plain: "nothing marks them",
		};

		// The step under the slider while it is being dragged. Applying every
		// step live re-laid out the whole page (rem chrome) under the pointer
		// and moved the slider with it, so a drag only renders the sample
		// below; `change` — the pointer let go, or a keyboard step, which
		// fires both events — applies it and the page follows in one move.
		const draggedTo = ref<FontSize | null>(null);
		const shown = computed(() => draggedTo.value ?? fontSize.value);
		const shownIndex = computed(() => fontSizes.indexOf(shown.value));
		const shownLabel = computed(() => fontSizeLabels[shown.value]);
		// The sample at the shown step: its percentage of the browser default,
		// through whatever the page is at now (1rem = the applied step).
		const sampleFontSize = computed(
			() => `${fontSizeScale[shown.value] / fontSizeScale[fontSize.value]}rem`
		);
		const sampleLines = [
			{
				time: "12:34",
				from: "grandma",
				color: "color-4",
				text: "Can you read this without your glasses?",
			},
			{
				time: "12:35",
				from: "you",
				color: "color-10",
				text: "Yes! Slide it until this is comfortable.",
			},
			{
				time: "12:35",
				from: "grandma",
				color: "color-4",
				text: "The ends are meant to be too small and too big.",
			},
		];

		const stepOf = (event: Event) =>
			fontSizes[Number((event.target as HTMLInputElement).value)];

		const onFontSizeInput = (event: Event) => {
			draggedTo.value = stepOf(event) ?? null;
		};

		const onFontSizeChange = (event: Event) => {
			const value = stepOf(event);
			draggedTo.value = null;

			if (value) {
				void store.dispatch("settings/update", {name: "fontSize", value, sync: true});
			}
		};

		// What the toggle does for the theme picked: names its pair, or says it
		// has none (helpers/themeAppearance.ts).
		const themePairHint = computed(() => {
			const themes = store.state.serverConfiguration?.themes ?? [];
			const label = (name: string) =>
				themes.find((t) => t.name === name)?.displayName ?? name;
			const chosen = store.state.settings.theme;
			const partner = chosen ? themePartner(chosen) : null;

			return partner
				? `${label(chosen)} and ${label(partner)} swap with the system's mode.`
				: `${label(chosen)} has no light/dark pair; Coffee, Cobalt, Princess and Day do.`;
		});

		// A theme that follows the system's mode says so in the list while the
		// toggle is on; any theme can still be picked.
		const themeOptionLabel = (name: string, displayName: string) =>
			store.state.settings.matchSystemAppearance && themePartner(name)
				? `${displayName} (light/dark)`
				: displayName;

		return {
			store,
			themeOptionLabel,
			themePairHint,
			trustedGroups,
			trustedCount,
			untrust,
			clearTrusted,
			fontSizes,
			fontSizeLabels,
			ownMessages,
			ownMessageStyles,
			ownMessageStyleLabels,
			ownMessageHints,
			shownIndex,
			shownLabel,
			sampleFontSize,
			sampleLines,
			onFontSizeInput,
			onFontSizeChange,
		};
	},
});
</script>
