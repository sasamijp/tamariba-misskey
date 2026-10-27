/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// タイムライン上でルート投稿の下に表示するスレッド (配下の返信すべて) の取得・更新をまとめて扱う。
// 表示中のスレッドをまとめて 1 リクエストで取得し、返信の追加・削除はストリーム (リアルタイムモード) かポーリングで拾う。

import * as Misskey from 'misskey-js';
import { createVisibilityAwareInterval } from '@@/js/interval.js';
import type { NoteUpdatedEvent } from 'misskey-js/streaming.types.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import { globalEvents } from '@/events.js';
import { $i } from '@/i.js';
import { store } from '@/store.js';
import { prefer } from '@/preferences.js';

type Listener = (replies: Misskey.entities.Note[]) => void;

const MAX_ROOTS_PER_REQUEST = 100;
const MIN_POLLING_INTERVAL = 1000 * 10;
const POLLING_INTERVAL =
	prefer.s.pollingInterval === 1 ? MIN_POLLING_INTERVAL * 1.5 * 1.5 :
	prefer.s.pollingInterval === 2 ? MIN_POLLING_INTERVAL * 1.5 :
	MIN_POLLING_INTERVAL;

const listeners = new Map<string, Set<Listener>>();
const threads = new Map<string, Misskey.entities.Note[]>();
const fetchQueue = new Set<string>();
let flushScheduled = false;
let flushing = false;
let disposePolling: (() => void) | null = null;

const useRealtime = $i != null && store.s.realtimeMode;

function notify(rootId: string) {
	const replies = threads.get(rootId) ?? [];
	for (const listener of listeners.get(rootId) ?? []) listener(replies);
}

function isSameReplies(a: Misskey.entities.Note[] | undefined, b: Misskey.entities.Note[]): boolean {
	return a != null && a.length === b.length && a.every((n, i) => n.id === b[i].id);
}

async function flush() {
	flushScheduled = false;
	// 古い応答が新しい応答を上書きしないよう、取得は 1 本ずつ直列に行う
	flushing = true;

	while (true) {
		for (const id of fetchQueue) {
			if (!listeners.has(id)) fetchQueue.delete(id);
		}
		if (fetchQueue.size === 0) break;

		const rootIds = [...fetchQueue].slice(0, MAX_ROOTS_PER_REQUEST);
		for (const id of rootIds) fetchQueue.delete(id);

		try {
			const res = await misskeyApi('notes/thread-replies', { noteIds: rootIds });
			for (const { noteId, replies } of res) {
				// 取得中に購読解除されたスレッドは保持しない
				if (!listeners.has(noteId)) continue;
				if (isSameReplies(threads.get(noteId), replies)) continue;
				threads.set(noteId, replies);
				notify(noteId);
			}
		} catch (err) {
			console.error(err);
		}
	}

	flushing = false;
}

function requestFetch(rootIds: Iterable<string>) {
	for (const id of rootIds) fetchQueue.add(id);
	if (flushScheduled || flushing || fetchQueue.size === 0) return;
	flushScheduled = true;
	// 同じタイミングでマウントされたスレッドをまとめて取得する
	window.setTimeout(flush, 0);
}

function findRootIdsContaining(noteId: string): string[] {
	const rootIds: string[] = [];
	for (const rootId of listeners.keys()) {
		if (rootId === noteId || threads.get(rootId)?.some(n => n.id === noteId)) rootIds.push(rootId);
	}
	return rootIds;
}

function onStreamNoteUpdated(ev: NoteUpdatedEvent) {
	if (ev.type !== 'threadUpdated') return;
	if (!listeners.has(ev.id)) return;
	requestFetch([ev.id]);
}

function onStreamConnected() {
	// 再接続時は購読し直し、切断中に付いた返信を取りこぼさないよう取り直す
	for (const rootId of listeners.keys()) useStream().send('sr', { id: rootId });
	requestFetch(listeners.keys());
}

globalEvents.on('notePosted', (note) => {
	if (note.replyId == null) return;
	requestFetch(findRootIdsContaining(note.replyId));
});

globalEvents.on('noteDeleted', (noteId) => {
	for (const [rootId, replies] of threads) {
		if (!replies.some(n => n.id === noteId)) continue;
		threads.set(rootId, replies.filter(n => n.id !== noteId));
		notify(rootId);
		// サーバー側の状態と揃えるため取り直す
		requestFetch([rootId]);
	}
});

if (useRealtime) {
	const stream = useStream();
	stream.on('noteUpdated', onStreamNoteUpdated);
	stream.on('_connected_', onStreamConnected);
}

function startPollingIfNeeded() {
	if (useRealtime || disposePolling != null) return;
	disposePolling = createVisibilityAwareInterval(() => {
		requestFetch(listeners.keys());
	}, POLLING_INTERVAL, { immediate: false });
}

function stopPollingIfIdle() {
	if (listeners.size > 0 || disposePolling == null) return;
	disposePolling();
	disposePolling = null;
}

/**
 * ルート投稿のスレッド (配下の返信すべて、時系列順) を購読する。
 * @returns 購読解除関数
 */
export function subscribeThread(rootId: string, listener: Listener): () => void {
	let set = listeners.get(rootId);
	if (set == null) {
		set = new Set();
		listeners.set(rootId, set);
		if (useRealtime) useStream().send('sr', { id: rootId });
	}
	set.add(listener);

	const cached = threads.get(rootId);
	if (cached != null) listener(cached);
	requestFetch([rootId]);
	startPollingIfNeeded();

	return () => {
		const set = listeners.get(rootId);
		if (set == null) return;
		set.delete(listener);
		if (set.size === 0) {
			listeners.delete(rootId);
			threads.delete(rootId);
			if (useRealtime) useStream().send('un', { id: rootId });
		}
		stopPollingIfIdle();
	};
}
