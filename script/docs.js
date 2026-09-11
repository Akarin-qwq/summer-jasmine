/* docs.js — story.html 的 Markdown 目录查看器
 *
 * 纯函数部分（buildTree / renderMarkdown / flattenFiles）可直接在 Node 中 require，
 * 便于自动化测试；浏览器端的 DOM 初始化用 document 守卫隔离。
 *
 * 数据来源：docs-manifest.json（由 node build-docs.js 生成），
 * 或内联的 docs-data.js（同一脚本生成，便于离线/本地直接打开）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MdViewer = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_FILES = ['README.md', 'index.md', 'INDEX.md'];

  // 统一路径分隔符为 /
  function norm(p) {
    return String(p).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
  }

  // 自然排序：把文件名里的数字按“数值”比较，而不是逐字符比较。
  // 例：episode#9 会排在 episode#10 前面（直接用 localeCompare 会得到相反结果）。
  // 非数字部分按原有语言顺序比较，数字部分按大小比较（数值相同则前导零少的在前）。
  function naturalCompare(a, b) {
    const ax = String(a).match(/\d+|\D+/g) || [];
    const bx = String(b).match(/\d+|\D+/g) || [];
    const len = Math.max(ax.length, bx.length);
    for (let i = 0; i < len; i++) {
      const as = ax[i];
      const bs = bx[i];
      if (as === undefined) return -1;      // a 更短，排前面
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

  // 从文件名里提取日期，作为排序主键。
  // 支持：2025-08-31 / 2025.8.31 / 2025_08_31 / 2025/08/31 / 2025年8月31日 / 20250831
  // 取文件名里“最后一个”日期（日期在结尾），避免标题里出现年份时误判。
  // 返回可比较的 YYYYMMDD 数字；文件名里没有日期则返回 null。
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

  // 排序比较器：先按文件名里的日期（升序 / 早的在前），
  // 没有日期或日期相同，再退回自然顺序（集数按数值大小）。
  function compareNames(a, b) {
    const da = extractDateKey(a);
    const db = extractDateKey(b);
    if (da !== null && db !== null && da !== db) return da - db;
    return naturalCompare(a, b);
  }

  // 由相对路径数组构建目录树
  function buildTree(paths) {
    const rootNode = { name: '', type: 'dir', path: '', children: {} };
    for (const raw of paths || []) {
      const segments = norm(raw).split('/').filter(Boolean);
      let node = rootNode;
      let current = '';
      segments.forEach(function (seg, i) {
        current = current ? (current + '/' + seg) : seg;
        if (!node.children[seg]) {
          node.children[seg] = {
            name: seg,
            type: (i === segments.length - 1) ? 'file' : 'dir',
            path: current,
            children: {}
          };
        }
        node = node.children[seg];
      });
    }
    return sortChildren(rootNode);
  }

  // 目录在前、文件在后；文件先按文件名里的日期，再按自然顺序（见 compareNames）
  function sortChildren(node) {
    const entries = Object.keys(node.children || {}).map(function (k) {
      return [k, node.children[k]];
    });
    entries.sort(function (a, b) {
      const da = a[1].type === 'dir' ? 0 : 1;
      const db = b[1].type === 'dir' ? 0 : 1;
      if (da !== db) return da - db;
      return compareNames(a[0], b[0]);
    });
    entries.forEach(function (entry) {
      if (entry[1].type === 'dir') sortChildren(entry[1]);
    });
    const next = {};
    entries.forEach(function (entry) { next[entry[0]] = entry[1]; });
    node.children = next;
    return node;
  }

  // 展平出所有文件路径（有序）
  function flattenFiles(node, acc) {
    acc = acc || [];
    node.children = node.children || {};
    Object.keys(node.children).forEach(function (key) {
      const child = node.children[key];
      if (child.type === 'file') acc.push(child.path);
      else flattenFiles(child, acc);
    });
    return acc;
  }

  // 渲染 Markdown -> HTML（lib 可选，测试时传入）
  function renderMarkdown(text, lib) {
    const m = lib || (typeof marked !== 'undefined' ? marked : null);
    if (!m) throw new Error('marked 未加载');
    if (typeof m.setOptions === 'function') m.setOptions({ gfm: true, breaks: true });
    return m.parse ? m.parse(text) : m(text);
  }

  // 把正文里的相对图片/链接按 MD 文件所在目录解析
  function fixRelativeUrls(html, mdPath) {
    if (typeof DOMParser === 'undefined') return html;
    const base = mdPath.slice(0, mdPath.lastIndexOf('/') + 1);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const skip = /^(#|https?:|mailto:|tel:|data:|javascript:|\/\/|[a-z]+:)/i;
    ['img', 'a'].forEach(function (tag) {
      doc.querySelectorAll(tag + '[' + (tag === 'img' ? 'src' : 'href') + ']').forEach(function (el) {
        const attr = tag === 'img' ? 'src' : 'href';
        const url = el.getAttribute(attr);
        if (!url) return;
        if (skip.test(url)) return;
        // 相对路径：以 MD 文件所在目录为基准
        el.setAttribute(attr, (base + url).replace(/\/\.\//g, '/'));
      });
    });
    return doc.body.innerHTML;
  }

  // ---------- 浏览器端初始化 ----------
  function init(opts) {
    if (typeof document === 'undefined') return;
    const cfg = Object.assign({
      manifestPath: 'docs-manifest.json',
      container: '#content',
      treeEl: '#tree',
      searchEl: '#search',
      emptyEl: '#empty',
      defaultFiles: DEFAULT_FILES
    }, opts || {});

    // 记住页面原始标题，切换文档时只追加文档名，保持站点标题一致
    const baseTitle = document.title;
    const content = document.querySelector(cfg.container);
    const treeEl = document.querySelector(cfg.treeEl);
    const searchEl = document.querySelector(cfg.searchEl);
    const emptyEl = document.querySelector(cfg.emptyEl);
    if (!content || !treeEl) return;

    let files = [];
    let loadedPath = null;

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // 由文件名计算默认入口
    function defaultEntry() {
      const preferred = cfg.defaultFiles.map(function (d) { return d.toLowerCase(); });
      for (const f of files) {
        const name = f.split('/').pop().toLowerCase();
        if (preferred.indexOf(name) !== -1) return f;
      }
      return files[0] || null;
    }

    function currentPath() {
      const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
      return h || null;
    }

    // 渲染文件树。
    // level 从 1 起算：顶层目录（如 docs）默认展开，更深的子目录默认收起，
    // 只有点击文件夹、或选中其中的文件时才会展开（见 applyDefaultCollapse / setActive）。
    function renderList(node, level, hidden) {
      level = level || 1;
      const keys = Object.keys(node.children || {});
      return '<ul' + (hidden ? ' hidden' : '') + '>' + keys.map(function (key) {
        const child = node.children[key];
        if (child.type === 'file') {
          return '<li class="file"><a class="file-link" href="#' + encodeURIComponent(child.path) +
            '" data-path="' + escapeHtml(child.path) + '">' + escapeHtml(child.name) + '</a></li>';
        }
        const expanded = level === 1;   // 顶层目录默认展开
        return '<li class="dir' + (expanded ? ' open' : '') + '">' +
          '<button class="folder" type="button" data-path="' + escapeHtml(child.path) + '"' +
          ' aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
          '<span class="chev">▶</span><span>' + escapeHtml(child.name) + '</span></button>' +
          renderList(child, level + 1, !expanded) +
          '</li>';
      }).join('') + '</ul>';
    }

    function setActive(path) {
      const links = treeEl.querySelectorAll('a.file-link');
      let active = null;
      links.forEach(function (a) {
        const on = a.getAttribute('data-path') === path;
        a.classList.toggle('active', on);
        if (on) active = a;
      });
      // 展开父目录
      if (active) {
        let li = active.closest('li');
        while (li) {
          const dir = li.parentElement && li.parentElement.closest('li.dir');
          if (dir) { dir.classList.add('open'); const ul = dir.querySelector(':scope > ul'); if (ul) ul.hidden = false; }
          li = dir;
        }
      }
    }

    function load(path) {
      if (!path) return;
      loadedPath = path;
      if (emptyEl) emptyEl.hidden = true;
      const inline = (typeof window !== 'undefined') && window.MD_VIEWER_DATA;
      const contents = inline && inline.contents ? inline.contents : null;
      const hasInline = contents && Object.prototype.hasOwnProperty.call(contents, path);
      const promise = hasInline ? Promise.resolve(contents[path]) : fetch(path).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      });
      promise.then(function (text) {
        content.innerHTML = fixRelativeUrls(renderMarkdown(text), path);
        setActive(path);
        const name = path.split('/').pop();
        document.title = baseTitle ? (name.replace(/\.md$/i, '') + ' · ' + baseTitle)
                                   : name.replace(/\.md$/i, '');
      }).catch(function (err) {
        content.innerHTML = '<p class="error">加载文档失败：' + escapeHtml(path) +
          '（' + escapeHtml((err && err.message) || err) + '）</p>';
      });
    }

    function renderTree() {
      const tree = buildTree(files);
      treeEl.innerHTML = renderList(tree);
    }

    // 是否为顶层目录（没有更外层的 li.dir 祖先）
    function isTopLevelDir(li) {
      let p = li.parentElement;
      while (p) {
        if (p.tagName === 'LI' && p.classList.contains('dir')) return false;
        p = p.parentElement;
      }
      return true;
    }

    // 恢复默认折叠状态：顶层目录展开、其余子目录收起（清空搜索时调用）
    function applyDefaultCollapse() {
      treeEl.querySelectorAll('li').forEach(function (li) { li.hidden = false; });
      treeEl.querySelectorAll('li.dir').forEach(function (li) {
        const open = isTopLevelDir(li);
        li.classList.toggle('open', open);
        const ul = li.querySelector(':scope > ul');
        if (ul) ul.hidden = !open;
        const btn = li.querySelector(':scope > button.folder');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    function start() {
      renderTree();
      const target = currentPath();
      const entry = target && files.indexOf(target) !== -1 ? target : defaultEntry();
      load(entry);
      if (searchEl) attachSearch();
    }

    function attachSearch() {
      searchEl.addEventListener('input', function () {
        const q = searchEl.value.trim().toLowerCase();
        // 清空搜索：恢复默认折叠状态
        if (!q) { applyDefaultCollapse(); return; }
        const links = treeEl.querySelectorAll('a.file-link');
        links.forEach(function (a) {
          const name = (a.textContent || '').toLowerCase();
          const p = (a.getAttribute('data-path') || '').toLowerCase();
          const hit = name.indexOf(q) !== -1 || p.indexOf(q) !== -1;
          a.closest('li').hidden = !hit;
        });
        treeEl.querySelectorAll('li.dir').forEach(function (li) {
          const visibleFile = Array.prototype.slice.call(li.querySelectorAll('li.file'))
            .some(function (f) { return !f.hidden; });
          li.hidden = !visibleFile;
          if (visibleFile) {
            li.classList.add('open');
            const ul = li.querySelector(':scope > ul'); if (ul) ul.hidden = false;
            const btn = li.querySelector(':scope > button.folder');
            if (btn) btn.setAttribute('aria-expanded', 'true');
          }
        });
      });
    }

    // 目录折叠
    treeEl.addEventListener('click', function (ev) {
      const btn = ev.target.closest('button.folder');
      if (btn) {
        const li = btn.closest('li.dir');
        const ul = li.querySelector(':scope > ul');
        const open = li.classList.toggle('open');
        if (ul) ul.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });

    function applyFiles(list) {
      files = list.filter(function (f) { return /\.md$/i.test(f); });
      start();
    }

    function showManifestError(err) {
      const isFile = typeof location !== 'undefined' && location.protocol === 'file:';
      const reason = isFile
        ? '你直接双击打开了 index.html，浏览器禁止在 file:// 下 fetch 文件。'
        : '读取 docs-manifest.json 失败：' + escapeHtml((err && err.message) || err);
      content.innerHTML = '<p class="error">' + reason +
        ' 请先运行 <code>node build-docs.js</code> 生成清单，' +
        '再用任意本地服务器打开页面（不要直接双击）。</p>';
    }

    function initData() {
      const inline = (typeof window !== 'undefined') && window.MD_VIEWER_DATA;
      if (inline && Array.isArray(inline.files)) {
        applyFiles(inline.files);
        return;
      }
      fetch(cfg.manifestPath).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (data) {
        applyFiles(data.files || []);
      }).catch(showManifestError);
    }

    window.addEventListener('hashchange', function () {
      const p = currentPath();
      if (p && p !== loadedPath) load(p);
    });

    initData();
  }

  // 自动启动（浏览器）
  if (typeof document !== 'undefined') {
    const cfg = document.currentScript ? document.currentScript.dataset : {};
    const startOptions = cfg.manifestPath ? { manifestPath: cfg.manifestPath } : undefined;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { init(startOptions); });
    } else {
      init(startOptions);
    }
  }

  return {
    buildTree: buildTree,
    renderMarkdown: renderMarkdown,
    flattenFiles: flattenFiles,
    fixRelativeUrls: fixRelativeUrls,
    naturalCompare: naturalCompare,
    extractDateKey: extractDateKey,
    compareNames: compareNames
  };
}));
