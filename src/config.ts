/*
 * WordPress Import Options Model
 *
 * Import options persisted in the plugin registry, adjustable from the import form at any time.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Import options: persisted in the plugin config (the config column of the plugins table); the
 * import form can adjust them at any time.
 *
 * <ul>
 * <li>siteInfo — import site info (name / subtitle / description / URL). When off (auto mode),
 * no site info is imported. The URL (primaryDomain) has an extra constraint: if the current site
 * config is in "auto-detect" mode, the URL part of the XML is skipped even when siteInfo is on,
 * so the site's domain redirect cannot be rewritten.</li>
 * <li>media — fetch and import media files (depends on the media-library plugin; auto-skipped
 * when it is not installed, leaving the original WP media links in posts).</li>
 * <li>comments — import comments (approved ones become "approved", the rest "pending").</li>
 * <li>overwrite — keep existing data and overwrite conflicts (posts with the same slug are
 * overwritten with the imported content).</li>
 * </ul>
 *
 * @since 1.0.0
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