<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="replies.length > 0" :class="$style.root">
	<MkNote
		v-for="reply in replies"
		:key="reply.id"
		:class="$style.reply"
		:note="reply"
		:withHardMute="true"
		:inThread="true"
	/>
</div>
</template>

<script lang="ts" setup>
import { onUnmounted, shallowRef } from 'vue';
import * as Misskey from 'misskey-js';
import MkNote from '@/components/MkNote.vue';
import { subscribeThread } from '@/utility/note-thread.js';

const props = defineProps<{
	rootNote: Misskey.entities.Note;
}>();

// スレッド配下の返信すべて (返信の返信も含む) を時系列で並べる。折りたたまない
const replies = shallowRef<Misskey.entities.Note[]>([]);

const unsubscribe = subscribeThread(props.rootNote.id, (x) => {
	replies.value = x;
});

onUnmounted(() => {
	unsubscribe();
});
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;
	margin: 0 16px 16px 56px;
	border-left: solid 2px var(--MI_THEME-divider);
}

.reply {
	&:not(:last-child) {
		border-bottom: solid 0.5px var(--MI_THEME-divider);
	}
}

@container (max-width: 500px) {
	.root {
		margin: 0 4px 12px 12px;
	}
}
</style>
