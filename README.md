# heli-arc

Arc-style look and features for the [Helium](https://github.com/imputnet/helium) browser,
as two separate extensions:

| Folder | What it is |
|---|---|
| [`arc-helium-theme`](arc-helium-theme/README.md) | Theme only: black, Arc-inspired colors for the vertical tabs sidebar, toolbar, omnibox and new tab page. No code or permissions. |
| [`heli-arc`](heli-arc/README.md) | **Heli-Arc**: side panel with Arc-style **Spaces**, **pinned folders** and a per-space tab list. |

They're separate because a Chromium theme can't contain code. Install either
or both. Neither registers a keyboard shortcut, so Helium's Ctrl+S sidebar
collapse keeps working, and neither touches web pages.

## Install the theme

1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `helium://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `arc-helium-theme` folder.
4. Right-click the window frame → **Browser layout** → **Vertical**.

To remove it, go to `helium://settings/appearance` and click **Reset** next
to *Theme*.

## Install Heli-Arc

1. In `helium://extensions` (Developer mode on), click **Load unpacked** and
   select the `heli-arc` folder.
2. Pin its toolbar icon and click it to open the panel.
3. Press Ctrl+S to collapse the native tab sidebar, which lists every tab
   from every space.

See [`heli-arc/README.md`](heli-arc/README.md) for how to use
it and what it can't do.

## Repository layout

```
arc-helium-theme/
  manifest.json      theme colors (Manifest V3, theme key only)
  icons/icon128.png  extension icon
  README.md          palette, contrast figures, verification checklist
heli-arc/
  manifest.json      side panel extension (sidePanel, tabs, storage, favicon)
  background.js      service worker: tab-to-space mapping, spaces, folders
  panel.html/css/js  the side panel UI
  README.md          usage, limits, permissions
```

## Status

Both extensions load without errors in Chromium 141, and Heli-Arc's logic is
tested there with Playwright. Neither has been checked in Helium yet. Helium
draws its own vertical sidebar and may ignore some theme colors there. Theme
results go in the checklist in the theme's README.

## Packaging

```sh
zip -r arc-helium-theme.zip arc-helium-theme
zip -r heli-arc.zip heli-arc
```
