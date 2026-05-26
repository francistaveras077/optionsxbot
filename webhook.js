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

// ─── ALPACA HEADERS ──────────────────────────────────────

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
    console.error('Price error:', e.message);
    return 0;
  }
}

// ─── GET BEST OPTIONS CONTRACT ───────────────────────────

async function getBestContract(ticker, type) {
  try {
    const isCall = type.toUpperCase() === 'CALL';
    const optionType = isCall ? 'call' : 'put';

    // Get current stock price
    const currentPrice = await getStockPrice(ticker);
    console.log(`📊 ${ticker} price: $${currentPrice}`);

    // Look for contracts 7-21 days out
    const today = new Date();
    const minDate = new Date();
    minDate.setDate(today.getDate() + 7);
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 21);
    const minDateStr = minDate.toISOString().split('T')[0];
    const maxDateStr = maxDate.toISOString().split('T')[0];

    // Get contracts list
    const contractsRes = await fetch(
      `https://paper-api.alpaca.markets/v2/options/contracts?underlying_symbols=${ticker}&type=${optionType}&expiration_date_gte=${minDateStr}&expiration_date_lte=${maxDateStr}&status=active&limit=50`,
      { headers: alpacaHeaders }
    );

    const contractsData = await contractsRes.json();
    let contracts = contractsData?.option_contracts || [];
    console.log(`📋 Found ${contracts.length} contracts for ${ticker}`);

    // If no contracts in 7-21 days, try 5-30 days
    if (contracts.length === 0) {
      const minDate2 = new Date();
      minDate2.setDate(today.getDate() + 5);
      const maxDate2 = new Date();
      maxDate2.setDate(today.getDate() + 30);
      const contractsRes2 = await fetch(
        `https://paper-api.alpaca.markets/v2/options/contracts?underlying_symbols=${ticker}&type=${optionType}&expiration_date_gte=${minDate2.toISOString().split('T')[0]}&expiration_date_lte=${maxDate2.toISOString().split('T')[0]}&status=active&limit=50`,
        { headers: alpacaHeaders }
      );
      const data2 = await contractsRes2.json();
      contracts = data2?.option_contracts || [];
      console.log(`📋 Extended search: ${contracts.length} contracts`);
    }

    if (contracts.length === 0) return null;

    // Get symbols for snapshot
    const symbols = contracts.slice(0, 30).map(c => c.symbol).join(',');

    // Get snapshots with full data — delta, bid, ask, IV, volume
    const snapshotRes = await fetch(
      `https://data.alpaca.markets/v1beta1/options/snapshots?symbols=${symbols}&feed=indicative`,
      { headers: alpacaHeaders }
    );

    const snapshotData = await snapshotRes.json();
    const snapshots = snapshotData?.snapshots || {};
    console.log(`📊 Got snapshots for ${Object.keys(snapshots).length} contracts`);

    // Score each contract
    const scored = contracts
      .map(c => {
        const snap = snapshots[c.symbol];
        if (!snap) return null;

        const greeks = snap.greeks || {};
        const quote = snap.latestQuote || {};
        const bar = snap.dailyBar || {};

        const delta = Math.abs(greeks.delta || 0);
        const bid = quote.bp || 0;
        const ask = quote.ap || 0;
        const volume = bar.v || 0;
        const iv = snap.impliedVolatility || 0;
        const strike = parseFloat(c.strike_price) || 0;
        const oi = parseInt(c.open_interest) || 0;
        const expDate = new Date(c.expiration_date);
        const daysOut = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
        const spread = ask - bid;
        const expFormatted = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        // Score — prefer delta 0.35-0.55, good liquidity, tight spread
        let score = 0;
        if (delta >= 0.40 && delta <= 0.55) score += 50;
        else if (delta >= 0.30 && delta <= 0.65) score += 30;
        else if (delta >= 0.20 && delta <= 0.75) score += 10;
        if (daysOut >= 7 && daysOut <= 21) score += 30;
        else if (daysOut >= 5 && daysOut <= 30) score += 15;
        if (volume > 500) score += 20;
        else if (volume > 100) score += 10;
        if (ask > 0 && spread / ask < 0.10) score += 15;
        else if (ask > 0 && spread / ask < 0.20) score += 5;
        if (oi > 100) score += 10;

        return { 
          symbol: c.symbol, strike, bid, ask, delta, iv, volume, oi, 
          daysOut, expDate: expFormatted, score, spread, currentPrice 
        };
      })
      .filter(c => c && c.ask > 0 && c.bid > 0 && c.daysOut >= 5)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      console.log('❌ No contracts with snapshot data');
      return null;
    }

    const best = scored[0];
    console.log(`✅ Best: ${best.symbol} Strike $${best.strike} Delta ${best.delta?.toFixed(2)} Bid $${best.bid} Ask $${best.ask}`);
    return best;

  } catch (err) {
    console.error('❌ Options error:', err.message);
    return null;
  }
}

