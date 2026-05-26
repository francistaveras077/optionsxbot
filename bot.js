const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const cron = require('node-cron');

const TOKEN = process.env.DISCORD_TOKEN;
const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
// News via Alpaca — no separate API key needed

if (!TOKEN) { console.error('❌ DISCORD_TOKEN not set'); process.exit(1); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

client.login(TOKEN);

client.once('ready', () => {
  console.log(`✅ Options X Bot online as ${client.user.tag}`);
  startScheduledJobs();
});

function getChannel(guild, name) {
  return guild.channels.cache.find(c =>
    c.name.toLowerCase().includes(name.toLowerCase())
  );
}

// ─── MARKET DATA ─────────────────────────────────────────

async function getStockData(ticker) {
  try {
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${ticker}/bars/latest?feed=iex`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        }
      }
    );
    const data = await res.json();
    return data?.bar || null;
  } catch (e) {
    console.error(`Error fetching ${ticker}:`, e.message);
    return null;
  }
}

async function getMultipleStocks(tickers) {
  const results = {};
  for (const ticker of tickers) {
    results[ticker] = await getStockData(ticker);
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

async function getMarketNews(tickers = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD']) {
  try {
    const symbols = tickers.join(',');
    const res = await fetch(
      `https://data.alpaca.markets/v1beta1/news?symbols=${symbols}&limit=10&sort=desc`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        }
      }
    );
    const data = await res.json();
    return data?.news?.map(n => n.headline).slice(0, 5) || [];
  } catch (e) {
    console.error('Alpaca news error:', e.message);
    return ['Could not fetch news'];
  }
}

// ─── AI ANALYSIS ─────────────────────────────────────────

async function generateWithClaude(prompt) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return null;
  }
}

// ─── PREMARKET ───────────────────────────────────────────

async function generatePremarket() {
  console.log('📊 Generating premarket...');

  const tickers = ['SPY', 'QQQ', 'VIX', 'NVDA', 'AAPL', 'AMD'];
  const stocks = await getMultipleStocks(tickers);
  const news = await getMarketNews();

  const stockSummary = Object.entries(stocks)
    .map(([t, d]) => d ? `${t}: Open $${d.o} High $${d.h} Low $${d.l} Close $${d.c} Volume ${d.v}` : `${t}: No data`)
    .join('\n');

  const newsSummary = news.join(' | ');

  const prompt = `You are an expert options trader writing a daily premarket analysis for a Discord community called Options X. 
  
Today's market data:
${stockSummary}

Today's news: ${newsSummary}

Write a concise premarket analysis in this EXACT format (replace brackets with real analysis):

📊 **PREMARKET DAILY** — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

🔍 **Market Bias Today:**
→ SPY: [BULLISH/BEARISH/NEUTRAL + one sentence reason]
→ QQQ: [BULLISH/BEARISH/NEUTRAL + one sentence reason]
→ VIX: [value + what it means]

📌 **Key Levels to Watch:**
→ SPY Support: $[X] | Resistance: $[X]
→ QQQ Support: $[X] | Resistance: $[X]

👀 **Tickers on Watchlist:**
→ NVDA — [one sentence setup]
→ AAPL — [one sentence setup]
→ AMD — [one sentence setup]

⚡ **Options Flow:**
→ [One insight about options activity or volatility]

📰 **News Moving Markets:**
→ [Most relevant news item for traders]

─────────────────────
Stay focused. Stay disciplined. ⚡

Keep it professional, concise and actionable. No fluff.`;

  const analysis = await generateWithClaude(prompt);
  return analysis || fallbackPremarket();
}

function fallbackPremarket() {
  return `📊 **PREMARKET DAILY** — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

⚠️ Market data temporarily unavailable.
Check SPY, QQQ levels manually before open.

Stay focused. Stay disciplined. ⚡`;
}

// ─── WATCHLIST ───────────────────────────────────────────

