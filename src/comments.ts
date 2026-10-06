/*
 * LinearPress Comments
 *
 * Implements the comments module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import crypto from 'node:crypto';
import type { DatabaseService } from '../../../types/services.js';
import type { WxrComment } from './wxr.js';

/** Map and comment live in the SAME business transaction, so failure/retry cannot duplicate.
 * Namespace is the WP site's canonical URL, not export bytes (exports can change). */
export async function ensureCommentMap(db: DatabaseService): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS ifwp_comment_map (
    source_key VARCHAR(64) NOT NULL, wp_post_id VARCHAR(64) NOT NULL, wp_comment_id VARCHAR(64) NOT NULL,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    PRIMARY KEY(source_key, wp_post_id, wp_comment_id))`);
}
export async function importComment(db: DatabaseService, source: string, wpPostId: number, postId: number, c: WxrComment, userId: number | null, created: string): Promise<void> {
  const namespace = crypto.createHash('sha256').update(source.trim().replace(/\/+$/, '').toLowerCase()).digest('hex');
  const wpId = c.id > 0 ? String(c.id) : crypto.createHash('sha256').update(JSON.stringify([c.author,c.authorEmail,c.date,c.content])).digest('hex');
  await db.transaction(async () => {
    const params = [namespace, String(wpPostId), wpId];
    const mapped = await db.get<{comment_id: number}>('SELECT comment_id FROM ifwp_comment_map WHERE source_key=? AND wp_post_id=? AND wp_comment_id=?', ...params);
    if (mapped && await db.get('SELECT id FROM comments WHERE id=?', mapped.comment_id)) return;
    if (mapped) await db.run('DELETE FROM ifwp_comment_map WHERE source_key=? AND wp_post_id=? AND wp_comment_id=?', ...params);
    // Adopt an old pre-map imported comment once, but never reuse a comment mapped to another WXR id.
    const old = await db.get<{id: number}>(`SELECT c.id FROM comments c WHERE c.post_id=? AND c.content=? AND COALESCE(c.guest_name,'')=? AND COALESCE(c.guest_email,'')=? AND c.created_at=? AND NOT EXISTS (SELECT 1 FROM ifwp_comment_map m WHERE m.comment_id=c.id) ORDER BY c.id LIMIT 1`, postId, c.content, c.author.trim(), c.authorEmail.trim(), created);
    let id = old?.id;
    if (id === undefined) {
      const result = await db.run('INSERT INTO comments(post_id,user_id,guest_name,guest_email,content,status,ip,created_at) VALUES(?,?,?,?,?,?,?,?)', postId, userId, c.author.trim() || null, c.authorEmail.trim() || null, c.content, c.approved === '1' || c.approved.toLowerCase() === 'approved' ? 'approved' : 'pending', c.authorIp || null, created);
      id = Number(result.lastInsertRowid);
    }
    await db.run('INSERT INTO ifwp_comment_map(source_key,wp_post_id,wp_comment_id,comment_id) VALUES(?,?,?,?)', ...params, id);
  });
}
