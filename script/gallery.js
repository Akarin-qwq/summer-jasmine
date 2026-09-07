const slides = document.querySelectorAll(".gallery-item");

let current = 0;

setInterval(() => {
    slides[current].classList.remove("start");

    current++;

    if (current >= slides.length) {
        current = 0;
    }

    slides[current].classList.add("start");
}, 2500);