async function generateWatchlist() {
  console.log('📋 Generating watchlist...');

  const tickers = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD', 'MSFT', 'TSLA', 'META'];
  const stocks = await getMultipleStocks(tickers);
  const news = await getMarketNews();

  const stockSummary = Object.entries(stocks)
    .map(([t, d]) => d ? `${t}: $${d.c} (H:${d.h} L:${d.l} V:${d.v})` : `${t}: No data`)
    .join('\n');

  const prompt = `You are an expert options trader creating a weekly watchlist for Options X Discord community.

Market data:
${stockSummary}

News: ${news.join(' | ')}

Create a weekly watchlist in this EXACT format:

📋 **WEEKLY WATCHLIST** — Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}

🎯 **Top 5 Tickers This Week:**

1️⃣ **[TICKER]**
→ Bias: Bullish/Bearish
→ Key level: $[X]
→ Play: Call/Put — Strike area — 1-2 weeks out
→ Why: [one sentence SMC/EMA reason]

2️⃣ **[TICKER]**
→ Bias: Bullish/Bearish  
→ Key level: $[X]
→ Play: Call/Put — Strike area — 1-2 weeks out
→ Why: [one sentence reason]

3️⃣ **[TICKER]**
→ Bias: Bullish/Bearish
→ Key level: $[X]
→ Play: Call/Put — Strike area — 1-2 weeks out
→ Why: [one sentence reason]

4️⃣ **[TICKER]**
→ Bias: Bullish/Bearish
→ Key level: $[X]
→ Play: Call/Put — Strike area — 1-2 weeks out
→ Why: [one sentence reason]

5️⃣ **[TICKER]**
→ Bias: Bullish/Bearish
→ Key level: $[X]
→ Play: Call/Put — Strike area — 1-2 weeks out
→ Why: [one sentence reason]

📊 **Market Theme This Week:**
→ [Key macro theme or catalyst to watch]

⚠️ **Risk Events:**
→ [Earnings, Fed meetings, or major events this week]

─────────────────────
Stay one step ahead. ⚡

Be specific with price levels. Use SMC and EMA logic.`;

  const watchlist = await generateWithClaude(prompt);
  return watchlist || '📋 **WEEKLY WATCHLIST** — Update coming soon ⚡';
}

// ─── MARKET SCAN ─────────────────────────────────────────

async function generateMarketScan() {
  console.log('🔍 Generating market scan...');

  const tickers = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD'];
  const stocks = await getMultipleStocks(tickers);

  const stockSummary = Object.entries(stocks)
    .map(([t, d]) => d ? `${t}: $${d.c} H:${d.h} L:${d.l}` : `${t}: No data`)
    .join('\n');

  const prompt = `You are an expert options trader doing a mid-day market scan for Options X Discord.

Current market data:
${stockSummary}

Write a brief market scan update in this format:

📈 **MARKET SCAN** — ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} EST

**Market Status:**
→ SPY: [price action summary]
→ QQQ: [price action summary]

**Setups Developing:**
→ [Ticker]: [potential setup — Call or Put — key level]
→ [Ticker]: [potential setup — Call or Put — key level]

**Key Levels Holding:**
→ [Important level being tested]

⚠️ *Always confirm on 15m before entering* ⚡

Keep it very brief — 2-3 sentences per section max.`;

  const scan = await generateWithClaude(prompt);
  return scan || null;
}

// ─── EARNINGS ALERT ──────────────────────────────────────

async function generateEarningsAlert() {
  const prompt = `You are an options trading expert. Write a brief weekly earnings alert for Options X Discord community.

List the most important earnings this week that could affect options traders, especially for: SPY, QQQ, NVDA, AAPL, AMD, MSFT, META, TSLA, AMZN, GOOGL

Format:
📅 **EARNINGS THIS WEEK**

⚠️ High Impact:
→ [Company] ([Ticker]) — [Day] after/before close
→ [Company] ([Ticker]) — [Day] after/before close

📊 Medium Impact:
→ [Company] ([Ticker]) — [Day]

💡 **Strategy:** [One sentence on how to play earnings with options — avoid holding through earnings, consider IV crush]

─────────────────────
Manage risk around earnings ⚡

Use your knowledge of typical earnings calendars. If unsure of exact dates say "check earnings calendar".`;

  const alert = await generateWithClaude(prompt);
  return alert || null;
}

// ─── WEEKLY RECAP ────────────────────────────────────────

