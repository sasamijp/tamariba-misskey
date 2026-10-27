/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class MultipleReactions1793102555430 {
    name = 'MultipleReactions1793102555430'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_ad0c221b25672daf2df320a817"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7751b74317122d11575bff31c" ON "note_reaction" ("userId", "noteId", "reaction") `);
    }

    async down(queryRunner) {
        // 1ユーザー1ノートにつき最初のリアクション以外を消してから戻す
        await queryRunner.query(`DELETE FROM "note_reaction" a USING "note_reaction" b WHERE a."userId" = b."userId" AND a."noteId" = b."noteId" AND a."id" > b."id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a7751b74317122d11575bff31c"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ad0c221b25672daf2df320a817" ON "note_reaction" ("userId", "noteId") `);
    }
}
