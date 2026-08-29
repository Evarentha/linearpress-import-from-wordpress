<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# 从 WordPress 导入（import-from-wordpress）

把 WordPress **WXR 导出 XML** 中的文章、媒体、用户、分类、评论与站点信息导入 LinearPress，
支持**保留现有、覆盖冲突**。

> 本仓库是 LinearPress 插件 **import-from-wordpress** 的独立开发仓库。插件即 Cordis 插件函数，即插即用、可停用可卸载。

## 插件化的优势

- **迁移不搬核心**：通过公开服务（`ctx.posts` / `ctx.users` / 媒体库等）写入数据，核心路由与数据表零改动。
- **与其它插件协作**：导入时会自动利用已安装的媒体库（拉取附件）、高级文章列表（分类）、多彩个人资料（作者资料）；未安装则优雅降级。
- **导入期间特殊维护模式**：不卸载/禁用任何插件，进度仅发起者可见，他人仍看到普通维护首页。

## 功能

- **文章与页面**：`post_type=post/page` 全部导入；Gutenberg 区块转换为 LinearPress 区块（paragraph/heading/blockquote/image/custom-html），不支持的区块转为段落文本或原样保留为 HTML。
- **媒体**：从原站点拉取附件存入媒体库（保留原发布日期），正文中的媒体引用自动重写；未装媒体库时仅保留原始链接。
- **用户**：按作者登录名创建/复用账号（随机密码哈希，仅归档不可登录）；装多彩个人资料时同步昵称等。
- **分类**：装高级文章列表时导入分类并关联。
- **评论**：已通过 → 已通过，其余 → 待审核，保留作者/邮箱/IP/时间。
- **站点信息**：名称/大小标题/描述/网址（autoDetect 或选择「自动配置」时跳过）。
- **浏览量/置顶**：`views` postmeta 导入浏览量；置顶同步到高级文章列表。

## 使用

1. WordPress 后台 → 工具 → 导出 → 全部内容，保存 XML。
2. LinearPress 后台 → 插件 →「从 WordPress 导入」→「导入 XML」。
3. 选择 XML、勾选选项、开始导入；完成后检查排版。

> 导入一旦开始无法中止（5~10 分钟，视内容量）；期间不要重启/部署站点；中断可重试续导。

## 安装

```bash
# 方式一：工作区同步
cd base && sh scripts/sync-plugins.sh import-from-wordpress

# 方式二：克隆到运行目录（目录名必须等于插件 id）
git clone <本仓库地址> src/plugins/import-from-wordpress
```

## 依赖插件（可选）

| 步骤 | 依赖插件 | 缺失时行为 |
| --- | --- | --- |
| 媒体导入 | `media-library` | 跳过拉取，仅保留原始链接 |
| 分类目录 | `advanced-posts-list` | 不导入分类 |
| 作者资料 | `colorful-profiles` | 仅导入用户名/邮箱/密码哈希 |

## 本地开发：怎么拉 / 怎么改 / 怎么跑

```bash
git clone <本仓库地址> LinearPress/Plugins/import-from-wordpress
cd LinearPress/base
npm install && npm run db:init
sh scripts/sync-plugins.sh import-from-wordpress
npm run dev
```

## 目录结构

```text
import-from-wordpress/
├── plugin.json            # Manifest
├── index.ts               # 入口：导入流程、进度会话、路由
├── src/
│   ├── wxr.ts             # WXR XML 解析
│   ├── importer.ts        # 导入主流程（文章/用户/评论/站点）
│   ├── blocks.ts          # Gutenberg 区块 → LinearPress 区块转换
│   ├── media.ts           # 附件拉取与媒体库写入
│   ├── progress.ts        # 进度存储与查询
│   └── constants.ts
└── views/admin/           # 导入页 / 进度页 / 占用提示页
```

## 贡献与发布

- conventional commits；提交前 `cd base && npm run typecheck`
- 版本：`git tag v1.0.0 && git push --tags`
- License：MIT（见仓库 LICENSE）