// ─── PARSE ALERT ─────────────────────────────────────────

function parseAlert(text) {
  const clean = text.trim().toUpperCase();
  return {
    ticker: clean.split(/\s+/)[0],
    type: clean.includes('CALL') ? 'CALL' : clean.includes('PUT') ? 'PUT' : null,
  };
}

// ─── FORMAT SIGNAL ────────────────────────────────────────

function formatSignal(ticker, type, c) {
  const typeEmoji = type === 'CALL' ? 'Call 📈' : 'Put 📉';

  if (!c) {
    return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker}
📊 **Type:** ${typeEmoji}
⚠️ *Options data unavailable — check chain manually*
📈 **Setup:** Key level triggered — confirm on 15m
🔢 **Suggested contracts:** 1-3

⚠️ *Always confirm entry on 15m before executing*`;
  }

  const entryLow = c.bid.toFixed(2);
  const entryHigh = c.ask.toFixed(2);
  const stop = (c.bid * 0.55).toFixed(2);
  const target = (c.ask * 2.0).toFixed(2);
  const ivPct = (c.iv * 100).toFixed(1);
  const spreadPct = c.ask > 0 ? ((c.spread / c.ask) * 100).toFixed(1) : 'N/A';

  return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker} @ $${c.currentPrice}
📊 **Type:** ${typeEmoji}
🎯 **Strike:** $${c.strike}
📅 **Exp:** ${c.expDate} (${c.daysOut} days)
💰 **Entry:** $${entryLow} — $${entryHigh}
🛑 **Stop Loss:** $${stop} (45% below bid)
✅ **Target:** $${target}+ (2x)
📊 **Delta:** ${c.delta?.toFixed(2)}
📊 **IV:** ${ivPct}%
📊 **Volume:** ${c.volume?.toLocaleString()}
📊 **Open Interest:** ${c.oi?.toLocaleString()}
📊 **Spread:** ${spreadPct}%
📈 **Setup:** Key level triggered — confirm on 15m
⚠️ **Risk:** Medium
🔢 **Suggested contracts:** 1-3

⚠️ *Always confirm entry on 15m before executing*`;
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
      return res.status(400).json({ error: 'Format: NVDA CALL or SPY PUT' });
    }

    const guild = client.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Bot not in guild' });

    console.log(`🔍 Fetching ${parsed.type} contracts for ${parsed.ticker}...`);
    const contract = await getBestContract(parsed.ticker, parsed.type);
    const message = formatSignal(parsed.ticker, parsed.type, contract);

    const premiumCh = getChannel(guild, 'premium-signals');
    if (premiumCh) {
      await premiumCh.send(message);
      console.log(`✅ Signal posted`);
    }

    if (['SPY', 'QQQ'].includes(parsed.ticker)) {
      const analysisCh = getChannel(guild, 'market-analysis');
      if (analysisCh) {
        await analysisCh.send(`📊 **MARKET ALERT — ${parsed.ticker} ${parsed.type}**\nKey level triggered. Full signal in #premium-signals ⚡`);
      }
    }

    res.json({ success: true, ticker: parsed.ticker, type: parsed.type, contract: contract?.symbol || 'not found' });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: '⚡ Options X Webhook Active',
    format: 'NVDA CALL or SPY PUT',
    dataSource: 'Alpaca — Delta, IV, Bid, Ask, Volume',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => console.log(`🚀 Webhook on port ${PORT}`));
