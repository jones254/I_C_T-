// script.js — ICT Smart Money Analyzer (15m / 1h / 4h / daily / weekly)
// WARNING: educational / analysis only
document.addEventListener("DOMContentLoaded", () => {

// ------------------- CONFIG / API KEYS -------------------
const POLY_API_KEY = "kMIVSYalfpLCApmVaF1Zepb4CA5XFjRm"; // replace if desired
const TD_API_KEY   = "d1babeb679ab40b3874b0541d46f6059"; // replace with your TwelveData key

// ------------------- PAIRS -------------------
const pairs = ["C:EURUSD","C:GBPUSD","C:USDJPY","C:USDCAD","C:AUDUSD","C:NZDUSD","C:EURGBP","C:EURJPY","C:GBPJPY","C:CHFJPY","C:AUDJPY","C:NZDJPY","C:EURCAD","C:GBPCAD","C:CADJPY","C:USDCHF","C:EURCHF","C:GBPCHF","C:AUDCAD","C:NZDCAD"];
const pairSelect = document.getElementById("pairSelect");
pairs.forEach(p => pairSelect.insertAdjacentHTML("beforeend", `<option value="${p}">${p.replace("C:","")}</option>`));
pairSelect.value = "C:EURUSD";

const modeSelect = document.getElementById("modeSelect");

// ------------------- TIMEFRAMES -------------------
const timeframes = {
  "weekly": {source:"polygon", mult:1, span:"week"},
  "daily":  {source:"polygon", mult:1, span:"day"},
  "4hour":  {source:"twelvedata", interval:"4h"},
  "1hour":  {source:"twelvedata", interval:"1h"},
  "15min":  {source:"twelvedata", interval:"15m"}
};

// ------------------- HELPERS -------------------
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const average = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN;
const sma = (arr,n) => arr.length < n ? NaN : average(arr.slice(arr.length-n));

function rsi(arr,p=14){
  if (!Array.isArray(arr) || arr.length < p+1) return NaN;
  let gains=0, losses=0;
  for (let i=arr.length-p;i<arr.length;i++){
    const d = arr[i]-arr[i-1];
    if (d>0) gains+=d; else losses += Math.abs(d);
  }
  const avgG = gains/p, avgL = losses/p;
  if (avgL === 0) return 100;
  const rs = avgG/avgL;
  return 100 - 100/(1+rs);
}
const trend = (s50,s200) => (isNaN(s50)||isNaN(s200)) ? "Neutral" : (s50>s200?"Up": s50<s200?"Down":"Neutral");

// ------------------- DATES -------------------
function rangeFor(tf){
  const now = new Date();
  let start = new Date();
  if (tf==="weekly") start.setFullYear(now.getFullYear()-5);
  else if (tf==="daily") start.setFullYear(now.getFullYear()-1);
  else if (tf==="4hour") start.setDate(now.getDate()-10);
  else if (tf==="1hour") start.setDate(now.getDate()-3);
  else if (tf==="15min") start.setDate(now.getDate()-2); // two days enough for 15m
  return {from: start.toISOString().slice(0,10), to: now.toISOString().slice(0,10)};
}

// ------------------- API FETCHERS -------------------
async function fetchPolygonAggs(ticker,mult,span,from,to,attempt=1){
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?sort=asc&limit=500&apiKey=${POLY_API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();
    if (j && Array.isArray(j.results) && j.results.length) return j.results.map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}));
    if (attempt===1){ await sleep(700); return fetchPolygonAggs(ticker,mult,span,from,to,2); }
    return [];
  } catch(e){ return []; }
}

function toTdSymbol(pair){ const raw = pair.replace("C:",""); return `${raw.slice(0,3)}/${raw.slice(3,6)}`; }

async function fetchTwelveDataIntraday(pair,interval,outputsize=500,attempt=1){
  const symbol = toTdSymbol(pair);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&format=JSON&apikey=${TD_API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const j = await resp.json();
    if (j && Array.isArray(j.values) && j.values.length){
      const asc = j.values.slice().reverse();
      return asc.map(v=>({ t:new Date(v.datetime).getTime(), o:Number(v.open), h:Number(v.high), l:Number(v.low), c:Number(v.close) }));
    }
    if (attempt===1){ await sleep(700); return fetchTwelveDataIntraday(pair,interval,outputsize,2); }
    return [];
  } catch(e){ return []; }
}

