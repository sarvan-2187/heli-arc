// Heli-Arc: side panel UI.
//
// Reads state from storage and chrome.tabs, re-renders on any change, and
// sends every mutation to the background worker.

const COLORS = [
  ['#8b9cff', 'Blue'],
  ['#ff8fb1', 'Pink'],
  ['#62d6a8', 'Green'],
  ['#ffb86b', 'Orange'],
  ['#c39bff', 'Purple'],
  ['#6cc8ff', 'Sky'],
];
const TAB_TYPE = 'text/x-arc-tab';
const ITEM_TYPE = 'text/x-arc-item';

const $ = (id) => document.getElementById(id);
let windowId = null;
let state = null;
let sess = null;
let tabs = [];
let activeSpaceId = null;
let editing = false;
let renderQueued = false;
let dragKind = null; // 'tab' | 'link' | 'folder' while a drag is in progress

// ---------------------------------------------------------------------------
// Helpers

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || 'Something went wrong');
  return res.result;
}

function act(type, payload) {
  return send(type, payload).catch((err) => toast(err.message));
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

// Rows are focusable divs rather than <button>s so an inline rename <input>
// can live inside them.
function rowEl(props, ...children) {
  const row = el('div', { role: 'button', tabIndex: 0, ...props }, ...children);
  row.addEventListener('keydown', (e) => {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    row.click();
  });
  return row;
}

// Icon URLs that failed to load, so re-renders don't retry them. A site's
// own favicon URL fails from an extension page when the site sends
// Cross-Origin-Resource-Policy, blocks hotlinking, or the file is gone.
const failedIcons = new Set();

// The browser's cached favicon for a page. It's served locally, so site
// headers can't block it.
function browserFavicon(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
}

function letterIcon(url) {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {}
  return el('span', { class: 'letter-icon', ariaHidden: 'true', textContent: (host[0] || '•').toUpperCase() });
}

// Try the tab's favicon, then the browser's cached one, then a letter.
function faviconFor(url, favIconUrl) {
  const sources = [];
  if (favIconUrl && /^(https?:|data:image\/)/.test(favIconUrl)) sources.push(favIconUrl);
  if (url) sources.push(browserFavicon(url));
  const pending = sources.filter((src) => !failedIcons.has(src));
  if (!pending.length) return letterIcon(url);

  const img = el('img', { alt: '', decoding: 'async' });
  let current = pending.shift();
  img.addEventListener('error', () => {
    failedIcons.add(current);
    current = pending.shift();
    if (current) img.src = current;
    else img.replaceWith(letterIcon(url));
  });
  img.src = current;
  return img;
}

const spaceById = (id) => state.spaces.find((s) => s.id === id);

function spaceOfTab(tab) {
  const s = sess.tabSpace[tab.id];
  return s && spaceById(s) ? s : activeSpaceId;
}

// ---------------------------------------------------------------------------
// Rendering

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(async () => {
    renderQueued = false;
    await render();
  });
}

async function render() {
  if (editing) return;
  const [{ state: s }, { sess: ss }, t] = await Promise.all([
    chrome.storage.local.get('state'),
    chrome.storage.session.get('sess'),
    chrome.tabs.query({ windowId }),
  ]);
  if (!s || !ss) return; // background still initialising; storage events will re-render
  state = s;
  sess = ss;
  tabs = t;
  activeSpaceId = sess.activeSpace[windowId];
  if (!spaceById(activeSpaceId)) activeSpaceId = spaceById(state.lastSpaceId) ? state.lastSpaceId : state.spaces[0].id;
  const space = spaceById(activeSpaceId);

  document.documentElement.style.setProperty('--accent', space.color);
  $('space-dot').style.background = space.color;
  $('space-name').textContent = space.name;

  renderFavorites();
  renderPinned(space);
  renderTabs();
  renderSpaceBar();
}

