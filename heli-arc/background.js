// Heli-Arc: background service worker.
//
// Owns the tab -> space mapping and the saved spaces/folders. The side panel
// reads state straight from storage and sends every change here, so all
// mutations run in one place and in order (see run()).
//
// storage.local   `state`: spaces, pinned folders/links, last space, and a
//                  per-space URL snapshot used to re-sort tabs after a restart.
// storage.session `sess`:  tabId -> spaceId, windowId -> active space, and the
//                  last active tab per window+space. Cleared by the browser on
//                  restart, which is how we know to rebuild from the snapshot.

const COLORS = ['#8b9cff', '#ff8fb1', '#62d6a8', '#ffb86b', '#c39bff', '#6cc8ff'];
const STARTUP_MATCH_MS = 15000;
const BLOCKED_SCHEMES = /^(javascript|data|blob|vbscript):/i;

let local = null;
let sess = null;
let ready = null;
let chain = Promise.resolve();
let startupPool = null; // spaceId -> snapshot URLs not yet claimed by a tab
let startupUntil = 0;
let snapTimer = null;

const uid = () => crypto.randomUUID().slice(0, 8);

function defaultLocal() {
  const id = uid();
  return {
    version: 1,
    lastSpaceId: id,
    spaces: [{ id, name: 'Personal', color: COLORS[0], pinned: [] }],
    snapshot: {},
  };
}

function defaultSess() {
  return { tabSpace: {}, activeSpace: {}, lastTab: {} };
}

function load() {
  if (!ready) {
    ready = (async () => {
      const [{ state }, { sess: saved }] = await Promise.all([
        chrome.storage.local.get('state'),
        chrome.storage.session.get('sess'),
      ]);
      local = state || defaultLocal();
      sess = saved || defaultSess();
      await reconcile();
      await saveLocal();
      await saveSess();
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// Serialize every read-modify-write so concurrent tab events can't clobber
// each other's changes.
function run(fn) {
  const p = chain.then(async () => {
    await load();
    return fn();
  });
  chain = p.catch((err) => console.error('[arc-spaces]', err));
  return p;
}

async function saveLocal() {
  await chrome.storage.local.set({ state: local });
}

async function saveSess() {
  await chrome.storage.session.set({ sess });
  scheduleSnapshot();
}

function scheduleSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => run(snapshot), 1000);
}

// Remember which URLs belong to which space so tabs can be re-sorted after
// the browser restarts and every tab gets a new id.
async function snapshot() {
  // Tabs are still being restored; don't overwrite the snapshot with a
  // half-built one.
  if (Date.now() < startupUntil) return scheduleSnapshot();
  const tabs = await chrome.tabs.query({});
  const snap = {};
  for (const tab of tabs) {
    const space = sess.tabSpace[tab.id];
    const url = tab.url || tab.pendingUrl;
    if (!space || !url || tab.pinned) continue;
    (snap[space] ||= []).push(url);
  }
  local.snapshot = snap;
  await saveLocal();
}

const spaceExists = (id) => local.spaces.some((s) => s.id === id);
const getSpace = (id) => local.spaces.find((s) => s.id === id);

function fallbackSpace(windowId) {
  const active = sess.activeSpace[windowId];
  if (active && spaceExists(active)) return active;
  if (spaceExists(local.lastSpaceId)) return local.lastSpaceId;
  return local.spaces[0].id;
}

function claimFromPool(url) {
  if (!startupPool || !url || Date.now() > startupUntil) return null;
  for (const [spaceId, urls] of Object.entries(startupPool)) {
    const i = urls.indexOf(url);
    if (i !== -1 && spaceExists(spaceId)) {
      urls.splice(i, 1);
      return spaceId;
    }
  }
  return null;
}

async function reconcile() {
  // An empty session means the browser just started (or the extension was
  // just installed): tab ids are new, so match tabs to spaces by URL.
  const snap = Object.entries(local.snapshot || {});
  if (Object.keys(sess.tabSpace).length === 0 && snap.length) {
    startupPool = {};
    for (const [id, urls] of snap) startupPool[id] = [...urls];
    startupUntil = Date.now() + STARTUP_MATCH_MS;
  }
  const tabs = await chrome.tabs.query({});
  const live = new Set(tabs.map((t) => String(t.id)));
  for (const tab of tabs) {
    if (spaceExists(sess.tabSpace[tab.id])) continue;
    sess.tabSpace[tab.id] = claimFromPool(tab.url || tab.pendingUrl) || fallbackSpace(tab.windowId);
  }
  for (const id of Object.keys(sess.tabSpace)) {
    if (!live.has(id)) delete sess.tabSpace[id];
  }
  for (const tab of tabs) {
    if (tab.active && !tab.pinned) sess.activeSpace[tab.windowId] = sess.tabSpace[tab.id];
  }
  for (const [windowId, spaceId] of Object.entries(sess.activeSpace)) {
    if (!spaceExists(spaceId)) sess.activeSpace[windowId] = local.spaces[0].id;
  }
}

// ---------------------------------------------------------------------------
// Tab and window events

chrome.tabs.onCreated.addListener((tab) =>
  run(async () => {
    const opener = tab.openerTabId != null ? sess.tabSpace[tab.openerTabId] : null;
    if (spaceExists(opener)) {
      sess.tabSpace[tab.id] = opener;
    } else if (!spaceExists(sess.tabSpace[tab.id])) {
      sess.tabSpace[tab.id] = claimFromPool(tab.url || tab.pendingUrl) || fallbackSpace(tab.windowId);
    }
    await saveSess();
  })
);

chrome.tabs.onRemoved.addListener((tabId) =>
  run(async () => {
    delete sess.tabSpace[tabId];
    await saveSess();
  })
);

chrome.tabs.onReplaced.addListener((addedId, removedId) =>
  run(async () => {
    if (sess.tabSpace[removedId]) sess.tabSpace[addedId] = sess.tabSpace[removedId];
    delete sess.tabSpace[removedId];
    await saveSess();
  })
);

chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url || change.pinned !== undefined) scheduleSnapshot();
});

