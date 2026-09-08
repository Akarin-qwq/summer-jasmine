const savedLanguage =
    localStorage.getItem("language") || "zh-CN";

setLanguage(savedLanguage);

async function setLanguage(lang) {
    const response = await fetch(`lang/${lang}.json`);
    const translations = await response.json();

    document.querySelectorAll("[data-i18n]").forEach(element => {
        const key = element.dataset.i18n;

        const value = key
            .split(".")
            .reduce((obj, key) => obj?.[key], translations);

        if (value !== undefined) {
            element.innerHTML = Array.isArray(value)
                ? value.join("<br>")
                : value;
        }
    });

    document.querySelectorAll("[data-i18n-src]").forEach(element => {
        const key = element.dataset.i18nSrc;

        const value = key
            .split(".")
            .reduce((obj, key) => obj?.[key], translations);

        if (value !== undefined) {
            element.src = value;
        }
    });

    localStorage.setItem("language", lang);
}

const languageButton = document.getElementById("languageButton");
const languageMenu = document.getElementById("languageMenu");
const languageButtons = document.querySelectorAll("#languageMenu button");

// 高亮当前选中的语言
function updateLanguageHighlight(lang) {
    languageButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.lang === lang);
    });
}

updateLanguageHighlight(savedLanguage);


// 点击语言按钮
languageButton.addEventListener("click", () => {
    languageMenu.classList.toggle("active");
});


// 选择语言
window.changeLanguage = function(lang, name) {
    setLanguage(lang);

    updateLanguageHighlight(lang);

    languageMenu.classList.remove("active");
};


// 点击其他地方关闭菜单
document.addEventListener("click", (event) => {

    if (!event.target.closest(".language")) {
        languageMenu.classList.remove("active");
    }

});
