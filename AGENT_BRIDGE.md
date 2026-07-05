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
