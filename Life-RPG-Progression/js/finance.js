/* Finance market dashboard. Python fetches prices and stores daily history in SQLite. */
const $market = (id) => document.getElementById(id);
let marketPayload = null;
let marketRange = '1M';
const money = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const pointsNumber = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', {maximumFractionDigits:2});
const pct = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
const changeClass = (value) => value == null ? 'neutral' : Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : 'neutral';
const safe = (text) => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function loadSavedMarket() {
  try {
    const response = await fetch('/api/finance/market');
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    marketPayload = await response.json();
    renderMarket();
    if (!marketPayload.index) setStatus('No saved market readings yet. Press Refresh to fetch data.');
    else if (marketPayload.warnings?.length) setStatus(`S&P 500 loaded, but ${marketPayload.warnings.length} market-data request(s) had issues. Try refreshing.`, true);
  } catch (error) {
    setStatus(`Could not load saved market data: ${error.message}`, true);
  }
}
function setStatus(message, isError=false) {
  const el = $market('marketStatus'); if (!el) return;
  el.textContent = message; el.classList.toggle('market-error', isError);
}
async function refreshMarket() {
  const button = $market('marketRefresh');
  button.disabled = true; button.textContent = '↻ Fetching market data…';
  setStatus('Contacting Yahoo Finance and recording the latest available values…');
  try {
    const response = await fetch('/api/finance/refresh', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
    marketPayload = data; renderMarket();
    const warningCount = (data.warnings || []).length;
    setStatus(`Updated ${new Date(data.fetched_at).toLocaleString()}${warningCount ? ` · ${warningCount} market-data request(s) had issues` : ''}`, warningCount > 0);
  } catch (error) {
    setStatus(error.message || 'Market refresh failed.', true);
    if (!marketPayload?.index) $market('marketChartCaption').textContent = 'No data loaded. Make sure you started server.py, your internet is working, and try again. The status message above should include the provider error.';
  } finally {
    button.disabled = false; button.textContent = '↻ Refresh market data';
  }
}
function renderMarket() {
  if (!marketPayload) return;
  const index = marketPayload.index;
  if (index) {
    $market('sp500Value').textContent = pointsNumber(index.price);
    const change = index.change == null ? '' : `${Number(index.change) >= 0 ? '+' : ''}${Number(index.change).toFixed(2)} points`;
    const el = $market('sp500Change'); el.className = `market-change ${changeClass(index.change)}`;
    el.textContent = `${change}${change && index.change_percent != null ? ' · ' : ''}${index.change_percent == null ? 'Change unavailable' : pct(index.change_percent)} vs previous close`;
    $market('marketMeta').textContent = `Market date: ${index.market_date || 'unknown'} · ${marketPayload.source || 'Market data source'} · Values can be delayed; personal research only.`;
  }
  renderStocks(marketPayload.stocks || []);
  renderChart(marketPayload.history || []);
}
function renderStocks(stocks) {
  const body = $market('marketStocks');
  if (!stocks.length) { body.innerHTML = '<tr><td colspan="5" class="lock">No quote data yet. Press Refresh market data.</td></tr>'; return; }
  body.innerHTML = stocks.map(stock => {
    const cls = changeClass(stock.change_percent);
    const change = stock.change == null ? '—' : `${Number(stock.change)>=0?'+':''}${money(stock.change)}`;
    const changePercent = stock.change_percent == null ? '—' : pct(stock.change_percent);
    return `<tr><td>${safe(stock.rank)}</td><td>${safe(stock.name)}</td><td class="market-ticker">${safe(stock.symbol)}</td><td>${money(stock.price)}</td><td class="market-cell-change ${cls}">${change}<br><span class="market-small">${changePercent}</span></td></tr>`;
  }).join('');
}
function localDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }

