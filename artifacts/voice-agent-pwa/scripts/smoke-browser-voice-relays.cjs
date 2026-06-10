const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const APP_PORT = Number(process.env.PWA_SMOKE_PORT || 8091);
const CDP_PORT = Number(process.env.PWA_SMOKE_CDP_PORT || 9231);
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitForHttp(url, label, getDetails = () => "") {
  for (let i = 0; i < 80; i += 1) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          res.statusCode && res.statusCode < 500 ? resolve() : reject(new Error(String(res.statusCode)));
        });
        req.on("error", reject);
        req.setTimeout(1000, () => {
          req.destroy(new Error("timeout"));
        });
      });
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`${label} did not start${getDetails() ? `\n${getDetails()}` : ""}`);
}

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    } catch {
      await delay(250);
    }
  }
  throw new Error("Chrome CDP did not start");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.logs = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Runtime.exceptionThrown") {
        this.logs.push(msg.params);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
        else pending.resolve(msg.result ?? {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws.close();
  }
}

async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 10000);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener("error", reject, { once: true });
  });
  return new Cdp(ws);
}

const initSource = `
(() => {
  if (!location.href.startsWith(${JSON.stringify(APP_URL)})) return;
  const params = new URL(location.href).searchParams;
  const selected = params.get("voiceSmokeProvider") || "openai";
  const launchMode = params.has("voiceSmokeLaunch");
  const state = window.__voiceSmoke = {
    fetches: [],
    websockets: [],
    audioSampleRates: [],
    sentMessages: [],
    mediaRequests: [],
  };
  const profiles = {
    openai: {
      id: "profile-openai-relay",
      displayName: "Relay Bev",
      wakePhrase: "Hey Bev",
      wakeMode: "tap",
      noiseMode: "standard",
      voicePipelineProvider: "openai_realtime_server_ws",
      voicePipelineConfig: { voice: "ash", speed: 1.05 },
    },
    gemini: {
      id: "profile-gemini-live",
      displayName: "Gemini Bev",
      wakePhrase: "Hey Bev",
      wakeMode: "tap",
      noiseMode: "standard",
      voicePipelineProvider: "google_gemini_3_1_flash_live",
      voicePipelineConfig: {
        voice: "Kore",
        voiceName: "Kore",
        speed: 1,
        thinkingLevel: "minimal",
        languageCodes: ["en-US"],
      },
    },
  };
  function selectedProfile() {
    return profiles[selected];
  }
  function profileById(id) {
    return Object.values(profiles).find((profile) => profile.id === id) || selectedProfile();
  }
  localStorage.clear();
  if (launchMode) {
    const staleProfile = selected === "openai" ? profiles.gemini : profiles.openai;
    localStorage.setItem("voycelab_token", "stale-token");
    localStorage.setItem("voycelab_agent_profile_id", staleProfile.id);
    localStorage.setItem("voycelab_agent_profile", JSON.stringify(staleProfile));
    localStorage.setItem("voycelab_wake_phrase", staleProfile.wakePhrase);
  } else {
    localStorage.setItem("voycelab_token", "smoke-token");
    localStorage.setItem("voycelab_agent_profile_id", selectedProfile().id);
    localStorage.setItem("voycelab_agent_profile", JSON.stringify(selectedProfile()));
    localStorage.setItem("voycelab_wake_phrase", "Hey Bev");
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init.method || "GET";
    state.fetches.push({ url, method, body: init.body || null });
    const profile = selectedProfile();
    if (url.includes("/api/auth/exchange/redeem")) {
      return new Response(JSON.stringify({
        token: "launch-token",
        agentProfileId: profile.id,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/auth/me")) {
      return new Response(JSON.stringify({ user: { id: 1, email: "smoke@example.com", name: "Smoke" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/venues")) {
      return new Response(JSON.stringify({ venues: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/v1/agent-profiles/")) {
      const id = decodeURIComponent(url.split("/api/v1/agent-profiles/")[1].split("?")[0]);
      return new Response(JSON.stringify(profileById(id)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/v1/realtime-sessions") || url.includes("/api/v1/realtime/sessions")) {
      const isGemini = profile.voicePipelineProvider.startsWith("google_gemini_");
      const path = isGemini ? "/api/realtime/gemini" : "/api/realtime";
      return new Response(JSON.stringify({
        sessionId: "session-" + profile.id,
        provider: profile.voicePipelineProvider,
        capabilities: { bargeIn: true, nativeAudio: true },
        clientHandshake: {
          kind: "ws_relay",
          payload: {
            path,
            query: {
              sessionId: "session-" + profile.id,
              agentProfileId: profile.id,
              modelId: isGemini ? "gemini-3.1-flash-live-preview" : undefined,
            },
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  class SmokeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.sent = [];
      state.websockets.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen && this.onopen({});
      }, 5);
    }
    send(data) {
      this.sent.push(data);
      state.sentMessages.push({ url: this.url, data });
    }
    close() {
      this.readyState = 3;
      this.onclose && this.onclose({ code: 1000, reason: "smoke" });
    }
    addEventListener(type, handler) {
      this["on" + type] = handler;
    }
    removeEventListener() {}
  }
  window.WebSocket = SmokeWebSocket;

  class SmokeAudioContext {
    constructor(opts = {}) {
      this.sampleRate = opts.sampleRate || 48000;
      this.currentTime = 0;
      this.destination = {};
      this.state = "running";
      state.audioSampleRates.push(this.sampleRate);
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
    createOscillator() {
      return {
        type: "sine",
        frequency: { value: 0 },
        connect(node) { return node; },
        start() {},
        stop() {},
      };
    }
    createGain() {
      return {
        gain: {
          value: 0,
          exponentialRampToValueAtTime() {},
        },
        connect(node) { return node; },
      };
    }
    decodeAudioData() { return Promise.resolve({ duration: 0.05 }); }
    createBufferSource() {
      return { connect() {}, start() {}, onended: null, buffer: null };
    }
  }
  window.AudioContext = SmokeAudioContext;
  window.webkitAudioContext = SmokeAudioContext;

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints) => {
        state.mediaRequests.push(constraints);
        return {
          getAudioTracks: () => [{ stop() {}, enabled: true }],
          getTracks: () => [{ stop() {} }],
        };
      },
    },
  });
  navigator.wakeLock = {
    request: async () => ({ release: async () => {}, addEventListener() {} }),
  };
})();
`;

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(cdp, expression, label) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // keep polling while the page boots
    }
    await delay(200);
  }
  let smokeState = "";
  try {
    smokeState = JSON.stringify(await evaluate(
      cdp,
      `window.__voiceSmoke ? {
        fetches: window.__voiceSmoke.fetches,
        websockets: window.__voiceSmoke.websockets.map((ws) => ({ url: ws.url, sent: ws.sent })),
        audioSampleRates: window.__voiceSmoke.audioSampleRates,
        body: document.body.innerText,
      } : null`,
    ));
  } catch {
    smokeState = "";
  }
  throw new Error(
    `Timed out waiting for ${label}. Logs: ${JSON.stringify(cdp.logs).slice(0, 2000)} State: ${smokeState.slice(0, 2000)}`,
  );
}