async function generateRecap() {
  const prompt = `You are an options trading coach writing a weekly recap for Options X Discord community.

Write an educational and motivational weekly recap in this format:

📅 **WEEKLY RECAP** — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}

📊 **Market Summary This Week:**
→ [Brief summary of what SPY/QQQ did this week]
→ [Key theme or event that drove markets]

💡 **Key Lessons This Week:**
→ [Trading lesson 1 — specific and actionable]
→ [Trading lesson 2 — specific and actionable]

♻️ **Wheel Strategy Reminder:**
→ [One tip about running the Wheel effectively]

📈 **SMC Insight:**
→ [One insight about CHoCH, BOS, or liquidity sweeps]

🎯 **Focus for Next Week:**
→ [What to watch and prepare for]

─────────────────────
Consistency beats perfection. ⚡

Keep it educational and motivational. No specific P&L numbers.`;

  const recap = await generateWithClaude(prompt);
  return recap || '📅 **WEEKLY RECAP** — Stay consistent. The edge compounds over time. ⚡';
}

// ─── FREE SIGNAL ─────────────────────────────────────────

async function generateFreeSignal() {
  const tickers = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD'];
  const stocks = await getMultipleStocks(tickers);

  const stockSummary = Object.entries(stocks)
    .map(([t, d]) => d ? `${t}: $${d.c}` : `${t}: No data`)
    .join(', ');

  const prompt = `You are an options trader. Based on these prices: ${stockSummary}

Generate ONE educational free signal example for Options X Discord. 
This is for educational purposes — show members what a good signal looks like.

Use this EXACT format:

🔥 **FREE SIGNAL OF THE WEEK**

⚡ **OPTIONS X SIGNAL**

📌 **Ticker:** [best looking ticker]
📊 **Type:** Call 📈 or Put 📉
🎯 **Strike:** $[reasonable strike near current price]
📅 **Exp:** [1-2 weeks out]
💰 **Entry:** $[estimated premium range]
🛑 **Stop Loss:** $[30-40% below entry]
✅ **Target:** $[2x entry]
📈 **Setup:** [SMC + EMA reason in one line]
⚠️ **Risk:** Medium
🔢 **Suggested contracts:** 1-3

─────────────────────
Want daily signals + full system?
Upgrade to Premium — Link in bio ⚡

⚠️ *Educational purposes only. Always do your own analysis.*`;

  const signal = await generateWithClaude(prompt);
  return signal || '🔥 **FREE SIGNAL** — Check #premium-signals for this week\'s setups ⚡';
}

// ─── SCHEDULED JOBS ──────────────────────────────────────

function startScheduledJobs() {
  const guild = client.guilds.cache.first();
  if (!guild) { console.log('❌ No guild found'); return; }

  console.log(`📡 Connected to: ${guild.name}`);
  console.log('⏰ Starting scheduled jobs...');

  // Premarket — Mon-Fri 8am EST (13:00 UTC)
  cron.schedule('0 13 * * 1-5', async () => {
    const ch = getChannel(guild, 'premarket-daily');
    if (ch) {
      const msg = await generatePremarket();
      await ch.send(msg);
      console.log('✅ Premarket posted');
    }
  });

  // Market scan — Mon-Fri 12pm EST (17:00 UTC)
  cron.schedule('0 17 * * 1-5', async () => {
    const ch = getChannel(guild, 'market-analysis');
    if (ch) {
      const msg = await generateMarketScan();
      if (msg) await ch.send(msg);
      console.log('✅ Market scan posted');
    }
  });

  // Earnings alert — Monday 8am EST (13:00 UTC)
  cron.schedule('0 13 * * 1', async () => {
    const ch = getChannel(guild, 'market-analysis');
    if (ch) {
      const msg = await generateEarningsAlert();
      if (msg) await ch.send(msg);
      console.log('✅ Earnings alert posted');
    }
  });

  // Free signal — Wednesday 10am EST (15:00 UTC)
  cron.schedule('0 15 * * 3', async () => {
    const ch = getChannel(guild, 'free-signals');
    if (ch) {
      const msg = await generateFreeSignal();
      await ch.send(msg);
      console.log('✅ Free signal posted');
    }
  });

  // Weekly recap — Friday 5pm EST (22:00 UTC)
  cron.schedule('0 22 * * 5', async () => {
    const ch = getChannel(guild, 'weekly-recaps');
    if (ch) {
      const msg = await generateRecap();
      await ch.send(msg);
      console.log('✅ Recap posted');
    }
  });

  // Weekly watchlist — Sunday 8pm EST (01:00 UTC Monday)
  cron.schedule('0 1 * * 1', async () => {
    const ch = getChannel(guild, 'weekly-watchlist');
    if (ch) {
      const msg = await generateWatchlist();
      await ch.send(msg);
      console.log('✅ Watchlist posted');
    }
  });

  console.log('✅ All scheduled jobs active');
}

