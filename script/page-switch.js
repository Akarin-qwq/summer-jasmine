const switchButton = document.getElementById("switchButton");
const switchMenu = document.getElementById("switchMenu");
const pageLinks = document.querySelectorAll("#switchMenu a");


// 高亮当前页面
function updatePageHighlight() {

    const currentPage = window.location.pathname.split("/").pop() || "index.html";

    pageLinks.forEach(link => {

        const linkPage = link.getAttribute("href");

        link.classList.toggle(
            "active",
            linkPage === currentPage
        );

    });
}


// 初始化当前页面高亮
updatePageHighlight();


// 点击按钮打开 / 关闭菜单
switchButton.addEventListener("click", () => {
    switchMenu.classList.toggle("active");
});


// 点击其他地方关闭菜单
document.addEventListener("click", (event) => {

    if (!event.target.closest(".switch")) {
        switchMenu.classList.remove("active");
    }

});