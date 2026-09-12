/* =========================
   画廊页面（gallery.html）

   - 图片统一放在 gallery 文件夹里，默认按 1、2、3… 的序号自动读取
     （1.jpg、2.png、3.webp… 后缀不限，缺号会自动跳过，连续 6 个号都没有就停止）
   - 想自定义顺序时，把文件名写进下面的 GALLERY_FILES 即可
   - 电脑端：Pinterest 风格瀑布流，鼠标经过时图片放大并跟随鼠标浮动
   - 手机端：两列瀑布流，点击图片放大查看，可左右滑动切换
   ========================= */

const GALLERY_FOLDER = "gallery/";

/* 自定义顺序：例如 ["封面.jpg", "截图1.png", "截图2.jpg"]，留空则自动扫描 */
const GALLERY_FILES = [];

/* 自动扫描用到的参数 */
const AUTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif"];
const AUTO_MAX_INDEX = 300;
const AUTO_MISS_LIMIT = 6;

/* 每列的大致宽度，用来计算电脑端排几列 */
const TARGET_COLUMN_WIDTH = 320;
const MAX_COLUMNS = 6;
const DESKTOP_GAP = 18;
const MOBILE_GAP = 10;

const LANG = localStorage.getItem("language") || "zh-CN";

const LABELS = {
    "zh-CN": { alt: "画廊图片", view: "查看大图", close: "关闭", prev: "上一张", next: "下一张" },
    "zh-TW": { alt: "畫廊圖片", view: "檢視大圖", close: "關閉", prev: "上一張", next: "下一張" },
    "en": { alt: "Gallery image", view: "View larger", close: "Close", prev: "Previous", next: "Next" },
    "jp": { alt: "ギャラリー画像", view: "拡大表示", close: "閉じる", prev: "前へ", next: "次へ" }
};

const label = LABELS[LANG] || LABELS["zh-CN"];

const board = document.getElementById("galleryBoard");
const loadingTip = document.getElementById("galleryLoading");
const emptyTip = document.getElementById("galleryEmpty");

const viewer = document.getElementById("galleryViewer");
const viewerImage = document.getElementById("galleryViewerImage");
const viewerCounter = document.getElementById("viewerCounter");
const viewerClose = document.getElementById("viewerClose");
const viewerPrev = document.getElementById("viewerPrev");
const viewerNext = document.getElementById("viewerNext");

const hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const mobileQuery = window.matchMedia("(max-width: 768px)");

let items = [];
let cards = [];
let columns = [];
let currentIndex = 0;
let closeTimer = null;
let lastFocus = null;
let relayoutTimer = null;
let layoutVersion = 0;   /* 每次重新排布就 +1，用来让卡片重新测量自己的位置 */

/* =========================
   读取 gallery 文件夹里的图片
   ========================= */

/* 试着加载一张图片，拿到它的原始尺寸；不存在就返回 null */
function loadImage(src) {
    return new Promise(resolve => {
        const probe = new Image();
        probe.decoding = "async";

        probe.onload = () => {
            resolve(probe.naturalWidth
                ? { src: src, width: probe.naturalWidth, height: probe.naturalHeight }
                : null);
        };

        probe.onerror = () => resolve(null);

        probe.src = src;
    });
}

/* 一个序号可能有好几种后缀，逐个试一下 */
async function probeIndex(index) {
    const lower = AUTO_EXTENSIONS.map(ext => loadImage(`${GALLERY_FOLDER}${index}.${ext}`));
    const hit = (await Promise.all(lower)).find(Boolean);
    if (hit) return hit;

    const upper = AUTO_EXTENSIONS.map(ext => loadImage(`${GALLERY_FOLDER}${index}.${ext.toUpperCase()}`));
    return (await Promise.all(upper)).find(Boolean) || null;
}

/* onFound：每找到一张就回调一次，页面可以先显示已经读到的图片 */
async function collectImages(onFound) {
    if (GALLERY_FILES.length > 0) {
        const found = [];

        for (const name of GALLERY_FILES) {
            const item = await loadImage(GALLERY_FOLDER + String(name).trim());

            if (item) {
                found.push(item);
                if (onFound) onFound(item);
            }
        }

        return found;
    }

    const found = [];
    let missing = 0;

    for (let index = 1; index <= AUTO_MAX_INDEX && missing < AUTO_MISS_LIMIT; index++) {
        const hit = await probeIndex(index);

        if (hit) {
            found.push(hit);
            missing = 0;
            if (onFound) onFound(hit);
        }
        else {
            missing++;
        }
    }

    return found;
}

/* =========================
   生成卡片
   ========================= */

function createCard(item, index) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card";
    card.setAttribute("aria-label", `${label.view}：${label.alt} ${index + 1}`);

    const img = document.createElement("img");
    img.src = item.src;
    img.width = item.width;
    img.height = item.height;
    img.alt = `${label.alt} ${index + 1}`;
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;

    card.appendChild(img);
    card.addEventListener("click", () => openViewer(index));

    attachFloat(card);

    return card;
}

