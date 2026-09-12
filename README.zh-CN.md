# 从 WordPress 导入（import-from-wordpress）

[![LinearPress](https://img.shields.io/badge/LinearPress-plugin-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![npm](https://img.shields.io/npm/v/@evarentha/linearpress-import-from-wordpress.svg)](https://www.npmjs.com/package/@evarentha/linearpress-import-from-wordpress) [![Node.js](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

[English](README.md) | **简体中文**

将 WordPress 站点的 WXR 导出 XML 迁移至 LinearPress：文章、页面、媒体、用户、分类、评论与站点信息，遵循「保留现有、覆盖冲突」语义（同 slug 的文章被覆盖，其余内容不受影响），可在现网站点上执行。导入一经启动无法中止；导入完成前，其他访客看到的均为维护页。

## 安装

```bash
git clone https://github.com/Evarentha/linearpress-import-from-wordpress.git src/plugins/import-from-wordpress
```

目录名必须与插件 id 一致，安装后需重启 LinearPress。也可以在 `base` 检出中执行 `sh scripts/sync-plugins.sh import-from-wordpress`，或在后台插件页上传 ZIP、填写 npm 包名。本插件为纯后端实现，导入页由基础权限 `plugin:manage` 守护，不自定义权限。

为获得完整保真，可选安装三个协作插件：media-library、advanced-posts-list、colorful-profiles。运行时逐个检测，缺失对应插件时自动跳过相关步骤。

## 执行导入

首先在 WordPress 后台导出：工具 → 导出 → 所有内容，保存为 XML（最大 64 MB）。然后在 LinearPress 后台打开插件页，点击本插件的「自定义设置」按钮进入 `/admin/import-from-wordpress`，选择文件、确认选项、开始导入。

导入以后台任务运行，视内容量通常需要 5 至 10 分钟，进度页每 1.2 秒轮询一次。进度仅对发起导入的会话可见（`/admin/import-from-wordpress/progress.json` 亦提供 JSON 形式）；其他访客看到的是普通维护页。导入过程中请勿重启或重新部署。中断的导入可直接重试并自断点续跑：基础设施库中的 `ifwp_media_map` 表记录每个 WordPress 媒体 URL 至新 URL 的映射，附件不会重复下载。

导入期间站点处于特殊的维护模式：不卸载、不停用任何插件，因为协作插件正是导入所依赖的。

## 导入内容

WXR 解析器、multipart 上传解析器、Gutenberg 块转换器全部在插件内自行实现，不引入任何 XML 库。段落、标题、引用、图片、诗节块转换为 LinearPress 原生块，其余块一律以 custom-html 原样保留；`views` postmeta 转换为文章浏览量，置顶标记原样保留。

写入全部经由公开服务（`ctx.posts`、`ctx.users`、媒体库），核心路由与核心表分毫不动。导入的 WordPress 作者转换为仅作归档的账号，配随机 bcrypt 密码、归入 subscriber 组，不可用于登录。评论保留作者、邮箱、IP 与时间戳；WordPress 中已通过的落为已通过，其余落为待审核。站点信息（名称、副标题、描述、URL）经 `ctx.config.set` 应用；域名处于 autoDetect 模式时跳过 URL 部分。

协作步骤与缺失时的回退：

| 步骤 | 协作插件 | 缺失时 |
| --- | --- | --- |
| 媒体 | media-library | 不下载附件，正文保留原链接 |
| 分类 | advanced-posts-list | 不导入分类 |
| 作者资料 | colorful-profiles | 仅导入用户名与邮箱；账号密码为随机生成 |

media-library 存在时，附件下载至 `uploads/<kind>s/Y/M/D`，正文中的媒体 URL 一并改写，包括 `-1024x896`、`-scaled` 变体。advanced-posts-list 存在时，分类导入 `apl_categories`，关联导入 `apl_post_categories`，置顶导入 `apl_post_options`。colorful-profiles 存在时，作者昵称同步至 `colorful_profiles`。

## 常见问题

**导入中断了怎么办？** 直接重试。`ifwp_media_map` 记录了已下载的媒体 URL 映射，重试自上次中断处继续，附件不会重复下载。

**会覆盖我现有的文章吗？** 遵循「保留现有、覆盖冲突」语义：同 slug 的文章被导入内容覆盖，无匹配 slug 的文章不受影响。

**导入期间访客能正常访问吗？** 访客看到的是普通维护页；仅发起导入的会话可见进度。导入过程中请勿重启或重新部署。

## 许可证

本项目以 GPL-3.0-or-later 许可发布，Copyright (C) 2026 Evarentha，完整文本见 [LICENSE](LICENSE)。