// ─── MANUAL COMMANDS ─────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  if (message.content === '!premarket') {
    await message.reply('⏳ Generating premarket with AI...');
    const ch = getChannel(message.guild, 'premarket-daily');
    if (ch) { const msg = await generatePremarket(); await ch.send(msg); await message.reply('✅ Done!'); }
  }

  if (message.content === '!watchlist') {
    await message.reply('⏳ Generating watchlist with AI...');
    const ch = getChannel(message.guild, 'weekly-watchlist');
    if (ch) { const msg = await generateWatchlist(); await ch.send(msg); await message.reply('✅ Done!'); }
  }

  if (message.content === '!scan') {
    await message.reply('⏳ Scanning market...');
    const ch = getChannel(message.guild, 'market-analysis');
    if (ch) { const msg = await generateMarketScan(); if (msg) { await ch.send(msg); await message.reply('✅ Done!'); } }
  }

  if (message.content === '!earnings') {
    await message.reply('⏳ Getting earnings calendar...');
    const ch = getChannel(message.guild, 'market-analysis');
    if (ch) { const msg = await generateEarningsAlert(); if (msg) { await ch.send(msg); await message.reply('✅ Done!'); } }
  }

  if (message.content === '!recap') {
    await message.reply('⏳ Generating recap with AI...');
    const ch = getChannel(message.guild, 'weekly-recaps');
    if (ch) { const msg = await generateRecap(); await ch.send(msg); await message.reply('✅ Done!'); }
  }

  if (message.content === '!freesignal') {
    await message.reply('⏳ Generating free signal...');
    const ch = getChannel(message.guild, 'free-signals');
    if (ch) { const msg = await generateFreeSignal(); await ch.send(msg); await message.reply('✅ Done!'); }
  }

  if (message.content === '!signal') {
    const ch = getChannel(message.guild, 'premium-signals');
    if (ch) {
      await ch.send(`⚡ **OPTIONS X SIGNAL**\n\n📌 **Ticker:** \n📊 **Type:** Call 📈 / Put 📉\n🎯 **Strike:** $\n📅 **Exp:** \n💰 **Entry:** $ — $\n🛑 **Stop Loss:** $\n✅ **Target:** $+\n📈 **Setup:** \n⚠️ **Risk:** \n🔢 **Suggested contracts:** 1-3`);
      await message.reply('✅ Signal template posted');
    }
  }

  if (message.content === '!wheel') {
    const ch = getChannel(message.guild, 'wheel-strategy');
    if (ch) {
      await ch.send(`♻️ **WHEEL UPDATE**\n\n📌 **Ticker:** \n🔄 **Action:** CSP / CC\n🎯 **Strike:** $\n📅 **Exp:** \n💰 **Premium collected:** $\n📊 **Current position:** \n✅ **Status:** Open / Closed`);
      await message.reply('✅ Wheel template posted');
    }
  }

  if (message.content === '!help') {
    await message.reply(`⚡ **OPTIONS X BOT — AI POWERED**\n\n**AI Commands:**\n\`!premarket\` — AI premarket with real data\n\`!watchlist\` — AI weekly watchlist\n\`!scan\` — AI market scan\n\`!earnings\` — Earnings calendar\n\`!recap\` — AI weekly recap\n\`!freesignal\` — AI free signal\n\n**Manual Commands:**\n\`!signal\` — Signal template\n\`!wheel\` — Wheel template\n\n**Auto Schedule:**\n📅 Premarket → Mon-Fri 8am EST\n🔍 Market Scan → Mon-Fri 12pm EST\n📆 Earnings → Monday 8am EST\n🔥 Free Signal → Wednesday 10am EST\n📊 Recap → Friday 5pm EST\n📋 Watchlist → Sunday 8pm EST`);
  }
});
