// Transparent rain over your own drawing: background: false, cropped to the tropics.
let rain;

function setup() {
  createCanvas(windowWidth, windowHeight);
  rain = createRain({ background: false, band: [30, -30], palette: 'ember', style: 'flow', grid: 'snap', stain: 0.3 });
}

function draw() {
  // your own background and shapes
  background(12, 10, 16);
  noFill();
  stroke(60, 40, 50);
  for (let r = 40; r < max(width, height); r += 40) circle(width / 2, height / 2, r * 2 + (frameCount % 40));

  rain.update();
  const h = height * 0.45;
  rain.draw(0, (height - h) / 2, width, h); // draw into a band of the canvas

  noStroke();
  fill(255);
  textSize(min(64, width / 12));
  textAlign(CENTER, CENTER);
  text('30°N – 30°S', width / 2, height * 0.15);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
