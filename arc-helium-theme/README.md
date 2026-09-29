# Arc Dark for Helium

A theme-only Chromium extension that gives Helium's browser chrome (vertical
tabs sidebar, toolbar, omnibox, new tab page) an Arc-inspired black palette.

It is a pure theme: `manifest.json` contains metadata, an icon, and a `theme`
key. No scripts, permissions, commands, or popups. It does not register any
keyboard shortcut, so Helium's native Ctrl+S sidebar collapse is untouched,
and it never touches web page content.

## Install (Load unpacked)

1. Open `helium://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `arc-helium-theme` folder
   (if you downloaded the zip, unzip it first).
4. The theme applies immediately. Chromium lists themes separately from
   regular extensions; there should be no "Errors" button on the card.

## Remove

Themes can't be disabled like normal extensions. Go to
`helium://settings/appearance` and click **Reset** next to *Theme*.
You can then remove the card from `helium://extensions`.

## Palette

| Key                   | RGB             | Purpose                       |
|-----------------------|-----------------|-------------------------------|
| `frame`               | 0, 0, 0         | Window frame / tab strip      |
| `frame_inactive`      | 10, 10, 10      | Frame when window unfocused   |
| `toolbar`             | 18, 18, 18      | Toolbar and active tab        |
| `tab_text`            | 240, 240, 240   | Active tab label              |
| `tab_background_text` | 150, 150, 150   | Inactive tab labels           |
| `toolbar_text`        | 230, 230, 230   | Toolbar text                  |
| `toolbar_button_icon` | 200, 200, 200   | Toolbar icons                 |
| `omnibox_background`  | 28, 28, 28      | Address bar fill              |
| `omnibox_text`        | 235, 235, 235   | Address bar text              |
| `bookmark_text`       | 200, 200, 200   | Bookmark bar labels           |
| `ntp_background`      | 0, 0, 0         | New tab page background       |
| `ntp_text`            | 230, 230, 230   | New tab page text             |

### Contrast (WCAG 2.x)

Target: inactive tab text vs sidebar background ≥ 4.5:1.

| Pair                                              | Ratio   |
|---------------------------------------------------|---------|
| `tab_background_text` on `frame` (0)              | 7.10:1  |
| `tab_background_text` on `frame_inactive` (10)    | 6.69:1  |
| `tab_background_text` on `toolbar` (18)           | 6.33:1  |
| `tab_text` on `toolbar`                           | 16.44:1 |
| `toolbar_text` on `toolbar`                       | 15.01:1 |
| `toolbar_button_icon` on `toolbar`                | 11.20:1 |
| `omnibox_text` on `omnibox_background`            | 14.30:1 |

Inactive tab text clears 4.5:1 whichever of `frame`, `frame_inactive` or
`toolbar` Helium uses for the sidebar, so no tuning was needed for the
target.

## Verification checklist (Helium, Vertical layout)

Right-click the window frame → **Browser layout** → **Vertical**, then fill
in which theme key actually drives each surface. "Expected" is Chromium's
standard theme mapping. Helium draws its own sidebar and can ignore theme
keys, so treat the Expected column as a hypothesis until someone checks it.

| Surface                    | Expected key          | Observed in Helium |
|----------------------------|-----------------------|--------------------|
| Sidebar background         | `frame`               |                    |
| Active tab row             | `toolbar`             |                    |
| Inactive tab rows          | `frame` (transparent) |                    |
| Active tab text            | `tab_text`            |                    |
| Inactive tab text          | `tab_background_text` |                    |
| Collapse button icon       | `toolbar_button_icon` |                    |
| New tab button             | `tab_background_text` / `toolbar_button_icon` | |
| Omnibox                    | `omnibox_background` / `omnibox_text` |    |
| Collapsed sidebar (Ctrl+S) | `frame`               |                    |
| Unfocused window           | `frame_inactive`      |                    |

Also check:

- [ ] Ctrl+S collapses the sidebar, and pressing it again expands it.
- [ ] `helium://extensions` shows no errors for the theme.

If a surface doesn't follow any key, write "Helium palette, not themable"
in the table. Don't work around it with scripts, because that would stop
this being a theme extension.

## Known limits (Chromium theme system)

- Colors are static. There's no runtime theme API, so per-window colors,
  animation, and automatic light/dark switching aren't possible.
- Theme keys only cover browser chrome. Menus, dialogs and some Helium UI
  may follow Helium's own dark palette instead.
- A theme overrides Helium's light/dark mode choice for the surfaces it
  covers.

## Packaging

From the repository root:

```sh
zip -r arc-helium-theme.zip arc-helium-theme
```

Share the zip. Recipients unzip it and use **Load unpacked** as above.
