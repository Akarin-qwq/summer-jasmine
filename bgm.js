const bgm = document.querySelector("#bgm");

bgm.volume = 0.2;

window.addEventListener("click", () => {
    bgm.play();
}, { once: true });