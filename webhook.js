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

client.once('ready', () => {
  console.log(`✅ Options X Bot online as ${client.user.tag}`);
});

function getChannel(guild, name) {
  return guild.channels.cache.find(c =>
    c.name.toLowerCase().includes(name.toLowerCase())
  );
}

// Get options chain from Alpaca
async function getBestContract(ticker, type) {
  try {
    const side = type.toUpperCase() === 'CALL' ? 'call' : 'put';
    
    // Get current stock price first
    const priceRes = await fetch(
      `https://data.alpaca.markets/v2/stocks/${ticker}/quotes/latest`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        }
      }
    );
    
    const priceData = await priceRes.json();
    const currentPrice = priceData?.quote?.ap || priceData?.quote?.bp || 0;
    console.log(`📊 ${ticker} current price: $${currentPrice}`);

    // Get options chain
    const optRes = await fetch(
      `https://data.alpaca.markets/v1beta1/options/snapshots/${ticker}?feed=indicative&limit=100&type=${side}`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        }
      }
    );

    const optData = await optRes.json();
    const snapshots = optData?.snapshots || {};
    
    if (Object.keys(snapshots).length === 0) {
      console.log('No options data found');
      return null;
    }

    // Filter and score contracts
    const contracts = Object.entries(snapshots)
      .map(([symbol, data]) => {
        const greeks = data?.greeks || {};
        const quote = data?.latestQuote || {};
        const details = data?.details || {};
        
        const delta = Math.abs(greeks?.delta || 0);
        const volume = data?.dailyBar?.v || 0;
        const oi = greeks?.openInterest || 0;
        const ask = quote?.ap || 0;
        const bid = quote?.bp || 0;
        const spread = ask - bid;
        const expDate = details?.expirationDate || '';
        const strike = details?.strikePrice || 0;

        // Score: prefer delta 0.35-0.50, high volume, low spread, 7-21 days out
        const today = new Date();
        const exp = new Date(expDate);
        const daysOut = Math.floor((exp - today) / (1000 * 60 * 60 * 24));

        let score = 0;
        if (delta >= 0.35 && delta <= 0.50) score += 40;
        else if (delta >= 0.25 && delta <= 0.60) score += 20;
        if (daysOut >= 7 && daysOut <= 21) score += 30;
        else if (daysOut >= 5 && daysOut <= 30) score += 15;
        if (volume > 100) score += 20;
        if (spread < ask * 0.10) score += 10;

        return { symbol, delta, volume, oi, ask, bid, spread, expDate, strike, daysOut, score };
      })
      .filter(c => c.daysOut >= 5 && c.daysOut <= 30 && c.ask > 0)
      .sort((a, b) => b.score - a.score);

    return contracts[0] || null;

  } catch (err) {
    console.error('Alpaca error:', err.message);
    return null;
  }
}

// Parse alert text
function parseAlert(text) {
  const clean = text.trim().toUpperCase();
  const words = clean.split(/\s+/);

  return {
    ticker: words[0],
    type: clean.includes('CALL') ? 'CALL' : clean.includes('PUT') ? 'PUT' : null,
  };
}

// Format Discord message
function formatSignal(ticker, type, contract) {
  const typeEmoji = type === 'CALL' ? 'Call 📈' : 'Put 📉';

  if (!contract) {
    return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker}
📊 **Type:** ${typeEmoji}
⚠️ *Could not fetch options data — check chain manually*
📈 **Setup:** Key level triggered on 1H
🔢 **Suggested contracts:** 1-3

⚠️ *Confirm entry on 15m before executing*`;
  }

  const expFormatted = new Date(contract.expDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const entryLow = (contract.bid * 0.95).toFixed(2);
  const entryHigh = (contract.ask * 1.05).toFixed(2);
  const stop = (contract.bid * 0.60).toFixed(2);
  const target = (contract.ask * 2.0).toFixed(2);

  return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker}
📊 **Type:** ${typeEmoji}
🎯 **Strike:** $${contract.strike}
📅 **Exp:** ${expFormatted} (${contract.daysOut} days)
💰 **Entry:** $${entryLow} — $${entryHigh}
🛑 **Stop Loss:** $${stop}
✅ **Target:** $${target}+
📊 **Delta:** ${contract.delta.toFixed(2)}
📊 **Volume:** ${contract.volume.toLocaleString()}
📈 **Setup:** Key level triggered — confirm on 15m
⚠️ **Risk:** Medium
🔢 **Suggested contracts:** 1-3

⚠️ *Always confirm entry on 15m before executing*`;
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    let alertText = '';

    if (typeof req.body === 'string') {
      alertText = req.body;
    } else if (req.body?.message) {
      alertText = req.body.message;
    } else if (req.body?.text) {
      alertText = req.body.text;
    } else {
      alertText = JSON.stringify(req.body);
    }

    console.log('📨 Alert received:', alertText);

    const parsed = parseAlert(alertText);

    if (!parsed.ticker || !parsed.type) {
      return res.status(400).json({ error: 'Format: NVDA CALL or SPY PUT' });
    }

    const guild = client.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Bot not in guild' });

    // Fetch best contract from Alpaca
    console.log(`🔍 Fetching best ${parsed.type} contract for ${parsed.ticker}...`);
    const contract = await getBestContract(parsed.ticker, parsed.type);

    const message = formatSignal(parsed.ticker, parsed.type, contract);

    // Post to premium-signals
    const premiumCh = getChannel(guild, 'premium-signals');
    if (premiumCh) {
      await premiumCh.send(message);
      console.log(`✅ Signal posted: ${parsed.ticker} ${parsed.type}`);
    }

    // If SPY or QQQ also alert market-analysis
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

// Health check
app.get('/', (req, res) => {
  res.json({
    status: '⚡ Options X Webhook Active',
    format: 'Send: NVDA CALL or SPY PUT',
    tickers: ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD'],
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server on port ${PORT}`);
});
