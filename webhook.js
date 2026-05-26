const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());
app.use(express.text({ type: '*/*' }));

const TOKEN = process.env.DISCORD_TOKEN;
const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.login(TOKEN);
client.once('ready', () => console.log(`✅ Options X Webhook online as ${client.user.tag}`));

function getChannel(guild, name) {
  return guild.channels.cache.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
}

const alpacaHeaders = {
  'APCA-API-KEY-ID': ALPACA_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET,
};

// ─── GET STOCK PRICE ─────────────────────────────────────

async function getStockPrice(ticker) {
  try {
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${ticker}/trades/latest`,
      { headers: alpacaHeaders }
    );
    const data = await res.json();
    return data?.trade?.p || 0;
  } catch (e) {
    return 0;
  }
}

// ─── GET BEST CONTRACT ────────────────────────────────────

async function getBestContract(ticker, type) {
  try {
    const isCall = type.toUpperCase() === 'CALL';
    const optionType = isCall ? 'call' : 'put';

    const currentPrice = await getStockPrice(ticker);
    console.log(`📊 ${ticker}: $${currentPrice}`);

    const today = new Date();
    const minDate = new Date();
    minDate.setDate(today.getDate() + 7);
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 21);

    const contractsRes = await fetch(
      `https://paper-api.alpaca.markets/v2/options/contracts?underlying_symbols=${ticker}&type=${optionType}&expiration_date_gte=${minDate.toISOString().split('T')[0]}&expiration_date_lte=${maxDate.toISOString().split('T')[0]}&status=active&limit=50`,
      { headers: alpacaHeaders }
    );

    const contractsData = await contractsRes.json();
    let contracts = contractsData?.option_contracts || [];

    if (contracts.length === 0) {
      const minDate2 = new Date();
      minDate2.setDate(today.getDate() + 5);
      const maxDate2 = new Date();
      maxDate2.setDate(today.getDate() + 30);
      const res2 = await fetch(
        `https://paper-api.alpaca.markets/v2/options/contracts?underlying_symbols=${ticker}&type=${optionType}&expiration_date_gte=${minDate2.toISOString().split('T')[0]}&expiration_date_lte=${maxDate2.toISOString().split('T')[0]}&status=active&limit=50`,
        { headers: alpacaHeaders }
      );
      contracts = (await res2.json())?.option_contracts || [];
    }

    if (contracts.length === 0) return null;

    const symbols = contracts.slice(0, 30).map(c => c.symbol).join(',');
    const snapshotRes = await fetch(
      `https://data.alpaca.markets/v1beta1/options/snapshots?symbols=${symbols}&feed=indicative`,
      { headers: alpacaHeaders }
    );

    const snapshots = (await snapshotRes.json())?.snapshots || {};

    const scored = contracts
      .map(c => {
        const snap = snapshots[c.symbol];
        if (!snap) return null;

        const greeks = snap.greeks || {};
        const quote = snap.latestQuote || {};
        const bar = snap.dailyBar || {};

        const delta = Math.abs(greeks.delta || 0);
        const gamma = greeks.gamma || 0;
        const theta = greeks.theta || 0;
        const vega = greeks.vega || 0;
        const bid = quote.bp || 0;
        const ask = quote.ap || 0;
        const volume = bar.v || 0;
        const iv = snap.impliedVolatility || 0;
        const strike = parseFloat(c.strike_price) || 0;
        const oi = parseInt(c.open_interest) || 0;
        const expDate = new Date(c.expiration_date);
        const daysOut = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
        const spread = ask - bid;
        const expFormatted = expDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }).replace(/\//g, '/');

        // ─── SCORING SYSTEM ───────────────────────────────

        let score = 0;

        // Delta — prefer ATM 0.40-0.55
        if (delta >= 0.40 && delta <= 0.55) score += 50;
        else if (delta >= 0.30 && delta <= 0.65) score += 30;
        else if (delta >= 0.20 && delta <= 0.75) score += 10;

        // Days to expiration
        if (daysOut >= 7 && daysOut <= 21) score += 30;
        else if (daysOut >= 5 && daysOut <= 30) score += 15;

        // Volume
        if (volume > 500) score += 20;
        else if (volume > 100) score += 10;

        // Spread quality
        if (ask > 0 && spread / ask < 0.10) score += 15;
        else if (ask > 0 && spread / ask < 0.20) score += 5;

        // Open Interest
        if (oi > 100) score += 10;

        // ─── NEW: Vol/OI ratio — unusual activity ─────────
        const volOiRatio = oi > 0 ? volume / oi : 0;
        if (volOiRatio > 3.0) score += 30; // very unusual — big money moving
        else if (volOiRatio > 1.5) score += 15; // unusual activity

        // ─── NEW: Theta penalty — avoid high decay ────────
        const thetaPct = ask > 0 ? Math.abs(theta) / ask : 0;
        if (thetaPct > 0.08) score -= 25; // losing >8% per day — too expensive
        else if (thetaPct > 0.05) score -= 10; // losing >5% per day — caution

        // ─── NEW: Expected move check ─────────────────────
        const expectedMove = currentPrice * iv * Math.sqrt(daysOut / 365);
        // Reward if target (2x entry) is within expected move
        const target = ask * 2.0;
        const priceTarget = isCall ? currentPrice + (target / 0.5) : currentPrice - (target / 0.5);
        if (Math.abs(priceTarget - currentPrice) <= expectedMove) score += 15;

        return {
          symbol: c.symbol, strike, bid, ask, delta, gamma, theta, vega,
          iv, volume, oi, daysOut, expDate: expFormatted, score, spread,
          currentPrice, volOiRatio, thetaPct, expectedMove
        };
      })
      .filter(c => c && c.ask > 0 && c.bid > 0 && c.daysOut >= 5)
      .sort((a, b) => b.score - a.score);

    return scored[0] || null;

  } catch (err) {
    console.error('❌ Options error:', err.message);
    return null;
  }
}

