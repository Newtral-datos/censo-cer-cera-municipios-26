// Paleta secuencial de un solo tono, centrada en el verde corporativo #01f3b3
// (claro → oscuro, mismo hue ~164°, saturación/luminosidad escalonadas).
const SEQUENTIAL_BRAND = [
  "#e3f7f2",
  "#adf0de",
  "#5af2c9",
  "#01f3b3", // ancla: color corporativo exacto
  "#0ab88a",
  "#0e8162",
  "#0e4335",
];

const fmt = new Intl.NumberFormat("es-ES");
const fmtPct = (v) => `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(v)}%`;

const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
// Esri "Gray Canvas": basemap monocromo pensado para overlays temáticos, sin API key.
const BASEMAP_URL = isDark
  ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
  : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";

function quantileBreaks(values, n) {
  const sorted = [...values].sort((a, b) => a - b);
  const breaks = [];
  for (let i = 1; i < n; i++) {
    const idx = Math.floor((sorted.length * i) / n);
    breaks.push(sorted[Math.min(idx, sorted.length - 1)]);
  }
  return breaks;
}

function buildColorExpression(breaks) {
  // ["step", valor, color0, break0, color1, break1, ..., color6]
  const expr = ["step", ["get", "pct_extranjero"], SEQUENTIAL_BRAND[0]];
  breaks.forEach((b, i) => {
    expr.push(b, SEQUENTIAL_BRAND[i + 1]);
  });
  return expr;
}

function buildLegend(breaks, max) {
  const edges = [0, ...breaks, max];
  const el = document.getElementById("legend");
  el.innerHTML = '<p class="legend__title">% extranjero / total</p>';
  SEQUENTIAL_BRAND.forEach((hex, i) => {
    const row = document.createElement("div");
    row.className = "legend__row";
    const label =
      i === SEQUENTIAL_BRAND.length - 1
        ? `> ${fmtPct(edges[i])}`
        : `${fmtPct(edges[i])} – ${fmtPct(edges[i + 1])}`;
    row.innerHTML = `<span class="legend__swatch" style="background:${hex}"></span><span>${label}</span>`;
    el.appendChild(row);
  });
}

function popupHtml(props) {
  return `
    <div class="popup">
      <p class="popup__title">${props.municipio}</p>
      <p class="popup__subtitle">${props.provincia}</p>
      <div class="popup__row"><span>Censo en España</span><span>${fmt.format(props.espanol ?? props["1agoespanol"])}</span></div>
      <div class="popup__row"><span>Censo CERA (extranjero)</span><span>${fmt.format(props.extranjero ?? props["1agoextranjero"])}</span></div>
      <div class="popup__row"><span>Total</span><span>${fmt.format(props.total)}</span></div>
      <div class="popup__row"><span>% extranjero</span><span class="popup__pct">${fmtPct(props.pct ?? props.pct_extranjero)}</span></div>
    </div>
  `;
}

const POPUP_OPTIONS = { closeButton: true, maxWidth: "260px" };

function overallBounds(index) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of index) {
    const [x0, y0, x1, y1] = f.bbox;
    if (x0 < minx) minx = x0;
    if (y0 < miny) miny = y0;
    if (x1 > maxx) maxx = x1;
    if (y1 > maxy) maxy = y1;
  }
  return [[minx, miny], [maxx, maxy]];
}

// Filtro por % extranjero sobre el total (español + extranjero): oculta
// polígonos por debajo del umbral en las tres capas (relleno, borde y borde
// de hover) a la vez.
function setupPctFilter(map) {
  const slider = document.getElementById("pct-slider");
  const valueEl = document.getElementById("pct-slider-value");

  let raf = null;
  slider.addEventListener("input", () => {
    const threshold = Number(slider.value);
    valueEl.textContent = threshold === 0 ? "Todos" : `≥ ${fmtPct(threshold)}`;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      const filter = threshold === 0 ? null : [">=", ["get", "pct_extranjero"], threshold];
      map.setFilter("municipios-fill", filter);
      map.setFilter("municipios-outline", filter);
      map.setFilter("municipios-hover", filter);
      raf = null;
    });
  });
}

