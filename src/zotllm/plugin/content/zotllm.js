/* global Zotero, ZotLLM:writable */
ZotLLM = {
  id: null,
  version: null,
  rootURI: null,
  menuIDs: [],
  windows: new Set(),
  PREF: "extensions.zotllm.",

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
  },

  log(msg) {
    Zotero.debug("ZotLLM: " + msg);
  },

  pref(name) {
    return Zotero.Prefs.get(this.PREF + name, true);
  },

  setPref(name, value) {
    Zotero.Prefs.set(this.PREF + name, value, true);
  },

  get baseURL() {
    let url = this.pref("serviceURL") || "http://127.0.0.1:23120/";
    return url.endsWith("/") ? url : url + "/";
  },

  // -- Fenster ---------------------------------------------------------------------
  addToAllWindows() {
    for (let win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  addToWindow(window) {
    window.MozXULElement.insertFTLIfNeeded("zotllm.ftl");
    this.windows.add(window);
  },

  removeFromWindow(window) {
    window.document.querySelector('[href="zotllm.ftl"]')?.remove();
    this.windows.delete(window);
  },

  // -- Start -----------------------------------------------------------------------
  async main() {
    this.registerMenus();
    this.registerEndpoints();
    // Dienst im Hintergrund prüfen bzw. starten, ohne den Zotero-Start zu verzögern
    this.ensureService({ quiet: true }).catch((e) => this.log("Dienststart: " + e));
  },

  shutdown() {
    for (let id of this.menuIDs) {
      try {
        Zotero.MenuManager.unregisterMenu(id);
      } catch (e) {
        this.log(e);
      }
    }
    this.menuIDs = [];
    delete Zotero.Server.Endpoints["/zotllm/uris"];
    delete Zotero.Server.Endpoints["/zotllm/styles/install"];
    for (let win of this.windows) this.removeFromWindow(win);
  },

  // -- Schnittstelle für ZotLLM -----------------------------------------------------------
  // Zotero-URIs der Einträge, wie sie das Word-Plugin in Belegen speichert (auch für nicht synchronisierte
  // Bibliotheken: http://zotero.org/users/local/<id>/items/<key>). Damit sind exportierte Word-Belege genau mit den
  // Einträgen verknüpft. Anfrage: {"items": ["users/0:KEY", "groups/123:KEY"]} → {"uris": {"users/0:KEY": "…"}}
  registerEndpoints() {
    let plugin = this;
    let Endpoint = function () {};
    Endpoint.prototype = {
      supportedMethods: ["POST"],
      supportedDataTypes: ["application/json"],
      permitBookmarklet: false,
      async init(request) {
        let data = (request && request.data) || {};
        let uris = {};
        for (let ref of data.items || []) {
          try {
            let [lib, key] = String(ref).split(":");
            let libraryID = lib.startsWith("groups/")
              ? Zotero.Groups.getLibraryIDFromGroupID(parseInt(lib.slice(7)))
              : Zotero.Libraries.userLibraryID;
            let item = libraryID && Zotero.Items.getByLibraryAndKey(libraryID, key);
            uris[ref] = item ? Zotero.URI.getItemURI(item) : null;
          } catch (e) {
            plugin.log("URI für " + ref + ": " + e);
            uris[ref] = null;
          }
        }
        return [200, "application/json", JSON.stringify({ uris })];
      },
    };
    Zotero.Server.Endpoints["/zotllm/uris"] = Endpoint;

    // Eigenen Stil aus dem CSL-Editor installieren – mit der Funktion, die auch „+“ in den Zotero-Einstellungen nutzt;
    // danach ist er sofort in Zotero und im Word-Plugin verfügbar. Nur Stile mit ZotLLM-Kennung, damit kein
    // installierter Originalstil (z. B. APA) überschrieben werden kann. Anfrage: {"style": "<?xml …"}
    let StyleInstall = function () {};
    StyleInstall.prototype = {
      supportedMethods: ["POST"],
      supportedDataTypes: ["application/json"],
      permitBookmarklet: false,
      async init(request) {
        if (!plugin.fromZotLLM(request)) return [403, "text/plain", "X-ZotLLM header required"];
        let style = String(((request && request.data) || {}).style || "");
        let id = (style.match(/<id>\s*([^<]+?)\s*<\/id>/) || [])[1] || "";
        if (!id.startsWith("http://www.zotero.org/styles/zotllm-")) {
          return [400, "application/json", JSON.stringify({ error: "Nur eigene Stile aus ZotLLM" })];
        }
        try {
          await Zotero.Styles.install({ string: style }, "ZotLLM", true);
          return [200, "application/json", JSON.stringify({ installed: id })];
        } catch (e) {
          plugin.log("Stil installieren: " + e);
          return [500, "application/json", JSON.stringify({ error: String(e) })];
        }
      },
    };
    Zotero.Server.Endpoints["/zotllm/styles/install"] = StyleInstall;
  },

  // Anfragen von ZotLLM tragen den Kopf X-ZotLLM (Webseiten können ihn ohne CORS-Freigabe nicht setzen)
  fromZotLLM(request) {
    let headers = (request && request.headers) || {};
    let value = typeof headers.get === "function"
      ? headers.get("X-ZotLLM")
      : headers["X-ZotLLM"] || headers["x-zotllm"];
    return value === "1";
  },

  // -- Dienst ------------------------------------------------------------------------
  async request(method, path, body, timeout = 8000) {
    let xhr = await Zotero.HTTP.request(method, this.baseURL + path, {
      headers: { "Content-Type": "application/json", "X-ZotLLM": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout,
      successCodes: false,
      responseType: "json",
    });
    if (xhr.status < 200 || xhr.status >= 300) {
      let detail = xhr.response && xhr.response.detail ? xhr.response.detail : xhr.statusText;
      throw new Error(`${xhr.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
    return xhr.response;
  },

  async ping() {
    try {
      let info = await this.request("GET", "api/plugin/info?client=zotero-plugin&version=" + encodeURIComponent(this.version || ""), undefined, 2500);
      if (info && info.launcher) this.setPref("launcher", JSON.stringify(info.launcher));
      return info;
    } catch (e) {
      return null;
    }
  },

  async ensureService({ quiet = false } = {}) {
    let info = await this.ping();
    if (info) return info;
    if (!this.pref("autostart")) {
      if (!quiet) this.notify("ZotLLM läuft nicht. Bitte ZotLLM starten.", true);
      return null;
    }
    let launcher = [];
    try {
      launcher = JSON.parse(this.pref("launcher") || "[]");
    } catch (e) {}
    if (!launcher.length) {
      if (!quiet) {
        this.notify("ZotLLM läuft nicht. Einmal ZotLLM starten (Startmenü) – danach startet das Plugin es automatisch mit Zotero.", true);
      }
      return null;
    }
    let args = launcher.slice(1);
    let minutes = this.pref("exitWithZoteroMinutes");
    if (minutes) args.push("--exit-with-zotero", String(minutes));
    try {
      this.log("Starte Dienst: " + launcher.join(" "));
      // Nicht abwarten: der Prozess läuft weiter, solange Zotero offen ist
      Zotero.Utilities.Internal.exec(launcher[0], args).catch((e) => this.log("Dienst beendet: " + e));
    } catch (e) {
      if (!quiet) this.notify("Dienst konnte nicht gestartet werden: " + e.message, true);
      return null;
    }
    for (let i = 0; i < 40; i++) {
      await Zotero.Promise.delay(500);
      info = await this.ping();
      if (info) return info;
    }
    if (!quiet) this.notify("Der ZotLLM-Dienst antwortet nicht.", true);
    return null;
  },

  notify(text, isError = false) {
    let pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.changeHeadline("ZotLLM");
    let line = new pw.ItemProgress(isError ? "chrome://zotero/skin/cross.png" : "chrome://zotero/skin/tick.png", text);
    line.setProgress(100);
    pw.show();
    pw.startCloseTimer(isError ? 8000 : 4000);
  },

  libPath(libraryID) {
    let lib = Zotero.Libraries.get(libraryID);
    if (lib.libraryType === "group") return "groups/" + Zotero.Groups.getGroupIDFromLibraryID(libraryID);
    return "users/0";
  },

  // -- Aktionen ------------------------------------------------------------------------
  async openUI(params = {}) {
    let info = await this.ensureService();
    if (!info) return;
    // Installiertes Programm: dessen Fenster nach vorne holen; sonst im Browser öffnen
    try {
      let r = await this.request("POST", "api/ui/open", params, 5000);
      if (r && r.shown) return;
    } catch (e) {
      this.log("Fenster nicht geöffnet: " + e);
    }
    let query = new URLSearchParams(params).toString();
    Zotero.launchURL(this.baseURL + (query ? "?" + query : ""));
  },

  selectedCollections(context) {
    let rows = context.collectionTreeRows || [];
    let out = [];
    for (let row of rows) {
      if (row.isCollection && row.isCollection()) out.push(row.ref);
    }
    return out;
  },

  selectedItemKeys(context) {
    let groups = new Map();
    for (let item of context.items || []) {
      let top = item.parentItem || item;
      if (top.isNote && top.isNote()) continue;
      let lib = this.libPath(top.libraryID);
      if (!groups.has(lib)) groups.set(lib, new Set());
      groups.get(lib).add(top.key);
    }
    return groups;
  },

  async indexCollections(context) {
    let cols = this.selectedCollections(context);
    if (!cols.length) return;
    if (!(await this.ensureService())) return;
    let byLib = new Map();
    for (let c of cols) {
      let lib = this.libPath(c.libraryID);
      if (!byLib.has(lib)) byLib.set(lib, []);
      byLib.get(lib).push(c.key);
    }
    try {
      // Läuft schon eine Indexierung, reiht ZotLLM den Auftrag in die Warteschlange ein
      let queued = false;
      for (let [lib, keys] of byLib) {
        let r = await this.request("POST", "api/plugin/index", { lib, collections: keys, add_to_scope: true });
        if (r && r.queued) queued = true;
      }
      let names = cols.map((c) => c.name).join(", ");
      this.notify(queued ? `Indexierung wartet in der Warteschlange: ${names}` : `Indexierung gestartet: ${names}`);
    } catch (e) {
      this.notify("Indexierung nicht gestartet: " + e.message, true);
    }
  },

  async indexItems(context) {
    let groups = this.selectedItemKeys(context);
    if (!groups.size) return;
    if (!(await this.ensureService())) return;
    try {
      let n = 0;
      let queued = false;
      for (let [lib, keys] of groups) {
        let r = await this.request("POST", "api/plugin/index", { lib, items: [...keys] });
        if (r && r.queued) queued = true;
        n += keys.size;
      }
      this.notify(queued ? `Indexierung von ${n} Einträgen wartet in der Warteschlange` : `Indexierung von ${n} Einträgen gestartet`);
    } catch (e) {
      this.notify("Indexierung nicht gestartet: " + e.message, true);
    }
  },

  async askCollection(context) {
    let cols = this.selectedCollections(context);
    if (!cols.length) return;
    let c = cols[0];
    await this.openUI({ tab: "ask", collection: `${this.libPath(c.libraryID)}:${c.key}` });
  },

  async askItems(context) {
    let groups = this.selectedItemKeys(context);
    let items = [];
    for (let [lib, keys] of groups) for (let k of keys) items.push(`${lib}:${k}`);
    if (!items.length) return;
    await this.openUI({ tab: "ask", items: items.join(",") });
  },

  async buildSheets(context) {
    let groups = this.selectedItemKeys(context);
    let items = [];
    for (let [lib, keys] of groups) for (let k of keys) items.push(`${lib}:${k}`);
    if (!items.length) return;
    if (!(await this.ensureService())) return;
    try {
      await this.request("POST", "api/sheets/build", { items });
      this.notify(`Auswertungsblätter für ${items.length} Einträge werden erstellt (als Notizen am Eintrag).`);
    } catch (e) {
      this.notify("Nicht gestartet: " + e.message, true);
    }
  },

  async syncNow() {
    if (!(await this.ensureService())) return;
    try {
      let r = await this.request("POST", "api/index/run", { sync: true });
      this.notify(r && r.queued ? "Abgleich und Indexierung warten in der Warteschlange" : "Abgleich und Indexierung gestartet");
    } catch (e) {
      this.notify(e.message, true);
    }
  },

  // -- Menüs -----------------------------------------------------------------------------
  registerMenus() {
    if (!Zotero.MenuManager) {
      this.log("MenuManager nicht verfügbar (Zotero < 8)");
      return;
    }
    let reg = (options) => {
      let id = Zotero.MenuManager.registerMenu({ pluginID: this.id, ...options });
      if (id) this.menuIDs.push(id);
    };
    reg({
      menuID: "zotllm-collection",
      target: "main/library/collection",
      menus: [
        {
          menuType: "submenu",
          l10nID: "zotllm-menu",
          menus: [
            { menuType: "menuitem", l10nID: "zotllm-index-collection", onCommand: (ev, ctx) => this.indexCollections(ctx) },
            { menuType: "menuitem", l10nID: "zotllm-ask-collection", onCommand: (ev, ctx) => this.askCollection(ctx) },
          ],
          onShowing: (ev, ctx) => ctx.setVisible(this.selectedCollections(ctx).length > 0),
        },
      ],
    });
    reg({
      menuID: "zotllm-item",
      target: "main/library/item",
      menus: [
        {
          menuType: "submenu",
          l10nID: "zotllm-menu",
          menus: [
            { menuType: "menuitem", l10nID: "zotllm-ask-items", onCommand: (ev, ctx) => this.askItems(ctx) },
            { menuType: "menuitem", l10nID: "zotllm-index-items", onCommand: (ev, ctx) => this.indexItems(ctx) },
            { menuType: "menuitem", l10nID: "zotllm-sheets-items", onCommand: (ev, ctx) => this.buildSheets(ctx) },
          ],
        },
      ],
    });
    reg({
      menuID: "zotllm-tools",
      target: "main/menubar/tools",
      menus: [
        { menuType: "separator" },
        { menuType: "menuitem", l10nID: "zotllm-open", onCommand: () => this.openUI() },
        { menuType: "menuitem", l10nID: "zotllm-sync", onCommand: () => this.syncNow() },
      ],
    });
  },
};
