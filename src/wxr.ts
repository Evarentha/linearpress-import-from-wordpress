/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * WordPress WXR (eXtended RSS) 导出 XML 解析器。
 *
 * 无第三方依赖：WXR 是受控格式（CDATA 转义由 WP 导出器保证），使用
 * 逐标签定位 + CDATA 提取即可可靠解析，且能容忍标签顺序与空白差异。
 */

export interface WxrAuthor {
  id: number;
  login: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
}

export interface WxrCategory {
  termId: number;
  nicename: string;
  parent: string;
  name: string;
}

export interface WxrPostMeta {
  key: string;
  value: string;
}

export interface WxrComment {
  id: number;
  author: string;
  authorEmail: string;
  authorUrl: string;
  authorIp: string;
  date: string;
  dateGmt: string;
  content: string;
  approved: string;
  type: string;
  parent: number;
  userId: number;
}

export interface WxrItemCategory {
  domain: string;
  nicename: string;
  name: string;
}

export interface WxrItem {
  title: string;
  link: string;
  pubDate: string;
  creator: string;
  guid: string;
  contentEncoded: string;
  excerptEncoded: string;
  postId: number;
  postDate: string;
  postDateGmt: string;
  postModified: string;
  postModifiedGmt: string;
  commentStatus: string;
  pingStatus: string;
  postName: string;
  status: string;
  postParent: number;
  menuOrder: number;
  postType: string;
  postPassword: string;
  isSticky: number;
  attachmentUrl: string;
  categories: WxrItemCategory[];
  postmeta: WxrPostMeta[];
  comments: WxrComment[];
}

export interface WxrExport {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  language: string;
  baseSiteUrl: string;
  baseBlogUrl: string;
  wxrVersion: string;
  authors: WxrAuthor[];
  categories: WxrCategory[];
  items: WxrItem[];
}

/** 还原 WP 导出器对 CDATA 尾部 `]]>` 的转义（]]]]><![CDATA[>）。 */
export function decodeCdata(value: string): string {
  return value.replace(/\]\]\]><!\[CDATA\[>/g, ']]>').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_full, inner: string) => inner);
}

/** 提取 `<tag>…</tag>` 的内容：优先 CDATA，否则按纯文本（去除首尾空白）。 */
function inner(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<![CDATA[')) {
    const m = trimmed.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    return m ? decodeCdata(m[1]) : trimmed;
  }
  return trimmed;
}

/** 返回 XML 片段 text 中首次出现的 <tag>…</tag> 的内容（不存在返回 undefined）。 */
function field(text: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`<${escaped}>([\\s\\S]*?)</${escaped}>`));
  return m ? inner(m[1]) : undefined;
}