function renderFavorites() {
  const pinnedTabs = tabs.filter((t) => t.pinned);
  $('favorites').replaceChildren(
    ...pinnedTabs.map((tab) =>
      el('button', {
        class: 'fav' + (tab.active ? ' active' : ''),
        title: tab.title || tab.url,
        onclick: () => chrome.tabs.update(tab.id, { active: true }),
        onauxclick: (e) => e.button === 1 && chrome.tabs.remove(tab.id),
        oncontextmenu: (e) =>
          openMenu(e, [
            ['Unpin from browser', () => chrome.tabs.update(tab.id, { pinned: false })],
            ['Close', () => chrome.tabs.remove(tab.id), 'danger'],
          ]),
      }, faviconFor(tab.url, tab.favIconUrl))
    )
  );
}

function renderPinned(space) {
  $('pinned-list').replaceChildren(
    ...space.pinned.map((item) => (item.type === 'folder' ? folderNode(item, space) : linkNode(item, space, null)))
  );
}

function folderNode(folder, space) {
  const children = el('div', { class: 'folder-children' }, ...folder.children.map((link) => linkNode(link, space, folder.id)));
  const title = el('span', { class: 'title', textContent: folder.name });
  const row = rowEl({
    class: 'row',
    draggable: true,
    title: folder.name,
    onclick: () => act('toggleFolder', { itemId: folder.id }),
    ondblclick: (e) => {
      e.preventDefault();
      rename(title, folder.name, (name) => act('renameItem', { itemId: folder.id, name }));
    },
    oncontextmenu: (e) =>
      openMenu(e, [
        ['Open all', () => openAll(folder)],
        ['Rename', () => rename(title, folder.name, (name) => act('renameItem', { itemId: folder.id, name }))],
        ['Delete folder', () => confirmThen(folderDeleteText(folder), () => act('removeItem', { itemId: folder.id })), 'danger'],
      ]),
  }, el('span', { class: 'chev', textContent: '▾' }), el('span', { textContent: '📁', ariaHidden: 'true' }), title);
  row.setAttribute('aria-expanded', String(folder.open));

  dragSource(row, ITEM_TYPE, folder.id, 'folder');
  dropTarget(row, {
    accepts: (kind) => kind === 'tab' || kind === 'link' || kind === 'folder',
    mode: (kind) => (kind === 'folder' ? 'before' : 'into'),
    onDrop: (kind, id) => {
      if (kind === 'tab') return pinTab(Number(id), space.id, folder.id);
      if (kind === 'link') return act('moveItem', { itemId: id, spaceId: space.id, folderId: folder.id });
      return act('moveItem', { itemId: id, spaceId: space.id, folderId: null, beforeId: folder.id });
    },
  });

  return el('div', { class: 'folder' + (folder.open ? '' : ' closed') }, row, children);
}

function folderDeleteText(folder) {
  const n = folder.children.length;
  return n ? `Delete “${folder.name}” and the ${n} link${n === 1 ? '' : 's'} in it?` : `Delete “${folder.name}”?`;
}

function linkNode(link, space, folderId) {
  const open = tabs.find((t) => !t.pinned && spaceOfTab(t) === space.id && t.url === link.url);
  const title = el('span', { class: 'title', textContent: link.title });
  const row = rowEl({
    class: 'row' + (open?.active ? ' active' : ''),
    draggable: true,
    title: `${link.title}\n${link.url}`,
    onclick: () => act('openLink', { itemId: link.id, windowId }),
    onauxclick: (e) => e.button === 1 && open && chrome.tabs.remove(open.id),
    ondblclick: (e) => {
      e.preventDefault();
      rename(title, link.title, (name) => act('renameItem', { itemId: link.id, name }));
    },
    oncontextmenu: (e) =>
      openMenu(e, [
        ['Rename', () => rename(title, link.title, (name) => act('renameItem', { itemId: link.id, name }))],
        ['Copy link', () => navigator.clipboard.writeText(link.url).then(() => toast('Link copied'))],
        ...(open ? [['Close tab', () => chrome.tabs.remove(open.id)]] : []),
        ['Unpin', () => act('removeItem', { itemId: link.id }), 'danger'],
      ]),
  }, faviconFor(link.url), title);

  // A pinned link with an open tab gets a close button, like Arc.
  if (open) {
    row.append(el('span', {
      class: 'close',
      title: 'Close tab',
      textContent: '✕',
      onclick: (e) => {
        e.stopPropagation();
        chrome.tabs.remove(open.id);
      },
    }));
  }

  dragSource(row, ITEM_TYPE, link.id, 'link');
  dropTarget(row, {
    accepts: (kind) => kind === 'tab' || kind === 'link',
    mode: () => 'before',
    onDrop: (kind, id) => {
      if (kind === 'tab') return pinTab(Number(id), space.id, folderId, link.id);
      return act('moveItem', { itemId: id, spaceId: space.id, folderId, beforeId: link.id });
    },
  });
  return row;
}