async function smokeProvider(cdp, provider) {
  await cdp.send("Page.navigate", { url: `${APP_URL}?voiceSmokeProvider=${provider}` });
  return smokeLoadedProvider(cdp, provider, `${provider} stored profile`);
}

async function smokeLaunchOverridesStaleProfile(cdp) {
  await cdp.send("Page.navigate", {
    url: `${APP_URL}?voiceSmokeProvider=openai&voiceSmokeLaunch=1&code=launch-openai&agentProfileId=profile-openai-relay`,
  });
  return smokeLoadedProvider(cdp, "openai", "launch overrides stale profile");
}

async function smokeLoadedProvider(cdp, provider, label) {
  await waitFor(cdp, "Boolean(document.querySelector('.orb'))", `${provider} orb`);
  const assistantName = provider === "openai" ? "Relay Bev" : "Gemini Bev";
  await waitFor(
    cdp,
    `document.body.innerText.toLowerCase().includes(${JSON.stringify(assistantName.toLowerCase())})`,
    `${provider} assistant profile`,
  );
  await evaluate(cdp, "document.querySelector('.orb').click()");
  await waitFor(
    cdp,
    "window.__voiceSmoke && window.__voiceSmoke.websockets.some((ws) => ws.url.includes('/api/realtime'))",
    `${provider} relay websocket`,
  );
  await delay(400);
  const state = await evaluate(
    cdp,
    `(() => ({
      websockets: window.__voiceSmoke.websockets.map((ws) => ({ url: ws.url, sent: ws.sent })),
      audioSampleRates: window.__voiceSmoke.audioSampleRates,
      mediaRequests: window.__voiceSmoke.mediaRequests,
      fetches: window.__voiceSmoke.fetches.map((f) => ({ url: f.url, method: f.method, body: f.body })),
    }))()`,
  );
  const relayWs = state.websockets.find((ws) => ws.url.includes("/api/realtime"));
  if (!relayWs) throw new Error(`${provider}: no relay websocket opened`);
  if (provider === "openai") {
    if (!relayWs.url.includes("/api/realtime?")) throw new Error(`openai: expected /api/realtime, got ${relayWs.url}`);
    if (!state.audioSampleRates.includes(24000)) {
      throw new Error(`openai: expected 24000 Hz input, got ${state.audioSampleRates.join(",")}`);
    }
  } else {
    if (!relayWs.url.includes("/api/realtime/gemini?")) {
      throw new Error(`gemini: expected /api/realtime/gemini, got ${relayWs.url}`);
    }
    if (!state.audioSampleRates.includes(16000)) {
      throw new Error(`gemini: expected 16000 Hz input, got ${state.audioSampleRates.join(",")}`);
    }
  }
  if (!relayWs.sent.some((msg) => String(msg).includes("x.context_update"))) {
    throw new Error(`${provider}: relay context update was not sent`);
  }
  return {
    provider: label,
    wsUrl: relayWs.url.replace(/token=[^&]+/, "token=[redacted]"),
    audioSampleRates: state.audioSampleRates,
    mediaRequests: state.mediaRequests.length,
  };
}

