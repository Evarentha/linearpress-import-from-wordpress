/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * 从 WordPress 导入（import-from-wordpress）。
 *
 * 入口：插件列表 →「从 WordPress 导入」（CustomSetting 按钮）→ 导入页「导入 XML」。
 * 导入页本身不出现在侧边栏。
 *
 * 导入流程：
 *  1. 上传并解析 WXR 导出 XML（multipart，无第三方解析依赖）；
 *  2. 进入特殊维护模式（不卸载/禁用任何插件，导入需要与媒体库 / 分类 /
 *     个人资料等插件协作）；
 *  3. 后台按 媒体 → 分类 → 用户（个人资料）→ 文章 → 评论 → 站点信息 顺序导入，
 *     保留现有、覆盖冲突；
 *  4. 进度只对发起者会话可见（progress 页 + JSON 轮询），其余访客看到普通维护首页。
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