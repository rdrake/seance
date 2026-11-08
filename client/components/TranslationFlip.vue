<template>
	<!-- A translated line shows its translation in the original's place
	     (Message.vue `replaced`); this button before it swaps the two, like
	     the topic's flipper in the header. -->
	<button
		v-if="entry && entry.status === 'done'"
		type="button"
		class="msg-translate-flip"
		:class="{original: entry.hidden}"
		:aria-label="label"
		:title="label"
		:aria-pressed="!entry.hidden"
		@click.stop="flip"
	>
		<i class="fas fa-language" aria-hidden="true" />
	</button>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import {useI18n} from "../js/i18n";
import {useStore} from "../js/store";
import {readingLanguage, showOriginal} from "../js/translate/reader";
import {languageName} from "../js/translate/languages";
import {sourceText} from "../js/translate/labels";
import type {ClientMessage} from "../js/types";

export default defineComponent({
	name: "TranslationFlip",
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
	},
	setup(props) {
		const store = useStore();
		const {t} = useI18n();
		const entry = computed(() => store.state.translations[props.message.id]);
		const nameOf = (code: string) => languageName(code, readingLanguage());

		const label = computed(() => {
			const value = entry.value;

			if (!value) {
				return "";
			}

			if (value.hidden) {
				return t("translate.flip.showTranslation");
			}

			// An own line's translation is the read-back of what was sent.
			if (props.message.self && value.from) {
				return t("translate.flip.sentIn", {language: nameOf(value.from)});
			}

			return t("translate.flip.translatedFrom", {
				language: sourceText(value.from, value.to, value.candidates ?? [], nameOf),
			});
		});

		const flip = () => {
			const value = entry.value;

			if (value) {
				showOriginal(props.message.id, !value.hidden);
			}
		};

		return {entry, label, flip};
	},
});
</script>
