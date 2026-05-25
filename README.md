# ⚡ Options X Bot — Setup Guide

## Installation

1. Install Node.js from nodejs.org
2. Open terminal in this folder
3. Run: npm install
4. Run: npm start

## Commands (Admin only)

| Command | Action |
|---|---|
| !signal | Post signal template to #premium-signals |
| !wheel | Post wheel update to #wheel-strategy |
| !premarket | Post premarket manually |
| !watchlist | Post watchlist manually |
| !recap | Post weekly recap manually |
| !help | Show all commands |

## Auto Schedule

| Message | Channel | Time |
|---|---|---|
| Premarket | #premarket-daily | Mon-Fri 8am EST |
| Watchlist | #weekly-watchlist | Sunday 8pm EST |
| Recap | #weekly-recaps | Friday 5pm EST |
| Free Signal | #free-signals | Wednesday 10am EST |

## How to use

1. Start the bot: npm start
2. Bot posts templates automatically on schedule
3. BEFORE each auto-post fires, edit the template in bot.js with real data
4. Or use commands to post manually anytime

## Keep bot running 24/7

Host on Railway.app (free):
1. Go to railway.app
2. New project → Deploy from GitHub
3. Upload this folder
4. Done — bot runs forever

