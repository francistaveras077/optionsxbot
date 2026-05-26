const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());
app.use(express.text({ type: '*/*' }));

const TOKEN = process.env.DISCORD_TOKEN;
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

// ─── YAHOO FINANCE OPTIONS ────────────────────────────────

async function getBestContract(ticker, type) {
  try {
    const isCall = type.toUpperCase() === 'CALL';

    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/options/${ticker}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        }
      }
    );

    const data = await res.json();
    const result = data?.optionChain?.result?.[0];
    if (!result) { console.log('❌ No Yahoo data for', ticker); return null; }

    const currentPrice = result?.quote?.regularMarketPrice || 0;
    console.log(`📊 ${ticker} price: $${currentPrice}`);

    const options = result?.options?.[0];
    const contracts = isCall ? options?.calls : options?.puts;
    if (!contracts || contracts.length === 0) { console.log('❌ No contracts found'); return null; }

    const today = new Date();
    const scored = contracts
      .map(c => {
        const expDate = new Date(c.expiration * 1000);
        const daysOut = Math.floor((expDate - today) / (1000 * 60 * 60 * 24));
        const volume = c.volume || 0;
        const oi = c.openInterest || 0;
        const ask = c.ask || 0;
        const bid = c.bid || 0;
        const strike = c.strike || 0;
        const spread = ask - bid;
        const expFormatted = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        let score = 0;
        if (daysOut >= 7 && daysOut <= 21) score += 40;
        else if (daysOut >= 5 && daysOut <= 30) score += 20;
        if (volume > 500) score += 30;
        else if (volume > 100) score += 15;
        if (oi > 1000) score += 20;
        else if (oi > 500) score += 10;
        if (ask > 0 && spread < ask * 0.15) score += 10;

        return { strike, ask, bid, spread, volume, oi, daysOut, expDate: expFormatted, score, currentPrice };
      })
      .filter(c => c.daysOut >= 3 && c.daysOut <= 60 && c.ask > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) { console.log('❌ No valid contracts after filter'); return null; }

    console.log(`✅ Best: Strike $${scored[0].strike} Exp ${scored[0].expDate} Ask $${scored[0].ask}`);
    return scored[0];

  } catch (err) {
    console.error('❌ Yahoo Finance error:', err.message);
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

  const entryLow = (contract.bid * 0.98).toFixed(2);
  const entryHigh = (contract.ask * 1.02).toFixed(2);
  const stop = (contract.bid * 0.55).toFixed(2);
  const target = (contract.ask * 2.0).toFixed(2);

  return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker}
📊 **Type:** ${typeEmoji}
🎯 **Strike:** $${contract.strike}
📅 **Exp:** ${contract.expDate} (${contract.daysOut} days)
💰 **Entry:** $${entryLow} — $${entryHigh}
🛑 **Stop Loss:** $${stop}
✅ **Target:** $${target}+
📊 **Volume:** ${contract.volume?.toLocaleString()}
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
    dataSource: 'Yahoo Finance',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => console.log(`🚀 Webhook server on port ${PORT}`));
