/* topo-layer.js
 * Camada topográfica em tempo real para Leaflet
 * Dados: tiles Terrarium (AWS Open Data / SRTM)
 */
(function () {
  const STOPS = [
    [0.00, [22, 79, 145]],   // azul: cotas mais baixas
    [0.14, [0, 151, 177]],   // azul-petróleo
    [0.28, [24, 184, 105]],  // verde
    [0.42, [135, 211, 35]],  // verde-limão
    [0.56, [239, 235, 20]],  // amarelo
    [0.70, [255, 166, 0]],   // laranja
    [0.84, [239, 75, 25]],   // vermelho-alaranjado
    [1.00, [145, 22, 48]],   // vermelho escuro: cotas mais altas
  ];
  const LINE = [72, 54, 42];

  function ramp(t) {
    t = Math.min(1, Math.max(0, t));
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
        const k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return STOPS[STOPS.length - 1][1].slice();
  }

  function contourStep(z) { return z >= 14 ? 5 : z >= 13 ? 10 : z >= 11 ? 25 : 50; }

  function blur(a, W, H, r) {
    const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[y * W + Math.min(W - 1, Math.max(0, x + k))];
      t[y * W + x] = s / n;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += t[Math.min(H - 1, Math.max(0, y + k)) * W + x];
      o[y * W + x] = s / n;
    }
    return o;
  }

  const style = document.createElement('style');
  style.textContent = '.topo-layer{mix-blend-mode:multiply}';
  document.head.appendChild(style);

  L.TopoLayer = L.GridLayer.extend({
    options: {
      range: [722, 820],
      tileSize: 256,
      maxNativeZoom: 14,
      noWrap: true,
      opacity: 0.75,
      shade: 4,
      contours: true,
      className: 'topo-layer',
      attribution: 'Elevação: Terrarium / AWS (SRTM)',
    },

    setRange(min, max) { this.options.range = [min, max]; this.redraw(); },

    createTile(coords, done) {
      const tile = L.DomUtil.create('canvas', 'leaflet-tile');
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try { this._paint(tile, img, coords); done(null, tile); }
        catch (err) { done(err, tile); }
      };
      img.onerror = () => done(null, tile);
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${coords.z}/${coords.x}/${coords.y}.png`;
      return tile;
    },

    _paint(canvas, img, coords) {
      const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;

      let e = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      e = blur(e, W, H, 2);

      const [lo, hi] = this.options.range;
      const step = contourStep(coords.z);
      const k = this.options.shade;

      const n = Math.PI - 2 * Math.PI * (coords.y + 0.5) / Math.pow(2, coords.z);
      const res = 156543.03392 * Math.cos(Math.atan(Math.sinh(n))) / Math.pow(2, coords.z);

      const at = (x, y) => e[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
      const out = ctx.createImageData(W, H), o = out.data;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const z0 = e[y * W + x];
          let [r, g, b] = ramp((z0 - lo) / (hi - lo));

          if (k > 0) {
            const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * res);
            const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * res);
            const len = Math.sqrt(1 + k * k * (dx * dx + dy * dy));
            const dot = (-k * dx * -0.5 + -k * dy * -0.5 + 0.7071) / len;
            const sh = Math.min(1.25, Math.max(0.6, dot / 0.7071));
            r *= sh; g *= sh; b *= sh;
          }

          if (this.options.contours) {
            const c0 = Math.floor(z0 / step);
            const c1 = Math.floor(at(x + 1, y) / step);
            const c2 = Math.floor(at(x, y + 1) / step);
            if (c0 !== c1 || c0 !== c2) {
              const cn = Math.max(c0, c1, c2);
              const a = cn % 5 === 0 ? 0.65 : 0.35;
              r = r * (1 - a) + LINE[0] * a;
              g = g * (1 - a) + LINE[1] * a;
              b = b * (1 - a) + LINE[2] * a;
            }
          }

          const i = (y * W + x) * 4;
          o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
    },
  });

  L.topoLayer = (opts) => new L.TopoLayer(opts);
})();