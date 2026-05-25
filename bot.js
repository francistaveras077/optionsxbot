const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const cron = require('node-cron');

// Token comes from environment variable — never hardcoded
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN environment variable not set');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// ─── MESSAGES ───────────────────────────────────────────

const premiumMessages = {
  premarket: () => `📊 **PREMARKET DAILY** — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

🔍 **Market Bias Today:**
→ SPY: [BULLISH / BEARISH / NEUTRAL]
→ QQQ: [BULLISH / BEARISH / NEUTRAL]
→ VIX: [value]

📌 **Key Levels to Watch:**
→ SPY Support: $XXX | Resistance: $XXX
→ QQQ Support: $XXX | Resistance: $XXX

👀 **Tickers on Watchlist:**
→ [Ticker 1] — reason
→ [Ticker 2] — reason
→ [Ticker 3] — reason

⚡ **Options Flow Overnight:**
→ [Notable unusual activity]

📰 **News Moving Markets:**
→ [Key news item]

─────────────────────
Stay focused. Stay disciplined. ⚡`,

  watchlist: () => `📋 **WEEKLY WATCHLIST** — Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}

🎯 **Top Tickers This Week:**

1️⃣ **[TICKER]**
→ Bias: Bullish/Bearish
→ Key level: $XXX
→ Play: Call/Put — Strike — Exp

2️⃣ **[TICKER]**
→ Bias: Bullish/Bearish
→ Key level: $XXX
→ Play: Call/Put — Strike — Exp

3️⃣ **[TICKER]**
→ Bias: Bullish/Bearish
→ Key level: $XXX
→ Play: Call/Put — Strike — Exp

📊 **Market Theme This Week:**
→ [Key macro theme or catalyst]

─────────────────────
Update tickers before Monday 8am EST ⚡`,

  recap: () => `📅 **WEEKLY RECAP** — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}

📊 **This Week's Results:**

✅ Wins: X
❌ Losses: X
📈 Win Rate: XX%

**Signals Breakdown:**
→ [Signal 1]: +XX% ✅
→ [Signal 2]: -XX% ❌
→ [Signal 3]: +XX% ✅

💰 **Wheel Strategy Update:**
→ Premiums collected: $XXX
→ Active positions: X

🔄 **Reinvestment This Week:**
→ Profits reinvested: $XXX
→ New Wheel positions: X

📚 **Lesson of the Week:**
→ [Key takeaway]

🎯 **Focus for Next Week:**
→ [Preview]

─────────────────────
Consistency beats perfection. ⚡`,

  freeSignal: () => `🔥 **FREE SIGNAL OF THE WEEK**

⚡ **OPTIONS X SIGNAL**

📌 Ticker: [TICKER]
📊 Type: Call / Put
🎯 Strike: $XXX
📅 Exp: [Date]
💰 Entry: $X.XX — $X.XX
🛑 Stop Loss: $X.XX
✅ Target: $X.XX+
📈 Setup: CHoCH + Liquidity Sweep + EMA confirmation
⚠️ Risk: Low / Medium / High
🔢 Suggested contracts: 1-3

─────────────────────
Want daily signals + full system?
Upgrade to Premium 👇
[Your Whop Link]`
};

// ─── FIND CHANNEL ────────────────────────────────────────

function getChannel(guild, name) {
  return guild.channels.cache.find(c => c.name === name);
}

// ─── SCHEDULED JOBS ──────────────────────────────────────

client.once('ready', () => {
  console.log(`✅ Options X Bot is online as ${client.user.tag}`);

  const guild = client.guilds.cache.first();
  if (!guild) {
    console.log('❌ No guild found');
    return;
  }

  console.log(`📡 Connected to: ${guild.name}`);

  // Premarket — Mon-Fri at 8:00am EST (13:00 UTC)
  cron.schedule('0 13 * * 1-5', async () => {
    const ch = getChannel(guild, 'premarket-daily');
    if (ch) {
      await ch.send(premiumMessages.premarket());
      console.log('✅ Premarket posted');
    }
  });

  // Weekly Watchlist — Sunday at 8:00pm EST (01:00 UTC Monday)
  cron.schedule('0 1 * * 1', async () => {
    const ch = getChannel(guild, 'weekly-watchlist');
    if (ch) {
      await ch.send(premiumMessages.watchlist());
      console.log('✅ Watchlist posted');
    }
  });

  // Weekly Recap — Friday at 5:00pm EST (22:00 UTC)
  cron.schedule('0 22 * * 5', async () => {
    const ch = getChannel(guild, 'weekly-recaps');
    if (ch) {
      await ch.send(premiumMessages.recap());
      console.log('✅ Recap posted');
    }
  });

  // Free Signal — Wednesday at 10:00am EST (15:00 UTC)
  cron.schedule('0 15 * * 3', async () => {
    const ch = getChannel(guild, 'free-signals');
    if (ch) {
      await ch.send(premiumMessages.freeSignal());
      console.log('✅ Free signal posted');
    }
  });

  console.log('⏰ All scheduled jobs active');
});

// ─── COMMANDS ────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  if (message.content === '!signal') {
    const ch = getChannel(message.guild, 'premium-signals');
    if (ch) {
      await ch.send(`⚡ **OPTIONS X SIGNAL**

📌 Ticker: 
📊 Type: Call / Put
🎯 Strike: $
📅 Exp: 
💰 Entry: $ — $
🛑 Stop Loss: $
✅ Target: $+
📈 Setup: 
⚠️ Risk: 
🔢 Suggested contracts: 1-3`);
      await message.reply('✅ Signal template posted in #premium-signals');
    }
  }

  if (message.content === '!wheel') {
    const ch = getChannel(message.guild, 'wheel-strategy');
    if (ch) {
      await ch.send(`♻️ **WHEEL UPDATE**

📌 Ticker: 
🔄 Action: CSP / CC
🎯 Strike: $
📅 Exp: 
💰 Premium collected: $
📊 Current position: 
✅ Status: Open / Closed`);
      await message.reply('✅ Wheel template posted');
    }
  }

  if (message.content === '!premarket') {
    const ch = getChannel(message.guild, 'premarket-daily');
    if (ch) {
      await ch.send(premiumMessages.premarket());
      await message.reply('✅ Premarket posted');
    }
  }

  if (message.content === '!recap') {
    const ch = getChannel(message.guild, 'weekly-recaps');
    if (ch) {
      await ch.send(premiumMessages.recap());
      await message.reply('✅ Recap posted');
    }
  }

  if (message.content === '!watchlist') {
    const ch = getChannel(message.guild, 'weekly-watchlist');
    if (ch) {
      await ch.send(premiumMessages.watchlist());
      await message.reply('✅ Watchlist posted');
    }
  }

  if (message.content === '!help') {
    await message.reply(`⚡ **OPTIONS X BOT COMMANDS**

\`!signal\` — Post signal template to #premium-signals
\`!wheel\` — Post wheel update template
\`!premarket\` — Post premarket manually
\`!watchlist\` — Post watchlist manually
\`!recap\` — Post weekly recap manually
\`!help\` — Show this menu

**Auto Schedule:**
📅 Premarket → Mon-Fri 8am EST
📋 Watchlist → Sunday 8pm EST
📊 Recap → Friday 5pm EST
🔥 Free Signal → Wednesday 10am EST`);
  }
});

client.login(TOKEN);
