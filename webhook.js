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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

client.login(TOKEN);
client.once('ready', () => console.log(`✅ Options X Webhook online as ${client.user.tag}`));

function getChannel(guild, name) {
  return guild.channels.cache.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
}

// ─── ALPACA PAPER API OPTIONS ─────────────────────────────

async function getBestContract(ticker, type) {
  try {
    const isCall = type.toUpperCase() === 'CALL';
    const optionType = isCall ? 'call' : 'put';

    // Get stock price
    const priceRes = await fetch(
      `https://data.alpaca.markets/v2/stocks/${ticker}/trades/latest`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        }
      }
    );
    const priceData = await priceRes.json();
    const currentPrice = priceData?.trade?.p || 0;
    console.log(`📊 ${ticker} price: $${currentPrice}`);

    // Date range — 7 to 30 days out
    const today = new Date();
    const minDate = new Date();
    minDate.setDate(today.getDate() + 7);
    const maxDate = new Date();
    maxDate.setDate(today.getDate() + 30);
    const minDateStr = minDate.toISOString().split('T')[0];
    const maxDateStr = maxDate.toISOString().split('T')[0];

    // Get contracts from paper API
    const contractsRes = await fetch(
      `https://paper-api.alpaca.markets/v2/options/contracts?underlying_symbols=${ticker}&type=${optionType}&expiration_date_gte=${minDateStr}&expiration_date_lte=${maxDateStr}&status=active&limit=50`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        }
      }
    );

    const contractsData = await contractsRes.json();
    const contracts = contractsData?.option_contracts || [];
    console.log(`📋 Found ${contracts.length} contracts for ${ticker}`);

    if (contracts.length === 0) return null;

    // Score contracts
    const scored = contracts.map(c => {
      const expDate = new Date(c.expiration_date);
      const daysOut = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
      const strike = parseFloat(c.strike_price) || 0;
      const closePrice = parseFloat(c.close_price) || 0;
      const oi = parseInt(c.open_interest) || 0;
      const expFormatted = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Prefer ATM contracts (strike close to current price)
      const distanceFromATM = Math.abs(strike - currentPrice);
      const atm_pct = currentPrice > 0 ? distanceFromATM / currentPrice : 1;

      let score = 0;
      if (daysOut >= 7 && daysOut <= 21) score += 40;
      else if (daysOut >= 5 && daysOut <= 30) score += 20;
      if (atm_pct < 0.02) score += 40; // very close to ATM
      else if (atm_pct < 0.05) score += 25;
      else if (atm_pct < 0.10) score += 10;
      if (oi > 10) score += 20;
      if (oi > 100) score += 10;

      // For calls: slightly OTM is better
      // For puts: slightly OTM is better
      if (isCall && strike > currentPrice && strike < currentPrice * 1.05) score += 15;
      if (!isCall && strike < currentPrice && strike > currentPrice * 0.95) score += 15;

      return { strike, closePrice, oi, daysOut, expDate: expFormatted, score, currentPrice, symbol: c.symbol };
    })
    .filter(c => c.daysOut >= 5 && c.daysOut <= 35)
    .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    const best = scored[0];
    console.log(`✅ Best: ${best.symbol} Strike $${best.strike} Exp ${best.expDate} Close $${best.closePrice}`);
    return best;

  } catch (err) {
    console.error('❌ Alpaca options error:', err.message);
    return null;
  }
}

// ─── PARSE ALERT ─────────────────────────────────────────

function parseAlert(text) {
  const clean = text.trim().toUpperCase();
  const words = clean.split(/\s+/);
  return {
    ticker: words[0],
    type: clean.includes('CALL') ? 'CALL' : clean.includes('PUT') ? 'PUT' : null,
  };
}

// ─── FORMAT SIGNAL ────────────────────────────────────────

function formatSignal(ticker, type, contract) {
  const typeEmoji = type === 'CALL' ? 'Call 📈' : 'Put 📉';

  if (!contract) {
    return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker}
📊 **Type:** ${typeEmoji}
⚠️ *Options data unavailable — check chain manually*
📈 **Setup:** Key level triggered — confirm on 15m
🔢 **Suggested contracts:** 1-3

⚠️ *Always confirm entry on 15m before executing*`;
  }

  // Estimate entry from close price
  const entryLow = (contract.closePrice * 0.97).toFixed(2);
  const entryHigh = (contract.closePrice * 1.03).toFixed(2);
  const stop = (contract.closePrice * 0.55).toFixed(2);
  const target = (contract.closePrice * 2.0).toFixed(2);

  return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker}
📊 **Type:** ${typeEmoji}
🎯 **Strike:** $${contract.strike}
📅 **Exp:** ${contract.expDate} (${contract.daysOut} days)
💰 **Entry:** $${entryLow} — $${entryHigh}
🛑 **Stop Loss:** $${stop}
✅ **Target:** $${target}+
📊 **Open Interest:** ${contract.oi?.toLocaleString()}
📈 **Setup:** Key level triggered — confirm on 15m
⚠️ **Risk:** Medium
🔢 **Suggested contracts:** 1-3

⚠️ *Always confirm entry on 15m before executing*`;
}

// ─── WEBHOOK ENDPOINT ─────────────────────────────────────

app.post('/webhook', async (req, res) => {
  try {
    let alertText = '';
    if (typeof req.body === 'string') alertText = req.body;
    else if (req.body?.message) alertText = req.body.message;
    else if (req.body?.text) alertText = req.body.text;
    else alertText = JSON.stringify(req.body);

    console.log('📨 Alert received:', alertText);

    const parsed = parseAlert(alertText);
    if (!parsed.ticker || !parsed.type) {
      return res.status(400).json({ error: 'Format: NVDA CALL or SPY PUT' });
    }

    const guild = client.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Bot not in guild' });

    console.log(`🔍 Fetching best ${parsed.type} for ${parsed.ticker}...`);
    const contract = await getBestContract(parsed.ticker, parsed.type);
    const message = formatSignal(parsed.ticker, parsed.type, contract);

    const premiumCh = getChannel(guild, 'premium-signals');
    if (premiumCh) {
      await premiumCh.send(message);
      console.log(`✅ Signal posted: ${parsed.ticker} ${parsed.type}`);
    }

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

// ─── HEALTH CHECK ─────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    status: '⚡ Options X Webhook Active',
    format: 'Send: NVDA CALL or SPY PUT',
    dataSource: 'Alpaca Paper API',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => console.log(`🚀 Webhook server on port ${PORT}`));
