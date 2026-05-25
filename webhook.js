const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

client.login(TOKEN);

client.once('ready', () => {
  console.log(`✅ Options X Webhook Bot online as ${client.user.tag}`);
});

// Find channel by partial name
function getChannel(guild, name) {
  return guild.channels.cache.find(c =>
    c.name.toLowerCase().includes(name.toLowerCase())
  );
}

// Format signal based on alert type
function formatSignal(data) {
  const { ticker, signal, price, timeframe } = data;

  let type = '';
  let risk = 'Medium';
  let setup = '';

  if (signal.toLowerCase().includes('bullish') || signal.toLowerCase().includes('buy')) {
    type = 'Call 📈';
    setup = signal;
  } else if (signal.toLowerCase().includes('bearish') || signal.toLowerCase().includes('sell')) {
    type = 'Put 📉';
    setup = signal;
  } else {
    type = 'Call / Put';
    setup = signal;
  }

  // Calculate rough strike suggestions
  const priceNum = parseFloat(price);
  const callStrike = Math.ceil(priceNum * 1.01);
  const putStrike = Math.floor(priceNum * 0.99);
  const strike = type.includes('Call') ? callStrike : putStrike;

  return `⚡ **OPTIONS X SIGNAL** *(Auto-detected)*

📌 **Ticker:** ${ticker}
📊 **Type:** ${type}
🎯 **Strike:** $${strike} *(adjust based on chain)*
📅 **Exp:** 1-2 weeks out
💰 **Entry:** Market open
🛑 **Stop:** Below/Above key EMA
✅ **Target:** 50-100% gain
📈 **Setup:** ${setup} on ${timeframe}
⚠️ **Risk:** ${risk}
🔢 **Suggested contracts:** 1-3

⚠️ *Always confirm entry on 15m before executing*`;
}

// Webhook endpoint — TradingView sends alerts here
app.post('/webhook', async (req, res) => {
  try {
    console.log('📨 Alert received:', req.body);

    const data = req.body;

    // Expected format from TradingView:
    // { "ticker": "NVDA", "signal": "Bullish CHoCH", "price": "127.50", "timeframe": "1H" }

    if (!data.ticker || !data.signal) {
      return res.status(400).json({ error: 'Missing ticker or signal' });
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
      return res.status(500).json({ error: 'Bot not in guild' });
    }

    const message = formatSignal(data);

    // Post to premium-signals
    const premiumCh = getChannel(guild, 'premium-signals');
    if (premiumCh) {
      await premiumCh.send(message);
      console.log(`✅ Signal posted for ${data.ticker}`);
    }

    // If SPY or QQQ also post market analysis
    if (['SPY', 'QQQ'].includes(data.ticker?.toUpperCase())) {
      const analysisCh = getChannel(guild, 'market-analysis');
      if (analysisCh) {
        await analysisCh.send(`📊 **MARKET ALERT — ${data.ticker}**\n${data.signal} detected at $${data.price} on ${data.timeframe}`);
      }
    }

    res.json({ success: true, ticker: data.ticker });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Options X Webhook Active ⚡',
    tickers: ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD'],
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on port ${PORT}`);
});
