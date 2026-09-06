const navbar = document.getElementById("navbar");
window.addEventListener("scroll", () => {
    if (window.scrollY > 300){
        navbar.classList.add("hidden");
    }
    else {
        navbar.classList.remove("hidden");
    }
});