// Buscador local sobre el índice de municipios (no depende de un geocoder
// externo: así desambigua los 17 nombres de municipio repetidos en más de
// una provincia y siempre encuentra lo que el mapa realmente tiene).
function setupGeocoder(map, index) {
  const input = document.getElementById("geocoder-input");
  const resultsEl = document.getElementById("geocoder-results");
  const searchable = index.map((f) => ({ ...f, search: `${f.municipio} ${f.provincia}`.toLowerCase() }));

  function closeResults() {
    resultsEl.classList.remove("is-open");
    resultsEl.innerHTML = "";
  }

  function selectFeature(f) {
    map.fitBounds(
      [
        [f.bbox[0], f.bbox[1]],
        [f.bbox[2], f.bbox[3]],
      ],
      { maxZoom: 13, padding: 60, duration: 600 }
    );
    const center = [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2];
    new maplibregl.Popup(POPUP_OPTIONS).setLngLat(center).setHTML(popupHtml(f)).addTo(map);
    closeResults();
    input.value = "";
    // en móvil, vuelve a dejar el mapa libre tras elegir un resultado
    document.body.classList.add("controls-collapsed");
    document.getElementById("controls-toggle")?.classList.remove("is-active");
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) {
      closeResults();
      return;
    }
    const matches = searchable.filter((f) => f.search.includes(q)).slice(0, 8);

    if (matches.length === 0) {
      closeResults();
      return;
    }

    resultsEl.innerHTML = "";
    matches.forEach((f) => {
      const li = document.createElement("li");
      li.className = "geocoder__result";
      li.innerHTML = `<span class="muni">${f.municipio}</span><span class="prov">${f.provincia}</span>`;
      li.addEventListener("click", () => selectFeature(f));
      resultsEl.appendChild(li);
    });
    resultsEl.classList.add("is-open");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".geocoder")) closeResults();
  });
}

async function main() {
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  const pmtilesUrl = new URL("data/municipios.pmtiles", window.location.href).href;

  const res = await fetch("data/municipios_index.json");
  const index = await res.json();
  const values = index.map((f) => f.pct);
  const breaks = quantileBreaks(values, SEQUENTIAL_BRAND.length);
  const max = Math.max(...values);
  buildLegend(breaks, max);

  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: [BASEMAP_URL],
          tileSize: 256,
          attribution: "Tiles &copy; Esri",
        },
        municipios: {
          type: "vector",
          url: `pmtiles://${pmtilesUrl}`,
          promoteId: "cod_ine",
        },
      },
      layers: [
        { id: "basemap", type: "raster", source: "basemap" },
        {
          id: "municipios-fill",
          type: "fill",
          source: "municipios",
          "source-layer": "municipios",
          paint: {
            "fill-color": buildColorExpression(breaks),
            "fill-opacity": 0.78,
          },
        },
        {
          id: "municipios-outline",
          type: "line",
          source: "municipios",
          "source-layer": "municipios",
          paint: { "line-color": "rgba(11,11,11,0.25)", "line-width": 0.4 },
        },
        {
          id: "municipios-hover",
          type: "line",
          source: "municipios",
          "source-layer": "municipios",
          paint: {
            "line-color": isDark ? "#ffffff" : "#0b0b0b",
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0],
          },
        },
      ],
    },
    bounds: overallBounds(index),
    fitBoundsOptions: { padding: 24 },
    maxZoom: 14,
    minZoom: 3,
    attributionControl: true,
  });

  // abajo-derecha: en móvil el buscador y el slider ocupan casi todo el ancho
  // arriba, así que los botones de zoom arriba-derecha quedaban tapados.
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  // Hover vía feature-state (barato, solo GPU) en vez de setFilter en cada
  // mousemove (eso recompila el estilo en cada píxel y provocaba el retraso).
  const hoverTarget = { source: "municipios", sourceLayer: "municipios", id: null };

  function setHover(id, value) {
    if (id == null) return;
    hoverTarget.id = id;
    map.setFeatureState(hoverTarget, { hover: value });
  }

  let hoveredId = null;
  map.on("mousemove", "municipios-fill", (e) => {
    if (!e.features.length) return;
    const id = e.features[0].id;
    if (id === hoveredId) return;
    map.getCanvas().style.cursor = "pointer";
    setHover(hoveredId, false);
    hoveredId = id;
    setHover(hoveredId, true);
  });
  map.on("mouseleave", "municipios-fill", () => {
    map.getCanvas().style.cursor = "";
    setHover(hoveredId, false);
    hoveredId = null;
  });

  map.on("click", "municipios-fill", (e) => {
    const props = e.features[0].properties;
    new maplibregl.Popup(POPUP_OPTIONS).setLngLat(e.lngLat).setHTML(popupHtml(props)).addTo(map);
  });

  setupGeocoder(map, index);
  setupPctFilter(map);
  setupMobileToggles();
}

// En móvil el buscador, el filtro y la leyenda ocultan demasiado mapa si están
// siempre visibles, así que empiezan colapsados (ver body.controls-collapsed /
// body.legend-collapsed en el CSS, solo con efecto bajo el media query móvil)
// y estos dos botones los despliegan/ocultan.
function setupMobileToggles() {
  const controlsBtn = document.getElementById("controls-toggle");
  const legendBtn = document.getElementById("legend-toggle");

  controlsBtn.addEventListener("click", () => {
    const open = document.body.classList.toggle("controls-collapsed") === false;
    controlsBtn.classList.toggle("is-active", open);
  });
  legendBtn.addEventListener("click", () => {
    const open = document.body.classList.toggle("legend-collapsed") === false;
    legendBtn.classList.toggle("is-active", open);
  });
}

main();