function renderTabs() {
  const list = tabs.filter((t) => !t.pinned && spaceOfTab(t) === activeSpaceId);
  $('tabs').replaceChildren(...list.map(tabNode));
}

function tabNode(tab) {
  const title = el('span', { class: 'title', textContent: tab.title || tab.url || 'New Tab' });
  const others = state.spaces.filter((s) => s.id !== activeSpaceId);
  const row = rowEl({
    class: 'row' + (tab.active ? ' active' : ''),
    draggable: true,
    title: tab.title || tab.url,
    onclick: () => chrome.tabs.update(tab.id, { active: true }),
    onauxclick: (e) => e.button === 1 && chrome.tabs.remove(tab.id),
    oncontextmenu: (e) =>
      openMenu(e, [
        ['Pin to space', () => pinTab(tab.id, activeSpaceId, null)],
        ...state.spaces
          .find((s) => s.id === activeSpaceId)
          .pinned.filter((i) => i.type === 'folder')
          .map((f) => [`Pin to “${f.name}”`, () => pinTab(tab.id, activeSpaceId, f.id)]),
        ...(others.length ? ['-', 'Move to space'] : []),
        ...others.map((s) => [s.name, () => act('moveTab', { tabId: tab.id, spaceId: s.id }), null, s.color]),
        '-',
        ['Pin to browser (all spaces)', () => chrome.tabs.update(tab.id, { pinned: true })],
        ['Duplicate', () => chrome.tabs.duplicate(tab.id)],
        ['Close', () => chrome.tabs.remove(tab.id), 'danger'],
      ]),
  }, faviconFor(tab.url, tab.favIconUrl), title, el('span', {
    class: 'close',
    title: 'Close tab',
    textContent: '✕',
    onclick: (e) => {
      e.stopPropagation();
      chrome.tabs.remove(tab.id);
    },
  }));

  dragSource(row, TAB_TYPE, tab.id, 'tab');
  dropTarget(row, {
    accepts: (kind) => kind === 'tab',
    mode: () => 'before',
    onDrop: async (_kind, id) => {
      const moving = tabs.find((t) => t.id === Number(id));
      if (!moving || moving.id === tab.id) return;
      // tabs.move takes the final index, which shifts by one when moving down.
      const index = moving.index < tab.index ? tab.index - 1 : tab.index;
      await chrome.tabs.move(moving.id, { index }).catch((err) => toast(err.message));
    },
  });
  return row;
}

function renderSpaceBar() {
  const buttons = state.spaces.map((space) => {
    const btn = el('button', {
      class: 'space-btn' + (space.id === activeSpaceId ? ' active' : ''),
      title: space.name,
      ariaLabel: `Switch to ${space.name}`,
      style: `--c: ${space.color}`,
      onclick: () => space.id !== activeSpaceId && act('switchSpace', { windowId, spaceId: space.id }),
      oncontextmenu: (e) => spaceMenu(e, space),
    }, el('span'));
    dropTarget(btn, {
      accepts: (kind) => kind === 'tab' || kind === 'link' || kind === 'folder',
      mode: () => 'into',
      onDrop: (kind, id) => {
        if (kind === 'tab') return act('moveTab', { tabId: Number(id), spaceId: space.id });
        return act('moveItem', { itemId: id, spaceId: space.id, folderId: null });
      },
    });
    return btn;
  });
  buttons.push(el('button', {
    class: 'space-btn add',
    title: 'New space',
    ariaLabel: 'New space',
    textContent: '＋',
    onclick: createSpace,
  }));
  $('space-bar').replaceChildren(...buttons);
}

