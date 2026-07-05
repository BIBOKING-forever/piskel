# Piskel Agent Bridge

This fork exposes a small command bridge so Codex can drive Piskel through the
browser without relying on fragile click paths.

Open the app with the panel enabled:

```bash
npm run build
node scripts/serve.js --test
```

Then visit:

```text
http://localhost:9001/?agent=1
```

The page shows a **Piskel Agent** panel with:

- `[data-agent-command]`: JSON command or array of commands.
- `[data-agent-run]`: runs the command.
- `[data-agent-output]`: JSON result.

The same API is also available in page script as `window.piskelAgent` /
`window.pskl.agent`.

## Commands

Each command has this shape:

```json
{ "name": "getState", "args": {} }
```

Supported names:

- `getState`
- `createSprite`
- `setFPS`
- `selectFrame`
- `addFrame`
- `duplicateFrame`
- `removeFrame`
- `setPixel`
- `drawPixels`
- `clearFrame`
- `setFramePixels`
- `importFrameDataUrl`
- `importSpritesheetDataUrl`
- `cutSpritesheet`
- `cutTileset`
- `composeRoom`
- `composeRoomFromTileset`
- `exportFrameDataUrl`
- `exportFramesheetDataUrl`
- `serializePiskel`
- `loadPiskel`

## Example

```json
[
  {
    "name": "createSprite",
    "args": { "width": 8, "height": 8, "fps": 6, "name": "Walk", "frameCount": 3 }
  },
  {
    "name": "drawPixels",
    "args": {
      "frameIndex": 0,
      "pixels": [
        { "x": 1, "y": 3, "color": "#ff3b30" },
        { "x": 1, "y": 4, "color": "#ff3b30" }
      ]
    }
  },
  {
    "name": "exportFramesheetDataUrl",
    "args": { "columns": 3, "scale": 4 }
  }
]
```

## Interior Tilesets

Use these commands for building website rooms from interior/building
spritesheets.

`cutTileset` slices a sheet into indexed tiles:

```json
{
  "name": "cutTileset",
  "args": {
    "dataUrl": "data:image/png;base64,...",
    "tileWidth": 16,
    "tileHeight": 16,
    "columns": 8,
    "rows": 6,
    "spacing": 0,
    "offsetX": 0,
    "offsetY": 0
  }
}
```

`composeRoom` draws a room from tile indices. `map` is a 2D grid where each
number points at a tile index from the sheet. Use `-1` or `null` for empty
cells. Set `importAsFrame` to load the finished room into Piskel as one editable
frame.

```json
{
  "name": "composeRoom",
  "args": {
    "tilesetDataUrl": "data:image/png;base64,...",
    "tileWidth": 16,
    "tileHeight": 16,
    "columns": 8,
    "name": "Therapy Office Room",
    "importAsFrame": true,
    "scale": 2,
    "layers": [
      {
        "name": "floor",
        "map": [
          [1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1]
        ]
      },
      {
        "name": "walls-furniture",
        "map": [
          [2, 2, 2, 2, 2, 2],
          [3, -1, -1, 8, -1, 4],
          [3, 12, -1, -1, 13, 4],
          [5, 5, 5, 5, 5, 5]
        ]
      }
    ]
  }
}
```

Cells can also be objects for per-tile offsets/flips:

```json
{ "index": 12, "dx": 0, "dy": -4, "flipX": true, "opacity": 0.9 }
```
