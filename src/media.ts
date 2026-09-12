/*
 * WordPress Attachment Media Importer
 *
 * Fetches WordPress attachment files and stores them in the LinearPress media library.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Media import: fetch attachment files from the WordPress site and write them into the media
 * library.
 *
 * <ul>
 * <li>Isomorphic with the media-library plugin: files land in uploads/<kind>s/YYYY/MM/DD/ with
 * URL /media-library/files/<kind>s/YYYY/MM/DD/<name>, and a media_library record is inserted
 * (preserving the original publish date).</li>
 * <li>Unsupported formats (including SVG) are skipped, keeping only the original link.</li>
 * <li>Fetch failures (site down / timeout / 404) are skipped and counted, without interrupting
 * the import.</li>
 * <li>The mapping is persisted in the infrastructure database's ifwp_media_map, so repeated
 * imports reuse previously imported media.</li>
 * </ul>
 *
 * @since 1.0.0
 */

import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import type { SqliteDatabase } from '../../../core/database.js';
import type { DatabaseService } from '../../../types/services.js';
import { addStat, advance } from './progress.js';

type MediaKind = 'image' | 'video' | 'audio';

const EXTENSIONS: Record<MediaKind, Set<string>> = {
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.ico']),
  video: new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.avi', '.mkv']),
  audio: new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus'])
};
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus'
};

const MEDIA_PATH = '/media-library/files';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_MEDIA_BYTES = 256 * 1024 * 1024;
/** 同时拉取的文件数（受限并发，平衡总耗时与内存占用）。 */
const DOWNLOAD_CONCURRENCY = 4;

export interface MediaImportContext {
  /** 业务数据库（可能是被驱动替换后的 MySQL）。 */
  database: DatabaseService;
  /** 基础设施 SQLite（保留导入状态与映射）。 */
  infra: SqliteDatabase;
  uploadRoot: string;
  /** 是否应拉取文件；false 表示媒体库插件未安装，仅保留原链接。 */
  fetchFiles: boolean;
}

export interface MediaImportResult {
  /** 旧 WP 媒体 URL → 新媒体库 URL。 */
  urlMap: Map<string, string>;
  imported: number;
  failed: number;
}

function kindFromUrl(url: string): MediaKind | undefined {
  const clean = url.split('?')[0]?.split('#')[0] ?? '';
  const ext = path.extname(clean).toLowerCase();
  return (Object.keys(EXTENSIONS) as MediaKind[]).find((kind) => EXTENSIONS[kind].has(ext));
}

function safeName(value: string): string {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'upload';
}

/** 去掉尺寸变体后缀得到基名（如 xxx-1024x896.jpg → xxx.jpg）。 */
function variantBase(url: string): string {
  const m = url.match(/-(\d{2,4}x\d{2,4}|scaled|e\d+)(\.[a-zA-Z0-9]+)$/i);
  return m ? url.slice(0, m.index) + m[2] : url;
}

function tryDecode(url: string): string {
  try {
    const decoded = decodeURIComponent(url);
    return decoded === url ? '' : decoded;
  } catch {
    return '';
  }
}

/** 从 WP 附件发布日期提取 YYYY/MM/DD（保留原日期的目录结构）。 */
function dateParts(wpDate: string): { year: string; month: string; day: string } {
  const m = wpDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { year: m[1], month: m[2], day: m[3] } : { year: '', month: '', day: '' };
}

