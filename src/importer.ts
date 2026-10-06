/*
 * WordPress Import Orchestrator
 *
 * Coordinates the phased import of media, categories, users, posts, comments, and site info.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Import orchestration: media → categories → users (profiles) → posts → comments → site info.
 *
 * <p>Special maintenance mode: during the import the site enters maintenance mode (reason=manual)
 * but deliberately does NOT call suspendNonWhitelistedPlugins to disable any plugin — the import
 * needs to cooperate with the media-library / categories / profiles plugins.</p>
 *
 * Data policy: keep existing data, overwrite conflicts.
 * <ul>
 * <li>Posts: if the same slug already exists, overwrite it (title/content/status/author/views/
 * updated time).</li>
 * <li>Users: if the same username (or email) already exists, reuse that user and fill in a blank
 * email; never overwrite passwords.</li>
 * <li>Media: on an ifwp_media_map hit, reuse the previously imported file.</li>
 * </ul>
 *
 * @since 1.0.0
 */

import crypto from 'node:crypto';
import { ensureCommentMap, importComment } from './comments.js';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import type { Context } from 'cordis';
import type { Block, SiteConfig } from '../../../types/index.js';
import type { DatabaseService } from '../../../types/services.js';
import type { SqliteDatabase } from '../../../core/database.js';
import { renderBlocks } from '../../../core/block-registry.js';
import { maintenance } from '../../../core/maintenance.js';
import { isAutoConfiguredUrl } from './config.js';
import type { ImportOptions } from './config.js';
import { convertWpContent, type MediaUrlMap } from './blocks.js';
import { importAttachments, type MediaImportContext } from './media.js';
import {
  addStat, advance, beginImport, failImport, finishImport, finishPhase, setPhase
} from './progress.js';
import {
  normalizeWpDate, siteHost, type WxrComment, type WxrExport, type WxrItem
} from './wxr.js';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const SUBSCRIBER_GROUP = 'subscriber';

interface PendingComment {
  wpPostId: number;
  postId: number;
  comment: WxrComment;
}

/** 与 Base 相同规则生成 slug（保留字母/数字含中文，其余折叠为连字符）。 */
function generateSlug(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}+/gu, '').toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function decodePostName(value: string): string {
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
}