// Activating a tab from anywhere (native sidebar, link, Ctrl+Tab) moves the
// window to that tab's space. Browser-pinned tabs are shared by all spaces.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) =>
  run(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.pinned) return;
    if (!spaceExists(sess.tabSpace[tabId])) sess.tabSpace[tabId] = fallbackSpace(windowId);
    const space = sess.tabSpace[tabId];
    sess.activeSpace[windowId] = space;
    sess.lastTab[`${windowId}:${space}`] = tabId;
    if (local.lastSpaceId !== space) {
      local.lastSpaceId = space;
      await saveLocal();
    }
    await saveSess();
  })
);

chrome.windows.onCreated.addListener((win) =>
  run(async () => {
    if (!sess.activeSpace[win.id]) {
      sess.activeSpace[win.id] = fallbackSpace(win.id);
      await saveSess();
    }
  })
);

chrome.windows.onRemoved.addListener((windowId) =>
  run(async () => {
    delete sess.activeSpace[windowId];
    for (const key of Object.keys(sess.lastTab)) {
      if (key.startsWith(`${windowId}:`)) delete sess.lastTab[key];
    }
    await saveSess();
  })
);

// ---------------------------------------------------------------------------
// Actions requested by the side panel

// Open a tab that belongs to spaceId. Mapping it here (rather than waiting
// for onCreated to guess) keeps it in the right space even during startup.
async function openTab(windowId, spaceId, url) {
  const tab = await chrome.tabs.create({ windowId, active: true, ...(url ? { url } : {}) });
  sess.tabSpace[tab.id] = spaceId;
  await saveSess();
  return tab;
}