// ─── PARSE ALERT ─────────────────────────────────────────

function parseAlert(text) {
  const clean = text.trim().toUpperCase();
  const words = clean.split(/\s+/);
  const ticker = words[0];
  const type = clean.includes('CALL') ? 'CALL' : clean.includes('PUT') ? 'PUT' : null;
  const setupMatch = clean.match(/(?:CALL|PUT)\s+(.+)/);
  const setup = setupMatch ? setupMatch[1].replace(/\+/g, ' + ') : null;
  return { ticker, type, setup };
}

// ─── FORMAT SIGNAL ────────────────────────────────────────

function formatSignal(ticker, type, setup, c) {
  const typeEmoji = type === 'CALL' ? 'CALL' : 'PUT';
  const setupText = setup || 'Key level triggered';

  if (!c) {
    return `⚡ **${ticker} ${typeEmoji}**
📈 *${setupText}*
⚠️ Check chain manually — confirm on 15m`;
  }

  // Format expiration as MM/DD
  const stop = (c.bid * 0.55).toFixed(2);
  const target = (c.ask * 2.0).toFixed(2);
  const rr = ((c.ask * 2.0 - c.ask) / c.bid).toFixed(1);

  // Delta rating
  let deltaRating = c.delta >= 0.45 && c.delta <= 0.55 ? '🟢' : c.delta >= 0.35 ? '🟡' : '🔴';

  // IV rating  
  let ivRating = c.iv < 0.30 ? '🟢' : c.iv < 0.50 ? '🟡' : '🔴';

  // Vol/OI signal
  let flowSignal = '';
  if (c.volOiRatio > 3.0) flowSignal = ' 🔥 UNUSUAL FLOW';
  else if (c.volOiRatio > 1.5) flowSignal = ' ⚡ Active';

  // Main visible signal — clean and compact
  const mainSignal = `⚡ **${ticker} $${c.strike} ${typeEmoji} ${c.expDate}**
**ENTRY BID** $${c.bid.toFixed(2)} | **STOP** $${stop} | **EXIT** $${target}${flowSignal}`;

  // Hidden system data — collapsed in details
  const systemData = `
||**— SYSTEM DATA —**
📊 Delta: ${c.delta.toFixed(2)} ${deltaRating} | IV: ${(c.iv * 100).toFixed(1)}% ${ivRating}
📊 Theta: -$${Math.abs(c.theta).toFixed(3)}/day | Vega: ${c.vega.toFixed(3)}
📊 Volume: ${c.volume?.toLocaleString()} | OI: ${c.oi?.toLocaleString()}
📊 Vol/OI: ${c.volOiRatio.toFixed(2)} | Spread: ${c.ask > 0 ? ((c.spread / c.ask) * 100).toFixed(1) : 'N/A'}%
📊 Expected Move: ±$${c.expectedMove.toFixed(2)}
⚖️ Risk/Reward: 1:${rr}
📈 Setup: ${setupText}
⚠️ Always confirm on 15m before executing||`;

  return mainSignal + systemData;
}

// ─── WEBHOOK ─────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  try {
    let alertText = '';
    if (typeof req.body === 'string') alertText = req.body;
    else if (req.body?.message) alertText = req.body.message;
    else if (req.body?.text) alertText = req.body.text;
    else alertText = JSON.stringify(req.body);

    console.log('📨 Alert:', alertText);

    const parsed = parseAlert(alertText);
    if (!parsed.ticker || !parsed.type) {
      return res.status(400).json({ error: 'Format: NVDA CALL or NVDA CALL CHoCH+EMA' });
    }

    const guild = client.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Bot not in guild' });

    const contract = await getBestContract(parsed.ticker, parsed.type);
    const message = formatSignal(parsed.ticker, parsed.type, parsed.setup, contract);

    const premiumCh = getChannel(guild, 'premium-signals');
    if (premiumCh) await premiumCh.send(message);

    if (['SPY', 'QQQ'].includes(parsed.ticker)) {
      const analysisCh = getChannel(guild, 'market-analysis');
      if (analysisCh) {
        await analysisCh.send(`📊 **MARKET ALERT — ${parsed.ticker} ${parsed.type}**\nKey level triggered. Full signal in #premium-signals ⚡`);
      }
    }

    res.json({ success: true, ticker: parsed.ticker, type: parsed.type });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: '⚡ Options X Webhook Active',
    format: 'NVDA CALL or NVDA CALL CHoCH+EMA',
    scoring: ['Delta', 'DTE', 'Volume', 'Spread', 'OI', 'Vol/OI ratio', 'Theta decay', 'Expected move'],
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => console.log(`🚀 Webhook on port ${PORT}`));
