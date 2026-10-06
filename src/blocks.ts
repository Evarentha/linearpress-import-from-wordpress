/*
 * Gutenberg-to-LinearPress Block Converter
 *
 * Converts WordPress Gutenberg block markup into LinearPress block structures.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Gutenberg block → LinearPress block converter.
 *
 * Conversion strategy (mapped to the import requirements):
 * <ul>
 * <li>paragraph → paragraph (plain text) / custom-html (kept as-is when it contains links or
 * other rich text)</li>
 * <li>heading → heading (h1-h6 collapsed to the 1-3 levels LinearPress supports)</li>
 * <li>quote → blockquote (plain text) / custom-html (rich text)</li>
 * <li>image → image (src/alt; media links are rewritten)</li>
 * <li>verse → paragraph (text)</li>
 * <li>everything else (code/html/shortcode/list/gallery/audio/video/mdx/…) → custom-html kept
 * as-is</li>
 * <li>Media URL rewriting: imported media-library files replace the original WP links
 * (including -WxH/-scaled variants).</li>
 * </ul>
 *
 * <p>Node content is kept in parts (text strings interleaved with child nodes) and serialized
 * back to HTML in the original order, preserving the full structure of nested children such as
 * `<ul>…<li>…</li></ul>` embedded inside an outer tag.</p>
 *
 * @since 1.0.0
 */

import type { Block } from '../../../types/index.js';

/** WordPress 原图 URL 与导入后媒体库 URL 的映射（old → new）。 */
export type MediaUrlMap = ReadonlyMap<string, string>;

type Part = string | WpNode;

interface WpNode {
  name: string;
  attrs: string;
  selfClose: boolean;
  parts: Part[];
}

const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'span', 'br', 'code', 'mark', 'sub', 'sup', 'small']);
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
/** 常见图片尺寸变体后缀：-300x200 / -scaled / -e123。 */
const VARIANT_SUFFIX = /-(\d{2,4}x\d{2,4}|scaled|e\d+)(\.[a-zA-Z0-9]+)$/i;

/** 去掉尺寸变体后缀得到基名（如 xxx-1024x896.jpg → xxx.jpg）。 */
function variantBase(url: string): string {
  const m = url.match(VARIANT_SUFFIX);
  return m ? url.slice(0, m.index) + m[2] : url;
}

function tryDecode(url: string): string {
  try {
    const decoded = decodeURIComponent(url);
    return decoded === url ? '' : decoded;
  } catch {
    return '';
  }
}

/** 解析 <img>/<audio>/<video> 属性片段里的 src/alt。 */
function attributesOf(tag: string): { src?: string; alt?: string } {
  const src = /src\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  return { src, alt };
}

/** HTML → 纯文本（保留换行，供 paragraph/heading/blockquote 内容）。 */
function textContent(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 是否为仅含简单内联标记的纯文本（可安全转换为 paragraph/blockquote）。 */
function isPlainInline(html: string): boolean {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (!INLINE_TAGS.has(m[1].toLowerCase())) return false;
  }
  return true;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

/** 单个 URL 重写：依次尝试原链接、解码/编码形式、去变体后缀的基名。 */
function rewriteUrl(url: string, map: MediaUrlMap): string {
  const candidates = [url];
  const decoded = tryDecode(url);
  if (decoded) candidates.push(decoded);
  const base = variantBase(url);
  if (base !== url) candidates.push(base);
  if (decoded) {
    const base2 = variantBase(decoded);
    if (base2 !== decoded && base2 !== base) candidates.push(base2);
  }
  for (const candidate of candidates) {
    const hit = map.get(candidate);
    if (hit) return hit;
  }
  return url;
}

/** 重写 HTML 中出现的全部已知媒体 URL。 */
function rewriteHtml(html: string, map: MediaUrlMap): string {
  if (!map.size || !html) return html;
  return html.replace(URL_PATTERN, (url) => {
    // 去掉结尾可能被误并入的标点后再尝试匹配；未命中则原样返回。
    const cleaned = url.replace(/[),.;:!?]+$/g, '');
    if (cleaned === url) return rewriteUrl(url, map);
    const rewritten = rewriteUrl(cleaned, map);
    const punctuation = url.slice(cleaned.length);
    return rewritten === cleaned ? url : rewritten + punctuation;
  });
}

/** 将节点与子节点按原顺序序列化为 HTML。 */
function serializeNode(node: WpNode): string {
  return node.parts.map((part) => (typeof part === 'string' ? part : serializeNode(part))).join('');
}

/** 节点原始 HTML（不含子节点序列化，仅纯文本片段）。 */
function textParts(node: WpNode): string {
  return node.parts.map((part) => (typeof part === 'string' ? part : '')).join('');
}