async function activateSpace(windowId, spaceId) {
  if (!spaceExists(spaceId)) throw new Error('Unknown space');
  sess.activeSpace[windowId] = spaceId;
  if (local.lastSpaceId !== spaceId) {
    local.lastSpaceId = spaceId;
    await saveLocal();
  }
  await saveSess();
  const tabs = await chrome.tabs.query({ windowId });
  const mine = tabs.filter((t) => !t.pinned && sess.tabSpace[t.id] === spaceId);
  const last = sess.lastTab[`${windowId}:${spaceId}`];
  const target = mine.find((t) => t.id === last) || mine[mine.length - 1];
  if (target) {
    if (!target.active) await chrome.tabs.update(target.id, { active: true });
  } else {
    // Empty space: open a fresh tab so the window has something to show.
    await openTab(windowId, spaceId);
  }
}

function findItem(itemId) {
  for (const space of local.spaces) {
    for (let i = 0; i < space.pinned.length; i++) {
      const item = space.pinned[i];
      if (item.id === itemId) return { space, list: space.pinned, index: i, item };
      if (item.type === 'folder') {
        const j = item.children.findIndex((c) => c.id === itemId);
        if (j !== -1) return { space, list: item.children, index: j, item: item.children[j], folder: item };
      }
    }
  }
  return null;
}

function targetList(spaceId, folderId) {
  const space = getSpace(spaceId);
  if (!space) throw new Error('Unknown space');
  if (!folderId) return space.pinned;
  const found = findItem(folderId);
  if (!found || found.item.type !== 'folder' || found.space.id !== spaceId) throw new Error('Unknown folder');
  return found.item.children;
}

function cleanUrl(url) {
  if (typeof url !== 'string' || !url || BLOCKED_SCHEMES.test(url)) throw new Error('Unsupported URL');
  return url;
}