async function uniqueSlug(db: DatabaseService, base: string, used: Set<string>): Promise<string> {
  let candidate = base || 'post';
  let suffix = 2;
  const exists = async (slug: string): Promise<boolean> => {
    if (used.has(slug)) return true;
    const row = await db.get('SELECT id FROM posts WHERE slug=?', slug);
    return row !== undefined;
  };
  while (await exists(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  used.add(candidate);
  return candidate;
}

function mapStatus(status: string): 'published' | 'draft' | 'archived' | null {
  switch (status) {
    case 'publish': return 'published';
    case 'pending':
    case 'future':
    case 'private':
    case 'draft': return 'draft';
    case 'archived': return 'archived';
    default: return null; // trash / auto-draft / inherit 等不导入
  }
}

function postMetaValue(item: WxrItem, key: string): string | undefined {
  return item.postmeta.find((meta) => meta.key === key)?.value;
}

async function isPluginEnabled(ctx: Context, id: string): Promise<boolean> {
  try {
    const rows = (await ctx.plugins.list()) as Array<{ id: string; enabled: number }>;
    return rows.some((row) => row.id === id && row.enabled === 1);
  } catch {
    return false;
  }
}

/**
 * 启动导入（后台执行）。返回 false 表示已有导入进行中。
 */
export async function startImport(ctx: Context, options: ImportOptions, parsed: WxrExport, sessionId: string, initiatorUserId: number): Promise<boolean> {
  if (!beginImport(sessionId)) return false;
  void runImport(ctx, options, parsed, sessionId, initiatorUserId).catch((error) => {
    console.error('[import-from-wordpress] 导入任务异常终止:', error);
    failImport(error instanceof Error ? error.message : String(error));
  });
  return true;
}

async function runImport(ctx: Context, options: ImportOptions, parsed: WxrExport, sessionId: string, initiatorUserId: number): Promise<void> {
  const db: DatabaseService = ctx.databaseService as unknown as DatabaseService;
  const infra = ctx.db as unknown as SqliteDatabase;
  const mediaEnabled = await isPluginEnabled(ctx, 'media-library');
  const aplEnabled = await isPluginEnabled(ctx, 'advanced-posts-list');
  const profilesEnabled = await isPluginEnabled(ctx, 'colorful-profiles');
  const urlMap: Map<string, string> = new Map<string, string>();

  maintenance.enter('manual'); // 特殊维护模式：不卸载/禁用任何插件
  try {
    // ---------------- 1. 媒体 ----------------
    if (options.media && mediaEnabled) {
      const attachments = parsed.items
        .filter((item) => item.postType === 'attachment' && item.attachmentUrl)
        .map((item) => ({ url: item.attachmentUrl, date: item.postDate, name: item.title }));
      setPhase('media', attachments.length, '媒体');
      const mediaCtx: MediaImportContext = { database: db, infra, uploadRoot: UPLOAD_ROOT, fetchFiles: true };
      const mediaResult = await importAttachments(mediaCtx, attachments);
      for (const [oldUrl, newUrl] of mediaResult.urlMap) urlMap.set(oldUrl, newUrl);
      finishPhase();
    } else if (options.media) {
      // 未安装媒体库插件：仅保留原 WP 媒体链接，不拉取。
      setPhase('media', 0, '媒体', '已跳过媒体（未安装媒体库插件，保留原链接）');
      finishPhase();
    } else {
      setPhase('media', 0, '媒体', '已跳过媒体（导入选项关闭）');
      finishPhase();
    }

    // ---------------- 2. 分类目录（需 advanced-posts-list） ----------------
    const categoryIdByName = new Map<string, number>();
    if (aplEnabled) {
      const names = [...new Set(parsed.categories.map((cat) => cat.name).filter(Boolean))];
      setPhase('categories', names.length, '分类目录');
      for (const name of names) {
        const existing = await db.get<{id: number}>('SELECT id FROM apl_categories WHERE name=? COLLATE NOCASE', name);
        if (existing) {
          categoryIdByName.set(name, existing.id);
          advance();
          continue;
        }
        let slug = generateSlug(name) || 'category';
        let suffix = 2;
        while (await db.get('SELECT id FROM apl_categories WHERE slug=?', slug)) slug = `${generateSlug(name) || 'category'}-${suffix++}`;
        const result = await db.run('INSERT INTO apl_categories(name, slug) VALUES(?,?)', name, slug);
        categoryIdByName.set(name, Number(result.lastInsertRowid));
        addStat('categories');
        advance();
      }
      finishPhase();
    }

    // ---------------- 3. 用户（+ colorful-profiles 个人信息） ----------------
    const authors = parsed.authors.filter((author) => author.login.trim());
    const userByWpId = new Map<number, number>();
    const userByLogin = new Map<string, number>();
    setPhase('users', authors.length, '用户');
    const subscriber = await db.get<{ id: number }>("SELECT id FROM groups WHERE name=?", SUBSCRIBER_GROUP);
    const subscriberId = subscriber?.id ?? 1;
    const now = new Date().toISOString();
    for (const author of authors) {
      const username = author.login.trim();
      if (!username) continue;
      let lpId = await findOrCreateUser(db, username, author.email, subscriberId);
      if (lpId === undefined && author.email.trim()) {
        // 邮箱唯一冲突兜底：以空邮箱重试一次。
        lpId = await insertUser(db, null, subscriberId, username, now);
      }
      if (lpId === undefined) continue; // 极端情况：跳过该作者（文章作者回退到发起者）。
      userByWpId.set(author.id, lpId);
      userByLogin.set(username, lpId);
      advance();
      addStat('users');
    }
    finishPhase();

    // ---------------- 3.5 个人资料（需 colorful-profiles） ----------------
    if (profilesEnabled) {
      setPhase('profiles', authors.length, '个人资料');
      await db.exec(`CREATE TABLE IF NOT EXISTS colorful_profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, nickname TEXT, avatar TEXT, avatar_crop TEXT, website TEXT, bio TEXT, contact TEXT, representative TEXT, updated_at TEXT)`);
      for (const author of authors) {
        const lpId = userByWpId.get(author.id);
        if (lpId !== undefined) {
          const nickname = author.displayName.trim() || author.login.trim();
          await db.run(
            `INSERT INTO colorful_profiles(user_id,nickname,avatar,avatar_crop,website,bio,contact,representative,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
             ON CONFLICT(user_id) DO UPDATE SET nickname=excluded.nickname, updated_at=excluded.updated_at`,
            lpId, nickname || null, null, null, null, null, null, null, now
          );
          addStat('profiles');
        }
        advance();
      }
      finishPhase();
    }

    // ---------------- 4. 文章（含页面）与评论 ----------------
    const postItems = parsed.items.filter((item) => item.postType === 'post' || item.postType === 'page');
    const pendingComments: PendingComment[] = [];
    const usedSlugs = new Set<string>();
    setPhase('posts', postItems.length, '文章');
    for (const item of postItems) {
      const status = mapStatus(item.status);
      // 空标题且无内容的条目（如纯附件页）跳过。
      if (!status) {
        addStat('postSkips');
        advance();
        continue;
      }
      const title = item.title.trim() || '(无标题)';
      const baseSlug = decodePostName(item.postName) || generateSlug(title);
      const creatorLogin = item.creator.trim();
      const authorId = userByLogin.get(creatorLogin) ?? initiatorUserId;
      const blocks: Block[] = convertWpContent(item.contentEncoded || '', urlMap);
      const html = renderBlocks(blocks);
      const views = Math.max(0, Number(postMetaValue(item, 'views')) || 0);
      const created = normalizeWpDate(item.postDate) || now;

      // 保留现有、覆盖冲突：先按原 slug 查找，命中则覆盖（不改变 slug）；未命中才做唯一化并新建。
      const existing = options.overwrite ? await db.get<{ id: number }>('SELECT id FROM posts WHERE slug=?', baseSlug) : undefined;
      let lpId: number;
      if (existing) {
        await db.run(
          'UPDATE posts SET title=?,content_json=?,html_cache=?,status=?,author_id=?,views=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
          title, JSON.stringify(blocks), html, status, authorId, views, existing.id
        );
        lpId = existing.id;
        addStat('postUpdates');
      } else {
        const slug = await uniqueSlug(db, baseSlug, usedSlugs);
        const result = await db.run(
          'INSERT INTO posts(title,slug,content_json,html_cache,status,author_id,views,created_at) VALUES(?,?,?,?,?,?,?,?)',
          title, slug, JSON.stringify(blocks), html, status, authorId, views, created
        );
        lpId = Number(result.lastInsertRowid);
      }
      addStat('posts');

      // 分类关联（advanced-posts-list）。
      if (aplEnabled) {
        const categoryNames = item.categories.filter((cat) => cat.domain === 'category').map((cat) => cat.name).filter(Boolean);
        if (categoryNames.length) {
          await db.run('DELETE FROM apl_post_categories WHERE post_id=?', lpId);
          for (const name of categoryNames) {
            const categoryId = categoryIdByName.get(name);
            if (categoryId !== undefined) await db.run('INSERT OR IGNORE INTO apl_post_categories(post_id,category_id) VALUES(?,?)', lpId, categoryId);
          }
        }
        if (item.isSticky) {
          await db.run('INSERT INTO apl_post_options(post_id,sticky) VALUES(?,1) ON CONFLICT(post_id) DO UPDATE SET sticky=1', lpId);
        }
      }

      for (const comment of item.comments) {
        if (!comment.content.trim()) continue;
        pendingComments.push({ wpPostId: item.postId, postId: lpId, comment });
      }
      advance();
    }
    finishPhase();

    // ---------------- 5. 评论 ----------------
    if (options.comments && pendingComments.length) {
      setPhase('comments', pendingComments.length, '评论');
      await ensureCommentMap(db);
      for (const { wpPostId, postId, comment } of pendingComments) {
        const userId = comment.userId ? userByWpId.get(comment.userId) ?? null : null;
        await importComment(db, parsed.baseBlogUrl || parsed.baseSiteUrl || parsed.link, wpPostId, postId, comment, userId, normalizeWpDate(comment.date) || now);
        addStat('comments');
        advance();
      }
      finishPhase();
    }

    // ---------------- 6. 站点信息 ----------------
    if (options.siteInfo) {
      setPhase('site', 1, '站点信息');
      let current: SiteConfig;
      try {
        current = await ctx.config.get();
      } catch {
        current = { autoDetect: true } as SiteConfig;
      }
      const patch: Partial<SiteConfig> = {};
      if (parsed.title) {
        patch.siteName = parsed.title;
        patch.siteTitle = parsed.title;
        patch.title = parsed.title; // 兼容旧字段
      }
      if (parsed.description) {
        patch.siteDescription = parsed.description;
        patch.siteSubtitle = parsed.description;
        patch.description = parsed.description; // 兼容旧字段
      }
      // 网址：当前配置为“自动配置”时不导入 XML 中的网址（避免域名重定向被改写）。
      if (!isAutoConfiguredUrl(current)) {
        const host = siteHost(parsed.link) || siteHost(parsed.baseSiteUrl) || siteHost(parsed.baseBlogUrl);
        if (host) patch.primaryDomain = host;
      }
      if (Object.keys(patch).length) await ctx.config.set(patch);
      advance();
      finishPhase();
    }

    finishImport('导入完成。请仔细检查各文章是否存在排版问题——本插件无法保证与 WordPress 原站完美兼容。');
  } catch (error) {
    console.error('[import-from-wordpress] 导入失败:', error);
    failImport(error instanceof Error ? error.message : String(error));
  } finally {
    maintenance.exit();
  }
}

/** 按用户名 / 邮箱寻找已有用户；命中则复用并尝试补充空邮箱。 */
async function findOrCreateUser(db: DatabaseService, username: string, email: string, subscriberId: number): Promise<number | undefined> {
  const byName = await db.get<{ id: number; email: string | null }>('SELECT id, email FROM users WHERE username=?', username);
  if (byName) {
    if (!byName.email && email.trim()) {
      try {
        await db.run('UPDATE users SET email=? WHERE id=?', email.trim(), byName.id);
      } catch { /* 邮箱唯一冲突时放弃 */ }
    }
    return byName.id;
  }
  const cleanEmail = email.trim();
  if (cleanEmail) {
    const byEmail = await db.get<{ id: number }>('SELECT id FROM users WHERE email=?', cleanEmail);
    if (byEmail) return byEmail.id;
  }
  return insertUser(db, cleanEmail || null, subscriberId, username, new Date().toISOString());
}

/** 直接插入导入用户（随机密码哈希，WordPress 作者账号仅作归档，不可登录）。 */
async function insertUser(db: DatabaseService, email: string | null, subscriberId: number, username: string, now: string): Promise<number | undefined> {
  const hash = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10);
  try {
    const result = await db.run('INSERT INTO users(username,password_hash,email,group_id,is_super_admin) VALUES(?,?,?,?,0)', username, hash, email, subscriberId);
    return Number(result.lastInsertRowid);
  } catch {
    return undefined;
  }
}