function mapNode(node: WpNode, map: MediaUrlMap): Block[] {
  const name = node.name;
  const innerHtml = node.parts.map((part) => (typeof part === 'string' ? part : serializeNode(part))).join('');
  const fullHtml = rewriteHtml(serializeNode(node), map);

  if (name === 'paragraph') {
    // 去掉 <p> 包装后判断是否为纯文本段落。
    const inner = innerHtml.match(/^\s*<p\b[^>]*>([\s\S]*?)<\/p\s*>\s*$/i)?.[1] ?? innerHtml;
    const candidate = decodeEntities(inner.trim());
    if (candidate && isPlainInline(candidate)) return [{ type: 'paragraph', content: textContent(candidate) }];
    const html = rewriteHtml(innerHtml, map).trim();
    return html ? [{ type: 'custom-html', content: html }] : [];
  }

  if (name === 'heading') {
    const wrapped = /^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>\s*$/i.exec(innerHtml);
    const content = wrapped ? textContent(wrapped[2]) : textContent(innerHtml);
    if (!content) return [];
    const level = Math.max(1, Math.min(3, wrapped ? Number(wrapped[1]) : headingLevel(innerHtml)));
    return [{ type: 'heading', level: level as 1 | 2 | 3, content }];
  }

  if (name === 'quote') {
    const inner = innerHtml.match(/^\s*<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>\s*$/i)?.[1] ?? innerHtml;
    const text = textContent(inner);
    if (text && isPlainInline(inner) && inner.length < 2000) return [{ type: 'blockquote', content: text }];
    return fullHtml.trim() ? [{ type: 'custom-html', content: fullHtml }] : [];
  }

  if (name === 'image') {
    const imgTag = innerHtml.match(/<img\b[^>]*>/i)?.[0] ?? '';
    if (imgTag) {
      const { src, alt } = attributesOf(imgTag);
      if (src) return [{ type: 'image', src: rewriteHtml(src, map), alt: alt ?? '' }];
    }
    return fullHtml.trim() ? [{ type: 'custom-html', content: fullHtml }] : [];
  }

  if (name === 'verse') {
    const text = textContent(innerHtml);
    return text ? [{ type: 'paragraph', content: text }] : [];
  }

  if (name === 'code' || name === 'html') {
    return fullHtml.trim() ? [{ type: 'custom-html', content: fullHtml }] : [];
  }

  if (name === 'shortcode') {
    const raw = rewriteHtml(textParts(node), map).trim();
    return raw ? [{ type: 'custom-html', content: raw }] : [];
  }

  // audio/video/gallery/list/… 及 mdx/* 等未知区块：custom-html 原样保留。
  return fullHtml.trim() ? [{ type: 'custom-html', content: fullHtml }] : [];
}

/** 解析 heading 级别：取 h1..h6。 */
function headingLevel(html: string): number {
  const m = html.match(/<h([1-6])\b/i);
  return m ? Number(m[1]) : 2;
}

/** Gutenberg 内容 → LinearPress Block[]。 */
export function convertWpContent(content: string, mediaMap: MediaUrlMap): Block[] {
  // 1) 分词：块注释 + 文本段。attrs 可能包含 '>'（JSON 内容），因此匹配到第一个 '-->' 为止。
  const TOKEN_RE = /<!--\s*(\/?)\s*wp:([a-zA-Z0-9_./-]+)([\s\S]*?)-->/g;
  type Token = { kind: 'open' | 'close' | 'text'; name?: string; attrs?: string; text?: string };
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(content)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', text: content.slice(last, m.index) });
    if (m[1] === '/') {
      tokens.push({ kind: 'close', name: m[2] });
    } else {
      const tail = m[3] ?? '';
      const selfClose = tail.trimEnd().endsWith('/');
      tokens.push({
        kind: 'open',
        name: m[2],
        attrs: selfClose ? tail.replace(/\/\s*$/, '').trim() : tail.trim(),
        text: selfClose ? 'self' : undefined
      });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) tokens.push({ kind: 'text', text: content.slice(last) });

  // 2) 建树：parts 按 token 原顺序交错保存文本与子节点。
  const root: WpNode[] = [];
  const stack: WpNode[] = [];
  for (const token of tokens) {
    if (token.kind === 'open' && token.name) {
      const node: WpNode = { name: token.name, attrs: token.attrs ?? '', selfClose: token.text === 'self', parts: [] };
      if (stack.length) stack[stack.length - 1].parts.push(node);
      else root.push(node);
      if (!node.selfClose) stack.push(node);
    } else if (token.kind === 'close' && stack.length) {
      stack.pop();
    } else if (token.kind === 'text' && token.text) {
      if (stack.length) stack[stack.length - 1].parts.push(token.text);
      else root.push({ name: 'text', attrs: '', selfClose: false, parts: [token.text] });
    }
  }

  // 3) 映射。
  const blocks: Block[] = [];
  for (const node of root) {
    if (node.name === 'text') {
      const html = rewriteHtml(textParts(node), mediaMap).trim();
      if (html) blocks.push({ type: 'custom-html', content: html });
      continue;
    }
    for (const block of mapNode(node, mediaMap)) blocks.push(block);
  }
  if (!blocks.length && content.trim()) blocks.push({ type: 'custom-html', content: rewriteHtml(content, mediaMap) });
  return blocks;
}