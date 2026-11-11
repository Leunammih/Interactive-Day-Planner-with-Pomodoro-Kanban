/* Day Planner offline shim.
   Replaces the claude.ai runtime (window.claude.use) so the planner runs as a
   self-hosted, offline-first web app:
   - "db":        documents saved on the device first, synced to a private GitHub Gist
   - "user":      a fixed id (one person per install)
   - "downloads": saves a file through the browser
   - "sample":    not available (the "Add with Claude" box falls back to plain adding)
*/
(function () {
  "use strict";
  const K = { token: "dsSync.token", gist: "dsSync.gist", etag: "dsSync.etag", cache: "dsSync.cache", pending: "dsSync.pending", last: "dsSync.lastOk" };
  const API = "https://api.github.com";
  const PREFIX = "ds-";              // gist file names: ds-<docId>.json
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const cfg = () => ({ token: ls.get(K.token, ""), gist: ls.get(K.gist, "") });

  /* ---------- GitHub Gist transport ---------- */
  async function gh(path, opts) {
    const { token } = cfg();
    const headers = Object.assign({ "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" }, (opts && opts.headers) || {});
    const res = await fetch(API + path, Object.assign({}, opts, { headers, cache: "no-store" }));
    return res;
  }
  async function findOrCreateGist() {
    let res = await gh("/gists?per_page=100");
    if (res.status === 401) throw { code: "auth" };
    if (res.ok) {
      const list = await res.json();
      const hit = list.find(g => g.files && g.files["day-planner.md"]);
      if (hit) return hit.id;
    }
    res = await gh("/gists", { method: "POST", body: JSON.stringify({ description: "Day Planner data (private, synced by the app)", public: false, files: { "day-planner.md": { content: "Data for the Day Planner app. Each ds-*.json file is one day, the backlog or settings. Edit only through the app." } } }) });
    if (res.status === 401 || res.status === 403) throw { code: "auth" };
    if (!res.ok) throw { code: "unavailable" };
    return (await res.json()).id;
  }
  /* returns {docs:{id:data}} or null when unchanged (304) */
  async function pull() {
    const { gist } = cfg();
    const etag = ls.get(K.etag, "");
    const res = await gh("/gists/" + gist, etag ? { headers: { "If-None-Match": etag } } : {});
    if (res.status === 304) return null;
    if (res.status === 401) throw { code: "auth" };
    if (res.status === 404) throw { code: "nogist" };
    if (!res.ok) throw { code: "unavailable" };
    const g = await res.json();
    const docs = {};
    for (const [name, f] of Object.entries(g.files || {})) {
      if (!name.startsWith(PREFIX) || !name.endsWith(".json")) continue;
      let text = f.content;
      if (f.truncated && f.raw_url) { const r = await fetch(f.raw_url, { cache: "no-store" }); if (!r.ok) throw { code: "unavailable" }; text = await r.text(); }
      try { docs[name.slice(PREFIX.length, -5)] = JSON.parse(text); } catch (e) {}
    }
    ls.set(K.cache, docs);
    ls.set(K.etag, res.headers.get("ETag") || "");
    return { docs };
  }
  async function push(files) {
    const { gist } = cfg();
    const body = { files: {} };
    for (const [id, data] of Object.entries(files)) body.files[PREFIX + id + ".json"] = { content: JSON.stringify(data) };
    const res = await gh("/gists/" + gist, { method: "PATCH", body: JSON.stringify(body) });
    if (res.status === 401) throw { code: "auth" };
    if (!res.ok) throw { code: "unavailable" };
    ls.del(K.etag); // force a fresh pull next time
  }

  /* ---------- sync engine ---------- */
  const listeners = [];
  let pending = ls.get(K.pending, {});      // docId -> data, not yet pushed
  let busy = false, failed = false, timer = null, firstDone = false;
  const status = { state: "local", msg: "" };
  function setStatus(state, msg) { status.state = state; status.msg = msg || ""; document.dispatchEvent(new CustomEvent("ds-sync", { detail: status })); }

  function snapshotFrom(docs, fromCache) {
    return {
      metadata: { fromCache },
      docs: Object.entries(docs).map(([id, data]) => ({ id, data: () => JSON.parse(JSON.stringify(data)) }))
    };
  }
  function emit(docs, fromCache) { listeners.forEach(l => { try { l.next(snapshotFrom(docs, fromCache)); } catch (e) { console.error(e); } }); }

  async function cycle() {
    if (busy) return; if (!cfg().token || !cfg().gist) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    busy = true;
    try {
      const out = Object.assign({}, pending); const ids = Object.keys(out);
      if (ids.length) { await push(out); ids.forEach(id => { if (pending[id] === out[id]) delete pending[id]; }); ls.set(K.pending, pending); }
      const r = await pull();
      if (r || !firstDone) { emit(r ? r.docs : ls.get(K.cache, {}), false); }
      firstDone = true;
      ls.set(K.last, Date.now());
      if (failed) { failed = false; window.dispatchEvent(new Event("online")); }
      setStatus("ok");
    } catch (e) {
      failed = true;
      setStatus(e && e.code === "auth" ? "auth" : e && e.code === "nogist" ? "nogist" : "error");
      if (!firstDone) emit(ls.get(K.cache, {}), true);
    } finally { busy = false; }
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(cycle, ms); }
  setInterval(() => { if (document.visibilityState === "visible") cycle(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") cycle(); else if (Object.keys(pending).length) cycle(); });
  window.addEventListener("online", () => schedule(500));
  window.addEventListener("offline", () => setStatus("offline"));

  function collection() {
    return {
      doc(id) {
        return {
          async set(data) {
            if (!cfg().token) throw { code: "invalid_argument" };
            pending[id] = JSON.parse(JSON.stringify(data)); ls.set(K.pending, pending);
            const cache = ls.get(K.cache, {}); cache[id] = pending[id]; ls.set(K.cache, cache);
            schedule(8000);   // batch edits: one save to GitHub at most every few seconds
          }
        };
      },
      onSnapshot(next, error) {
        if (!cfg().token || !cfg().gist) { setTimeout(() => error && error({ code: "not_set_up" }), 0); return () => {}; }
        const l = { next, error }; listeners.push(l);
        setTimeout(cycle, 0);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      }
    };
  }

  /* ---------- downloads ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/.test(filename) ? "application/json" : /\.csv$/.test(filename) ? "text/csv" : "text/plain" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  };

  window.claude = {
    offlineShim: true,
    async use(name) {
      if (name === "db") return { collection };
      if (name === "user") return { id: async () => "me" };
      if (name === "downloads") return downloads;
      return null; // sample and anything else: not available here
    }
  };

  /* ---------- sync setup sheet (tap the status pill) ---------- */
  function setupSheet() {
    const c = cfg(), last = ls.get(K.last, 0);
    const d = document.createElement("dialog");
    d.id = "dsSyncDlg";
    d.innerHTML = `
      <form method="dialog" style="display:grid;gap:12px">
        <b style="font-family:var(--f-display);font-size:19px">Sync between Mac and iPhone</b>
        <p class="hint" style="margin:0">Everything is always saved on this device first, so the planner works offline. Sync copies it to a private Gist in your GitHub account when you're online.</p>
        <p class="hint" style="margin:0"><b>Status:</b> ${c.token ? (status.state === "ok" ? "connected" : status.state === "offline" ? "offline, will sync when back online" : status.state === "auth" ? "the token was refused, paste a new one" : status.state === "error" ? "GitHub not reachable right now" : "connecting") : "not set up, saved on this device only"}${last ? ` · last sync ${new Date(last).toLocaleString()}` : ""}${Object.keys(pending).length ? ` · ${Object.keys(pending).length} waiting to upload` : ""}</p>
        <label class="field"><span>GitHub token (Gists: read and write)</span><input type="password" id="dsTok" autocomplete="off" placeholder="github_pat_…" value="${c.token ? "••••••••" : ""}"></label>
        <p class="hint" style="margin:0">Create it at github.com → Settings → Developer settings → Fine-grained tokens. Under Account permissions, set Gists to Read and write. Use the same token on each device.</p>
        <div class="btnrow">
          <button class="btn primary" value="save" id="dsSave">Save and sync</button>
          <button class="btn" value="now" id="dsNow" ${c.token ? "" : "disabled"}>Sync now</button>
          <button class="btn danger" value="off" id="dsOff" ${c.token ? "" : "disabled"}>Turn off on this device</button>
          <button class="btn ghost" value="close">Close</button>
        </div>
      </form>`;
    d.style.cssText = "border:1px solid var(--line);border-radius:16px;background:var(--surface);color:var(--ink);max-width:min(520px,calc(100% - 32px));padding:18px";
    document.body.appendChild(d);
    d.addEventListener("close", async () => {
      const v = d.returnValue, tok = d.querySelector("#dsTok").value.trim(); d.remove();
      if (v === "now") { await cycle(); return; }
      if (v === "off") { [K.token, K.gist, K.etag].forEach(ls.del); location.reload(); return; }
      if (v !== "save" || !tok || tok.startsWith("••")) return;
      ls.set(K.token, tok);
      try { ls.set(K.gist, await findOrCreateGist()); ls.del(K.etag); location.reload(); }
      catch (e) { ls.del(K.token); alertBox(e && e.code === "auth" ? "GitHub refused that token. Check that it has Gists: Read and write." : "GitHub isn't reachable right now. Try again when you're online."); }
    });
    d.showModal();
  }
  function alertBox(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 4000); }

  document.addEventListener("DOMContentLoaded", () => {
    const pill = document.getElementById("pill");
    if (pill) { pill.style.cursor = "pointer"; pill.setAttribute("role", "button"); pill.title = "Sync settings"; pill.addEventListener("click", setupSheet); }
    if (!cfg().token && !ls.get("dsSync.hinted", false)) { ls.set("dsSync.hinted", true); setTimeout(() => alertBox("Tip: tap “Saved on this device” at the top to set up sync with your other devices."), 1500); }
  });
  /* keep the status pill honest about where data is */
  document.addEventListener("ds-sync", e => {
    const t = document.getElementById("pilltxt"); if (!t) return;
    if (e.detail.state === "auth") t.textContent = "Sync token refused · tap to fix";
  });

  /* ---------- service worker ---------- */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
})();