// ---------------------------------------------------------------------------
// Actions

async function createSpace() {
  const spaceId = await send('createSpace', { name: `Space ${state.spaces.length + 1}` }).catch((err) => toast(err.message));
  if (!spaceId) return;
  await act('switchSpace', { windowId, spaceId });
  // Let the new space render, then offer to name it.
  setTimeout(() => {
    const space = spaceById(spaceId);
    if (space) rename($('space-name'), space.name, (name) => act('updateSpace', { spaceId, name }));
  }, 150);
}

function spaceMenu(e, space) {
  openMenu(e, [
    ['Rename', () => {
      const go = () => rename($('space-name'), space.name, (name) => act('updateSpace', { spaceId: space.id, name }));
      if (space.id === activeSpaceId) go();
      else act('switchSpace', { windowId, spaceId: space.id }).then(() => setTimeout(go, 150));
    }],
    '-',
    'Color',
    ...COLORS.map(([hex, name]) => [name + (hex === space.color ? '  ✓' : ''), () => act('updateSpace', { spaceId: space.id, color: hex }), null, hex]),
    '-',
    ['New folder', () => space.id === activeSpaceId ? addFolder() : act('addFolder', { spaceId: space.id })],
    ['Delete space', () => {
      if (state.spaces.length === 1) return toast("Can't delete the last space");
      confirmThen(`Delete “${space.name}”? Its pinned links are removed; its open tabs move to another space.`, () => act('deleteSpace', { spaceId: space.id }));
    }, 'danger'],
  ]);
}

async function addFolder() {
  const itemId = await send('addFolder', { spaceId: activeSpaceId, name: 'New Folder' }).catch((err) => toast(err.message));
  if (!itemId) return;
  await render();
  const row = [...$('pinned-list').querySelectorAll('.folder > .row')].pop();
  const title = row?.querySelector('.title');
  if (title) rename(title, 'New Folder', (name) => act('renameItem', { itemId, name }));
}

async function pinTab(tabId, spaceId, folderId, beforeId) {
  const tab = tabs.find((t) => t.id === tabId) || (await chrome.tabs.get(tabId).catch(() => null));
  const url = tab?.url || tab?.pendingUrl;
  if (!url) return toast('This tab has no address yet');
  const id = await send('addLink', { spaceId, folderId, url, title: tab.title, beforeId }).catch((err) => toast(err.message));
  if (id === null) toast('Already pinned here');
}

async function openAll(folder) {
  for (const link of folder.children) await act('openLink', { itemId: link.id, windowId });
}

// ---------------------------------------------------------------------------
// Drag and drop

function dragSource(node, type, id, kind) {
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(type, String(id));
    e.dataTransfer.setData('text/x-arc-kind', kind);
    e.dataTransfer.effectAllowed = 'move';
    dragKind = kind;
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    dragKind = null;
    node.classList.remove('dragging');
    clearDropMarks();
  });
}

function dropTarget(node, { accepts, mode, onDrop }) {
  const cls = () => (mode(dragKind) === 'into' ? 'drop-into' : 'drop-before');
  node.addEventListener('dragover', (e) => {
    if (!dragKind || !accepts(dragKind)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!node.classList.contains(cls())) {
      clearDropMarks();
      node.classList.add(cls());
    }
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) node.classList.remove('drop-into', 'drop-before');
  });
  node.addEventListener('drop', (e) => {
    const kind = dragKind;
    if (!kind || !accepts(kind)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    const id = e.dataTransfer.getData(kind === 'tab' ? TAB_TYPE : ITEM_TYPE);
    if (id) onDrop(kind, id);
  });
}

function clearDropMarks() {
  for (const n of document.querySelectorAll('.drop-into, .drop-before')) n.classList.remove('drop-into', 'drop-before');
}

