import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ENV_PROPERTY_KEYS } from "./envProperties.mjs";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv.includes("--help")) {
  console.log(`Usage: node scripts/tv-performance.mjs --endpoint=ws://HOST:PORT/devtools/page/TARGET [options]
Node 22+ required. NUVIO_CDP_URL can supply the endpoint instead.

Measurements: --measure (16 Home navigation keys, 100ms p95 budget), --probe
Actions: --press=ArrowRight,Enter | --click=SELECTOR | --type=TEXT | --wait=MS
         --early-play (select first 720/1080 card, skipping donation rows), --reload
Inspect: --ui-summary --inspect-dom --player-state --badge-stats --css-smoke
Artifacts: --screenshot --source --badge-benchmark --baseline-ref=358d08c
           --output-dir=PATH (default .cache/tv-performance)
Private config: --capture-build-config --config-output=PATH (default ignored artifact folder)
Experiments: --no-motion --no-effects --constrained --prune-rows
Cleanup: --restore --cleanup-check

Experiments modify the current TV session until --restore. Probes always clean up.
CPU profiles and captured config stay local; never commit the artifact folder.
See docs/performance/CONTINUE.md for setup and repeatable flows.`);
  process.exit(0);
}
if (typeof WebSocket !== "function") throw new Error("Use Node 22 or newer for the CDP profiler.");
const outputDir = path.resolve(
  option("output-dir") || path.join(repoRoot, ".cache/tv-performance")
);
const artifact = (name) => path.join(outputDir, name);
const endpoint = option("endpoint") || process.env.NUVIO_CDP_URL;
if (!endpoint || !/^wss?:\/\//.test(endpoint))
  throw new Error("Supply --endpoint=ws://... or NUVIO_CDP_URL from ares-inspect.");
await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("TV inspector connection timed out."));
  }, 10000);
  socket.onopen = () => {
    clearTimeout(timer);
    resolve();
  };
  socket.onerror = () => {
    clearTimeout(timer);
    reject(
      new Error(
        "Could not connect to the TV inspector. Reopen ares-inspect and use its current URL."
      )
    );
  };
});
let nextId = 0;
const pending = new Map();
const parsedScripts = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Debugger.scriptParsed") parsedScripts.push(message.params);
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  clearTimeout(item.timer);
  message.error
    ? item.reject(new Error(JSON.stringify(message.error)))
    : item.resolve(message.result);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} timed out after 30 seconds.`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
try {
  if (process.argv.includes("--reload")) {
    await call("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (process.argv.includes("--badge-benchmark")) {
    const baselineRef = option("baseline-ref") || "358d08c";
    if (!/^[a-zA-Z0-9_./-]+$/.test(baselineRef) || baselineRef.startsWith("-"))
      throw new Error("Invalid baseline Git reference.");
    const original = execFileSync(
      "git",
      ["show", `${baselineRef}:js/core/streams/streamBadgeRules.js`],
      { cwd: repoRoot, encoding: "utf8" }
    ).replace(/export /g, "");
    const optimized = (
      await fs.readFile(path.join(repoRoot, "js/core/streams/streamBadgeRules.js"), "utf8")
    ).replace(/export /g, "");
    const expression = `(() => {
     const stored=JSON.parse(localStorage.getItem('streamBadgeSettings')||'null'),active=String(JSON.parse(localStorage.getItem('activeProfileId')||'"1"'));
     const settings=stored?.__profileScoped?stored.profiles?.[active]:stored;
     const rules=settings?.rules||settings?.streamBadgeRules||{};
     const oldMatch=(()=>{${original};return matchStreamBadges;})();
     const next=(()=>{${optimized};return {match:matchStreamBadges,prepare:prepareStreamBadgeRules};})();
     const streams=Array.from({length:24},(_,i)=>({title:'Abbott.Elementary.S02E16.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb '+i,description:'Abbott Elementary - Teacher Conference 1080p WEB-DL English audio '+i}));
     let start=performance.now();const before=streams.map(stream=>oldMatch(stream,rules));const originalMs=performance.now()-start;
     start=performance.now();const snapshot=next.prepare(rules);const after=streams.map(stream=>next.match(stream,snapshot));const optimizedColdMs=performance.now()-start;
     start=performance.now();streams.forEach(stream=>next.match({...stream},snapshot));const optimizedWarmMs=performance.now()-start;
     return {streamCount:streams.length,originalMs,optimizedColdMs,optimizedWarmMs,identicalResults:JSON.stringify(before)===JSON.stringify(after)};
   })()`;
    console.log(
      "Actual-rule synthetic-stream benchmark: " + JSON.stringify(await evaluate(expression))
    );
  }
  if (process.argv.includes("--capture-build-config")) {
    const env = await evaluate("globalThis.__NUVIO_ENV__ || {}");
    if (!env.NUVIO_SUPABASE_URL || !env.NUVIO_SUPABASE_ANON_KEY)
      throw new Error("Installed runtime configuration is incomplete");
    const escapeProperty = (value) => {
      const text = String(value ?? "");
      if (/[\r\n]/.test(text))
        throw new Error("Multiline configuration needs manual local.properties preparation.");
      return text.replaceAll("\\", "\\\\");
    };
    const configPath = path.resolve(option("config-output") || artifact("tv-build.properties"));
    await fs.writeFile(
      configPath,
      ENV_PROPERTY_KEYS.map((key) => key + "=" + escapeProperty(env[key])).join("\n") + "\n",
      { mode: 0o600 }
    );
    await fs.chmod(configPath, 0o600);
    console.log("Installed build configuration preserved at " + configPath + " (values omitted).");
  }
  if (process.argv.includes("--cleanup-check"))
    console.log(
      "Diagnostic cleanup: " +
        JSON.stringify(
          await evaluate(
            `(() => ({temporaryStyles:document.querySelectorAll('#nuvio-perf-disable-effects,#nuvio-perf-disable-motion').length,detachedRows:!!window.__nuvioDetachedRows,activeProbe:!!window.__nuvioPerfProbe||!!window.__nuvioFlowProbe,temporaryClassSnapshot:!!window.__nuvioOriginalPerfClasses,catalogRows:document.querySelectorAll('.home-modern-row').length,videoPaused:document.querySelector('video')?.paused}))()`
          )
        )
    );
  if (process.argv.includes("--no-motion"))
    await evaluate(
      `(() => {document.getElementById('nuvio-perf-disable-motion')?.remove();const style=document.createElement('style');style.id='nuvio-perf-disable-motion';style.textContent='*,*::before,*::after{animation:none!important;transition:none!important;}';document.head.appendChild(style);return true;})()`
    );
  if (process.argv.includes("--badge-stats"))
    console.log(
      "Badge configuration: " +
        JSON.stringify(
          await evaluate(
            `(() => {const stored=JSON.parse(localStorage.getItem('streamBadgeSettings')||'null'),active=String(JSON.parse(localStorage.getItem('activeProfileId')||'"1"'));const settings=stored?.__profileScoped?stored.profiles?.[active]:stored;const rules=settings?.rules||settings?.streamBadgeRules||{},imports=rules.imports||[];return {imports:imports.length,activeFilters:imports.filter(i=>i.isActive!==false).reduce((n,i)=>n+(i.filters||[]).filter(f=>f.isEnabled!==false).length,0),maxPatternLength:Math.max(0,...imports.flatMap(i=>(i.filters||[]).map(f=>String(f.pattern||'').length)))};})()`
          )
        )
    );
  if (process.argv.includes("--probe")) {
    await evaluate(
      `(() => {const s={keys:[],frames:[],longTasks:[],last:0,running:true,mutations:{added:0,removed:0}};window.__nuvioFlowProbe=s;s.listener=e=>{const start=performance.now(),sample={key:e.key,nextFrameMs:null};s.keys.push(sample);requestAnimationFrame(()=>sample.nextFrameMs=performance.now()-start);};window.addEventListener('keydown',s.listener,true);s.observer=new PerformanceObserver(l=>l.getEntries().forEach(e=>s.longTasks.push({duration:e.duration})));s.observer.observe({entryTypes:['longtask']});s.mutationObserver=new MutationObserver(list=>list.forEach(m=>{s.mutations.added+=m.addedNodes.length;s.mutations.removed+=m.removedNodes.length;}));s.mutationObserver.observe(document.body,{childList:true,subtree:true});const tick=t=>{if(!s.running)return;if(s.last)s.frames.push(t-s.last);s.last=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);return true;})()`
    );
    await call("Profiler.enable");
    await call("Profiler.start");
  }
  if (process.argv.includes("--ui-summary"))
    console.log(
      JSON.stringify(
        await evaluate(
          `(() => ({focused:(Array.from(document.querySelectorAll('.focused')).find(node=>node.getClientRects().length)||document.activeElement)?.className,sidebar:Array.from(document.querySelectorAll('.home-sidebar .focusable,.modern-sidebar-panel .focusable')).map(e=>({class:e.className,action:e.dataset.action,route:e.dataset.route,label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,50)})),continueCards:Array.from(document.querySelectorAll('.home-continue-card')).map((e,i)=>({index:i,action:e.dataset.action,type:e.dataset.itemType,title:e.dataset.itemTitle||e.querySelector('.home-continue-title')?.textContent||e.querySelector('.home-continue-name')?.textContent})),activeScreens:Array.from(document.querySelectorAll('.screen')).filter(e=>getComputedStyle(e).display!=='none').map(e=>({id:e.id,nodes:e.querySelectorAll('*').length})),inputs:Array.from(document.querySelectorAll('input')).filter(e=>e.getBoundingClientRect().width>0).map(e=>({id:e.id,type:e.type,placeholder:e.placeholder}))}))()`
        ),
        null,
        2
      )
    );
  const press = process.argv.find((a) => a.startsWith("--press="));
  if (press)
    for (const key of press.slice(8).split(",")) {
      const codes = {
        ArrowLeft: 37,
        ArrowUp: 38,
        ArrowRight: 39,
        ArrowDown: 40,
        Enter: 13,
        Escape: 27,
        MediaPlayPause: 179,
        s: 83
      };
      const virtualKey = codes[key];
      if (!virtualKey) throw new Error(`Unsupported key: ${key}`);
      const start = Date.now();
      await call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: key,
        windowsVirtualKeyCode: virtualKey,
        nativeVirtualKeyCode: virtualKey
      });
      await call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: key,
        windowsVirtualKeyCode: virtualKey,
        nativeVirtualKeyCode: virtualKey
      });
      console.log("Key " + key + " CDP roundtrip: " + (Date.now() - start) + "ms");
      await new Promise((r) => setTimeout(r, 400));
    }
  const click = process.argv.find((a) => a.startsWith("--click="));
  if (click)
    console.log(
      "Click dispatched: " +
        (await evaluate(
          `(() => {const e=document.querySelector(${JSON.stringify(click.slice(8))});if(!e||!e.getClientRects().length||getComputedStyle(e).display==='none')return false;e.click();return true;})()`
        ))
    );
  if (process.argv.includes("--early-play")) {
    const started = Date.now();
    let selection = null;
    while (Date.now() - started < 20000) {
      selection = await evaluate(`(() => {
       const screen=document.getElementById('stream');
       if(!screen||getComputedStyle(screen).display==='none')return null;
       const card=Array.from(screen.querySelectorAll('[data-action="playStream"]')).find(card=>/(1080|720)/i.test(card.textContent)&&!/donat|support the project/i.test(card.textContent));
       if(!card)return null;
       const before={pendingSources:screen.querySelectorAll('.stream-route-chip.loading').length,mountedCards:screen.querySelectorAll('[data-action="playStream"]').length};
       card.click();return before;
     })()`);
      if (selection) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!selection) process.exitCode = 2;
    console.log(
      "First available stream selection: " +
        JSON.stringify({ selection, elapsedMs: Date.now() - started })
    );
  }
  if (process.argv.includes("--css-smoke"))
    console.log(
      "Reduced-motion visibility: " +
        JSON.stringify(
          await evaluate(`(() => {
   const root=document.createElement('div');document.body.appendChild(root);
   const classes=['player-parental-guide','player-parental-item','player-loading-identity','nuvio-loading-indicator-spoke','stream-route-panel-shell','library-picker-menu library-picker-menu-open','profile-pin-layer is-opening'];
   try{return classes.map(className=>{const node=document.createElement('div');node.className=className;root.appendChild(node);const s=getComputedStyle(node);return {className,opacity:s.opacity,animation:s.animationName};});}finally{root.remove();}
 })()`)
        )
    );
  const typing = process.argv.find((a) => a.startsWith("--type="));
  if (typing) {
    await evaluate(
      `(() => {const input=document.getElementById('searchInput');input.focus();return true;})()`
    );
    for (const char of typing.slice(7)) {
      const start = Date.now();
      await call("Input.insertText", { text: char });
      console.log("Character insertion CDP roundtrip: " + (Date.now() - start) + "ms");
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 2500));
    console.log(
      "Search result state: " +
        JSON.stringify(
          await evaluate(
            `(() => {const root=document.getElementById('search');return {inputValue:document.getElementById('searchInput')?.value,rows:root.querySelectorAll('.search-result-row,.search-row').length,cards:root.querySelectorAll('.search-result-card').length,nodes:root.querySelectorAll('*').length,loading:root.querySelectorAll('.loading,.search-loading').length};})()`
          )
        )
    );
  }
  const wait = process.argv.find((a) => a.startsWith("--wait="));
  if (wait) await new Promise((r) => setTimeout(r, Math.min(30000, Number(wait.slice(7)))));
  if (process.argv.includes("--player-state"))
    console.log(
      JSON.stringify(
        await evaluate(
          `(() => {const p=document.getElementById('player'),v=document.querySelector('#player video')||document.querySelector('video');return {playerVisible:!!p&&getComputedStyle(p).display!=='none',playerNodes:p?.querySelectorAll('*').length,homePreserved:document.getElementById('home')?.querySelectorAll('*').length,video:v?{paused:v.paused,readyState:v.readyState,networkState:v.networkState,width:v.videoWidth,height:v.videoHeight}:null,actions:Array.from(p?.querySelectorAll('.player-control-btn')||[]).map(e=>e.dataset.action),subtitleDialogClass:p?.querySelector('.player-subtitle-dialog')?.className};})()`
        ),
        null,
        2
      )
    );
  if (process.argv.includes("--source")) {
    await call("Debugger.enable");
    const app = parsedScripts.find((s) => s.url.endsWith("/app.bundle.js"));
    if (app) {
      const { scriptSource } = await call("Debugger.getScriptSource", { scriptId: app.scriptId });
      await fs.writeFile(artifact("installed-app.bundle.js"), scriptSource);
      console.log("Installed app source saved locally for mapping CPU samples.");
    }
    await call("Debugger.disable");
  }
  if (process.argv.includes("--prune-rows"))
    console.log(
      "Detached offscreen catalog rows: " +
        (await evaluate(
          `(() => {if(window.__nuvioDetachedRows)return 0;const rows=Array.from(document.querySelectorAll('.home-modern-row')).slice(6);window.__nuvioDetachedRows=rows.map(row=>{const marker=document.createComment('nuvio-perf-row');row.replaceWith(marker);return {row,marker};});return rows.length;})()`
        ))
    );
  if (process.argv.includes("--inspect-dom"))
    console.log(
      JSON.stringify(
        await evaluate(
          `(() => {const count=selector=>document.querySelectorAll(selector).length;const classes={};for(const img of document.images){const c=img.className||'(none)';classes[c]=(classes[c]||0)+1;}return {imageClasses:classes,rows:count('.home-modern-row'),cards:count('.home-content-card'),cw:count('.home-continue-card'),collectionCards:count('[data-action="openCollectionFolder"]'),imagesWithSource:Array.from(document.images).filter(i=>i.getAttribute('src')).length,imagesLoaded:Array.from(document.images).filter(i=>i.complete&&i.naturalWidth>0).length,homeNodes:count('#home *'),screens:Array.from(document.querySelectorAll('[id$="Screen"],.screen')).map(e=>({id:e.id,class:e.className,nodes:e.querySelectorAll('*').length,display:getComputedStyle(e).display})),rowsInfo:Array.from(document.querySelectorAll('.home-modern-row,.home-row-continue')).map(e=>({key:e.dataset.rowKey,cards:e.querySelectorAll('.home-content-card').length,images:e.querySelectorAll('img').length})),activeAnimations:document.getAnimations().length,videoElements:count('video'),canvasElements:count('canvas')};})()`
        ),
        null,
        2
      )
    );
  if (process.argv.includes("--constrained"))
    await evaluate(
      `(() => {window.__nuvioOriginalPerfClasses ||= {html:document.documentElement.className,body:document.body.className};for(const e of [document.documentElement,document.body]){e.classList.add('performance-constrained');e.classList.remove('modern-sidebar-blur-capable');}return true;})()`
    );
  if (process.argv.includes("--restore"))
    await evaluate(
      `(() => {const c=window.__nuvioOriginalPerfClasses;if(c){document.documentElement.className=c.html;document.body.className=c.body;delete window.__nuvioOriginalPerfClasses;}document.getElementById('nuvio-perf-disable-effects')?.remove();document.getElementById('nuvio-perf-disable-motion')?.remove();for(const item of window.__nuvioDetachedRows||[])item.marker.replaceWith(item.row);delete window.__nuvioDetachedRows;return true;})()`
    );
  if (process.argv.includes("--no-effects"))
    await evaluate(
      `(() => {document.getElementById('nuvio-perf-disable-effects')?.remove();const style=document.createElement('style');style.id='nuvio-perf-disable-effects';style.textContent='*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;filter:none!important;}';document.head.appendChild(style);return true;})()`
    );
  if (process.argv.includes("--measure")) {
    await evaluate(
      `(() => { const state={keys:[],frames:[],longTasks:[],running:true,lastFrame:0,starts:new WeakMap()}; window.__nuvioPerfProbe=state;state.startListener=e=>state.starts.set(e,performance.now());window.addEventListener('keydown',state.startListener,true);state.listener=e=>{const start=state.starts.get(e)||performance.now(),sample={key:e.key,handlerMs:performance.now()-start,nextFrameMs:null};state.keys.push(sample);requestAnimationFrame(()=>sample.nextFrameMs=performance.now()-start);};document.addEventListener('keydown',state.listener,true);state.observer=new PerformanceObserver(list=>list.getEntries().forEach(e=>state.longTasks.push({start:e.startTime,duration:e.duration})));state.observer.observe({entryTypes:['longtask']});const tick=t=>{if(!state.running)return;if(state.lastFrame)state.frames.push(t-state.lastFrame);state.lastFrame=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);return true;})()`
    );
    await call("Profiler.enable");
    await call("Profiler.setSamplingInterval", { interval: 1000 });
    await call("Profiler.start");
    for (const key of [
      "ArrowRight",
      "ArrowRight",
      "ArrowRight",
      "ArrowRight",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowRight",
      "ArrowRight",
      "ArrowRight",
      "ArrowRight",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft"
    ]) {
      const virtualKey = key === "ArrowRight" ? 39 : 37;
      await call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: key,
        windowsVirtualKeyCode: virtualKey,
        nativeVirtualKeyCode: virtualKey
      });
      await call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: key,
        windowsVirtualKeyCode: virtualKey,
        nativeVirtualKeyCode: virtualKey
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const { profile } = await call("Profiler.stop");
    await fs.writeFile(artifact("home-cpu-profile.json"), JSON.stringify(profile));
    const durations = new Map();
    (profile.samples || []).forEach((id, i) =>
      durations.set(id, (durations.get(id) || 0) + (profile.timeDeltas?.[i] || 0))
    );
    const top = profile.nodes
      .map((node) => ({
        function: node.callFrame.functionName || "(anonymous)",
        file: node.callFrame.url.split("/").pop(),
        line: node.callFrame.lineNumber + 1,
        selfMs: Math.round((durations.get(node.id) || 0) / 1000)
      }))
      .sort((a, b) => b.selfMs - a.selfMs)
      .slice(0, 25);
    const result = await evaluate(
      `(() => {const s=window.__nuvioPerfProbe;s.running=false;s.observer.disconnect();document.removeEventListener('keydown',s.listener,true);window.removeEventListener('keydown',s.startListener,true);const percentile=(v,p)=>{v=v.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?v[Math.floor((v.length-1)*p)]:null;};const r={keys:s.keys,frames:{count:s.frames.length,medianMs:percentile(s.frames,.5),p95Ms:percentile(s.frames,.95),maxMs:Math.max(...s.frames)},longTasks:s.longTasks,input:{medianHandlerMs:percentile(s.keys.map(k=>k.handlerMs),.5),p95HandlerMs:percentile(s.keys.map(k=>k.handlerMs),.95),p95NextFrameMs:percentile(s.keys.map(k=>k.nextFrameMs),.95)}};delete window.__nuvioPerfProbe;return r;})()`
    );
    result.cpuTop = top;
    console.log(JSON.stringify(result, null, 2));
    await fs.writeFile(artifact("home-measurement.json"), JSON.stringify(result, null, 2));
    console.log(
      "Navigation latency verdict: " +
        (result.input.p95NextFrameMs > 100
          ? "FAIL (>100ms p95 to next frame)"
          : "PASS (<=100ms p95 to next frame)")
    );
    const complete = result.keys.length === 16 && Number.isFinite(result.input.p95NextFrameMs);
    if (!complete) console.error("Incomplete key samples: navigation latency verdict is invalid.");
    process.exitCode = !complete || result.input.p95NextFrameMs > 100 ? 2 : 0;
  }
  const snapshot = await evaluate(
    `(() => ({ua:navigator.userAgent, classes:document.documentElement.className, bodyClasses:document.body.className, nodes:document.querySelectorAll('*').length, images:document.images.length, screen:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}, focused:(Array.from(document.querySelectorAll('.focused')).find(node=>node.getClientRects().length)||document.activeElement)?.className, memory:performance.memory ? {used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null, scripts:Array.from(document.scripts).map(s=>s.src.split('/').pop()), resources:performance.getEntriesByType('resource').map(r=>({name:r.name.split('/').pop().split('?')[0],duration:Math.round(r.duration),bytes:r.decodedBodySize})).filter(r=>/bundle|\.js$|\.css$/.test(r.name))}))()`
  );
  console.log(JSON.stringify(snapshot, null, 2));
  if (process.argv.includes("--screenshot")) {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(artifact("tv-screen.png"), Buffer.from(shot.data, "base64"));
    console.log("Screenshot: " + artifact("tv-screen.png"));
  }
  if (process.argv.includes("--probe")) {
    await new Promise((r) => setTimeout(r, 1500));
    const { profile } = await call("Profiler.stop");
    await fs.writeFile(artifact("flow-cpu-profile.json"), JSON.stringify(profile));
    console.log(
      "Flow measurement: " +
        JSON.stringify(
          await evaluate(
            `(() => {const s=window.__nuvioFlowProbe;s.running=false;window.removeEventListener('keydown',s.listener,true);s.observer.disconnect();s.mutationObserver.disconnect();const f=s.frames.sort((a,b)=>a-b),r={keys:s.keys,frames:{count:f.length,p95Ms:f[Math.floor((f.length-1)*.95)],maxMs:f[f.length-1]},longTasks:s.longTasks,mutations:s.mutations};delete window.__nuvioFlowProbe;return r;})()`
          ),
          null,
          2
        )
    );
  }
} finally {
  // A failed selector, navigation, or profiler call must not leave a RAF loop or
  // event observer running on the TV. Experimental CSS/rows use explicit restore.
  try {
    await Promise.race([
      evaluate(`(() => {
       for(const name of ['__nuvioPerfProbe','__nuvioFlowProbe']) {
         const s=window[name];if(!s)continue;s.running=false;
         s.observer?.disconnect();s.mutationObserver?.disconnect();
         if(s.listener){window.removeEventListener('keydown',s.listener,true);document.removeEventListener('keydown',s.listener,true);}
         if(s.startListener)window.removeEventListener('keydown',s.startListener,true);
         delete window[name];
       }
       return true;
     })()`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Probe cleanup timeout")), 3000))
    ]);
  } catch {
    console.error("Could not confirm probe cleanup; run --cleanup-check after reconnecting.");
  }
  try {
    await Promise.race([
      call("Profiler.stop"),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
  } catch {}
  socket.close();
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
}
