/*
 * WordPress Import Plugin Entry Point
 *
 * Cordis plugin that imports a WordPress WXR export into LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Import from WordPress (import-from-wordpress).
 *
 * <p>Entry point: plugin list → "从 WordPress 导入" (CustomSetting button) → import page →
 * "导入 XML" (import XML). The import page itself never appears in the admin sidebar.</p>
 *
 * Import flow:
 * <ul>
 * <li>Upload and parse the WXR export XML (multipart, no third-party parsing dependency).</li>
 * <li>Enter a special maintenance mode — no plugin is unloaded or disabled, because the import
 * cooperates with the media-library / categories / profiles plugins.</li>
 * <li>Import in the background in the order media → categories → users (profiles) → posts →
 * comments → site info, keeping existing data and overwriting conflicts.</li>
 * <li>Progress is visible only to the initiating session (progress page + JSON polling); all
 * other visitors see the ordinary maintenance home page.</li>
 * </ul>
 *
 * @since 1.0.0
 */

import type { Context } from 'cordis';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { checkPermission, requireAuth } from '../../services/permission.service.js';
import type { SiteConfig } from '../../types/index.js';
import { IMPORT_START_URL, IMPORT_URL, MANAGE_PERMISSION, PLUGIN_ID, PLUGIN_NAME, PROGRESS_API_URL, PROGRESS_URL } from './src/constants.js';
import { isAutoConfiguredUrl, loadOptions, parseOptionsForm, saveOptions } from './src/config.js';
import type { ImportOptions } from './src/config.js';
import { startImport } from './src/importer.js';
import { isImportRunning, snapshotFor } from './src/progress.js';
import { parseWxr, validateExport } from './src/wxr.js';

const MAX_XML_BYTES = 64 * 1024 * 1024;
const text = (value: unknown): string => String(value ?? '').trim();
const param = (value: unknown): string => Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
const messageOf = (error: unknown): string => error instanceof Error ? error.message : '操作失败';

/** 页面处理器包装：失败时渲染 error 视图（与 Base wrap 语义一致）。 */
function wrap(fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler {
  return (req, res, next: NextFunction) => {
    void Promise.resolve(fn(req, res)).catch((error) => {
      console.error(`[${PLUGIN_ID}] handler error:`, error);
      if (res.headersSent) return next(error);
      res.status(500).render('error', { title: '导入出错', message: messageOf(error) });
    });
  };
}
/** JSON API 处理器包装：失败时返回 { ok:false }。 */
function wrapJson(fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler {
  return (req, res) => {
    void Promise.resolve(fn(req, res)).catch((error) => {
      console.error(`[${PLUGIN_ID}] handler error:`, error);
      if (!res.headersSent) res.status(400).json({ ok: false, message: messageOf(error) });
    });
  };
}

async function readBody(req: Request): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_XML_BYTES) throw new Error('XML 文件不能超过 64MB');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

interface UploadResult { fields: Record<string, string>; filename: string; data: Buffer; }

/** multipart 解析：提取表单字段与 XML 文件（与 media-library 同构）。 */
function parseMultipart(body: Buffer, contentType: string): UploadResult {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('上传请求缺少 multipart boundary');
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields: Record<string, string> = {};
  let filename: string | undefined;
  let data: Buffer | undefined;
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    const start = cursor + boundary.length;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    const part = body.subarray(start, next);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const content = part.subarray(headerEnd + 4, part.length - 2); // 去掉结尾 \r\n
      const name = headers.match(/name="([^"]+)"/i)?.[1] ?? '';
      const fileHeader = headers.match(/filename="([^"]*)"/i)?.[1];
      if (fileHeader !== undefined) { filename = fileHeader; data = content; }
      else fields[name] = content.toString('utf8');
    }
    cursor = next;
  }
  if (!filename || !data?.length) throw new Error('请选择要导入的 WordPress XML 文件');
  return { fields, filename, data };
}

export default async function importFromWordPress(context: Context): Promise<void> {
  const { web, admin } = context.linearpress;
  const plugins = context.plugins;
  const adminGuard = [requireAuth, checkPermission(MANAGE_PERMISSION)] as const;

  // 插件列表 CustomSetting 入口（不在侧边栏）。
  admin.registerCustomSetting({ label: '从 WordPress 导入', link: IMPORT_URL });

  // ------------------------------------------------------------ 导入表单页
  web.register('get', IMPORT_URL, ...adminGuard, wrap(async (_req, res) => {
    const options = loadOptions(plugins, PLUGIN_ID);
    let siteConfig: SiteConfig;
    try { siteConfig = await context.config.get(); } catch { siteConfig = { autoDetect: true } as SiteConfig; }
    res.render('admin/import-from-wordpress', {
      title: PLUGIN_NAME,
      options,
      running: isImportRunning(),
      progressUrl: PROGRESS_URL,
      siteUrlAuto: isAutoConfiguredUrl(siteConfig),
      notice: param(_req.query.notice)
    });
  }));

  // ------------------------------------------------------------ 启动导入
  web.register('post', IMPORT_START_URL, ...adminGuard, wrap(async (req, res) => {
    if (isImportRunning()) return res.redirect(PROGRESS_URL);
    const upload = parseMultipart(await readBody(req), String(req.headers['content-type'] ?? ''));
    if (!upload.filename.toLowerCase().endsWith('.xml')) throw new Error('请选择 WordPress 导出的 XML 文件（.xml）');
    const options: ImportOptions = parseOptionsForm(upload.fields, loadOptions(plugins, PLUGIN_ID));
    await saveOptions(plugins, PLUGIN_ID, options);
    const xml = upload.data.toString('utf8');
    const parsed = parseWxr(xml);
    const parseError = validateExport(parsed);
    if (parseError) throw new Error(parseError);
    const sessionId = String(req.sessionID ?? '');
    const userId = Number(req.session.userId ?? 0);
    const started = await startImport(context, options, parsed, sessionId, userId);
    if (!started) return res.redirect(PROGRESS_URL);
    res.redirect(PROGRESS_URL);
  }));

  // ------------------------------------------------------------ 进度页
  web.register('get', PROGRESS_URL, ...adminGuard, wrap(async (req, res) => {
    const state = snapshotFor(String(req.sessionID ?? ''));
    if (!state) return res.status(503).render('admin/import-occupied', { title: '正在维护', progressUrl: PROGRESS_URL });
    res.render('admin/import-progress', { title: '导入进度', state, progressApiUrl: PROGRESS_API_URL, progressUrl: PROGRESS_URL });
  }));

  // ------------------------------------------------------------ 进度轮询 JSON
  web.register('get', PROGRESS_API_URL, ...adminGuard, wrapJson(async (req, res) => {
    const state = snapshotFor(String(req.sessionID ?? ''));
    res.json({ ok: true, allowed: state !== null, state });
  }));

  context.logger.info('activated');
}

export { PLUGIN_ID, IMPORT_URL, PROGRESS_URL };