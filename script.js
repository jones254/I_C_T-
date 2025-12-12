// script.js — ICT-only Hybrid Mode (no RSI, no MA)
// Replace POLY_API_KEY and TD_API_KEY with your own keys (if you have them)
document.addEventListener("DOMContentLoaded", () => {

const POLY_API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm"; // <-- replace if desired
const TD_API_KEY   = "d1babeb679ab40b3874b0541d46f6059"; // <-- replace if desired

// ---------- pairs ----------
const pairs = [
  "C:EURUSD","C:GBPUSD","C:USDJPY","C:USDCAD","C:AUDUSD",
  "C:NZDUSD","C:EURGBP","C:EURJPY","C:GBPJPY","C:CHFJPY",
  "C:AUDJPY","C:NZDJPY","C:EURCAD","C:GBPCAD","C:CADJPY",
  "C:USDCHF","C:EURCHF","C:GBPCHF","C:AUDCAD","C:NZDCAD"
];

const pairSelect = document.getElementById("pairSelect");
pairs.forEach(p => pairSelect.insertAdjacentHTML("beforeend", `<option value="${p}">${p.replace("C:","")}</option>`));
pairSelect.value = "C:EURUSD";
const modeSelect = document.getElementById("modeSelect");

const timeframes = {
  "weekly": { source: "polygon", mult:1, span:"week" },
  "daily":  { source: "polygon", mult:1, span:"day" },
  "4hour":  { source: "twelvedata", interval: "4h" },
  "1hour":  { source: "twelvedata", interval: "1h" },
  "15min":  { source: "twelvedata", interval: "15m" }
};

// ---------- helpers ----------
const sleep = ms => new Promise(res => setTimeout(res, ms));
function rangeFor(tf){
  const now = new Date(); let start = new Date();
  if (tf === "weekly") start.setFullYear(now.getFullYear()-5);
  else if (tf === "daily") start.setFullYear(now.getFullYear()-1);
  else if (tf === "4hour") start.setDate(now.getDate()-10);
  else if (tf === "1hour") start.setDate(now.getDate()-3);
  else if (tf === "15min") start.setDate(now.getDate()-2);
  return { from: start.toISOString().slice(0,10), to: now.toISOString().slice(0,10) };
}

// ---------- polygon fetch ----------
async function fetchPolygonAggs(ticker,mult,span,from,to,attempt=1){
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?sort=asc&limit=500&apiKey=${POLY_API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();
    if (j && Array.isArray(j.results) && j.results.length) return j.results.map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}));
    if (attempt === 1){ await sleep(700); return fetchPolygonAggs(ticker,mult,span,from,to,2); }
    return [];
  } catch(e){ return []; }
}

// ---------- twelvedata fetch ----------
function toTdSymbol(pair){ const raw = pair.replace("C:",""); return `${raw.slice(0,3)}/${raw.slice(3,6)}`; }

async function fetchTwelveDataIntraday(pair, interval, outputsize=500, attempt=1){
  const symbol = toTdSymbol(pair);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&format=JSON&apikey=${TD_API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();
    if (j && Array.isArray(j.values) && j.values.length){
      const asc = j.values.slice().reverse();
      return asc.map(v=>({ t: new Date(v.datetime).getTime(), o:Number(v.open), h:Number(v.high), l:Number(v.low), c:Number(v.close) }));
    }
    if (attempt === 1){ await sleep(700); return fetchTwelveDataIntraday(pair,interval,outputsize,2); }
    return [];
  } catch(e){ return []; }
}

async function fetchForTimeframe(pair, tfKey){
  const tf = timeframes[tfKey];
  if (!tf) return [];
  if (tf.source === "polygon"){
    const {from,to} = rangeFor(tfKey);
    return await fetchPolygonAggs(pair, tf.mult, tf.span, from, to);
  }
  if (tf.source === "twelvedata"){
    return await fetchTwelveDataIntraday(pair, tf.interval, 500);
  }
  return [];
}

// ---------- ICT detection helpers ----------

