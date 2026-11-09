// Every option, switchable live, plus a readout of the cell under the cursor.
let rain;
const choices = {
  palette: ['ocean', 'moss', 'ember'],
  style: ['breathe', 'flow'],
  grid: ['free', 'snap'],
  theme: ['dark', 'light', 'auto'],
  speed: [0, 1, 2, 4, 8],
};

function setup() {
  createCanvas(windowWidth, windowHeight);
  rain = createRain({ style: 'flow' });

  const ui = select('#ui');
  for (const [key, values] of Object.entries(choices)) {
    const label = createElement('label', key).parent(ui);
    const menu = createSelect().parent(label);
    values.forEach((v) => menu.option(String(v)));
    menu.selected(String(rain.options[key]));
    menu.changed(() => {
      const v = menu.value();
      rain.set({ [key]: key === 'speed' ? Number(v) : v });
    });
  }
}

function draw() {
  rain.update();
  rain.draw();

  const hit = rain.pick(mouseX, mouseY);
  const t = rain.time();
  const lines = [
    t ? t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : `loading ${round(rain.progress * 100)}%`,
  ];
  if (hit) {
    lines.push(`${abs(hit.lat).toFixed(1)}°${hit.lat >= 0 ? 'N' : 'S'} ${abs(hit.lon).toFixed(1)}°${hit.lon >= 0 ? 'E' : 'W'}`);
    lines.push(hit.rate ? `${hit.rate.toFixed(1)} mm/h ${hit.snow ? 'snow' : 'rain'}` : 'dry');
    lines.push(`7 days ${hit.total.toFixed(0)} mm`);
  }
  const light = rain.options.theme === 'light';
  noStroke();
  fill(light ? 30 : 230);
  textSize(13);
  lines.forEach((s, i) => text(s, 16, 26 + i * 18));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