/* =========================
   电脑端：鼠标经过时卡片浮起，鼠标所在的角落被按下去
   ========================= */

function attachFloat(card) {
    if (!hoverCapable) return;

    const MAX_TILT = 12;      /* 最大倾斜角度 */
    const LIFT = 28;          /* 浮起高度 */
    const HOVER_SCALE = 1.04; /* 浮起时整体放大一点 */
    const DAMPING = 0.16;     /* 数值越大跟得越紧 */

    const target = { tiltX: 0, tiltY: 0, lift: 0, scale: 1 };
    const current = { tiltX: 0, tiltY: 0, lift: 0, scale: 1 };
    const keys = Object.keys(target);

    let baseRect = null;     /* 卡片没有倾斜时的位置，用来算鼠标相对卡片的位置 */
    let baseScrollY = 0;
    let measuredVersion = -1;
    let frame = null;

    function measure() {
        const previous = card.style.transform;

        card.style.transform = "none";
        baseRect = card.getBoundingClientRect();
        baseScrollY = window.scrollY;
        card.style.transform = previous;
    }

    function apply() {
        card.style.transform =
            "perspective(900px) " +
            `rotateX(${current.tiltX.toFixed(2)}deg) ` +
            `rotateY(${current.tiltY.toFixed(2)}deg) ` +
            `translateZ(${current.lift.toFixed(2)}px) ` +
            `scale(${current.scale.toFixed(3)})`;
    }

    function render() {
        keys.forEach(key => {
            current[key] += (target[key] - current[key]) * DAMPING;
        });

        const settled = keys.every(key => Math.abs(target[key] - current[key]) < 0.05);

        if (settled) {
            keys.forEach(key => {
                current[key] = target[key];
            });
        }

        apply();

        if (settled) {
            frame = null;
            return;
        }

        frame = requestAnimationFrame(render);
    }

    function play() {
        if (frame === null) {
            frame = requestAnimationFrame(render);
        }
    }

    card.addEventListener("pointerenter", event => {
        if (event.pointerType !== "mouse") return;

        measure();
        card.classList.add("is-floating");
        play();
    });

    card.addEventListener("pointermove", event => {
        if (event.pointerType !== "mouse") return;

        if (baseRect === null || measuredVersion !== layoutVersion) {
            measure();
            measuredVersion = layoutVersion;
        }

        /* 页面滚动时卡片在视口里的位置会变，对齐一下 */
        const top = baseRect.top - (window.scrollY - baseScrollY);

        /* 鼠标相对卡片中心的位置，范围 -1 ~ 1 */
        const offsetX = Math.max(-1, Math.min(1,
            (event.clientX - (baseRect.left + baseRect.width / 2)) / (baseRect.width / 2)));
        const offsetY = Math.max(-1, Math.min(1,
            (event.clientY - (top + baseRect.height / 2)) / (baseRect.height / 2)));

        /* 鼠标靠右 → 右边压下去；鼠标靠下 → 下边压下去，对角则翘起来 */
        target.tiltY = offsetX * MAX_TILT;
        target.tiltX = -offsetY * MAX_TILT;
        target.lift = LIFT;
        target.scale = HOVER_SCALE;

        play();
    });

    function reset() {
        target.tiltX = 0;
        target.tiltY = 0;
        target.lift = 0;
        target.scale = 1;
        card.classList.remove("is-floating");
        play();
    }

    card.addEventListener("pointerleave", reset);
    card.addEventListener("pointercancel", reset);
    card.addEventListener("blur", reset);
}

/* =========================
   交错排布（瀑布流）
   ========================= */

function gapSize() {
    return mobileQuery.matches ? MOBILE_GAP : DESKTOP_GAP;
}

function columnCount() {
    /* 手机端固定两列 */
    if (mobileQuery.matches) return 2;

    const width = board.clientWidth || window.innerWidth;
    const gap = gapSize();
    const count = Math.round((width + gap) / (TARGET_COLUMN_WIDTH + gap));

    return Math.max(2, Math.min(MAX_COLUMNS, count));
}

/* 立即跳到指定位置（绕过 html 上的 scroll-behavior: smooth，避免带动画） */
function jumpTo(x, y) {
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;

    html.style.scrollBehavior = "auto";
    window.scrollTo(x, y);
    html.style.scrollBehavior = previous;
}

/* 只增减列，不清空面板，避免内容一瞬间全部消失 */
function ensureColumns(count, gap) {
    while (columns.length > count) {
        columns.pop().remove();
    }

    while (columns.length < count) {
        const column = document.createElement("div");
        column.className = "gallery-col";

        board.appendChild(column);
        columns.push(column);
    }

    columns.forEach(column => column.style.setProperty("--gallery-gap", `${gap}px`));
}

