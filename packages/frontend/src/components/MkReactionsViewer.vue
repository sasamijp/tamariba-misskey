<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component
	:is="prefer.s.animation ? TransitionGroup : 'div'"
	:enterActiveClass="$style.transition_x_enterActive"
	:leaveActiveClass="$style.transition_x_leaveActive"
	:enterFromClass="$style.transition_x_enterFrom"
	:leaveToClass="$style.transition_x_leaveTo"
	:moveClass="$style.transition_x_move"
	tag="div" :class="$style.root"
>
	<XReaction
		v-for="[reaction, count] in _reactions"
		:key="reaction"
		:reaction="reaction"
		:reactionEmojis="props.reactionEmojis"
		:count="count"
		:isInitial="initialReactions.has(reaction)"
		:noteId="props.noteId"
		:myReactions="props.myReactions"
		@reactionToggled="onMockToggleReaction"
	/>
	<slot v-if="hasMoreReactions" name="more"></slot>
</component>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { inject, watch, ref } from 'vue';
import { TransitionGroup } from 'vue';
import { isSupportedEmoji } from '@@/js/emojilist.js';
import { getEmojiNameFromReaction, isLocalCustomEmojiReaction } from '@@/js/emoji-name.js';
import XReaction from '@/components/MkReactionsViewer.reaction.vue';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { customEmojisMap } from '@/custom-emojis.js';
import { DI } from '@/di.js';

const props = withDefaults(defineProps<{
	noteId: Misskey.entities.Note['id'];
	reactions: Misskey.entities.Note['reactions'];
	reactionEmojis: Misskey.entities.Note['reactionEmojis'];
	myReactions: string[];
	maxNumber?: number;
}>(), {
	maxNumber: Infinity,
});

const mock = inject(DI.mock, false);

const emit = defineEmits<{
	(ev: 'mockUpdateMyReaction', emoji: string, delta: number): void;
}>();

const initialReactions = new Set(Object.keys(props.reactions));

const _reactions = ref<[string, number][]>([]);
const hasMoreReactions = ref(false);

function onMockToggleReaction(emoji: string, count: number) {
	if (!mock) return;

	const i = _reactions.value.findIndex((item) => item[0] === emoji);
	if (i < 0) return;

	emit('mockUpdateMyReaction', emoji, (count - _reactions.value[i][1]));
}

function canReact(reaction: string) {
	if (!$i) return false;
	// TODO: CheckPermissions
	return isLocalCustomEmojiReaction(reaction)
		? customEmojisMap.has(getEmojiNameFromReaction(reaction))
		: isSupportedEmoji(reaction);
}

watch([() => props.reactions, () => props.maxNumber, () => props.myReactions], ([newSource, maxNumber, myReactions]) => {
	hasMoreReactions.value = Object.keys(newSource).length > maxNumber;

	// その種類のリアクションが最初につけられた順 (サーバーから届いた順・後から増えたものは末尾) に並べる
	const ordered = Object.entries(newSource).filter(([, count]) => count !== 0);
	if (prefer.s.showAvailableReactionsFirstInNote) {
		// ソートの比較関数内で評価すると同じ絵文字に対して何度も実行されるため、事前に1回だけ評価しておく
		const canReactCache = new Map<string, boolean>();
		for (const [emoji] of ordered) {
			canReactCache.set(emoji, canReact(emoji));
		}
		// 安定ソートなので、同じグループ内ではつけられた順が保たれる
		ordered.sort(([emojiA], [emojiB]) => {
			const canReactA = canReactCache.get(emojiA)!;
			const canReactB = canReactCache.get(emojiB)!;
			if (canReactA === canReactB) return 0;
			return canReactA ? -1 : 1;
		});
	}

	const newReactions = ordered.slice(0, maxNumber);

	for (const myReaction of myReactions) {
		if (myReaction in newSource && !newReactions.some(([x]) => x === myReaction)) {
			newReactions.push([myReaction, newSource[myReaction]]);
		}
	}

	_reactions.value = newReactions;
}, { immediate: true, deep: true });
</script>

<style lang="scss" module>
.transition_x_move,
.transition_x_enterActive,
.transition_x_leaveActive {
	transition: opacity 0.2s cubic-bezier(0,.5,.5,1), transform 0.2s cubic-bezier(0,.5,.5,1) !important;
}
.transition_x_enterFrom,
.transition_x_leaveTo {
	opacity: 0;
	transform: scale(0.7);
}
.transition_x_leaveActive {
	position: absolute;
}

.root {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;

	&:empty {
		display: none;
	}
}
</style>
