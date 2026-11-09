// Snapshots: play a saved run of hours (no network to NASA needed), and export one.
let saved, live;

function setup() {
  createCanvas(windowWidth, windowHeight);
  // a 24-hour recording shipped next to this page
  saved = createRain({ source: { snapshot: 'rain-24h.json' }, palette: 'moss', speed: 3 });
  // live data, used only for the export button
  live = loadRainData('live');
  live.on('ready', () => { select('#save').removeAttribute('disabled'); });
  select('#save').mousePressed(exportWeek);
}

function draw() {
  saved.update();
  saved.draw();
  fill(230);
  noStroke();
  const t = saved.time();
  text(t ? `snapshot · ${t.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'loading snapshot…', 16, 26);
}

// Writes week.json + week.bin; put both next to a page and use { snapshot: 'week.json' }.
function exportWeek() {
  const snap = live.toSnapshot({ name: 'week' });
  download(new Blob([JSON.stringify(snap.meta, null, 2)], { type: 'application/json' }), 'week.json');
  download(new Blob([snap.bytes], { type: 'application/octet-stream' }), 'week.bin');
  select('#msg').html(`saved ${snap.meta.hours} hours`);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
