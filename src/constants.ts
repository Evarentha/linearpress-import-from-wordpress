/*
 * WordPress Import Route and Permission Constants
 *
 * Plugin identity, admin route URLs, and the management permission for the importer.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Shared constants for the import-from-wordpress plugin.
 *
 * <p>Defines the plugin identity (must match the plugin directory name and its display name),
 * the admin routes (import form page, import start, progress page, progress JSON polling API),
 * and the permission required for management operations.</p>
 *
 * @since 1.0.0
 */

/** 插件标识：必须与插件目录名一致。 */
export const PLUGIN_ID = 'import-from-wordpress';
export const PLUGIN_NAME = '从 WordPress 导入';

/** 导入页（CustomSetting 入口与表单页）。 */
export const IMPORT_URL = '/admin/import-from-wordpress';
/** 启动导入（POST，multipart）。 */
export const IMPORT_START_URL = `${IMPORT_URL}/import`;
/** 进度页：仅发起者会话可见。 */
export const PROGRESS_URL = `${IMPORT_URL}/progress`;
/** 进度轮询接口：返回 JSON。 */
export const PROGRESS_API_URL = `${IMPORT_URL}/progress.json`;

/** 管理操作所需权限。 */
export const MANAGE_PERMISSION = 'plugin:manage';