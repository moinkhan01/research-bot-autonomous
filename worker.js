
// Research Bot Autonomous Infra - Cloudflare Worker v3
// Optimized for Meta AI: Meta AI can add tasks via GET /?task=... and read results via GET /
// Bindings: RESEARCH_BOT_KV, RESEARCH_BOT_D1, RESEARCH_BOT_R2, BROWSER (optional), AI (optional)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    // Ensure D1 schema exists (auto-migrate on first request)
    await ensureSchema(env);

    // === META AI CAN ADD TASKS VIA URL ===
    // Example: https://worker.workers.dev/?task=Research%20top%205%20browser%20agents
    // This is how Meta AI's browser.open tool adds tasks (GET only)
    if (url.searchParams.has("task") || url.searchParams.has("add_task")) {
      const instruction = (url.searchParams.get("task") || url.searchParams.get("add_task") || "").trim();
      if (!instruction) return new Response("Missing ?task= param", { status: 400, headers: CORS });
      
      const id = Date.now().toString();
      const task = {
        id,
        instruction: decodeURIComponent(instruction),
        status: "pending",
        created_at: new Date().toISOString(),
        source: "meta-ai-url",
      };
      
      // Save to D1 (persistent) + KV (fast)
      await env.RESEARCH_BOT_D1.prepare("INSERT INTO tasks (id, instruction, status, created_at, source, result) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(task.id, task.instruction, task.status, task.created_at, task.source, null).run();
      
      if (env.RESEARCH_BOT_KV) {
        await env.RESEARCH_BOT_KV.put(`task:${id}`, JSON.stringify(task));
      }

      // Return HTML for browser tool (Meta AI) and JSON for API clients
      const accept = request.headers.get("Accept") || "";
      if (accept.includes("text/html") || url.searchParams.has("html") !== false) { // default to HTML for browser.open
        return new Response(`
          <html><head><meta charset="utf-8"><title>Task Queued</title></head>
          <body style="background:#0a0a0f;color:#fff;font-family:monospace;padding:24px">
            <h2 style="color:#00cc88">✅ Task Queued for Research Bot</h2>
            <pre style="background:#15151f;padding:16px;border-radius:8px;overflow:auto">${JSON.stringify(task, null, 2)}</pre>
            <p>Bot will pick it up in ~30s if Bot Lab Chrome is open. If offline, Cloudflare Browser Rendering will handle it (10 min/day free).</p>
            <p><a href="/" style="color:#5a5cff">View all tasks</a> | <a href="/tasks?status=pending" style="color:#5a5cff">Pending only</a></p>
            <script>if (window.location.search.includes("task=")) history.replaceState({}, "", "/");</script>
          </body></html>
        `, { headers: { ...CORS, "Content-Type": "text/html" } });
      }
      return new Response(JSON.stringify(task), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // === LIST TASKS - Meta AI can read this ===
    if (url.pathname === "/tasks" || url.pathname === "/") {
      const statusFilter = url.searchParams.get("status");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
      
      let query = "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?";
      let params = [limit];
      if (statusFilter) {
        query = "SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?";
        params = [statusFilter, limit];
      }
      
      const { results } = await env.RESEARCH_BOT_D1.prepare(query).bind(...params).all();
      
      // HTML view for Meta AI browser tool
      if (url.pathname === "/" || (request.headers.get("Accept")||"").includes("text/html")) {
        const tasksHtml = results.map(t => `
          <div style="border:1px solid #2a2a35;border-left:4px solid ${t.status==='pending'?'#ffcc00':t.status==='running'?'#5a5cff':'#00cc88'};padding:12px;margin:8px 0;border-radius:8px;background:#15151f">
            <b>${t.status.toUpperCase()}</b> - ${t.created_at}<br>
            <b style="color:#fff">${t.instruction}</b><br>
            ${t.result ? `<pre style="background:#0f0f14;padding:8px;border-radius:4px;margin-top:8px;overflow:auto;font-size:11px">${JSON.stringify(JSON.parse(t.result), null, 2).slice(0,3000)}</pre>` : '<span style="color:#666">waiting...</span>'}
          </div>
        `).join("") || "<p style='color:#666'>No tasks yet. Add one: ?task=Research browser agents</p>";

        return new Response(`
          <!DOCTYPE html><html><head><meta charset="utf-8"><title>Research Bot Mission Control - Cloudflare</title>
          <style>body{background:#0a0a0f;color:#fff;font-family:Inter,system-ui;padding:20px} .hint{color:#888;font-size:12px} code{background:#1a1a2e;padding:2px 6px;border-radius:4px} textarea{width:100%;height:80px;background:#0f0f14;color:#fff;border:1px solid #333;border-radius:8px;padding:8px} button{background:#5a5cff;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer}</style>
          </head><body>
            <h1>🤖 Research Bot Mission Control - Autonomous Infra</h1>
            <p class="hint">This page is readable by Meta AI via browser tool. Add tasks via URL: <code>${url.origin}/?task=YOUR_QUERY</code></p>
            <form method="GET" action="/"><textarea name="task" placeholder="Research top 5 browser automation frameworks"></textarea><br><button type="submit">Send to Bot Queue</button></form>
            <h2 style="margin-top:24px">Live Queue - ${results.length} tasks</h2>
            <div>${tasksHtml}</div>
            <p class="hint" style="margin-top:24px">Free tier: 100K req/day, 10 min/day browser rendering, 10K neurons/day AI. Worker + D1 + KV + R2 + Pages all free.</p>
          </body></html>
        `, { headers: { ...CORS, "Content-Type": "text/html" } });
      }
      return new Response(JSON.stringify(results), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // === EXTENSION POLLS PENDING TASKS ===
    if (url.pathname === "/poll") {
      const { results } = await env.RESEARCH_BOT_D1.prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").all();
      return new Response(JSON.stringify(results[0] || null), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // === BOT POSTS RESULT (from extension or Browser Rendering) ===
    if (url.pathname === "/result" && request.method === "POST") {
      const body = await request.json();
      const { id, status, result } = body;
      if (!id) return new Response("Missing id", { status: 400, headers: CORS });
      
      await env.RESEARCH_BOT_D1.prepare("UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?")
        .bind(status, JSON.stringify(result), new Date().toISOString(), id).run();
      
      if (env.RESEARCH_BOT_KV) {
        const existing = await env.RESEARCH_BOT_KV.get(`task:${id}`);
        if (existing) {
          const t = JSON.parse(existing);
          t.status = status;
          t.result = result;
          t.updated_at = new Date().toISOString();
          await env.RESEARCH_BOT_KV.put(`task:${id}`, JSON.stringify(t));
        }
      }
      
      return new Response(JSON.stringify({ ok: true, id, status }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // === CLOUDFLARE BROWSER RENDERING FALLBACK (when local extension offline) ===
    // POST /browse - uses Browser Rendering to fetch a URL (10 min/day free)
    if (url.pathname === "/browse" && request.method === "POST" && env.BROWSER) {
      try {
        const { url: targetUrl } = await request.json();
        const browser = await env.BROWSER.launch();
        const page = await browser.newPage();
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        const content = await page.content();
        const text = content.slice(0, 8000);
        await browser.close();
        
        // Optional: Summarize with Workers AI Llama if available
        let summary = null;
        if (env.AI) {
          const aiRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [{ role: 'user', content: `Summarize this webpage in 3 bullet points:\n\n${text.slice(0,4000)}` }],
          });
          summary = aiRes.response || aiRes;
        }
        
        return new Response(JSON.stringify({ url: targetUrl, text, summary }), { headers: { ...CORS, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
      }
    }

    return new Response("Research Bot Worker Live. Use /?task=YOUR_QUERY to add task, /tasks to list, /poll for extension, /result to post result.", { headers: CORS });
  },

  // Cron trigger for keep-alive and auto-research (5 per account free)
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      // Keep D1 warm, prevent Supabase-style idle pause (not needed for Cloudflare but good hygiene)
      await env.RESEARCH_BOT_D1.prepare("SELECT COUNT(*) as count FROM tasks").first();
      // Could auto-queue daily research here if desired
    })());
  }
};

async function ensureSchema(env) {
  try {
    await env.RESEARCH_BOT_D1.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        instruction TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        source TEXT,
        result TEXT
      )
    `).run();
    await env.RESEARCH_BOT_D1.prepare(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`).run();
    await env.RESEARCH_BOT_D1.prepare(`CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)`).run();
  } catch (e) {
    // D1 may not be bound in local dev, ignore
  }
}
