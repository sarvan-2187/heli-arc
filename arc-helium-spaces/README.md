# Arc Spaces for Helium

Arc-style **Spaces**, **pinned folders** and a **per-space tab list**, in
the browser's side panel. It's a companion to the Arc Dark theme
(`../arc-helium-theme`) and a separate extension, because a theme can't
contain code.

## Install

1. Open `helium://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `arc-helium-spaces` folder.
3. Pin the extension to the toolbar (puzzle icon → pin), then click it to
   open the panel.
4. Optional: in `helium://settings/appearance`, set the side panel to open
   on the **left** so it sits where Arc's sidebar does.
5. Optional: press **Ctrl+S** to collapse Helium's native vertical tabs.
   It shows every tab from every space, and this panel replaces it.

No keyboard shortcut is registered, so Ctrl+S and Helium's other shortcuts
are untouched. To add one of your own, use `helium://extensions/shortcuts`.

## Using it

| Do this | To |
|---|---|
| Click a dot at the bottom | Switch space. The last tab you used there comes back, or a new tab opens if the space is empty. |
| **＋** at the bottom | Create a space and name it. |
| Right-click a space dot, or **⋯** | Rename, change color, add a folder, delete the space. |
| Double-click the space name | Rename the space. |
| **＋** next to *Pinned* | New folder. |
| Drag a tab onto *Pinned* or onto a folder | Save it as a pinned link. |
| Drag pinned links and folders | Reorder them, or move links between folders. |
| Drag a pinned link onto the tab list | Unpin it. |
| Drag a tab onto a space dot | Move the tab to that space. |
| Drag a tab onto another tab | Reorder tabs. |
| Click a pinned link | Focus its open tab, or open it. |
| Right-click a tab | Pin, move to a space, pin to the browser, duplicate, close. |
| Middle-click a tab or link | Close the tab. |
| **Clear** | Close every tab in the current space. Pinned links stay. |

Tabs you pin *in the browser* (right-click → Pin to browser) appear as icons
at the top of every space, like Arc's Favorites.

## How it works (and what it can't do)

- **Spaces filter tabs; they don't hide them.** Every tab stays open in the
  window. The panel shows only the current space's tabs, and switching
  spaces activates a tab from that space. Helium's native sidebar still
  lists everything, which is why you'll want it collapsed.
- **New tabs join the current space.** Links opened from a tab join that
  tab's space. If you focus a tab from another space by any route (native
  sidebar, Ctrl+Tab, a notification), the window switches to that space.
- **Each window has its own current space.** Spaces and pinned links are
  shared by all windows.
- **Restart recovery is by URL.** Tab ids change when the browser restarts,
  so the extension keeps a snapshot of which URLs belong to which space and
  re-sorts restored tabs against it. If two spaces had the same URL open,
  a restored copy can land in the other space. Tabs it can't match go to
  the last used space.
- **Chrome tab groups aren't shown** in the panel. Grouped tabs are listed
  flat.
- **Not Arc:** there's no per-space profile (logins and cookies are shared),
  no Little Arc, no Boosts, no swipe gestures, and no animated space
  transitions.

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | Show the panel. |
| `tabs` | Read tab titles and URLs to list and pin them. |
| `storage` | Save spaces, folders and pinned links (stored locally only). |
| `favicon` | Show site icons for pinned links. |

Nothing is sent anywhere. There are no content scripts, so web pages are
never touched.

## Data

Everything lives in `chrome.storage.local` on your machine. Removing the
extension deletes your spaces and pinned links. Your tabs aren't affected.

## Tests

It was checked in Chromium 141 with Playwright: tab-to-space assignment,
switching, empty-space tab creation, folders and links, moving tabs between
spaces, Clear, deleting spaces, rejection of `javascript:` links, and
re-sorting tabs after a browser restart with session restore. It hasn't been
tested in Helium yet.
