const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- CONFIG ----------
const GIVEAWAY_PAGE = 'https://myfundedperpetuals.com/rewards?tab=giveaways';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || ''; // set in Render dashboard
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''; // e.g., 8527111427:AAE2OeR35qsJ4sV3Z_fJo9Stm1TZ4-SvAyY
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''; // your chat ID with the bot
const NO_GIVEAWAY_TEXT = 'No Giveaways Available';
const CHECK_INTERVAL_MS = 45000;   // 45 seconds between page reloads
const COOLDOWN_AFTER_ENTRY_MS = 1800000; // 30 min cooldown after a successful click
const SELF_PING_INTERVAL_MS = 180000;   // 3 minutes — primary keep-alive
// ------------------------------------------------------

// ---------- Self-ping loop (primary keep-alive) ----------
// Pings its own /ping endpoint every 3 minutes to keep Render awake.
// UptimeRobot is still configured as a backup on the free tier.
function startSelfPingLoop() {
  const pingUrl = `http://localhost:${PORT}/ping`;
  setInterval(async () => {
    try {
      await fetch(pingUrl, { method: 'GET' });
      console.log('[self-ping] Keep-alive ping sent to self.');
    } catch (err) {
      console.error('[self-ping] Failed to ping self:', err.message);
    }
  }, SELF_PING_INTERVAL_MS);
}

// ---------- Keep-Alive for UptimeRobot (backup) ----------
app.get('/ping', (req, res) => {
  console.log('[ping] UptimeRobot keep-alive received.');
  res.status(200).send('Alive');
});

// ---------- Send Discord alert (if webhook configured) ----------
async function sendAlert(message) {
  // Send to Discord if webhook configured
  if (DISCORD_WEBHOOK) {
    try {
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      });
      console.log('[alert] Discord notification sent.');
    } catch (err) {
      console.error('[alert] Failed to send Discord notification:', err.message);
    }
  }

  // Send to Telegram if bot token and chat ID configured
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
      });
      console.log('[alert] Telegram notification sent.');
    } catch (err) {
      console.error('[alert] Failed to send Telegram notification:', err.message);
    }
  }
  if (!DISCORD_WEBHOOK && (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID)) {
    console.log('[alert] No webhook/Telegram configured. Would send:', message);
  }
}

// ---------- Main bot loop ----------
async function runBot() {
  console.log('Launching headless browser...');

  const browser = await puppeteer.connect({
  browserWSEndpoint: 'ws://127.0.0.1:9222',
});

  const page = await browser.newPage();

  // Spoof a normal desktop Chrome user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Inject session cookies so we stay logged in as "baapji"
  const cookiesPath = path.join(__dirname, 'cookies.json');
  if (fs.existsSync(cookiesPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      await page.setCookie(...cookies);

    // ✅ Cookie validity check - check expiration dates
    const now = Date.now() / 1000;
    const expiredCookies = cookies.filter(cookie => cookie.expirationDate && cookie.expirationDate * 1000 < now);
    if (expiredCookies.length > 0) {
      console.warn('⚠️ Cookie validity check: Found', expiredCookies.length, 'expired cookie(s).');
      await sendAlert(`⚠️ **Cookie Warning**\n\nFound ${expiredCookies.length} expired cookie(s).\n\nSome functionality may be limited.\n\nCheck https://myfundedperpetuals.com manually.`);
    } else {
      console.log('🔒 Session cookies injected successfully - all cookies valid.');
    }
    } catch (err) {
      console.error('❌ Failed to parse cookies.json:', err.message);
    }
  } else {
    console.error('❌ cookies.json not found at:', cookiesPath);
    console.error('   Export your cookies from the logged-in MFP page and commit cookies.json to the repo.');
  }

  let cooldownUntil = 0;

  while (true) {
    const now = Date.now();

    // If we just entered a giveaway, wait out the cooldown before checking again
    if (now < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - now) / 1000);
      console.log(`⏳ Cooldown active. Resuming in ${remaining}s...`);
      await sleep(CHECK_INTERVAL_MS);
      continue;
    }

    try {
      console.log(`🔄 Loading ${GIVEAWAY_PAGE}...`);
      await page.goto(GIVEAWAY_PAGE, { waitUntil: 'networkidle2', timeout: 60000 });

      // Check whether the "No Giveaways Available" text is still on the page
      const pageText = await page.evaluate(() => document.body.innerText);
      const noGiveawaysVisible = pageText.includes(NO_GIVEAWAY_TEXT);

      if (noGiveawaysVisible) {
        console.log('📭 Status: No Giveaways Available. Checking again soon...');
      } else {
        console.log('🚨 Change detected! "No Giveaways Available" is gone — giveaway panel may be active.');

        // Try to find and click an Enter / Claim button
        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const target = buttons.find(
            (b) =>
              b.innerText.includes('Enter') ||
              b.innerText.includes('Claim') ||
              b.innerText.includes('Participate')
          );
          if (target) {
            target.click();
            return true;
          }
          return false;
        });

        if (clicked) {
          console.log('🎉 Successfully clicked the giveaway entry button!');
          await sendAlert(
            `🎉 **My Funded Perps Giveaway Bot**\n\nSuccessfully entered a giveaway on your account!\n\nCheck https://myfundedperpetuals.com to confirm.`
          );
          cooldownUntil = Date.now() + COOLDOWN_AFTER_ENTRY_MS;
        } else {
          console.log('⚠️ Giveaway panel is visible but no matching Enter/Claim button found.');
        }
      }
    } catch (err) {
      console.error('❌ Loop error:', err.message);
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Boot ----------
async function initializeBot() {
  console.log(`🌐 Server listening on port ${PORT}`);
  console.log(`📡 Self-ping loop started (every 3 min).`);

  // 🤖 Send startup notification to Telegram
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const startupMsg = `🚀 **MFP Giveaway Bot Started**\n\nService is online on port ${PORT}.\n🕵️ Monitoring: ${GIVEAWAY_PAGE}\n📅 Check time: ${new Date().toLocaleString()}`;
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: startupMsg }),
      });
      console.log('[startup] Telegram notification sent.');
    } catch (err) {
      console.error('[startup] Failed to send Telegram notification:', err.message);
    }
  }
}

app.listen(PORT, () => {
  initializeBot().catch((err) => console.error('Failed to initialize bot:', err));
  startSelfPingLoop();
  runBot().catch((err) => {
    console.error('💥 Bot crashed:', err);
    // 📝 Log crash to file
    const fs = require('fs');
    const logMsg = `[${new Date().toISOString()}] BOT CRASH: ${err.message}\n`;
    fs.appendFile('bot_crash.log', logMsg, (err) => {
      if (err) console.error('Failed to write crash log:', err);
    });
  });
});