async function download(url: string): Promise<{ data: Buffer; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_MEDIA_BYTES) throw new Error('文件过大');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('空文件');
    if (buffer.length > MAX_MEDIA_BYTES) throw new Error('文件过大');
    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() || 'application/octet-stream';
    return { data: buffer, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureMediaSchema(database: DatabaseService): Promise<void> {
  await database.exec(`CREATE TABLE IF NOT EXISTS media_library (id VARCHAR(64) PRIMARY KEY, kind VARCHAR(16) NOT NULL, original_name VARCHAR(255) NOT NULL, filename VARCHAR(255) NOT NULL, url VARCHAR(1024) NOT NULL, mime_type VARCHAR(150) NOT NULL, size BIGINT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
}

function ensureInfraSchema(infra: SqliteDatabase): void {
  infra.exec(`CREATE TABLE IF NOT EXISTS ifwp_media_map (wp_url TEXT PRIMARY KEY, media_url TEXT NOT NULL, media_id TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
}

/**
 * 导入单个附件。返回新旧 URL 映射条目；跳过/失败返回 undefined。
 */
async function importAttachment(ctx: MediaImportContext, wpUrl: string, wpDate: string, filenameHint: string): Promise<{ wpUrl: string; mediaUrl: string; mediaId: string } | undefined> {
  const cleanUrl = wpUrl.trim();
  if (!cleanUrl) return undefined;
  const kind = kindFromUrl(cleanUrl);
  if (!kind) return undefined;
  const ext = path.extname(cleanUrl.split('?')[0] ?? '').toLowerCase();

  // 已导入过：复用映射（幂等重试）。
  const existing = ctx.infra.prepare('SELECT media_url, media_id FROM ifwp_media_map WHERE wp_url=?').get(cleanUrl) as { media_url: string; media_id: string } | undefined;
  if (existing) {
    advance();
    addStat('media');
    return { wpUrl: cleanUrl, mediaUrl: existing.media_url, mediaId: existing.media_id };
  }

  if (!ctx.fetchFiles) return undefined; // 未安装媒体库：仅保留原链接

  try {
    const { data, mimeType } = await download(cleanUrl);
    const parts = dateParts(wpDate);
    const year = parts.year || 'import';
    const month = parts.month || 'unknown';
    const day = parts.day || 'unknown';
    const folder = path.join(ctx.uploadRoot, `${kind}s`, year, month, day);
    await fs.ensureDir(folder);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `wp-${stamp}-${crypto.randomBytes(3).toString('hex')}${ext}`;
    const filePath = path.join(folder, filename);
    await fs.writeFile(filePath, data, { flag: 'wx' });
    const url = `${MEDIA_PATH}/${kind}s/${year}/${month}/${day}/${filename}`;
    const mediaId = crypto.randomUUID();
    await ctx.database.run(
      'INSERT INTO media_library(id,kind,original_name,filename,url,mime_type,size,created_at) VALUES(?,?,?,?,?,?,?,?)',
      mediaId, kind, safeName(filenameHint || cleanUrl), filename, url, mimeType || MIME_BY_EXT[ext] || 'application/octet-stream', data.length,
      wpDate.trim() || new Date().toISOString()
    );
    ctx.infra.prepare('INSERT INTO ifwp_media_map(wp_url,media_url,media_id) VALUES(?,?,?)').run(cleanUrl, url, mediaId);
    advance();
    addStat('media');
    return { wpUrl: cleanUrl, mediaUrl: url, mediaId };
  } catch (error) {
    console.error(`[import-from-wordpress] 媒体拉取失败（保留原链接）: ${cleanUrl}`, error instanceof Error ? error.message : error);
    advance();
    addStat('mediaFailed');
    return undefined;
  }
}

/**
 * 顺序导入全部附件（受限并发拉取）。只对 post_type=attachment 且有 attachment_url 的条目处理。
 */
export async function importAttachments(ctx: MediaImportContext, attachments: Array<{ url: string; date: string; name: string }>): Promise<MediaImportResult> {
  ensureInfraSchema(ctx.infra);
  if (ctx.fetchFiles) await ensureMediaSchema(ctx.database);

  const urlMap = new Map<string, string>();
  const result: MediaImportResult = { urlMap, imported: 0, failed: 0 };
  const queue = [...attachments];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const entry = await importAttachment(ctx, item.url, item.date || '', item.name || item.url);
      if (entry) {
        urlMap.set(entry.wpUrl, entry.mediaUrl);
        // 附加别名键：基名 / 解码形式，便于文章内尺寸变体与编码差异命中。
        const aliases = [variantBase(entry.wpUrl), tryDecode(entry.wpUrl), tryDecode(variantBase(entry.wpUrl))];
        for (const alias of aliases) {
          if (alias && alias !== entry.wpUrl && !urlMap.has(alias)) urlMap.set(alias, entry.mediaUrl);
        }
        result.imported += 1;
      } else {
        result.failed += 1;
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(DOWNLOAD_CONCURRENCY, queue.length || 1); i += 1) workers.push(worker());
  await Promise.all(workers);
  return result;
}