function findChromePath() {
  for (const chromePath of CHROME_PATHS) {
    try {
      require("node:fs").accessSync(chromePath);
      return chromePath;
    } catch {
      // try the next path
    }
  }
  throw new Error("Chrome was not found. Set CHROME_PATH to run this smoke test.");
}

async function main() {
  const chromePath = findChromePath();
  const viteBin = path.resolve(process.cwd(), "node_modules/vite/bin/vite.js");
  const vite = spawn(process.execPath, [
    viteBin,
    "--host",
    "127.0.0.1",
    "--port",
    String(APP_PORT),
  ], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  let viteOutput = "";
  vite.stdout.on("data", (chunk) => {
    viteOutput += chunk.toString();
  });
  vite.stderr.on("data", (chunk) => {
    viteOutput += chunk.toString();
  });

  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--user-data-dir=${process.env.TEMP || process.env.TMP || "C:/tmp"}/voycelab-cdp-smoke-${Date.now()}`,
    "about:blank",
  ], {
    stdio: "ignore",
  });

  try {
    await waitForHttp(APP_URL, "PWA dev server", () => viteOutput.slice(-2000));
    const version = await waitForCdp();
    const browser = await connectCdp(version.webSocketDebuggerUrl);
    const target = await browser.send("Target.createTarget", { url: "about:blank" });
    browser.close();

    const pages = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageInfo = pages.find((page) => page.id === target.targetId) || pages[0];
    const page = await connectCdp(pageInfo.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: initSource });

    const openai = await smokeProvider(page, "openai");
    const gemini = await smokeProvider(page, "gemini");
    const launchOverride = await smokeLaunchOverridesStaleProfile(page);
    console.log("PASS pwa browser voice relay smoke");
    console.log(JSON.stringify({ openai, gemini, launchOverride }, null, 2));
    page.close();
  } finally {
    vite.kill();
    chrome.kill();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
