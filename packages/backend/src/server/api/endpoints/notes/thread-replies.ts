/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { MiMeta, NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['notes'],

	requireCredential: false,

	description: 'Get all replies in the threads started by the given root notes, in chronological order.',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				noteId: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
				},
				replies: {
					type: 'array',
					optional: false, nullable: false,
					items: {
						type: 'object',
						optional: false, nullable: false,
						ref: 'Note',
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteIds: { type: 'array', items: { type: 'string', format: 'misskey:id' }, maxItems: 100, minItems: 1, uniqueItems: true },
	},
	required: ['noteIds'],
} as const;

// 1 スレッドあたりに返す返信の上限。超えた分は古い返信から省く
const MAX_REPLIES_PER_THREAD = 300;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.meta)
		private serverSettings: MiMeta,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (me == null && this.serverSettings.ugcVisibilityForVisitor === 'none') {
				return ps.noteIds.map(noteId => ({ noteId, replies: [] }));
			}

			// 返信の多いスレッドが他のスレッドを押し出さないよう、上限はスレッドごとにかける
			const notesByRoot = await Promise.all(ps.noteIds.map(async noteId => {
				// threadId はスレッドのルート投稿の ID なので、返信の返信も含めて配下の投稿をまとめて引ける
				const query = this.notesRepository.createQueryBuilder('note')
					.where('note.threadId = :noteId', { noteId })
					.innerJoinAndSelect('note.user', 'user')
					.leftJoinAndSelect('note.reply', 'reply')
					.leftJoinAndSelect('note.renote', 'renote')
					.leftJoinAndSelect('reply.user', 'replyUser')
					.leftJoinAndSelect('renote.user', 'renoteUser')
					.orderBy('note.id', 'DESC');

				if (me == null && this.serverSettings.ugcVisibilityForVisitor === 'local') {
					query.andWhere('note.userHost IS NULL');
				}

				this.queryService.generateVisibilityQuery(query, me);
				this.queryService.generateBaseNoteFilteringQuery(query, me);

				const notes = await query.limit(MAX_REPLIES_PER_THREAD).getMany();
				return notes.reverse();
			}));

			const packed = await this.noteEntityService.packMany(notesByRoot.flat(), me);

			let offset = 0;
			return ps.noteIds.map((noteId, i) => {
				const replies = packed.slice(offset, offset + notesByRoot[i].length);
				offset += notesByRoot[i].length;
				return { noteId, replies };
			});
		});
	}
}