/** 带属性的标签（如 <guid isPermaLink="false">）。 */
function fieldAttr(text: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`));
  return m ? inner(m[1]) : undefined;
}

/** 数字字段安全转换。 */
const num = (value: string | undefined, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** 连续切分 `<open>…</close>` 块（同一层级，不含嵌套）。 */
function splitBlocks(text: string, open: string, close: string): string[] {
  const out: string[] = [];
  let from = 0;
  while (true) {
    const start = text.indexOf(open, from);
    if (start === -1) break;
    const end = text.indexOf(close, start);
    if (end === -1) break;
    out.push(text.slice(start + open.length, end));
    from = end + close.length;
  }
  return out;
}

function parseAuthor(block: string): WxrAuthor {
  return {
    id: num(field(block, 'wp:author_id')),
    login: field(block, 'wp:author_login') ?? '',
    email: field(block, 'wp:author_email') ?? '',
    displayName: field(block, 'wp:author_display_name') ?? '',
    firstName: field(block, 'wp:author_first_name') ?? '',
    lastName: field(block, 'wp:author_last_name') ?? ''
  };
}

function parseCategoryBlock(block: string): WxrCategory {
  return {
    termId: num(field(block, 'wp:term_id')),
    nicename: field(block, 'wp:category_nicename') ?? '',
    parent: field(block, 'wp:category_parent') ?? '',
    name: field(block, 'wp:cat_name') ?? ''
  };
}

function parseComment(block: string): WxrComment {
  return {
    id: num(field(block, 'wp:comment_id')),
    author: field(block, 'wp:comment_author') ?? '',
    authorEmail: field(block, 'wp:comment_author_email') ?? '',
    authorUrl: field(block, 'wp:comment_author_url') ?? '',
    authorIp: field(block, 'wp:comment_author_IP') ?? '',
    date: field(block, 'wp:comment_date') ?? '',
    dateGmt: field(block, 'wp:comment_date_gmt') ?? '',
    content: field(block, 'wp:comment_content') ?? '',
    approved: field(block, 'wp:comment_approved') ?? '0',
    type: field(block, 'wp:comment_type') ?? 'comment',
    parent: num(field(block, 'wp:comment_parent')),
    userId: num(field(block, 'wp:comment_user_id'))
  };
}

function parseItem(block: string): WxrItem {
  const itemCategories: WxrItemCategory[] = [];
  // <category domain="category" nicename="uncategorized"><![CDATA[未分类]]></category>
  const categoryTagRe = /<category\b([^>]*)>([\s\S]*?)<\/category>/g;
  let cm: RegExpExecArray | null;
  while ((cm = categoryTagRe.exec(block)) !== null) {
    const attrs = cm[1];
    const domain = /domain\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
    const nicename = /nicename\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
    itemCategories.push({ domain, nicename, name: inner(cm[2]) });
  }

  const postmeta = splitBlocks(block, '<wp:postmeta>', '</wp:postmeta>').map((meta) => ({
    key: field(meta, 'wp:meta_key') ?? '',
    value: field(meta, 'wp:meta_value') ?? ''
  }));

  const comments = splitBlocks(block, '<wp:comment>', '</wp:comment>').map(parseComment);

  return {
    title: field(block, 'title') ?? '',
    link: field(block, 'link') ?? '',
    pubDate: field(block, 'pubDate') ?? '',
    creator: field(block, 'dc:creator') ?? '',
    guid: fieldAttr(block, 'guid') ?? '',
    contentEncoded: field(block, 'content:encoded') ?? '',
    excerptEncoded: field(block, 'excerpt:encoded') ?? '',
    postId: num(field(block, 'wp:post_id')),
    postDate: field(block, 'wp:post_date') ?? '',
    postDateGmt: field(block, 'wp:post_date_gmt') ?? '',
    postModified: field(block, 'wp:post_modified') ?? '',
    postModifiedGmt: field(block, 'wp:post_modified_gmt') ?? '',
    commentStatus: field(block, 'wp:comment_status') ?? '',
    pingStatus: field(block, 'wp:ping_status') ?? '',
    postName: field(block, 'wp:post_name') ?? '',
    status: field(block, 'wp:status') ?? '',
    postParent: num(field(block, 'wp:post_parent')),
    menuOrder: num(field(block, 'wp:menu_order')),
    postType: field(block, 'wp:post_type') ?? '',
    postPassword: field(block, 'wp:post_password') ?? '',
    isSticky: num(field(block, 'wp:is_sticky')),
    attachmentUrl: field(block, 'wp:attachment_url') ?? '',
    categories: itemCategories,
    postmeta,
    comments
  };
}

/** 解析完整 WXR 文档。未知 / 异常片段会被跳过，不会中断整体解析。 */
export function parseWxr(xml: string): WxrExport {
  // channel 头部：首个 <item> 之前（含站点级 title/link/description/base_*）。
  const firstItem = xml.indexOf('<item>');
  const head = firstItem === -1 ? xml : xml.slice(0, firstItem);

  const items = splitBlocks(xml, '<item>', '</item>').map(parseItem);
  const authors = splitBlocks(xml, '<wp:author>', '</wp:author>').map(parseAuthor);
  const categories = splitBlocks(xml, '<wp:category>', '</wp:category>').map(parseCategoryBlock);

  // <image> 块（站点图标），取 url 即可。
  const imageBlock = splitBlocks(xml, '<image>', '</image>')[0];
  const imageUrl = imageBlock === undefined ? '' : field(imageBlock, 'url') ?? '';

  return {
    title: field(head, 'title') ?? '',
    link: field(head, 'link') ?? '',
    description: field(head, 'description') ?? '',
    pubDate: field(head, 'pubDate') ?? '',
    language: field(head, 'language') ?? '',
    baseSiteUrl: field(head, 'wp:base_site_url') ?? '',
    baseBlogUrl: field(head, 'wp:base_blog_url') ?? '',
    wxrVersion: field(head, 'wp:wxr_version') ?? '',
    authors,
    categories,
    items
  };
}

/** 解析后做基础完整性校验，返回人类可读错误（无错误返回 null）。 */
export function validateExport(parsed: WxrExport): string | null {
  if (!parsed.items.length) return '导出文件中没有找到任何文章/页面条目（<item>）。';
  if (!parsed.title && !parsed.link) return '未能解析站点信息（<channel> 头部）。';
  return null;
}

/** 规范化 WP 日期（YYYY-MM-DD HH:MM:SS）→ 同样的可排序文本；无效输入保留原样。 */
export function normalizeWpDate(value: string): string {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : value.trim();
}

/** 站点主域名（来自 channel link / base_site_url，去除协议与尾部斜杠）。 */
export function siteHost(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const firstSlash = withoutProtocol.indexOf('/');
  return (firstSlash === -1 ? withoutProtocol : withoutProtocol.slice(0, firstSlash)).trim();
}