function distribute(gap) {
    if (columns.length === 0) return;

    const heights = columns.map(() => 0);

    cards.forEach(card => {
        /* 放进当前最矮的一列，形成交错排布 */
        let shortest = 0;

        for (let index = 1; index < heights.length; index++) {
            if (heights[index] < heights[shortest] - 0.5) {
                shortest = index;
            }
        }

        const column = columns[shortest];

        /* 已经在最矮那一列就不搬动它：搬动节点会让浏览器调整滚动位置 */
        if (card.parentElement !== column) {
            column.appendChild(card);
        }

        heights[shortest] += card.offsetHeight + gap;
    });
}

function relayout() {
    if (cards.length === 0) return;

    layoutVersion++;

    const gap = gapSize();
    const count = columnCount();
    const scrollY = window.scrollY;   /* 排布时会被浏览器顺手改掉，先记下来 */

    board.style.setProperty("--gallery-gap", `${gap}px`);

    if (count !== columns.length) {
        ensureColumns(count, gap);
    }

    distribute(gap);

    if (window.scrollY !== scrollY) {
        jumpTo(window.scrollX, scrollY);
    }
}

/* =========================
   点击放大查看
   ========================= */

function updateViewer() {
    const item = items[currentIndex];
    if (!item) return;

    viewerImage.src = item.src;
    viewerImage.alt = `${label.alt} ${currentIndex + 1}`;
    viewerCounter.textContent = `${currentIndex + 1} / ${items.length}`;

    const multiple = items.length > 1;
    viewerPrev.hidden = !multiple;
    viewerNext.hidden = !multiple;
}

function openViewer(index) {
    currentIndex = index;
    lastFocus = document.activeElement;

    updateViewer();

    viewer.hidden = false;
    document.body.classList.add("viewer-open");

    /* 等面板显示出来再让按钮获得焦点（visibility 为 hidden 时没法聚焦） */
    requestAnimationFrame(() => {
        viewer.classList.add("open");
        viewerClose.focus({ preventScroll: true });
    });
}

function closeViewer() {
    viewer.classList.remove("open");
    document.body.classList.remove("viewer-open");

    if (closeTimer !== null) clearTimeout(closeTimer);

    closeTimer = setTimeout(() => {
        if (!viewer.classList.contains("open")) {
            viewer.hidden = true;
        }
    }, 320);

    if (lastFocus && typeof lastFocus.focus === "function") {
        lastFocus.focus({ preventScroll: true });
    }
}

function stepViewer(delta) {
    if (items.length < 2) return;

    currentIndex = (currentIndex + delta + items.length) % items.length;
    updateViewer();
}

function bindViewer() {
    if (viewer.dataset.ready === "1") return;
    viewer.dataset.ready = "1";

    viewerClose.setAttribute("aria-label", label.close);
    viewerPrev.setAttribute("aria-label", label.prev);
    viewerNext.setAttribute("aria-label", label.next);

    viewerClose.addEventListener("click", closeViewer);
    viewerPrev.addEventListener("click", () => stepViewer(-1));
    viewerNext.addEventListener("click", () => stepViewer(1));

    /* 点击图片外的黑色区域关闭 */
    viewer.addEventListener("click", event => {
        if (event.target === viewer) closeViewer();
    });

    document.addEventListener("keydown", event => {
        if (!viewer.classList.contains("open")) return;

        if (event.key === "Escape") closeViewer();
        else if (event.key === "ArrowLeft") stepViewer(-1);
        else if (event.key === "ArrowRight") stepViewer(1);
    });

    /* 手机端左右滑动切换 */
    let startX = 0;
    let startY = 0;

    viewer.addEventListener("touchstart", event => {
        const touch = event.changedTouches[0];
        startX = touch.clientX;
        startY = touch.clientY;
    }, { passive: true });

    viewer.addEventListener("touchend", event => {
        const touch = event.changedTouches[0];
        const moveX = touch.clientX - startX;
        const moveY = touch.clientY - startY;

        if (Math.abs(moveX) > 45 && Math.abs(moveY) < 60) {
            stepViewer(moveX < 0 ? 1 : -1);
        }
    }, { passive: true });
}

/* =========================
   启动
   ========================= */

let resizeTimer = null;

window.addEventListener("resize", () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {
        resizeTimer = null;
        relayout();
    }, 150);
});

/* 图片是一张一张读进来的，排布跟着刷新：先读到的先显示 */
function scheduleRelayout() {
    if (relayoutTimer !== null) return;

    relayoutTimer = setTimeout(() => {
        relayoutTimer = null;
        relayout();
    }, 120);
}

async function init() {
    /* 只有画廊页有这块面板 */
    if (!board) return;

    await collectImages(item => {
        const card = createCard(item, items.length);

        items.push(item);
        cards.push(card);

        scheduleRelayout();
    });

    if (relayoutTimer !== null) {
        clearTimeout(relayoutTimer);
        relayoutTimer = null;
    }

    if (loadingTip) loadingTip.classList.add("hidden");

    if (items.length === 0) {
        if (emptyTip) emptyTip.classList.remove("hidden");
        return;
    }

    if (emptyTip) emptyTip.classList.add("hidden");

    relayout();
    bindViewer();
}

init();
