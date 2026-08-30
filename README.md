# 🤖 Research Bot - Autonomous Infra for Meta AI

**Optimized for Meta AI to drive the bot while you're away. 100% free, one-click deploy.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB/research-bot-autonomous)

### What this does (for Meta AI)
- Meta AI can add tasks by opening: `https://your-worker.workers.dev/?task=Research X`
- Meta AI can read results by opening: `https://your-worker.workers.dev/`
- No API keys needed in URL - uses Cloudflare bindings
- Local Chrome extension (Bot Lab) polls `/poll` every 30s
- If extension offline, Cloudflare Browser Rendering fallback (10 min/day free) can do research
- Results stored in D1 (5M reads/day free) + KV (100K reads/day free) + R2 (10GB free)

### One-Click Deploy (Least Human Involvement)

1. Click **Deploy to Cloudflare** button above
2. Cloudflare will:
   - Clone repo to your GitHub
   - Auto-create KV namespace, D1 database, R2 bucket (no manual wrangler commands)
   - Deploy Worker + Pages
   - Give you URL: `https://research-bot-autonomous.<your-subdomain>.workers.dev`

3. Copy that URL into:
   - `bot-extension/background.js` -> `CLOUDFLARE_WORKER_URL`
   - Reload extension in `chrome://extensions`

4. Give the Worker URL to Meta AI in chat:
   "My worker is at https://research-bot-autonomous.moin.workers.dev - you can now add tasks yourself"

### How Meta AI adds tasks autonomously

Meta AI uses browser tool:

```
browser.open("https://research-bot-autonomous.moin.workers.dev/?task=Research top 5 browser automation frameworks")
```

Worker returns HTML confirming task queued. Bot Lab extension picks it up in 30s.

### Free Tier Usage (for 50 tasks/day)

- Workers: 1,540 req/day = 1.5% of 100K free
- KV: 50 writes/day = 5% of 1K writes free
- D1: 50 writes/day = 0.05% of 100K writes free
- R2: ~50MB/day = 15% of 10GB free
- Browser Rendering: 10 min/day free (use local extension for bulk to stay free)
- Workers AI: 10K neurons/day free (~5 Llama 8B calls)
- Pages: Unlimited bandwidth free

Total: $0/month

### Architecture

```
Meta AI (browser.open ?task=) 
   ↓
Cloudflare Worker (GET /?task= → D1 + KV)
   ↓
   ├─→ Chrome Extension (Bot Lab) polls /poll → does research via google.com tabs → POST /result
   └─→ Browser Rendering fallback (if extension offline) → POST /result
   ↓
D1 + KV + R2 (results)
   ↓
Meta AI reads via browser.open /tasks
```

### Files

- `worker.js` - Main worker with GET task ingestion for Meta AI
- `wrangler.toml` - Infra as code (auto-provisioned by Deploy Button)
- `background.js` - Extension background polling Cloudflare
- `public/index.html` - Mission Control dashboard (auto-hosted on Pages)

### For Meta AI

This infra is designed specifically for you. To add a task while user is away:

1. `browser.open("https://WORKER_URL/?task=YOUR_RESEARCH")`
2. Wait 60s
3. `browser.open("https://WORKER_URL/tasks?status=done&limit=1")` to read result
