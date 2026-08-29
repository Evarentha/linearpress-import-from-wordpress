<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# 从 WordPress 导入 · Import from WordPress

Import posts, media, users, categories, comments and site info from a **WordPress WXR export XML** into LinearPress — keeping existing data, overwriting conflicts.

把 WordPress **WXR 导出 XML** 中的文章、媒体、用户、分类、评论与站点信息导入 LinearPress，支持**保留现有、覆盖冲突**。

> Independent plugin repository for LinearPress **import-from-wordpress**. A plugin is a Cordis plugin function — install on demand, disable/uninstall cleanly.
> 本仓库是 LinearPress 插件 **import-from-wordpress** 的独立仓库。

## Why Plugins? / 插件化的优势

- **Migrate without touching core** —— writes via public services（`ctx.posts` / `ctx.users` / media library）; core routes and tables are untouched.
  **迁移不搬核心**——通过公开服务写入，核心零改动。
- **Collaborates with other plugins** —— uses installed media-library（pull attachments）、advanced-posts-list（categories）、colorful-profiles（author profiles）; degrades gracefully.
  **与其它插件协作**——自动利用已装插件，未装则优雅降级。
- **Special maintenance mode** —— doesn't disable plugins; progress only visible to the initiator.
  **导入期间特殊维护模式**——不卸载任何插件。

## Features / 功能

- **Posts & pages / 文章与页面**：Gutenberg blocks → LinearPress blocks（paragraph/heading/blockquote/image/custom-html）; unsupported blocks keep as plain text/HTML.
- **Media / 媒体**：pull attachments into the media library（keeping original dates）; rewrite in-post references; without media-library only original links are kept.
- **Users / 用户**：create/reuse by login（random password hash, archived account）; sync nicknames when colorful-profiles installed.
- **Categories / 分类**：imported when advanced-posts-list installed.
- **Comments / 评论**：approved stay approved, others pending; keep author/email/IP/time.
- **Site info / 站点信息**：name/subtitles/description/URL（skipped in auto-detect mode）.
- **Views & sticky / 浏览量与置顶**：`views` postmeta imported; sticky syncs to advanced-posts-list.

## Usage / 使用

1. WordPress → Tools → Export → All content → save XML.
2. LinearPress admin → Plugins →「从 WordPress 导入」→「导入 XML」.
3. Select XML, choose options, start. Check layout afterwards.

> Import cannot be aborted（5–10 min typically）；don't restart/redeploy during import（can resume）.

## Install / 安装

```bash
# Option 1 — workspace sync（工作区同步）
cd base && sh scripts/sync-plugins.sh import-from-wordpress

# Option 2 — clone into runtime dir（目录名必须等于插件 id）
git clone https://github.com/Evarentha/linearpress-import-from-wordpress src/plugins/import-from-wordpress
```

## Optional Dependencies / 依赖插件（可选）

| Step / 步骤 | Plugin / 依赖 | Without it / 缺失时 |
| --- | --- | --- |
| Media / 媒体 | `media-library` | skip fetching, keep original links |
| Categories / 分类 | `advanced-posts-list` | no categories |
| Author profiles / 作者资料 | `colorful-profiles` | username/email/hash only |

## Local Development / 本地开发：怎么拉 / 怎么改 / 怎么跑

```bash
git clone https://github.com/Evarentha/linearpress-import-from-wordpress LinearPress/Plugins/import-from-wordpress
cd LinearPress/base
npm install && npm run db:init
sh scripts/sync-plugins.sh import-from-wordpress
npm run dev
```

## Directory / 目录结构

```text
import-from-wordpress/
├── plugin.json            Manifest
├── index.ts               entry：import flow, progress session, routes
├── src/
│   ├── wxr.ts             WXR XML parser
│   ├── importer.ts        main import flow
│   ├── blocks.ts          Gutenberg → LinearPress block conversion
│   ├── media.ts           attachment fetching
│   ├── progress.ts        progress storage
│   └── constants.ts
└── views/admin/           import / progress / occupied pages
```

## Contribute & Release / 贡献与发布

- conventional commits；`cd base && npm run typecheck` before commit
- Version：`git tag v1.0.0 && git push --tags`
- License：MIT（LICENSE）