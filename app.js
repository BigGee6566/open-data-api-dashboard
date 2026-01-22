
// World Bank indicators
const INDICATORS = {
  gdp: { code: "NY.GDP.MKTP.CD", label: "GDP (current US$)" },
  pop: { code: "SP.POP.TOTL", label: "Population (total)" },
  infl: { code: "FP.CPI.TOTL.ZG", label: "Inflation (annual %)" }
};

const YEARS_BACK = 12;

const countrySelect = document.getElementById("country");
const reloadBtn = document.getElementById("reloadBtn");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const tableBody = document.getElementById("latestTableBody");

// KPI elements (ensure these IDs exist in index.html)
const kpiGDP = document.getElementById("kpiGDP");
const kpiGDPYear = document.getElementById("kpiGDPYear");
const kpiPOP = document.getElementById("kpiPOP");
const kpiPOPYear = document.getElementById("kpiPOPYear");
const kpiINF = document.getElementById("kpiINF");
const kpiINFYear = document.getElementById("kpiINFYear");

let gdpChart = null;
let popChart = null;
let inflChart = null;

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function setError(msg) {
  if (errorEl) errorEl.textContent = msg || "";
}

function formatNumber(value, maxFrac = 2) {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFrac }).format(value);
}

function formatCurrencyUSD(value) {
  if (value === null || value === undefined) return "N/A";
  return "$" + new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function compactBigNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);

  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

async function fetchIndicatorSeries(country, indicatorCode) {
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicatorCode}?format=json&per_page=200`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${indicatorCode}`);
  }

  const data = await res.json();

  // World Bank: [metadata, rows]
  if (!Array.isArray(data) || !Array.isArray(data[1])) {
    throw new Error(`Unexpected API response for ${indicatorCode}`);
  }

  const rows = data[1];

  // Keep only valid data points
  const cleaned = rows
    .filter(r => r && r.date && r.value !== null && r.value !== undefined)
    .map(r => ({ year: Number(r.date), value: r.value }))
    .filter(p => Number.isFinite(p.year))
    .sort((a, b) => a.year - b.year);

  // Keep last N points
  return cleaned.slice(Math.max(0, cleaned.length - YEARS_BACK));
}

function destroyChart(chart) {
  if (chart && typeof chart.destroy === "function") chart.destroy();
}

function createLineChart(canvasEl, labels, values, title, yTickFormatter) {
  const ctx = canvasEl.getContext("2d");

  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: title,
          data: values,
          tension: 0.25,
          pointRadius: 2.5,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // critical for fixed card height
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: (context) => {
              const v = context.raw;
              return `${context.dataset.label}: ${v === null || v === undefined ? "N/A" : formatNumber(v)}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 0 } },
        y: {
          ticks: {
            callback: (val) => (yTickFormatter ? yTickFormatter(val) : val)
          }
        }
      }
    }
  });
}

function latestPoint(series) {
  return series && series.length ? series[series.length - 1] : null;
}

function renderKPIs(gdpSeries, popSeries, inflSeries) {
  const g = latestPoint(gdpSeries);
  const p = latestPoint(popSeries);
  const i = latestPoint(inflSeries);

  // These elements exist only if you added KPI cards in index.html.
  if (kpiGDP) kpiGDP.textContent = g ? formatCurrencyUSD(g.value) : "—";
  if (kpiGDPYear) kpiGDPYear.textContent = g ? `Year: ${g.year}` : "No data";

  if (kpiPOP) kpiPOP.textContent = p ? formatNumber(p.value, 0) : "—";
  if (kpiPOPYear) kpiPOPYear.textContent = p ? `Year: ${p.year}` : "No data";

  if (kpiINF) kpiINF.textContent = i ? `${formatNumber(i.value, 1)}%` : "—";
  if (kpiINFYear) kpiINFYear.textContent = i ? `Year: ${i.year}` : "No data";
}

function renderTable(gdpSeries, popSeries, inflSeries) {
  if (!tableBody) return;

  tableBody.innerHTML = "";

  const rows = [
    { name: INDICATORS.gdp.label, point: latestPoint(gdpSeries), fmt: formatCurrencyUSD },
    { name: INDICATORS.pop.label, point: latestPoint(popSeries), fmt: (v) => formatNumber(v, 0) },
    { name: INDICATORS.infl.label, point: latestPoint(inflSeries), fmt: (v) => (v == null ? "N/A" : `${formatNumber(v, 1)}%`) }
  ];

  for (const r of rows) {
    const tr = document.createElement("tr");
    const year = r.point ? String(r.point.year) : "N/A";
    const val = r.point ? r.fmt(r.point.value) : "N/A";

    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${year}</td>
      <td>${val}</td>
    `;
    tableBody.appendChild(tr);
  }
}

function requireAtLeastTwoPoints(...seriesList) {
  return seriesList.every(s => Array.isArray(s) && s.length >= 2);
}

async function loadAll() {
  const country = countrySelect ? countrySelect.value : "ZAF";

  setError("");
  setStatus("Loading data from World Bank API...");
  if (reloadBtn) reloadBtn.disabled = true;
  if (countrySelect) countrySelect.disabled = true;

  try {
    const [gdpSeries, popSeries, inflSeries] = await Promise.all([
      fetchIndicatorSeries(country, INDICATORS.gdp.code),
      fetchIndicatorSeries(country, INDICATORS.pop.code),
      fetchIndicatorSeries(country, INDICATORS.infl.code)
    ]);

    if (!requireAtLeastTwoPoints(gdpSeries, popSeries, inflSeries)) {
      setStatus("");
      setError("Not enough data points returned for clean charts (need at least 2 years). Try another country.");
      return;
    }

    setStatus("Data loaded successfully.");

    // KPIs and Table
    renderKPIs(gdpSeries, popSeries, inflSeries);
    renderTable(gdpSeries, popSeries, inflSeries);

    // Destroy old charts
    destroyChart(gdpChart);
    destroyChart(popChart);
    destroyChart(inflChart);

    // Create charts
    const gdpCanvas = document.getElementById("gdpChart");
    const popCanvas = document.getElementById("popChart");
    const inflCanvas = document.getElementById("inflChart");

    if (!gdpCanvas || !popCanvas || !inflCanvas) {
      throw new Error("Missing chart canvas elements. Ensure gdpChart, popChart, inflChart exist in index.html.");
    }

    gdpChart = createLineChart(
      gdpCanvas,
      gdpSeries.map(d => d.year),
      gdpSeries.map(d => d.value),
      INDICATORS.gdp.label,
      (v) => compactBigNumber(v)
    );

    popChart = createLineChart(
      popCanvas,
      popSeries.map(d => d.year),
      popSeries.map(d => d.value),
      INDICATORS.pop.label,
      (v) => compactBigNumber(v)
    );

    inflChart = createLineChart(
      inflCanvas,
      inflSeries.map(d => d.year),
      inflSeries.map(d => d.value),
      INDICATORS.infl.label,
      (v) => `${Number(v).toFixed(1)}%`
    );

  } catch (err) {
    console.error(err);
    setStatus("");
    setError(`Error: ${err.message}. Check your internet connection or try another country.`);
  } finally {
    if (reloadBtn) reloadBtn.disabled = false;
    if (countrySelect) countrySelect.disabled = false;
  }
}

// Wire up controls
if (reloadBtn) reloadBtn.addEventListener("click", loadAll);
if (countrySelect) countrySelect.addEventListener("change", loadAll);

// Initial load
loadAll();