async function fetchForTimeframe(pair,tfKey){
  const tf = timeframes[tfKey];
  if (!tf) return [];
  if (tf.source === "polygon"){
    const {from,to} = rangeFor(tfKey);
    return await fetchPolygonAggs(pair,tf.mult,tf.span,from,to);
  }
  if (tf.source === "twelvedata"){
    return await fetchTwelveDataIntraday(pair,tf.interval,500);
  }
  return [];
}

// ------------------- ICT DETECTION HELPERS -------------------
// Swing pivot detection (simple pivot of left and right bars)
function findPivots(bars, left = 3, right = 3){
  // returns arrays: pivotsHigh indices, pivotsLow indices
  const highs = []; const lows = [];
  for (let i=left; i<bars.length-right; i++){
    const curH = bars[i].h; const curL = bars[i].l;
    let isHigh = true, isLow = true;
    for (let j=i-left;j<=i+right;j++){
      if (j===i) continue;
      if (bars[j].h > curH) isHigh = false;
      if (bars[j].l < curL) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return {highs, lows};
}

// Market Structure: find latest swings and BOS/CHoCH
function detectMarketStructure(bars){
  // simple approach: use pivot highs/lows length 3 each side
  const {highs, lows} = findPivots(bars, 2, 2);
  // convert to price points
  const pivotHighs = highs.map(i => ({idx:i, price:bars[i].h, time:bars[i].t}));
  const pivotLows = lows.map(i => ({idx:i, price:bars[i].l, time:bars[i].t}));
  // examine last few pivots to determine trend and breaks
  // find last two pivot highs and lows to infer BOS (break of structure)
  let structure = {pivotHighs, pivotLows, BOS:[], CHoCH:[]};

  // Simple BOS detection:
  // If price closes above previous pivot high -> BOS Up
  for (let i=1;i<pivotHighs.length;i++){
    const prev = pivotHighs[i-1];
    const cur = pivotHighs[i];
    if (cur.price > prev.price){
      structure.BOS.push({type:"Up", idx:cur.idx, price:cur.price, time:cur.time});
    }
  }
  for (let i=1;i<pivotLows.length;i++){
    const prev = pivotLows[i-1];
    const cur = pivotLows[i];
    if (cur.price < prev.price){
      structure.BOS.push({type:"Down", idx:cur.idx, price:cur.price, time:cur.time});
    }
  }

  // CHoCH (change of character) detection: price breaks latest swing in opposite direction
  // For simplicity, detect when a new pivot high is lower than a previous high in uptrend (or opposite)
  // This is heuristic and may need tuning
  // Return structure for plotting
  return structure;
}

// Fair Value Gap detection (3-bar FVG heuristic)
function detectFVG(bars){
  const fvg = [];
  for (let i=2;i<bars.length;i++){
    const b2 = bars[i-2];
    const b1 = bars[i-1];
    const b0 = bars[i];
    // Bearish FVG: b0.low > b2.high (gap down left side)
    if (b0.l > b2.h){
      fvg.push({type:"Bearish", fromIdx:i-2, toIdx:i, high:b2.h, low:b0.l, time:b1.t});
    }
    // Bullish FVG: b0.h < b2.l
    if (b0.h < b2.l){
      fvg.push({type:"Bullish", fromIdx:i-2, toIdx:i, high:b0.h, low:b2.l, time:b1.t});
    }
  }
  return fvg;
}

// Order Block detection (simple heuristic):
// Find last strong opposite candle before BOS: for Up BOS, find last bearish candle before BOS zone
function detectOrderBlocks(bars){
  const obs = [];
  // naive: iterate and when a strong directional shift (large body) happens, mark previous opposite candle as OB
  for (let i=2;i<bars.length;i++){
    const c0 = bars[i].c, o0 = bars[i].o;
    const c1 = bars[i-1].c, o1 = bars[i-1].o;
    // bullish impulse (up), mark previous bearish candle as bullish OB
    if (c0 > o0 && c1 < o1 && (c0 - o0) > (o1 - c1) * 0.5) {
      obs.push({type:"BullishOB", idx:i-1, high:bars[i-1].h, low:bars[i-1].l, time:bars[i-1].t});
    }
    // bearish impulse
    if (c0 < o0 && c1 > o1 && (o0 - c0) > (c1 - o1) * 0.5) {
      obs.push({type:"BearishOB", idx:i-1, high:bars[i-1].h, low:bars[i-1].l, time:bars[i-1].t});
    }
  }
  return obs;
}

// Liquidity pockets (equal highs/lows within tolerance)
function detectLiquidity(bars, tolerance = 0.0003){
  const pockets = [];
  for (let i=1;i<bars.length;i++){
    for (let j=i+1;j<bars.length;j++){
      if (Math.abs(bars[i].h - bars[j].h) <= tolerance * bars[i].h) {
        pockets.push({type:"EqualHigh", price: (bars[i].h + bars[j].h)/2, idx1:i, idx2:j});
      }
      if (Math.abs(bars[i].l - bars[j].l) <= tolerance * bars[i].l) {
        pockets.push({type:"EqualLow", price: (bars[i].l + bars[j].l)/2, idx1:i, idx2:j});
      }
    }
  }
  return pockets;
}

// OTE (Optimal Trade Entry) zone (62% - 79% fib retracement) between swing high/low
function computeOTE(lowPrice, highPrice){
  const diff = highPrice - lowPrice;
  return { low: lowPrice + diff*0.62, high: lowPrice + diff*0.79 };
}

// ------------------- CONFIDENCE (ICT-style) -------------------
function computeIctConfidence(detected, results, barsByTf, mode="standard"){
  // detected: { fvg, obs, liquidity, structure } (for the picked timeframe)
  // results: per-timeframe indicators & trend
  // barsByTf: map timeframe->bars for volatility calculation
  let score = 0;

  // structure weight (40): if BOS exists and direction agrees with overall dominant -> full points
  const dominant = results["Overall"].Dominant;
  const structureFound = detected.structure && detected.structure.BOS && detected.structure.BOS.length > 0;
  if (structureFound){
    const matches = detected.structure.BOS.filter(b => (b.type === "Up" && dominant === "Up") || (b.type === "Down" && dominant === "Down")).length;
    score += (matches > 0) ? 40 : 15;
  }

  // FVG / OB weight (30)
  let fvgScore = 0;
  if (detected.fvg && detected.fvg.length) fvgScore = Math.min(detected.fvg.length * 6, 20);
  let obScore = 0;
  if (detected.obs && detected.obs.length) obScore = Math.min(detected.obs.length * 5, 15);
  score += fvgScore + obScore;

  // Liquidity weight (15)
  let liqScore = 0;
  if (detected.liquidity && detected.liquidity.length) liqScore = Math.min(detected.liquidity.length * 3, 15);
  score += liqScore;

  // Indicator alignment (RSI + SMA) (15)
  // Compare per timeframe whether RSI & SMA agree with dominant
  let indicatorPoints = 0, indicatorTotal = 0;
  Object.keys(results).forEach(tf => {
    if (tf === "Overall") return;
    const r = results[tf];
    if (!r || r.Error) return;
    indicatorTotal++;
    const rsiOk = (dominant === "Up" && typeof r.RSI === "number" && r.RSI < 55) || (dominant === "Down" && typeof r.RSI === "number" && r.RSI > 45);
    const smaOk = (dominant === "Up" && typeof r.SMA50 === "number" && typeof r.SMA200 === "number" && r.SMA50 > r.SMA200) || (dominant === "Down" && typeof r.SMA50 === "number" && typeof r.SMA200 === "number" && r.SMA50 < r.SMA200);
    if (rsiOk) indicatorPoints += 1;
    if (smaOk) indicatorPoints += 1;
  });
  const indicatorScore = indicatorTotal ? (indicatorPoints / (indicatorTotal*2)) * 15 : 0;
  score += indicatorScore;

  // Normalize to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // mode adjustments
  if (mode === "conservative") score = Math.round(score * 0.9);
  if (mode === "aggressive") score = Math.round(Math.min(100, score * 1.05));

  return score;
}

// ------------------- PICK CHART BARS -------------------
function pickChartBars(barsByTf){
  const order = ["15min","1hour","4hour","daily","weekly"];
  for (const tf of order) if (barsByTf[tf] && barsByTf[tf].length) return {bars:barsByTf[tf], tf};
  return {bars:[], tf:null};
}

// ------------------- RUN LOGIC -------------------
const runBtn = document.getElementById("runBtn");
runBtn.onclick = async () => {
  const pair = pairSelect.value;
  const mode = modeSelect.value;

  if (!pair) return alert("Select pair");

  document.getElementById("results").innerHTML = `<div class="bg-white p-4 rounded-lg shadow">Running ${pair.replace("C:","")} ...</div>`;
  document.getElementById("chartMeta").textContent = "";
  document.getElementById("ictList").innerHTML = "";
  document.getElementById("confidenceBar").style.width = "0%";
  document.getElementById("confidenceText").textContent = "—";

  // storage
  const barsByTf = {};
  const results = {};

  const order = ["weekly","daily","4hour","1hour","15min"];
  for (let i=0;i<order.length;i++){
    const tf = order[i];
    if (i!==0) await sleep(600);

    let bars = await fetchForTimeframe(pair, tf);

    // intraday fallback -> daily
    if ((tf === "4hour" || tf === "1hour" || tf==="15min") && (!bars || bars.length === 0)){
      if (!barsByTf["daily"] || !barsByTf["daily"].length) barsByTf["daily"] = await fetchForTimeframe(pair, "daily");
      bars = barsByTf["daily"] || [];
    }

    barsByTf[tf] = bars;

    if (!bars || bars.length === 0){
      results[tf] = { Error:"No data", Bars:0 };
      continue;
    }

    const closes = bars.map(b=>b.c);
    const s50 = sma(closes,50);
    const s200 = sma(closes,200);
    const rsiVal = rsi(closes,14);

    results[tf] = {
      Close: closes.at(-1),
      RSI: isNaN(rsiVal) ? "N/A" : Number(rsiVal.toFixed(2)),
      SMA50: isNaN(s50) ? "N/A" : Number(s50.toFixed(6)),
      SMA200: isNaN(s200) ? "N/A" : Number(s200.toFixed(6)),
      Trend: trend(s50,s200),
      Bars: closes.length
    };
  }

  // overall
  const trendCounts = {};
  Object.values(results).forEach(r => { if (r && r.Trend && r.Trend!=="Neutral") trendCounts[r.Trend] = (trendCounts[r.Trend]||0)+1; });
  let dominant = "Neutral";
  if (Object.keys(trendCounts).length) dominant = Object.keys(trendCounts).reduce((a,b)=>trendCounts[a]>trendCounts[b]?a:b);
  const allRSIs = Object.values(results).map(r=> typeof r.RSI === "number" ? r.RSI : null).filter(x=>x!==null);
  const avgRsi = allRSIs.length ? Number((allRSIs.reduce((a,b)=>a+b,0)/allRSIs.length).toFixed(2)) : "N/A";

  let advice = "NEUTRAL";
  if (dominant==="Up" && avgRsi < 45) advice = "STRONG BUY";
  else if (dominant==="Down" && avgRsi > 55) advice = "STRONG SELL";
  else if (dominant==="Up") advice = "BUY";
  else if (dominant==="Down") advice = "SELL";

  results["Overall"] = { Dominant:dominant, AvgRSI:avgRsi, Advice:advice };

  // pick bars for chart
  const picked = pickChartBars(barsByTf);
  document.getElementById("chartMeta").innerHTML = picked.tf ? `<span class="timeframe-badge">${picked.tf.toUpperCase()}</span>` : "";

  // run ICT detection ON PICKED BARS (most granular chart)
  const barsForIct = picked.bars || [];
  const structure = barsForIct.length ? detectMarketStructure(barsForIct) : {pivotHighs:[],pivotLows:[],BOS:[],CHoCH:[]};
  const fvg = barsForIct.length ? detectFVG(barsForIct) : [];
  const obs = barsForIct.length ? detectOrderBlocks(barsForIct) : [];
  const liquidity = barsForIct.length ? detectLiquidity(barsForIct) : [];
  const detected = {structure, fvg, obs, liquidity};

  // compute ICT confidence
  const ictConfidence = computeIctConfidence(detected, results, barsByTf, mode);
  results["Overall"].Confidence = ictConfidence + "%";

  // render results & charts
  renderResults(results);
  renderCharts(picked.bars, detected);

  // update ICT list & confidence UI
  const ictList = document.getElementById("ictList");
  ictList.innerHTML = "";
  if (detected.structure.BOS && detected.structure.BOS.length) detected.structure.BOS.forEach(b => {
    ictList.insertAdjacentHTML("beforeend", `<li>Structure BOS: ${b.type} @ ${b.price.toFixed(5)}</li>`);
  });
  detected.fvg.forEach(f => {
    ictList.insertAdjacentHTML("beforeend", `<li>FVG ${f.type} @ [${f.low.toFixed(5)} - ${f.high.toFixed(5)}]</li>`);
  });
  detected.obs.forEach(o => {
    ictList.insertAdjacentHTML("beforeend", `<li>Order Block ${o.type} @ [${o.low.toFixed(5)} - ${o.high.toFixed(5)}]</li>`);
  });
  detected.liquidity.forEach(l => {
    ictList.insertAdjacentHTML("beforeend", `<li>Liquidity ${l.type} around ${l.price.toFixed(5)}</li>`);
  });

  document.getElementById("confidenceBar").style.width = results["Overall"].Confidence;
  document.getElementById("confidenceText").textContent = `ICT Confidence: ${results["Overall"].Confidence} (${mode} mode)`;
};

// ------------------- RENDER RESULTS -------------------
function renderResults(results){
  const container = document.getElementById("results");
  container.innerHTML = "";
  const order = ["weekly","daily","4hour","1hour","15min","Overall"];
  order.forEach(tf => {
    if (!results[tf]) return;
    const r = results[tf];
    const title = tf==="Overall" ? "Overall" : tf.toUpperCase();
    let body = "";
    if (r.Error) body = `<div class="text-red-600 font-semibold">${r.Error}</div>`;
    else {
      body = `<div class="grid grid-cols-2 gap-2 text-sm">`;
      for (const k in r) body += `<div class="text-gray-600">${k}</div><div class="font-mono">${r[k]}</div>`;
      body += `</div>`;
    }
    container.insertAdjacentHTML("beforeend", `
      <div class="bg-white p-4 rounded-xl shadow mb-3">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold">${title}</h3>
        </div>
        ${body}
      </div>
    `);
  });
}

// ------------------- RENDER CHARTS (with ICT overlays) -------------------
function renderCharts(bars, detected){
  const chartDiv = document.getElementById("chart");
  const rsiDiv = document.getElementById("rsiChart");
  chartDiv.innerHTML = ""; rsiDiv.innerHTML = "";

  if (!bars || bars.length === 0) {
    console.warn("No bars to render");
    return;
  }

  // prepare candle data
  let candleData = bars.map(b => ({
    time: Math.floor(Number(b.t)/1000),
    open: Number(b.o),
    high: Number(b.h),
    low:  Number(b.l),
    close:Number(b.c)
  }));

  // check sequence
  let bad = false;
  for (let i=1;i<candleData.length;i++) if (candleData[i].time <= candleData[i-1].time) { bad = true; break; }
  if (bad){
    const base = Math.floor(Date.now()/1000) - candleData.length * 15 * 60;
    candleData = candleData.map((c,i)=>({ ...c, time: base + i*15*60 }));
  }

  try {
    const chart = LightweightCharts.createChart(chartDiv, {
      layout:{background:{color:"#fff"},textColor:"#333"},
      grid:{vertLines:{color:"#eee"},horzLines:{color:"#eee"}},
      rightPriceScale:{scaleMargins:{top:0.1,bottom:0.1}},
      timeScale:{timeVisible:true, secondsVisible:false}
    });

    const candleSeries = chart.addCandlestickSeries();
    candleSeries.setData(candleData);

    // overlay: markers for BOS
    const markers = [];
    if (detected && detected.structure && detected.structure.BOS){
      detected.structure.BOS.forEach(b => {
        markers.push({
          time: Math.floor(b.time/1000),
          position: b.type === "Up" ? "aboveBar" : "belowBar",
          color: b.type === "Up" ? 'green' : 'red',
          shape: b.type === "Up" ? 'arrowUp' : 'arrowDown',
          text: `BOS ${b.type}`
        });
      });
    }
    candleSeries.setMarkers(markers);

    // overlay: FVG horizontal lines
    if (detected && detected.fvg) {
      detected.fvg.forEach((f, idx) => {
        // draw two horizontal lines (low & high) as tiny 2-point line series
        try {
          const nameHigh = `fvg-high-${idx}`;
          const sHigh = chart.addLineSeries({ color: 'rgba(200,90,90,0.9)', lineStyle: 2, priceLineVisible:false });
          sHigh.setData([{time: Math.floor(f.fromIdx ? bars[f.fromIdx].t/1000 : bars[0].t/1000), value: f.high}, {time: Math.floor(bars[bars.length-1].t/1000), value: f.high}]);
          const sLow = chart.addLineSeries({ color: 'rgba(90,200,120,0.9)', lineStyle: 2, priceLineVisible:false });
          sLow.setData([{time: Math.floor(f.fromIdx ? bars[f.fromIdx].t/1000 : bars[0].t/1000), value: f.low}, {time: Math.floor(bars[bars.length-1].t/1000), value: f.low}]);
        } catch(e) { /* ignore drawing error */ }
      });
    }

    // overlay: Order Blocks (draw horizontal pair lines)
    if (detected && detected.obs){
      detected.obs.forEach((o, idx) => {
        try {
          const color = o.type === "BullishOB" ? 'rgba(6,95,70,0.25)' : 'rgba(150,20,20,0.25)';
          const sTop = chart.addLineSeries({ color: color, lineWidth: 1, priceLineVisible:false });
          sTop.setData([{time: Math.floor(bars[0].t/1000), value: o.high}, {time: Math.floor(bars[bars.length-1].t/1000), value: o.high}]);
          const sBot = chart.addLineSeries({ color: color, lineWidth: 1, priceLineVisible:false });
          sBot.setData([{time: Math.floor(bars[0].t/1000), value: o.low}, {time: Math.floor(bars[bars.length-1].t/1000), value: o.low}]);
        } catch(e) {}
      });
    }

    // overlay: liquidity markers
    if (detected && detected.liquidity){
      const liqMarkers = detected.liquidity.slice(0,20).map((l, i) => ({
        time: Math.floor(bars[Math.max(0, Math.min(bars.length-1, l.idx1 || 0))].t/1000),
        position: 'inBar',
        color: '#f59e0b',
        shape: 'circle',
        text: `${l.type}`
      }));
      candleSeries.setMarkers((candleSeries.getMarkers ? candleSeries.getMarkers().concat(liqMarkers) : liqMarkers));
    }

    // RSI chart
    const closes = candleData.map(c=>c.close);
    const rsiData = [];
    for (let i=0;i<closes.length;i++){
      const seg = closes.slice(0,i+1);
      const val = rsi(seg,14);
      if (!isNaN(val)) rsiData.push({ time: candleData[i].time, value: Number(val.toFixed(2)) });
    }
    const rsiChart = LightweightCharts.createChart(rsiDiv, { layout:{background:{color:"#fff"}, textColor:"#333"}, rightPriceScale:{visible:true} });
    rsiChart.addLineSeries().setData(rsiData);

  } catch (err) {
    console.error("renderCharts error:", err);
  }
}

// ------------------- END DOMContentLoaded -------------------
}); // end
