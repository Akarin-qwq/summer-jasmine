const bgm = document.querySelector("#bgm");

bgm.volume = 0.2;

let wasPlaying = false;

window.addEventListener("click", () => {
    bgm.play();
}, { once: true });

// 切到后台
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        wasPlaying = !bgm.paused;

        if (wasPlaying) {
            bgm.pause();
        }
    } else {
        // 回到网页
        if (wasPlaying) {
            bgm.play();
        }
    }
});


// 页面被隐藏 / 离开
window.addEventListener("pagehide", () => {
    wasPlaying = !bgm.paused;

    if (wasPlaying) {
        bgm.pause();
    }
});
