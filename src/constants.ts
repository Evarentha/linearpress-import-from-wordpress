/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
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