function renderChart(history) {
  const svg = $market('marketChart');
  let points = [];
  let intraday = false;
  if (marketRange === '1D' || marketRange === '1W') {
    const raw = (marketPayload?.intraday || []).filter(p => p.close != null && p.timestamp);
    if (raw.length) {
      const withDates = raw.map(p => ({...p, parsed: new Date(p.timestamp)}));
      if (marketRange === '1D') {
        // Show the latest trading day represented by the downloaded observations.
        const latestDay = withDates[withDates.length - 1].parsed.toLocaleDateString('en-CA');
        points = withDates.filter(p => localDateKey(p.parsed) === latestDay).map(p => ({...p, date:p.parsed.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}));
      } else {
        const tradingDays = [...new Set(withDates.map(p => localDateKey(p.parsed)))];
        const shownDays = new Set(tradingDays.slice(-5));
        points = withDates.filter(p => shownDays.has(localDateKey(p.parsed))).map(p => ({...p, date:p.parsed.toLocaleDateString('en-US',{month:'short',day:'numeric'})}));
      }
      intraday = points.length > 1;
    }
  } else {
    const days = {'1M':31,'3M':92,'6M':183,'1Y':370}[marketRange] || 31;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    points = history.filter(p => p.close != null && new Date(`${p.date}T00:00:00`) >= cutoff);
  }
  if (points.length < 2) {
    svg.innerHTML = '<text x="24" y="40">Refresh market data to load this range.</text>';
    $market('marketChartCaption').textContent = (marketRange === '1D' || marketRange === '1W')
      ? 'Intraday history is not available yet. Press Refresh market data while the market data provider is reachable.'
      : (history.length ? 'Not enough points for this range yet.' : 'Refresh market data to download history and start your chart.');
    return;
  }
  const W=760,H=250,L=72,R=18,T=18,B=42,plotW=W-L-R,plotH=H-T-B;
  const values=points.map(p=>Number(p.close)); let min=Math.min(...values),max=Math.max(...values);
  if (min===max) { min*=.99; max*=1.01; }
  const pad=(max-min)*.08; min-=pad; max+=pad;
  const xy=points.map((p,i)=>({x:L+(i/(points.length-1))*plotW,y:T+(1-(Number(p.close)-min)/(max-min))*plotH,p}));
  const path=xy.map((v,i)=>`${i?'L':'M'}${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ');
  const area=`${path} L${xy[xy.length-1].x},${T+plotH} L${xy[0].x},${T+plotH} Z`;
  let grid='';
  for(let i=0;i<5;i++){
    const y=T+i*plotH/4,val=max-i*(max-min)/4;
    grid+=`<line class="chart-grid" x1="${L}" y1="${y}" x2="${W-R}" y2="${y}"/><text x="${L-9}" y="${y+4}" text-anchor="end">${Math.round(val).toLocaleString('en-US')}</text>`;
  }
  // Vertical guides mark elapsed time, with readable labels along the time axis.
  const tickIndexes=[0,Math.round((points.length-1)*.25),Math.round((points.length-1)*.5),Math.round((points.length-1)*.75),points.length-1];
  let timeGrid='';
  [...new Set(tickIndexes)].forEach((idx, n, arr)=>{
    const x=L+(idx/(points.length-1))*plotW;
    const p=points[idx];
    let label=p.date || '';
    if (intraday && marketRange==='1D') label=p.date;
    else if (intraday && marketRange==='1W') label=p.date;
    else label=p.date;
    const anchor=idx===0?'start':idx===points.length-1?'end':'middle';
    timeGrid+=`<line class="chart-grid chart-grid-vertical" x1="${x}" y1="${T}" x2="${x}" y2="${T+plotH}"/><text x="${x}" y="${H-8}" text-anchor="${anchor}">${safe(label)}</text>`;
  });
  svg.innerHTML=`<defs><linearGradient id="marketFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#42ff8a"/><stop offset="100%" stop-color="#42ff8a" stop-opacity="0"/></linearGradient></defs>${grid}${timeGrid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>`;
  const delta=values[values.length-1]-values[0], change=values[0] ? delta/values[0]*100 : 0;
  const start=points[0].date, end=points[points.length-1].date;
  const detail = marketRange==='1D' ? 'intraday observations' : marketRange==='1W' ? 'intraday observations across recent trading days' : 'daily closes';
  $market('marketChartCaption').textContent=`${points.length} ${detail} · ${start} to ${end} · ${delta>=0?'+':''}${delta.toFixed(2)} points (${change>=0?'+':''}${change.toFixed(2)}%) across this displayed range. Vertical guides show time progression.`;
}

document.addEventListener('DOMContentLoaded', () => {
  $market('marketRefresh')?.addEventListener('click', refreshMarket);
  document.querySelectorAll('[data-market-range]').forEach(button => button.addEventListener('click', () => {
    marketRange=button.dataset.marketRange;
    document.querySelectorAll('[data-market-range]').forEach(b=>b.classList.toggle('active',b===button));
    renderChart(marketPayload?.history || []);
  }));
  loadSavedMarket();
});
