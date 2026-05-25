const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());
app.use(express.text());

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

client.login(TOKEN);

client.once('ready', () => {
  console.log(`✅ Options X Webhook online as ${client.user.tag}`);
});

function getChannel(guild, name) {
  return guild.channels.cache.find(c =>
    c.name.toLowerCase().includes(name.toLowerCase())
  );
}

// Parse simple alert format:
// "NVDA 130 CALL entry 2.20 stop 1.20 exit 3.40"
// "SPY 520 PUT entry 1.50 stop 0.80 exit 2.80"
function parseAlert(text) {
  try {
    const clean = text.trim().toUpperCase();
    const words = clean.split(/\s+/);

    const result = {
      ticker: null,
      strike: null,
      type: null,
      entry: null,
      stop: null,
      exit: null,
    };

    // Get ticker — first word
    result.ticker = words[0];

    // Get type — CALL or PUT anywhere in message
    if (clean.includes('CALL')) result.type = 'Call 📈';
    if (clean.includes('PUT')) result.type = 'Put 📉';

    // Get strike — number before CALL/PUT or after ticker
    for (let i = 1; i < words.length; i++) {
      if (!isNaN(words[i]) && !result.strike && words[i].length <= 6) {
        result.strike = words[i];
      }
    }

    // Get entry, stop, exit values
    for (let i = 0; i < words.length; i++) {
      if (words[i] === 'ENTRY' && words[i+1]) result.entry = words[i+1];
      if (words[i] === 'STOP' && words[i+1]) result.stop = words[i+1];
      if ((words[i] === 'EXIT' || words[i] === 'TARGET') && words[i+1]) result.exit = words[i+1];
    }

    return result;
  } catch (e) {
    console.error('Parse error:', e);
    return null;
  }
}

function formatSignal(parsed, rawPrice) {
  const { ticker, strike, type, entry, stop, exit } = parsed;

  // Calculate expiration — next Friday by default
  const today = new Date();
  const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(today);
  nextFriday.setDate(today.getDate() + daysUntilFriday);
  const expDate = nextFriday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return `⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** ${ticker}
📊 **Type:** ${type || 'Call/Put'}
🎯 **Strike:** $${strike || 'TBD'}
📅 **Exp:** ${expDate}
💰 **Entry:** $${entry || 'Market'}
🛑 **Stop Loss:** $${stop || 'TBD'}
✅ **Target:** $${exit || 'TBD'}
📈 **Setup:** Key level triggered — confirm on 15m
⚠️ **Risk:** Medium
🔢 **Suggested contracts:** 1-3

⚠️ *Always confirm entry on 15m before executing*`;
}

// Main webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    // Accept both text and JSON
    let alertText = '';

    if (typeof req.body === 'string') {
      alertText = req.body;
    } else if (req.body && req.body.message) {
      alertText = req.body.message;
    } else if (req.body && req.body.text) {
      alertText = req.body.text;
    } else {
      alertText = JSON.stringify(req.body);
    }

    console.log('📨 Alert received:', alertText);

    const parsed = parseAlert(alertText);

    if (!parsed || !parsed.ticker) {
      return res.status(400).json({ error: 'Could not parse alert' });
    }

    const guild = client.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Bot not in guild' });

    const message = formatSignal(parsed);

    // Post to premium-signals
    const premiumCh = getChannel(guild, 'premium-signals');
    if (premiumCh) {
      await premiumCh.send(message);
      console.log(`✅ Signal posted: ${alertText}`);
    }

    // If SPY or QQQ also post to market-analysis
    if (['SPY', 'QQQ'].includes(parsed.ticker)) {
      const analysisCh = getChannel(guild, 'market-analysis');
      if (analysisCh) {
        await analysisCh.send(`📊 **MARKET ALERT — ${parsed.ticker} ${parsed.type || ''}**\nKey level triggered. Check #premium-signals for full details.`);
      }
    }

    res.json({ success: true, parsed });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: '⚡ Options X Webhook Active',
    format: 'NVDA 130 CALL entry 2.20 stop 1.20 exit 3.40',
    tickers: ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD'],
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server on port ${PORT}`);
});
