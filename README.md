# heli-arc

An Arc-inspired dark theme for the [Helium](https://github.com/imputnet/helium) browser.
It restyles the vertical tabs sidebar, toolbar, omnibox and new tab page with a
black base, near-black surfaces, soft gray text and one accent.

It's a theme-only Chromium extension: no scripts, permissions or keyboard
shortcuts. Helium's native Ctrl+S sidebar collapse keeps working, and web
pages aren't touched.

## Install

1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `helium://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `arc-helium-theme` folder.
4. Right-click the window frame → **Browser layout** → **Vertical**.

To remove it, go to `helium://settings/appearance` and click **Reset** next
to *Theme*.

## Repository layout

```
arc-helium-theme/
  manifest.json      theme colors (Manifest V3, theme key only)
  icons/icon128.png  extension icon
  README.md          palette, contrast figures, verification checklist
```

See [`arc-helium-theme/README.md`](arc-helium-theme/README.md) for the full
palette, contrast ratios, the Helium verification checklist and known limits.

## Status

The theme loads without errors in Chromium 141. It hasn't been checked in
Helium yet. Helium draws its own vertical sidebar and may ignore some theme
colors there. Results go in the checklist in the theme's README.

## Packaging

```sh
zip -r arc-helium-theme.zip arc-helium-theme
```