// Pivot finder (simple local pivot)
function findPivots(bars, left=2, right=2){
  const highs = [], lows = [];
  for (let i=left; i<bars.length-right; i++){
    let isHigh = true, isLow = true;
    for (let j=i-left; j<=i+right; j++){
      if (j===i) continue;
      if (bars[j].h > bars[i].h) isHigh = false;
      if (bars[j].l < bars[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

// Market structure: detect pivots and simple BOS (break of prior pivot)
function detectStructure(bars){
  const {highs, lows} = findPivots(bars,2,2);
  const pivotHighs = highs.map(i => ({ idx:i, price: bars[i].h, time: bars[i].t }));
  const pivotLows = lows.map(i => ({ idx:i, price: bars[i].l, time: bars[i].t }));

  const BOS = [];
  // Simple BOS up: a pivot high greater than previous pivot high
  for (let i=1;i<pivotHighs.length;i++){
    if (pivotHighs[i].price > pivotHighs[i-1].price) BOS.push({ type: "Up", idx: pivotHighs[i].idx, price: pivotHighs[i].price, time: pivotHighs[i].time });
  }
  // BOS down
  for (let i=1;i<pivotLows.length;i++){
    if (pivotLows[i].price < pivotLows[i-1].price) BOS.push({ type: "Down", idx: pivotLows[i].idx, price: pivotLows[i].price, time: pivotLows[i].time });
  }

  return { pivotHighs, pivotLows, BOS };
}

// FVG detection (3-candle heuristic)
function detectFVG(bars){
  const fvg = [];
  for (let i=2;i<bars.length;i++){
    const b2 = bars[i-2], b1 = bars[i-1], b0 = bars[i];
    // Bearish FVG (gap): low of current > high of two bars ago
    if (b0.l > b2.h) fvg.push({ type:"Bearish", high: b2.h, low: b0.l, time: b1.t });
    // Bullish FVG
    if (b0.h < b2.l) fvg.push({ type:"Bullish", high: b0.h, low: b2.l, time: b1.t });
  }
  return fvg;
}

// Order-blocks (simple heuristic): last opposite candle before a strong impulse
function detectOrderBlocks(bars){
  const obs = [];
  for (let i=2;i<bars.length;i++){
    const cur = bars[i], prev = bars[i-1];
    // bullish OB heuristic: strong bullish candle followed by prior bearish
    if (cur.c > cur.o && prev.c < prev.o && (cur.c - cur.o) > (prev.o - prev.c) * 0.5) {
      obs.push({ type:"BullishOB", idx: i-1, high: prev.h, low: prev.l, time: prev.t });
    }
    if (cur.c < cur.o && prev.c > prev.o && (prev.c - prev.o) < (cur.o - cur.c) * 0.5) {
      obs.push({ type:"BearishOB", idx: i-1, high: prev.h, low: prev.l, time: prev.t });
    }
  }
  return obs;
}

// Liquidity (equal highs / equal lows within tolerance)
function detectLiquidity(bars, tol=0.0004){
  const pockets = [];
  for (let i=0;i<bars.length;i++){
    for (let j=i+1;j<bars.length;j++){
      if (Math.abs(bars[i].h - bars[j].h) <= tol * bars[i].h) pockets.push({ type:"EqualHigh", price:(bars[i].h+bars[j].h)/2, idx1:i, idx2:j });
      if (Math.abs(bars[i].l - bars[j].l) <= tol * bars[i].l) pockets.push({ type:"EqualLow", price:(bars[i].l+bars[j].l)/2, idx1:i, idx2:j });
    }
  }
  return pockets;
}

// OTE 62% - 79% between two swing points
function computeOTE(low, high){
  const diff = high - low;
  return { low: low + diff*0.62, high: low + diff*0.79 };
}

// Displacement: measure size of last impulse relative to recent average range
function detectDisplacement(bars, lookback=30){
  if (!bars || bars.length < lookback) return { value: 0, strong: false };
  const recent = bars.slice(-lookback);
  const ranges = recent.map(b => Math.abs(b.h - b.l));
  const avgRange = ranges.reduce((a,b)=>a+b,0)/ranges.length;
  const lastRange = Math.abs(bars[bars.length-1].h - bars[bars.length-1].l);
  const value = lastRange / (avgRange || 1);
  return { value, strong: value > 1.8 }; // heuristic threshold
}

// ---------- pick bars preference ----------
function pickChartBars(barsByTf){
  const order = ["15min","1hour","4hour","daily","weekly"];
  for (const tf of order) if (barsByTf[tf] && barsByTf[tf].length) return { bars: barsByTf[tf], tf };
  return { bars: [], tf: null };
}

// ---------- ICT hybrid confidence (pure SMC) ----------
function computeHybridIctConfidence(detected, results, barsByTf, mode="standard"){
  // weights (base)
  let wStructure = 40, wOB = 20, wFVG = 15, wLiquidity = 15, wOTE = 10;
  if (mode === "conservative"){ wStructure += 5; wLiquidity += 5; wOB -= 5; }
  if (mode === "aggressive"){ wFVG += 5; wOTE += 5; wStructure -= 5; }

  let score = 0;

  // structure: presence and alignment across MTFs
  const overallDominant = results["Overall"] ? results["Overall"].Dominant : "Neutral";
  // define structure support as number of timeframes that have at least one BOS matching the Overall direction
  const tfs = Object.keys(timeframes);
  let structureSupport = 0;
  tfs.forEach(tf => {
    const r = results[tf];
    if (!r || r.Error) return;
    // we used Trend previously; here we infer direction by counting BOS in that timeframe's detected structure
    // but results[tf].Direction is not present since we removed indicators; instead we use structure from detected map (caller passes detected)
  });

  // For simplicity we derive structureSupport from detected.structure.BOS length (caller is expected to pass detected corresponding to picked timeframe)
  const struct = detected.structure || {};
  if (struct && struct.BOS && struct.BOS.length){
    // if at least one BOS in picked timeframe -> good
    structureSupport = Math.min(struct.BOS.length, 3); // cap
    score += (structureSupport / 3) * wStructure;
  }

  // Order Blocks
  const obCount = detected.obs ? detected.obs.length : 0;
  score += Math.min(obCount, 6) / 6 * wOB; // cap at 6 OBs

  // FVG
  const fvgCount = detected.fvg ? detected.fvg.length : 0;
  score += Math.min(fvgCount, 5) / 5 * wFVG;

  // Liquidity
  const liqCount = detected.liquidity ? detected.liquidity.length : 0;
  score += Math.min(liqCount, 6) / 6 * wLiquidity;

  // OTE alignment: check if last swing range produces an OTE zone and whether current price sits inside it (we'll check simple membership)
  let oteScore = 0;
  // derive last swing low/high from detected pivot arrays if present
  const ph = (detected.structure && detected.structure.pivotHighs) ? detected.structure.pivotHighs : [];
  const pl = (detected.structure && detected.structure.pivotLows) ? detected.structure.pivotLows : [];
  if (ph.length && pl.length){
    // pick most recent low & high
    const lastLow = pl[pl.length-1].price;
    const lastHigh = ph[ph.length-1].price;
    if (lastHigh > lastLow){
      const ote = computeOTE(lastLow, lastHigh);
      // use picked bars' latest close
      const pickedBars = barsByTf[detected.pickedTf] || [];
      const lastClose = pickedBars.length ? pickedBars[pickedBars.length-1].c : null;
      if (lastClose !== null && lastClose >= ote.low && lastClose <= ote.high) {
        oteScore = wOTE;
      } else {
        oteScore = wOTE * 0.4; // partial credit
      }
    }
  }
  score += oteScore;

  // normalize 0-100
  score = Math.round(Math.max(0, Math.min(100, score)));

  // apply mode tweak
  if (mode === "conservative") score = Math.round(score * 0.9);
  if (mode === "aggressive") score = Math.round(Math.min(100, score * 1.05));

  return score;
}

// ---------- main run logic ----------
const runBtn = document.getElementById("runBtn");
runBtn.onclick = async () => {
  const pair = pairSelect.value;
  const mode = modeSelect.value;

  if (!pair) return alert("Select a pair");

  document.getElementById("results").innerHTML = `<div class="bg-white p-4 rounded-lg shadow">Running ${pair.replace("C:","")} ...</div>`;
  document.getElementById("chartMeta").textContent = "";
  document.getElementById("ictList").innerHTML = "";
  document.getElementById("confidenceBar").style.width = "0%";
  document.getElementById("confidenceText").textContent = "—";

  const barsByTf = {};
  const results = {};

  const order = ["weekly","daily","4hour","1hour","15min"];
  for (let i=0;i<order.length;i++){
    const tf = order[i];
    if (i !== 0) await sleep(600);

    let bars = await fetchForTimeframe(pair, tf);

    // intraday fallback -> daily
    if ((tf === "4hour" || tf === "1hour" || tf === "15min") && (!bars || bars.length === 0)){
      if (!barsByTf["daily"] || !barsByTf["daily"].length) barsByTf["daily"] = await fetchForTimeframe(pair, "daily");
      bars = barsByTf["daily"] || [];
    }

    barsByTf[tf] = bars;

    if (!bars || bars.length === 0){
      results[tf] = { Error: "No data", Bars: 0 };
      continue;
    }

    // minimal per-timeframe result: just Bars & last close
    results[tf] = { Bars: bars.length, Close: bars[bars.length-1].c };
  }

  // pick chart bars (most granular available)
  const picked = pickChartBars(barsByTf);
  const pickedTf = picked.tf;
  document.getElementById("chartMeta").innerHTML = pickedTf ? `<span class="timeframe-badge">${pickedTf.toUpperCase()}</span>` : "";

  // detect ICT concepts on picked bars
  const barsForIct = picked.bars || [];
  const structure = barsForIct.length ? detectStructure(barsForIct) : { pivotHighs:[], pivotLows:[], BOS:[] };
  const fvg = barsForIct.length ? detectFVG(barsForIct) : [];
  const obs = barsForIct.length ? detectOrderBlocks(barsForIct) : [];
  const liquidity = barsForIct.length ? detectLiquidity(barsForIct) : [];
  const displacement = barsForIct.length ? detectDisplacement(barsForIct) : { value:0, strong:false };

  const detected = {
    structure, fvg, obs, liquidity, displacement, pickedTf
  };

  // Build overall placeholder (no indicators)
  results["Overall"] = { Dominant: (structure.BOS && structure.BOS.length ? structure.BOS[0].type : "Neutral"), Bars: picked.bars ? picked.bars.length : 0 };

  // compute hybrid ICT confidence (pure SMC)
  const ictConfidence = computeHybridIctConfidence(detected, results, barsByTf, mode);
  results["Overall"].Confidence = ictConfidence + "%";

  // render results and chart
  renderResults(results);
  renderCharts(picked.bars, detected);

  // fill ICT list & confidence UI
  const ictList = document.getElementById("ictList");
  ictList.innerHTML = "";
  if (detected.structure.BOS && detected.structure.BOS.length) {
    detected.structure.BOS.forEach(b => ictList.insertAdjacentHTML("beforeend", `<li class="ict-item">BOS ${b.type} @ ${b.price.toFixed(5)}</li>`));
  }
  detected.fvg.forEach(f => ictList.insertAdjacentHTML("beforeend", `<li class="ict-item">${f.type} FVG [${f.low.toFixed(5)} - ${f.high.toFixed(5)}]</li>`));
  detected.obs.forEach(o => ictList.insertAdjacentHTML("beforeend", `<li class="ict-item">${o.type} OB [${o.low.toFixed(5)} - ${o.high.toFixed(5)}]</li>`));
  detected.liquidity.forEach(l => ictList.insertAdjacentHTML("beforeend", `<li class="ict-item">${l.type} @ ${l.price.toFixed(5)}</li>`));
  if (detected.displacement && detected.displacement.strong) ictList.insertAdjacentHTML("beforeend", `<li class="ict-item">Displacement: strong (${detected.displacement.value.toFixed(2)}x)</li>`);

  document.getElementById("confidenceBar").style.width = results["Overall"].Confidence;
  document.getElementById("confidenceText").textContent = `ICT Confidence: ${results["Overall"].Confidence} (${mode} mode)`;
};

// ---------- renderResults ----------
function renderResults(results){
  const container = document.getElementById("results");
  container.innerHTML = "";
  const order = ["weekly","daily","4hour","1hour","15min","Overall"];
  order.forEach(tf => {
    if (!results[tf]) return;
    const r = results[tf];
    const title = tf === "Overall" ? "Overall" : tf.toUpperCase();
    let body = "";
    if (r.Error) body = `<div class="text-red-600 font-semibold">${r.Error}</div>`;
    else {
      body = `<div class="grid grid-cols-2 gap-2 text-sm">`;
      for (const k in r) body += `<div class="text-gray-600">${k}</div><div class="font-mono">${r[k]}</div>`;
      body += `</div>`;
    }
    container.insertAdjacentHTML("beforeend", `
      <div class="bg-white p-4 rounded-xl shadow mb-3">
        <div class="flex items-center justify-between mb-2"><h3 class="font-bold">${title}</h3></div>
        ${body}
      </div>
    `);
  });
}

// ---------- renderCharts (horizontal lines for OB & FVG) ----------
function renderCharts(bars, detected){
  const chartDiv = document.getElementById("chart");
  chartDiv.innerHTML = "";
  if (!bars || bars.length === 0) { console.warn("No bars to render"); return; }

  // convert
  let candleData = bars.map(b => ({ time: Math.floor(Number(b.t)/1000), open: b.o, high: b.h, low: b.l, close: b.c }));

  // ensure monotonic times
  let broken = false;
  for (let i=1;i<candleData.length;i++) if (candleData[i].time <= candleData[i-1].time) { broken = true; break; }
  if (broken){
    const base = Math.floor(Date.now()/1000) - candleData.length * 15 * 60;
    candleData = candleData.map((c,i)=>({ ...c, time: base + i*15*60 }));
  }

  try {
    const chart = LightweightCharts.createChart(chartDiv, {
      layout:{ background:{color:"#fff"}, textColor:"#333" },
      grid:{ vertLines:{color:"#eee"}, horzLines:{color:"#eee"} },
      rightPriceScale:{ scaleMargins:{top:0.1,bottom:0.1} },
      timeScale:{ timeVisible:true, secondsVisible:false }
    });

    const candleSeries = chart.addCandlestickSeries();
    candleSeries.setData(candleData);

    // Draw horizontal lines for FVG (red for bearish, green for bullish)
    if (detected && detected.fvg && detected.fvg.length){
      detected.fvg.forEach((f, i) => {
        try {
          const color = f.type === "Bullish" ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)';
          const lineTop = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible:false });
          const lineBottom = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible:false });
          // top line at f.high, bottom at f.low
          const startTime = Math.floor(candleData[0].time);
          const endTime = Math.floor(candleData[candleData.length-1].time);
          lineTop.setData([{ time: startTime, value: f.high }, { time: endTime, value: f.high }]);
          lineBottom.setData([{ time: startTime, value: f.low }, { time: endTime, value: f.low }]);
        } catch(e) {}
      });
    }

    // Draw horizontal lines for Order Blocks (paler colors)
    if (detected && detected.obs && detected.obs.length){
      detected.obs.forEach((o, i) => {
        try {
          const color = o.type === "BullishOB" ? 'rgba(6,95,70,0.6)' : 'rgba(153,27,27,0.6)';
          const lineTop = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible:false });
          const lineBottom = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible:false });
          const startTime = Math.floor(candleData[0].time);
          const endTime = Math.floor(candleData[candleData.length-1].time);
          lineTop.setData([{ time: startTime, value: o.high }, { time: endTime, value: o.high }]);
          lineBottom.setData([{ time: startTime, value: o.low }, { time: endTime, value: o.low }]);
        } catch(e) {}
      });
    }

    // Liquidity: draw small markers as circle markers above/below bars (we keep chart clean; no labels)
    if (detected && detected.liquidity && detected.liquidity.length){
      const markers = detected.liquidity.slice(0,30).map(l => ({
        time: Math.floor(bars[Math.min(bars.length-1, l.idx1 || 0)].t / 1000),
        position: 'inBar',
        color: '#f59e0b',
        shape: 'circle',
        text: ''
      }));
      // set markers (no textual label)
      candleSeries.setMarkers(markers);
    }

  } catch (err) {
    console.error("renderCharts error:", err);
  }
}

}); // DOMContentLoaded end
