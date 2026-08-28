/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * 导入选项：持久化在插件配置中（plugins 表 config 列），导入表单可随时调整。
 *
 * - siteInfo：导入站点信息（名称 / 副标题 / 描述 / 网址）。
 *   关闭（自动配置）时不导入任何站点信息。
 *   网址（primaryDomain）另有约束：当前站点配置若为“自动配置”（autoDetect），
 *   即使开启 siteInfo 也会跳过 XML 中的网址部分，避免站点域名重定向被改写。
 * - media：拉取并导入媒体文件（依赖 media-library 插件，未安装时自动跳过，
 *   仅保留文章中的原始 WP 媒体链接）。
 * - comments：导入评论（审核通过的导入为“已通过”，其余为“待审核”）。
 * - overwrite：保留现有数据、覆盖冲突（同一 slug 的文章以导入内容覆盖）。
 */
export interface ImportOptions {
  siteInfo: boolean;
  media: boolean;
  comments: boolean;
  overwrite: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  siteInfo: true,
  media: true,
  comments: true,
  overwrite: true
};

export interface PluginConfigStore {
  getConfig<T = unknown>(id: string): T | null;
  setConfig(id: string, config: unknown): Promise<void> | void;
}

export function loadOptions(store: PluginConfigStore, pluginId: string): ImportOptions {
  const stored = store.getConfig<Partial<ImportOptions>>(pluginId);
  return { ...DEFAULT_IMPORT_OPTIONS, ...(stored ?? {}) };
}

export function saveOptions(store: PluginConfigStore, pluginId: string, options: ImportOptions): Promise<void> {
  return Promise.resolve(store.setConfig(pluginId, options));
}

const BOOL = (value: unknown): boolean => value === '1' || value === 'true' || value === 'on' || value === true;

/** 从表单字段解析导入选项（未出现的字段保持当前已保存选项）。 */
export function parseOptionsForm(body: Record<string, unknown>, current: ImportOptions): ImportOptions {
  const checkbox = (name: string, fallback: boolean): boolean => (body[name] === undefined ? fallback : BOOL(body[name]));
  const siteInfoMode = String(body.site_info_mode ?? 'manual').trim();
  return {
    siteInfo: siteInfoMode === 'manual',
    media: checkbox('import_media', current.media),
    comments: checkbox('import_comments', current.comments),
    overwrite: checkbox('import_overwrite', current.overwrite)
  };
}

/** 判断当前站点是否为“自动配置网址”模式。 */
export function isAutoConfiguredUrl(siteConfig: { autoDetect: boolean }): boolean {
  return siteConfig.autoDetect === true;
}