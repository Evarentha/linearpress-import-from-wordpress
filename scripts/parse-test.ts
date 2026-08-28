/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 *
 * WXR 解析 + 区块转换冒烟脚本（开发用，不参与插件打包语义）。
 * 用法：cd base && npx tsx ../Plugins/import-from-wordpress/scripts/parse-test.ts [xml路径]
 */

import fs from 'node:fs';
import { convertWpContent } from '../src/blocks.js';
import { parseWxr, validateExport } from '../src/wxr.js';

const file = process.argv[2] ?? '/sdcard/Download/linearteam.WordPress.2026-08-26.xml';
const xml = fs.readFileSync(file, 'utf8');
console.log('XML 大小:', (xml.length / 1024).toFixed(1), 'KB');

const t0 = Date.now();
const parsed = parseWxr(xml);
console.log('解析耗时:', Date.now() - t0, 'ms');

const error = validateExport(parsed);
if (error) {
  console.error('=== 校验失败 ===', error);
  process.exit(1);
}

const types = new Map<string, number>();
for (const item of parsed.items) types.set(item.postType, (types.get(item.postType) ?? 0) + 1);
console.log('条目统计:', Object.fromEntries(types));
console.log('作者:', parsed.authors.length, '| 分类:', parsed.categories.length, '| 评论:', parsed.items.reduce((sum, i) => sum + i.comments.length, 0));
console.log('站点:', parsed.title, '|', parsed.link, '|', parsed.description);
try { console.log('主域名:', new URL(parsed.link).host); } catch { /* 忽略 */ }

// 区块转换：对最长内容与首篇普通文章做统计。
let longest = '';
let longestTitle = '';
for (const item of parsed.items) {
  if (item.contentEncoded.length > longest.length) { longest = item.contentEncoded; longestTitle = item.title; }
}
console.log('\n最长文章:', longestTitle, '(' + (longest.length / 1024).toFixed(1) + ' KB)');
const blockTypeCount = new Map<string, number>();
const blocks = convertWpContent(longest, new Map());
for (const block of blocks) blockTypeCount.set(block.type, (blockTypeCount.get(block.type) ?? 0) + 1);
console.log('区块统计:', Object.fromEntries(blockTypeCount));
const sampleText = longest.slice(0, 180).replace(/\n/g, ' ');
console.log('\n内容开头:', sampleText);

// 首篇 post 的转换结果
const firstPost = parsed.items.find((i) => i.postType === 'post');
if (firstPost) {
  console.log('\n=== 首篇文章「' + firstPost.title + '」区块 ===');
  for (const b of convertWpContent(firstPost.contentEncoded, new Map()).slice(0, 8)) {
    console.log(' -', b.type, JSON.stringify((b as { content?: string }).content ?? (b as { src?: string }).src ?? '').slice(0, 60));
  }
}
console.log('\nOK');