
// CONFIG - Cloudflare Worker version
const CLOUDFLARE_WORKER_URL = "https://https://research-bot-autonomous.YOUR_SUBDOMAIN.workers.dev.workers.dev"; // e.g. https://research-bot-queue.yourname.workers.dev
const POLL_INTERVAL_MIN = 0.5;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("poll-tasks", { periodInMinutes: POLL_INTERVAL_MIN });
  chrome.storage.local.set({ botLogs: [], tasks: [] });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "poll-tasks") await pollTasks();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ADD_TASK") {
    addLocalTask(msg.instruction).then(sendResponse);
    return true;
  }
  if (msg.type === "GET_STATUS") {
    chrome.storage.local.get(["tasks", "botLogs", "botStatus"], sendResponse);
    return true;
  }
});

async function addLocalTask(instruction){
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const newTask = { id: Date.now().toString(), instruction, status: "pending", created_at: new Date().toISOString() };
  tasks.unshift(newTask);
  await chrome.storage.local.set({ tasks });
  log(`Task queued locally: ${instruction.slice(0,80)}`);
  // also push to Cloudflare
  if(CLOUDFLARE_WORKER_URL && !CLOUDFLARE_WORKER_URL.includes("REPLACE")){
    try{
      await fetch(`${CLOUDFLARE_WORKER_URL}/?task=${encodeURIComponent(instruction)}`);
      log(`Pushed to Cloudflare Worker`);
    }catch(e){ log(`Cloudflare push failed: ${e.message}`); }
  }
  return newTask;
}

async function pollTasks(){
  // Poll Cloudflare Worker for pending tasks
  if(!CLOUDFLARE_WORKER_URL || CLOUDFLARE_WORKER_URL.includes("REPLACE")){
    // fallback to local only
    const { tasks=[] } = await chrome.storage.local.get("tasks");
    const pending = tasks.find(t=>t.status==="pending");
    if(pending) await executeTask(pending);
    return;
  }

  try{
    const res = await fetch(`${CLOUDFLARE_WORKER_URL}/tasks?status=pending`);
    const remoteTasks = await res.json();
    if(remoteTasks.length>0){
      log(`Found ${remoteTasks.length} pending tasks on Cloudflare`);
      await executeTask(remoteTasks[0]); // oldest first (worker returns newest first, so take last)
    } else {
      await chrome.storage.local.set({ botStatus: "idle - waiting on Cloudflare Worker" });
    }
  }catch(e){
    log(`Cloudflare poll failed: ${e.message}`);
  }
}

async function executeTask(task){
  log(`Starting task ${task.id}: ${task.instruction}`);
  await updateTaskCloudflare(task.id, "running", null);
  
  try{
    const result = await doResearch(task.instruction);
    await updateTaskCloudflare(task.id, "done", result);
    log(`Done task ${task.id}`);
  }catch(e){
    await updateTaskCloudflare(task.id, "failed", { error: e.message });
    log(`Failed task ${task.id}: ${e.message}`);
  }
}

async function updateTaskCloudflare(id, status, result){
  // update local copy too
  const { tasks=[] } = await chrome.storage.local.get("tasks");
  const idx = tasks.findIndex(t=>t.id==id);
  if(idx>=0){
    tasks[idx].status = status;
    if(result) tasks[idx].result = result;
    await chrome.storage.local.set({ tasks });
  }
  // update cloudflare
  if(CLOUDFLARE_WORKER_URL && !CLOUDFLARE_WORKER_URL.includes("REPLACE")){
    try{
      await fetch(`${CLOUDFLARE_WORKER_URL}/result`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id, status, result})
      });
    }catch(e){}
  }
}

async function doResearch(instruction){
  await chrome.storage.local.set({ botStatus: `researching: ${instruction.slice(0,50)}` });
  const query = encodeURIComponent(instruction);
  const tab = await chrome.tabs.create({ url: `https://www.google.com/search?q=${query}`, active: false });
  await new Promise(r=>setTimeout(r,5000));
  try{
    const [{result}] = await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func:()=>{ const links=[...document.querySelectorAll('a h3')].slice(0,5).map(h=>({title:h.innerText,url:h.closest('a').href})); return {title:document.title,links,snippet:document.body.innerText.slice(0,3000)}; }
    });
    await chrome.tabs.remove(tab.id);
    return { summary: `Research for: ${instruction}`, found: result, timestamp: new Date().toISOString() };
  }catch(e){
    try{ await chrome.tabs.remove(tab.id); }catch(_){}
    throw e;
  }
}

function log(msg){
  chrome.storage.local.get("botLogs", ({botLogs=[]})=>{
    botLogs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    chrome.storage.local.set({botLogs: botLogs.slice(0,100)});
  });
}
