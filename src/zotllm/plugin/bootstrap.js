/* ZotLLM – Zotero-Plugin (Zotero 8–10). Bewusst schlank: die Arbeit macht der lokale Dienst. */
/* global Services, Zotero */
var ZotLLM;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "content/zotllm.js");
  ZotLLM.init({ id, version, rootURI });
  ZotLLM.addToAllWindows();
  await ZotLLM.main();
}

function onMainWindowLoad({ window }) {
  ZotLLM?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  ZotLLM?.removeFromWindow(window);
}

function shutdown() {
  ZotLLM?.shutdown();
  ZotLLM = undefined;
}

function uninstall() {}