// Dropping on the pinned area itself (not on a row) pins at the end.
dropTarget($('pinned'), {
  accepts: (kind) => kind === 'tab' || kind === 'link' || kind === 'folder',
  mode: () => 'into',
  onDrop: (kind, id) => {
    if (kind === 'tab') return pinTab(Number(id), activeSpaceId, null);
    return act('moveItem', { itemId: id, spaceId: activeSpaceId, folderId: null });
  },
});

// Dropping a pinned link on the tab list unpins it (its tab, if open, stays).
dropTarget($('tabs'), {
  accepts: (kind) => kind === 'link',
  mode: () => 'into',
  onDrop: (_kind, id) => act('removeItem', { itemId: id }),
});

// ---------------------------------------------------------------------------
// Inline rename, context menu, confirm dialog

function rename(titleEl, current, commit) {
  if (editing) return;
  editing = true;
  const input = el('input', { class: 'inline-edit', value: current, maxLength: 60, spellcheck: false });
  titleEl.hidden = true;
  titleEl.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    input.remove();
    titleEl.hidden = false;
    editing = false;
    if (save && value && value !== current) await commit(value);
    queueRender();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  // Keep clicks inside the input from toggling folders or opening links.
  for (const type of ['click', 'dblclick', 'mousedown']) input.addEventListener(type, (e) => e.stopPropagation());
  input.addEventListener('blur', () => finish(true));
}

// items: [label, fn, className?, swatchColor?] | '-' (separator) | 'text' (label)
function openMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  const menu = $('menu');
  menu.replaceChildren(
    ...items.map((item) => {
      if (item === '-') return el('hr');
      if (typeof item === 'string') return el('div', { class: 'label', textContent: item });
      const [label, fn, cls, swatch] = item;
      return el('button', {
        class: cls || '',
        role: 'menuitem',
        onclick: () => {
          closeMenu();
          fn();
        },
      }, swatch ? el('span', { class: 'swatch', style: `background:${swatch}` }) : null, label);
    })
  );
  menu.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(e.clientX, w - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(e.clientY, h - r.height - 8))}px`;
  menu.querySelector('button')?.focus();
}

function closeMenu() {
  $('menu').hidden = true;
}

function confirmThen(text, fn) {
  const modal = $('modal');
  $('modal-text').textContent = text;
  modal.hidden = false;
  $('modal-ok').focus();
  const close = () => {
    modal.hidden = true;
    $('modal-ok').onclick = $('modal-cancel').onclick = null;
  };
  $('modal-ok').onclick = () => {
    close();
    fn();
  };
  $('modal-cancel').onclick = close;
}

document.addEventListener('click', (e) => {
  if (!$('menu').contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeMenu();
  if (!$('modal').hidden) $('modal-cancel').click();
});
window.addEventListener('blur', closeMenu);
$('scroll').addEventListener('scroll', closeMenu);

// ---------------------------------------------------------------------------
// Static controls

$('new-tab').addEventListener('click', () => act('newTab', { windowId, spaceId: activeSpaceId }));
$('add-folder').addEventListener('click', addFolder);
$('clear').addEventListener('click', () => act('clearSpace', { windowId, spaceId: activeSpaceId }));
$('space-menu').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  spaceMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, spaceById(activeSpaceId));
});
$('space-name').addEventListener('dblclick', () => {
  const space = spaceById(activeSpaceId);
  rename($('space-name'), space.name, (name) => act('updateSpace', { spaceId: space.id, name }));
});

// ---------------------------------------------------------------------------
// Live updates

for (const ev of ['onCreated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) {
  chrome.tabs[ev].addListener(queueRender);
}
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.title || change.url || change.favIconUrl || change.pinned !== undefined || change.status) queueRender();
});
chrome.storage.onChanged.addListener(queueRender);

(async () => {
  windowId = (await chrome.windows.getCurrent()).id;
  await send('hello').catch(() => {}); // wakes the worker so state exists
  await render();
})();
