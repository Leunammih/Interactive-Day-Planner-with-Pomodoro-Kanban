/* Day Planner offline shim.
   Replaces the claude.ai runtime (window.claude.use) so the planner runs as a
   self-hosted, offline-first web app:
   - "db":        documents saved on the device first, synced to data/<docId>.json
                  in a private GitHub repo of your choice (Claude can read it there too)
   - "user":      a fixed id (one person per install)
   - "downloads": saves a file through the browser
   - "sample":    not available (the "Add with Claude" box falls back to plain adding)
*/
(function () {
  "use strict";
  const K = { token: "dsSync.token", repo: "dsSync.repo", branch: "dsSync.branch", etag: "dsSync.etag", shas: "dsSync.shas", cache: "dsSync.cache", pending: "dsSync.pending", last: "dsSync.lastOk" };
  const API = "https://api.github.com";
  const DIR = "data/";
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const cfg = () => ({ token: ls.get(K.token, ""), repo: ls.get(K.repo, ""), branch: ls.get(K.branch, "main") });
  const ready = () => { const c = cfg(); return !!(c.token && c.repo); };

  /* ---------- GitHub repo transport ---------- */
  async function gh(path, opts, token) {
    const headers = Object.assign({ "Accept": "application/vnd.github+json", "Authorization": "Bearer " + (token || cfg().token), "X-GitHub-Api-Version": "2022-11-28" }, (opts && opts.headers) || {});
    return fetch(API + path, Object.assign({}, opts, { headers, cache: "no-store" }));
  }
  const fail = res => { throw { code: res.status === 401 || res.status === 403 ? "auth" : res.status === 404 ? "norepo" : "unavailable", status: res.status }; };
  const b64 = str => { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  async function checkRepo(token, repo) {
    const res = await gh("/repos/" + repo, {}, token);
    if (!res.ok) fail(res);
    const j = await res.json();
    if (j.permissions && !j.permissions.push) throw { code: "readonly" };
    if (!j.private) throw { code: "public" };
    return j.default_branch || "main";
  }
  async function blobText(sha) {
    const res = await gh(`/repos/${cfg().repo}/git/blobs/${sha}`, { headers: { "Accept": "application/vnd.github.raw+json" } });
    if (!res.ok) fail(res);
    return res.text();
  }
  /* returns {docs:{id:data}} or null when nothing changed */
  async function pull() {
    const { repo, branch } = cfg();
    const etag = ls.get(K.etag, "");
    const res = await gh(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, etag ? { headers: { "If-None-Match": etag } } : {});
    if (res.status === 304) return null;
    if (res.status === 404 || res.status === 409) { ls.set(K.etag, ""); return { docs: ls.get(K.cache, {}) }; } // empty repo
    if (!res.ok) fail(res);
    const tree = (await res.json()).tree || [];
    const shas = ls.get(K.shas, {}), cache = ls.get(K.cache, {}), seen = {};
    let changed = false;
    for (const f of tree) {
      if (f.type !== "blob" || !f.path.startsWith(DIR) || !f.path.endsWith(".json")) continue;
      const id = f.path.slice(DIR.length, -5); if (id.includes("/")) continue;
      seen[id] = 1;
      if (shas[id] === f.sha && cache[id]) continue;
      if (pending[id]) { shas[id] = f.sha; continue; }   // our newer copy goes up next
      try { cache[id] = JSON.parse(await blobText(f.sha)); shas[id] = f.sha; changed = true; } catch (e) { if (e && e.code) throw e; }
    }
    ls.set(K.shas, shas); ls.set(K.cache, cache);
    ls.set(K.etag, res.headers.get("ETag") || "");
    return changed || !firstDone ? { docs: cache } : null;
  }
  async function putOne(id, data, retry) {
    const { repo, branch } = cfg(); const shas = ls.get(K.shas, {});
    const body = { message: "Update " + id, content: b64(JSON.stringify(data, null, 1)), branch };
    if (shas[id]) body.sha = shas[id];
    const res = await gh(`/repos/${repo}/contents/${DIR}${encodeURIComponent(id)}.json`, { method: "PUT", body: JSON.stringify(body) });
    if (res.ok) { const j = await res.json(); shas[id] = j.content && j.content.sha; ls.set(K.shas, shas); return; }
    if ((res.status === 409 || res.status === 422) && !retry) {
      // someone else (another device, or Claude) changed this file: newest edit wins
      const cur = await gh(`/repos/${repo}/contents/${DIR}${encodeURIComponent(id)}.json?ref=${encodeURIComponent(branch)}`);
      if (cur.status === 404) { delete shas[id]; ls.set(K.shas, shas); return putOne(id, data, true); }
      if (!cur.ok) fail(cur);
      const j = await cur.json(); shas[id] = j.sha; ls.set(K.shas, shas);
      let remote = null; try { remote = JSON.parse(await blobText(j.sha)); } catch (e) {}
      if (remote && (remote.updatedAt || 0) > (data.updatedAt || 0)) { delete shas[id]; ls.set(K.shas, shas); return; } // remote wins; pulled next
      return putOne(id, data, true);
    }
    fail(res);
  }
  async function push(files) {
    for (const [id, data] of Object.entries(files)) await putOne(id, data);
    ls.del(K.etag);
  }

  /* ---------- sync engine ---------- */
  const listeners = [];
  let pending = ls.get(K.pending, {});      // docId -> data, not yet pushed
  let busy = false, failed = false, timer = null; var firstDone = false;
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
    if (busy) return; if (!ready()) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    busy = true;
    try {
      const out = Object.assign({}, pending); const ids = Object.keys(out);
      if (ids.length) { await push(out); ids.forEach(id => { if (pending[id] === out[id]) delete pending[id]; }); ls.set(K.pending, pending); }
      const r = await pull();
      if (r) emit(r.docs, false);
      firstDone = true;
      ls.set(K.last, Date.now());
      if (failed) { failed = false; window.dispatchEvent(new Event("online")); }
      setStatus("ok");
    } catch (e) {
      failed = true;
      setStatus(e && e.code === "auth" ? "auth" : e && e.code === "norepo" ? "norepo" : "error");
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
            if (!ready()) throw { code: "invalid_argument" };
            pending[id] = JSON.parse(JSON.stringify(data)); ls.set(K.pending, pending);
            const cache = ls.get(K.cache, {}); cache[id] = pending[id]; ls.set(K.cache, cache);
            schedule(8000);   // batch edits: one save to GitHub at most every few seconds
          }
        };
      },
      onSnapshot(next, error) {
        if (!ready()) { setTimeout(() => error && error({ code: "not_set_up" }), 0); return () => {}; }
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

  /* ---------- sync setup sheet (⚙︎ button in the top bar) ---------- */
  function setupSheet() {
    const c = cfg(), last = ls.get(K.last, 0), np = Object.keys(pending).length;
    const st = !ready() ? "not set up, saved on this device only" : status.state === "ok" ? "connected" : status.state === "offline" ? "offline, will sync when back online" : status.state === "auth" ? "the token was refused, paste a new one" : status.state === "norepo" ? "the repo wasn't found, check the name and the token's access" : status.state === "error" ? "GitHub not reachable right now" : "connecting";
    const d = document.createElement("dialog");
    d.id = "dsSyncDlg";
    d.innerHTML = `
      <form method="dialog" style="display:grid;gap:12px">
        <b style="font-family:var(--f-display);font-size:19px">Sync between your devices</b>
        <p class="hint" style="margin:0">Everything is saved on this device first, so the planner works offline. Sync copies it to a private GitHub repo when you're online, and brings in changes from your other devices.</p>
        <p class="hint" style="margin:0"><b>Status:</b> ${st}${last ? ` · last sync ${new Date(last).toLocaleString()}` : ""}${np ? ` · ${np} waiting to upload` : ""}</p>
        <label class="field"><span>Private data repo (owner/name)</span><input type="text" id="dsRepo" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your-name/day-planner-data" value="${c.repo || ""}"></label>
        <label class="field"><span>GitHub token</span><input type="password" id="dsTok" autocomplete="off" placeholder="github_pat_…" value="${c.token ? "••••••••" : ""}"></label>
        <p class="hint" style="margin:0">Create it at github.com → Settings → Developer settings → Fine-grained tokens. Repository access: only the data repo. Permissions: Contents, Read and write. Use the same token on each device.</p>
        <div class="btnrow">
          <button class="btn primary" value="save">Save and sync</button>
          <button class="btn" value="now" ${ready() ? "" : "disabled"}>Sync now</button>
          <button class="btn danger" value="off" ${ready() ? "" : "disabled"}>Turn off on this device</button>
          <button class="btn ghost" value="close">Close</button>
        </div>
      </form>`;
    d.style.cssText = "border:1px solid var(--line);border-radius:16px;background:var(--surface);color:var(--ink);max-width:min(520px,calc(100% - 32px));padding:18px";
    document.body.appendChild(d);
    d.addEventListener("close", async () => {
      const v = d.returnValue, tokIn = d.querySelector("#dsTok").value.trim(), repo = d.querySelector("#dsRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$|\/$/g, ""); d.remove();
      if (v === "now") { await cycle(); return; }
      if (v === "off") { [K.token, K.repo, K.etag, K.shas].forEach(ls.del); location.reload(); return; }
      if (v !== "save") return;
      const tok = tokIn.startsWith("••") ? c.token : tokIn;
      if (!tok || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { alertBox("Fill in both the repo (owner/name) and the token."); return; }
      try {
        const branch = await checkRepo(tok, repo);
        if (repo !== c.repo) { [K.etag, K.shas].forEach(ls.del); }
        ls.set(K.token, tok); ls.set(K.repo, repo); ls.set(K.branch, branch);
        location.reload();
      } catch (e) {
        alertBox(e.code === "auth" ? "GitHub refused that token, or it has no access to that repo." : e.code === "norepo" ? "Repo not found. Check the name, and that the token includes it." : e.code === "readonly" ? "The token can only read that repo. Give it Contents: Read and write." : e.code === "public" ? "That repo is public. Use a private repo so your days stay private." : "GitHub isn't reachable right now. Try again when you're online.");
      }
    });
    d.showModal();
  }
  function alertBox(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 4000); }

  document.addEventListener("DOMContentLoaded", () => {
    const pill = document.getElementById("pill");
    const rb = document.getElementById("reloadBtn");
    if (rb && !document.getElementById("dsGear")) { const g = rb.cloneNode(false); g.id = "dsGear"; g.textContent = "⚙︎"; g.style.fontSize = "24px"; g.title = "Sync settings"; g.setAttribute("aria-label", "Sync settings"); g.addEventListener("click", setupSheet); rb.parentNode.insertBefore(g, rb); }
    document.addEventListener("click", e => { if (!ready() && e.target.closest && e.target.closest("#syncBtn")) { e.preventDefault(); e.stopImmediatePropagation(); setupSheet(); } }, true);
    if (pill) { pill.style.cursor = "pointer"; pill.setAttribute("role", "button"); pill.title = "Sync settings"; pill.addEventListener("click", setupSheet); }
    if (!ready() && !ls.get("dsSync.hinted2", false)) { ls.set("dsSync.hinted2", true); setTimeout(() => alertBox("Tip: tap ⚙︎ at the top to set up sync with your other devices."), 1500); }
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