const actions = {
  hello: async () => null,

  switchSpace: ({ windowId, spaceId }) => activateSpace(windowId, spaceId),

  newTab: async ({ windowId, spaceId }) => {
    if (!spaceExists(spaceId)) throw new Error('Unknown space');
    sess.activeSpace[windowId] = spaceId;
    await saveSess();
    await openTab(windowId, spaceId);
  },

  moveTab: async ({ tabId, spaceId }) => {
    if (!spaceExists(spaceId)) throw new Error('Unknown space');
    const tab = await chrome.tabs.get(tabId);
    sess.tabSpace[tabId] = spaceId;
    await saveSess();
    const current = sess.activeSpace[tab.windowId];
    // The window stays on its space; show something else there.
    if (tab.active && current && current !== spaceId) await activateSpace(tab.windowId, current);
  },

  // Arc's "Clear": close every unpinned tab of the space in this window.
  clearSpace: async ({ windowId, spaceId }) => {
    const tabs = await chrome.tabs.query({ windowId });
    const ids = tabs.filter((t) => !t.pinned && sess.tabSpace[t.id] === spaceId).map((t) => t.id);
    if (!ids.length) return;
    sess.activeSpace[windowId] = spaceId;
    await saveSess();
    // Open the replacement first so the window never runs out of tabs.
    await openTab(windowId, spaceId);
    await chrome.tabs.remove(ids);
  },

  createSpace: async ({ name }) => {
    const id = uid();
    const color = COLORS[local.spaces.length % COLORS.length];
    local.spaces.push({ id, name: String(name || 'Space').slice(0, 60), color, pinned: [] });
    await saveLocal();
    return id;
  },

  updateSpace: async ({ spaceId, name, color }) => {
    const space = getSpace(spaceId);
    if (!space) throw new Error('Unknown space');
    if (name) space.name = String(name).slice(0, 60);
    if (color && COLORS.includes(color)) space.color = color;
    await saveLocal();
  },

  deleteSpace: async ({ spaceId }) => {
    if (local.spaces.length === 1) throw new Error("Can't delete the last space");
    const index = local.spaces.findIndex((s) => s.id === spaceId);
    if (index === -1) return;
    local.spaces.splice(index, 1);
    const heir = local.spaces[Math.max(0, index - 1)].id;
    // Tabs aren't closed; they move to the neighbouring space.
    for (const [tabId, s] of Object.entries(sess.tabSpace)) {
      if (s === spaceId) sess.tabSpace[tabId] = heir;
    }
    const affectedWindows = [];
    for (const [windowId, s] of Object.entries(sess.activeSpace)) {
      if (s === spaceId) {
        sess.activeSpace[windowId] = heir;
        affectedWindows.push(Number(windowId));
      }
    }
    if (local.lastSpaceId === spaceId) local.lastSpaceId = heir;
    delete local.snapshot[spaceId];
    await saveLocal();
    await saveSess();
    for (const windowId of affectedWindows) await activateSpace(windowId, heir).catch(() => {});
  },

  addFolder: async ({ spaceId, name }) => {
    const id = uid();
    targetList(spaceId, null).push({ type: 'folder', id, name: String(name || 'New Folder').slice(0, 60), open: true, children: [] });
    await saveLocal();
    return id;
  },

  addLink: async ({ spaceId, folderId, url, title, beforeId }) => {
    const list = targetList(spaceId, folderId);
    url = cleanUrl(url);
    if (list.some((i) => i.type === 'link' && i.url === url)) return null;
    const id = uid();
    const link = { type: 'link', id, url, title: String(title || url).slice(0, 200) };
    const at = beforeId ? list.findIndex((i) => i.id === beforeId) : -1;
    list.splice(at === -1 ? list.length : at, 0, link);
    await saveLocal();
    return id;
  },

  renameItem: async ({ itemId, name }) => {
    const found = findItem(itemId);
    if (!found || !name) return;
    if (found.item.type === 'folder') found.item.name = String(name).slice(0, 60);
    else found.item.title = String(name).slice(0, 200);
    await saveLocal();
  },

  removeItem: async ({ itemId }) => {
    const found = findItem(itemId);
    if (!found) return;
    found.list.splice(found.index, 1);
    await saveLocal();
  },

  toggleFolder: async ({ itemId }) => {
    const found = findItem(itemId);
    if (!found || found.item.type !== 'folder') return;
    found.item.open = !found.item.open;
    await saveLocal();
  },

  // Move a folder or link. Folders only live at the top level of a space.
  moveItem: async ({ itemId, spaceId, folderId, beforeId }) => {
    const found = findItem(itemId);
    if (!found || itemId === beforeId || itemId === folderId) return;
    if (found.item.type === 'folder' && folderId) return;
    const list = targetList(spaceId, folderId);
    found.list.splice(found.index, 1);
    const at = beforeId ? list.findIndex((i) => i.id === beforeId) : -1;
    list.splice(at === -1 ? list.length : at, 0, found.item);
    await saveLocal();
  },

  // Open a saved link: focus a tab in this space already showing it, else
  // open a new one.
  openLink: async ({ itemId, windowId }) => {
    const found = findItem(itemId);
    if (!found || found.item.type !== 'link') return;
    const spaceId = found.space.id;
    const tabs = await chrome.tabs.query({ windowId });
    const existing = tabs.find((t) => !t.pinned && sess.tabSpace[t.id] === spaceId && t.url === found.item.url);
    sess.activeSpace[windowId] = spaceId;
    await saveSess();
    if (existing) await chrome.tabs.update(existing.id, { active: true });
    else await openTab(windowId, spaceId, cleanUrl(found.item.url));
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handler = actions[msg?.type];
  if (!handler) return false;
  run(() => handler(msg)).then(
    (result) => reply({ ok: true, result }),
    (err) => reply({ ok: false, error: String(err?.message || err) })
  );
  return true;
});

chrome.runtime.onInstalled.addListener(() => run(async () => {}));
chrome.runtime.onStartup.addListener(() => run(async () => {}));

// Clicking the toolbar icon opens the panel. No keyboard shortcut is
// registered so Helium's own shortcuts (Ctrl+S) are left alone.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
