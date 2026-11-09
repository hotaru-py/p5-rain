// The smallest p5.rain sketch: the last 7 days of NASA IMERG rain, live.
let rain;

function setup() {
  createCanvas(windowWidth, windowHeight);
  rain = createRain();
}

function draw() {
  rain.update();
  rain.draw();
  if (!rain.ready) {
    fill(200);
    text(rain.error ? rain.error.message : `loading ${round(rain.progress * 100)}%`, 20, 30);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
