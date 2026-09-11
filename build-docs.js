#!/usr/bin/env node
/* build-docs.js — 为 story.html（md 浏览页）生成文档清单
 *
 * 用法（在站点根目录执行）：
 *   node build-docs.js [内容目录，默认 docs]
 *
 * 会输出两个文件（都相对站点根目录）：
 *   docs-manifest.json —— 文档路径清单（服务器环境下由 docs.js fetch 读取）
 *   docs-data.js       —— 清单 + 所有文档正文的内联版本（供离线/本地直接打开）
 *
 * 说明：浏览器无法直接列出目录，所以新增/删除 .md 后需要重新运行本脚本。
 * 路径一律使用 / 分隔，相对站点根目录（例如 "docs/index.md"）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 站点根目录 = 本脚本所在目录，保证在任意工作目录下执行结果都一致
const SITE_DIR = path.dirname(__filename);
const DOCS_DIR = process.argv[2] || 'docs';
const root = path.resolve(SITE_DIR, DOCS_DIR);

if (!fs.existsSync(root)) {
  console.error('目录不存在：' + DOCS_DIR);
  process.exit(1);
}

// 自然排序：数字按数值比较，保证 episode#9 排在 episode#10 前面
// （必须与 script/docs.js 里的 naturalCompare 保持一致）
function naturalCompare(a, b) {
  const ax = String(a).match(/\d+|\D+/g) || [];
  const bx = String(b).match(/\d+|\D+/g) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const as = ax[i];
    const bs = bx[i];
    if (as === undefined) return -1;
    if (bs === undefined) return 1;
    if (/^\d/.test(as) && /^\d/.test(bs)) {
      const diff = parseInt(as, 10) - parseInt(bs, 10);
      if (diff !== 0) return diff;
      if (as.length !== bs.length) return as.length - bs.length;
    } else {
      const diff = as.localeCompare(bs);
      if (diff !== 0) return diff;
    }
  }
  return 0;
}

// 从文件名里提取日期（YYYYMMDD），没有则返回 null。
// 支持 2025-08-31 / 2025.8.31 / 2025_08_31 / 2025/08/31 / 2025年8月31日 / 20250831
// 取文件名里“最后一个”日期（日期在结尾），避免标题里出现年份时误判。
// 必须与 script/docs.js 里的实现保持一致。
function extractDateKey(name) {
  const s = String(name);
  const re = /(20\d{2})\s*[-._/年]\s*(\d{1,2})\s*[-._/月]\s*(\d{1,2})/g;
  let m, last = null;
  while ((m = re.exec(s)) !== null) {
    last = m;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last) return Number(last[1]) * 10000 + Number(last[2]) * 100 + Number(last[3]);
  const re2 = /(20\d{2})(\d{2})(\d{2})/g;
  let n, last2 = null;
  while ((n = re2.exec(s)) !== null) {
    last2 = n;
    if (n.index === re2.lastIndex) re2.lastIndex++;
  }
  if (last2) return Number(last2[1]) * 10000 + Number(last2[2]) * 100 + Number(last2[3]);
  return null;
}

// 排序：先按文件名里的日期升序，再按自然顺序（集数）
function compareNames(a, b) {
  const da = extractDateKey(a);
  const db = extractDateKey(b);
  if (da !== null && db !== null && da !== db) return da - db;
  return naturalCompare(a, b);
}

// 递归收集 .md（按名称排序，保持稳定顺序）
const relFiles = [];
(function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort(function (a, b) { return compareNames(a.name, b.name); });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      relFiles.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
})(root);
relFiles.sort(function (a, b) { return compareNames(a, b); });

// 站点根目录下的相对前缀（例如 "docs"）
const prefix = path.relative(SITE_DIR, root).split(path.sep).join('/') || '.';
const files = relFiles.map(function (r) { return prefix === '.' ? r : prefix + '/' + r; });

const manifest = {
  root: DOCS_DIR,
  generatedAt: new Date().toISOString(),
  files: files
};

// 内联正文，方便 file:// 直接打开（file:// 下不允许 fetch）
const contents = {};
relFiles.forEach(function (r, i) {
  contents[files[i]] = fs.readFileSync(path.join(root, r), 'utf8');
});

fs.writeFileSync(
  path.join(SITE_DIR, 'docs-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);
fs.writeFileSync(
  path.join(SITE_DIR, 'docs-data.js'),
  '/* 自动生成，勿手改：node build-docs.js ' + DOCS_DIR + ' */\n' +
    'window.MD_VIEWER_DATA = ' + JSON.stringify(Object.assign({}, manifest, { contents: contents }), null, 2) + ';\n'
);

console.log('已生成 docs-manifest.json 与 docs-data.js（' + files.length + ' 个文件）');
