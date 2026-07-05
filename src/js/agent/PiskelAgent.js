(function () {
  var ns = $.namespace("pskl.agent");

  var READY_EVENT = "piskel-agent-ready";
  var CHANGE_EVENT = "piskel-agent-change";
  var DEFAULT_COMMAND = {
    name: "getState"
  };

  function getController() {
    if (!pskl.app || !pskl.app.piskelController) {
      throw new Error("Piskel is not ready yet.");
    }
    return pskl.app.piskelController;
  }

  function getLayer(layerIndex) {
    var controller = getController();
    var index =
      typeof layerIndex === "number"
        ? layerIndex
        : controller.getCurrentLayerIndex();
    var layer = controller.getLayerAt(index);
    if (!layer) {
      throw new Error("No layer found at index " + index + ".");
    }
    return layer;
  }

  function getFrame(options) {
    options = options || {};
    var controller = getController();
    var frameIndex =
      typeof options.frameIndex === "number"
        ? options.frameIndex
        : controller.getCurrentFrameIndex();
    var frame = getLayer(options.layerIndex).getFrameAt(frameIndex);
    if (!frame) {
      throw new Error("No frame found at index " + frameIndex + ".");
    }
    return frame;
  }

  function emitChange(detail) {
    if (typeof window.CustomEvent === "function") {
      window.dispatchEvent(
        new window.CustomEvent(CHANGE_EVENT, { detail: detail })
      );
    }
  }

  function notifyChanged(detail, saveState) {
    if (saveState !== false) {
      $.publish(Events.PISKEL_SAVE_STATE, {
        type: pskl.service.HistoryService.SNAPSHOT
      });
    }
    $.publish(Events.PISKEL_RESET);
    emitChange(detail || getState());
  }

  function createLayerFromFrames(name, frames) {
    var layer = new pskl.model.Layer(name || "Layer 1");
    frames.forEach(function (frame) {
      layer.addFrame(frame);
    });
    return layer;
  }

  function createEmptyFrames(width, height, count) {
    var frames = [];
    count = count || 1;
    for (var i = 0; i < count; i++) {
      frames.push(new pskl.model.Frame(width, height));
    }
    return frames;
  }

  function createImageFromDataUrl(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.addEventListener("load", function onLoad() {
        image.removeEventListener("load", onLoad);
        resolve(image);
      });
      image.addEventListener("error", function onError() {
        image.removeEventListener("error", onError);
        reject(new Error("Unable to load image data URL."));
      });
      image.src = dataUrl;
    });
  }

  function createFrameFromPixels(width, height, pixels) {
    if (!pixels || pixels.length !== width * height) {
      throw new Error("pixels must contain width * height entries.");
    }

    var buffer = new Uint32Array(width * height);
    for (var i = 0; i < pixels.length; i++) {
      buffer[i] = pskl.utils.colorToInt(pixels[i]);
    }
    return pskl.model.Frame.fromPixelGrid(buffer, width, height);
  }

  function buildPiskel(options, frames) {
    options = options || {};
    var width = options.width;
    var height = options.height;
    if (!width || !height) {
      throw new Error("width and height are required.");
    }

    var fps = options.fps || Constants.DEFAULT.FPS;
    var descriptor = new pskl.model.piskel.Descriptor(
      options.name || "Agent Piskel",
      options.description || ""
    );
    var piskel = new pskl.model.Piskel(width, height, fps, descriptor);
    var layer = createLayerFromFrames(
      options.layerName || "Layer 1",
      frames || createEmptyFrames(width, height, options.frameCount || 1)
    );
    piskel.addLayer(layer);
    return piskel;
  }

  function bestFitColumns(frameCount, width, height) {
    var ratio = width / height;
    var bestFit = Math.round(Math.sqrt(frameCount / ratio));
    return pskl.utils.Math.minmax(bestFit, 1, frameCount);
  }

  function getTileGeometry(image, options) {
    var tileWidth = options.tileWidth || options.frameWidth;
    var tileHeight = options.tileHeight || options.frameHeight;
    if (!tileWidth || !tileHeight) {
      throw new Error("tileWidth and tileHeight are required.");
    }

    var offsetX = options.offsetX || 0;
    var offsetY = options.offsetY || 0;
    var spacingX = options.spacingX || options.spacing || 0;
    var spacingY = options.spacingY || options.spacing || 0;
    var columns =
      options.columns ||
      Math.floor((image.width - offsetX + spacingX) / (tileWidth + spacingX));
    var rows =
      options.rows ||
      Math.floor((image.height - offsetY + spacingY) / (tileHeight + spacingY));

    if (!columns || !rows) {
      throw new Error("Unable to calculate tileset rows/columns.");
    }

    return {
      tileWidth: tileWidth,
      tileHeight: tileHeight,
      offsetX: offsetX,
      offsetY: offsetY,
      spacingX: spacingX,
      spacingY: spacingY,
      columns: columns,
      rows: rows,
      tileCount: columns * rows
    };
  }

  function getTileSourceRect(index, geometry) {
    if (index < 0 || index >= geometry.tileCount) {
      throw new Error("Tile index " + index + " is outside the tileset.");
    }

    var column = index % geometry.columns;
    var row = Math.floor(index / geometry.columns);
    return {
      x: geometry.offsetX + column * (geometry.tileWidth + geometry.spacingX),
      y: geometry.offsetY + row * (geometry.tileHeight + geometry.spacingY),
      width: geometry.tileWidth,
      height: geometry.tileHeight,
      column: column,
      row: row
    };
  }

  function normalizeTileCell(cell) {
    if (cell === null || typeof cell === "undefined" || cell === -1) {
      return null;
    }

    if (typeof cell === "number") {
      return { index: cell };
    }

    if (Array.isArray(cell)) {
      return cell.map(normalizeTileCell).filter(Boolean);
    }

    return {
      index:
        typeof cell.index === "number"
          ? cell.index
          : typeof cell.tile === "number"
            ? cell.tile
            : cell.id,
      offsetX: cell.offsetX || cell.dx || 0,
      offsetY: cell.offsetY || cell.dy || 0,
      flipX: !!cell.flipX,
      flipY: !!cell.flipY,
      opacity:
        typeof cell.opacity === "number"
          ? pskl.utils.Math.minmax(cell.opacity, 0, 1)
          : 1
    };
  }

  function drawTile(image, context, geometry, tile, x, y, scale) {
    if (Array.isArray(tile)) {
      tile.forEach(function (entry) {
        drawTile(image, context, geometry, entry, x, y, scale);
      });
      return;
    }

    if (!tile || typeof tile.index !== "number") {
      return;
    }

    var source = getTileSourceRect(tile.index, geometry);
    var dx = x * geometry.tileWidth * scale + tile.offsetX * scale;
    var dy = y * geometry.tileHeight * scale + tile.offsetY * scale;
    var dw = geometry.tileWidth * scale;
    var dh = geometry.tileHeight * scale;

    context.save();
    context.globalAlpha = context.globalAlpha * tile.opacity;
    if (tile.flipX || tile.flipY) {
      context.translate(dx + (tile.flipX ? dw : 0), dy + (tile.flipY ? dh : 0));
      context.scale(tile.flipX ? -1 : 1, tile.flipY ? -1 : 1);
      dx = 0;
      dy = 0;
    }
    context.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      dx,
      dy,
      dw,
      dh
    );
    context.restore();
  }

  function getMapSize(map) {
    if (!map || !map.length) {
      throw new Error("A non-empty map is required.");
    }
    return {
      columns: map.reduce(function (max, row) {
        return Math.max(max, row ? row.length : 0);
      }, 0),
      rows: map.length
    };
  }

  function normalizeRoomLayers(options) {
    if (options.layers && options.layers.length) {
      return options.layers.map(function (layer, index) {
        return {
          name: layer.name || "Layer " + (index + 1),
          opacity:
            typeof layer.opacity === "number"
              ? pskl.utils.Math.minmax(layer.opacity, 0, 1)
              : 1,
          map: layer.map || []
        };
      });
    }

    return [
      {
        name: "Room",
        opacity: 1,
        map: options.map || []
      }
    ];
  }

  function importCanvasAsFrame(canvas, options) {
    var frame = pskl.utils.FrameUtils.createFromCanvas(
      canvas,
      0,
      0,
      canvas.width,
      canvas.height,
      true
    );
    var piskel = buildPiskel(
      {
        width: canvas.width,
        height: canvas.height,
        fps: options.fps,
        name: options.name || "Interior Room",
        description: options.description,
        layerName: options.layerName || "Room"
      },
      [frame]
    );
    getController().setPiskel(piskel);
  }

  function getState() {
    var controller = getController();
    var piskel = controller.getPiskel();
    return {
      ready: true,
      name: piskel.getDescriptor().name,
      description: piskel.getDescriptor().description,
      width: controller.getWidth(),
      height: controller.getHeight(),
      fps: controller.getFPS(),
      frameCount: controller.getFrameCount(),
      currentFrameIndex: controller.getCurrentFrameIndex(),
      currentLayerIndex: controller.getCurrentLayerIndex(),
      visibleFrameIndexes: controller.getVisibleFrameIndexes(),
      layers: controller.getLayers().map(function (layer, index) {
        return {
          index: index,
          name: layer.getName(),
          opacity: layer.getOpacity(),
          frameCount: layer.size()
        };
      })
    };
  }

  function createSprite(options) {
    var piskel = buildPiskel(options);
    getController().setPiskel(piskel);
    return getState();
  }

  function loadPiskel(serialized) {
    return new Promise(function (resolve, reject) {
      var data =
        typeof serialized === "string" ? JSON.parse(serialized) : serialized;
      pskl.utils.serialization.Deserializer.deserialize(
        data,
        function (piskel) {
          getController().setPiskel(piskel);
          resolve(getState());
        },
        reject
      );
    });
  }

  function serializePiskel() {
    return getController().serialize();
  }

  function setFPS(fps) {
    getController().setFPS(fps);
    emitChange(getState());
    return getState();
  }

  function selectFrame(index) {
    getController().setCurrentFrameIndex(index);
    return getState();
  }

  function addFrame(index) {
    var controller = getController();
    if (typeof index === "number") {
      controller.addFrameAt(index);
    } else {
      controller.addFrame();
    }
    return getState();
  }

  function duplicateFrame(index) {
    var controller = getController();
    if (typeof index === "number") {
      controller.duplicateFrameAt(index);
    } else {
      controller.duplicateCurrentFrame();
    }
    return getState();
  }

  function removeFrame(index) {
    getController().removeFrameAt(index);
    return getState();
  }

  function setPixel(x, y, color, options) {
    var frame = getFrame(options);
    frame.setPixel(x, y, color);
    notifyChanged({ action: "setPixel", x: x, y: y });
    return getState();
  }

  function drawPixels(pixels, options) {
    var frame = getFrame(options);
    pixels.forEach(function (pixel) {
      frame.setPixel(pixel.x, pixel.y, pixel.color);
    });
    notifyChanged({ action: "drawPixels", count: pixels.length });
    return getState();
  }

  function clearFrame(options) {
    getFrame(options).clear();
    notifyChanged({ action: "clearFrame" });
    return getState();
  }

  function setFramePixels(options) {
    options = options || {};
    var targetFrame = getFrame(options);
    var sourceFrame = createFrameFromPixels(
      targetFrame.getWidth(),
      targetFrame.getHeight(),
      options.pixels
    );
    targetFrame.setPixels(sourceFrame.getPixels());
    notifyChanged({ action: "setFramePixels" });
    return getState();
  }

  function importFrameDataUrl(dataUrl, options) {
    options = options || {};
    return createImageFromDataUrl(dataUrl).then(function (image) {
      var frame = pskl.utils.FrameUtils.createFromImage(
        image,
        options.preserveOpacity !== false
      );
      var piskel = buildPiskel(
        {
          width: frame.getWidth(),
          height: frame.getHeight(),
          fps: options.fps,
          name: options.name || "Imported Frame",
          description: options.description,
          layerName: options.layerName
        },
        [frame]
      );
      getController().setPiskel(piskel);
      return getState();
    });
  }

  function importSpritesheetDataUrl(dataUrl, options) {
    options = options || {};
    return createImageFromDataUrl(dataUrl).then(function (image) {
      var frameWidth = options.frameWidth || image.width;
      var frameHeight = options.frameHeight || image.height;
      var offsetX = options.offsetX || 0;
      var offsetY = options.offsetY || 0;
      var horizontal = options.horizontal !== false;
      var ignoreEmptyFrames = !!options.ignoreEmptyFrames;
      var canvases = pskl.utils.CanvasUtils.createFramesFromImage(
        image,
        offsetX,
        offsetY,
        frameWidth,
        frameHeight,
        horizontal,
        ignoreEmptyFrames
      );
      var frames = canvases.map(function (canvas) {
        return pskl.utils.FrameUtils.createFromCanvas(
          canvas,
          0,
          0,
          frameWidth,
          frameHeight,
          options.preserveOpacity !== false
        );
      });

      if (!frames.length) {
        throw new Error("Spritesheet import produced no frames.");
      }

      var piskel = buildPiskel(
        {
          width: frameWidth,
          height: frameHeight,
          fps: options.fps,
          name: options.name || "Imported Spritesheet",
          description: options.description,
          layerName: options.layerName
        },
        frames
      );
      getController().setPiskel(piskel);
      return getState();
    });
  }

  function exportFrameDataUrl(options) {
    options = options || {};
    var controller = getController();
    var frameIndex =
      typeof options.frameIndex === "number"
        ? options.frameIndex
        : controller.getCurrentFrameIndex();
    var frame = controller.renderFrameAt(frameIndex, true);
    var canvas = pskl.utils.CanvasUtils.createCanvas(
      controller.getWidth(),
      controller.getHeight()
    );
    canvas.getContext("2d").drawImage(frame, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function exportFramesheetDataUrl(options) {
    options = options || {};
    var controller = getController();
    var columns =
      options.columns ||
      bestFitColumns(
        controller.getFrameCount(),
        controller.getWidth(),
        controller.getHeight()
      );
    var renderer = new pskl.rendering.PiskelRenderer(controller);
    var canvas = renderer.renderAsCanvas(columns);
    var scale = options.scale || 1;
    if (scale !== 1) {
      canvas = pskl.utils.ImageResizer.resize(
        canvas,
        canvas.width * scale,
        canvas.height * scale,
        false
      );
    }
    return canvas.toDataURL("image/png");
  }

  function cutSpritesheet(dataUrl, options) {
    options = options || {};
    return createImageFromDataUrl(dataUrl).then(function (image) {
      var frameWidth = options.frameWidth || image.width;
      var frameHeight = options.frameHeight || image.height;
      var canvases = pskl.utils.CanvasUtils.createFramesFromImage(
        image,
        options.offsetX || 0,
        options.offsetY || 0,
        frameWidth,
        frameHeight,
        options.horizontal !== false,
        !!options.ignoreEmptyFrames
      );
      return canvases.map(function (canvas, index) {
        return {
          index: index,
          dataUrl: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height
        };
      });
    });
  }

  function cutTileset(dataUrl, options) {
    options = options || {};
    return createImageFromDataUrl(dataUrl).then(function (image) {
      var geometry = getTileGeometry(image, options);
      var tiles = [];

      for (var index = 0; index < geometry.tileCount; index++) {
        var source = getTileSourceRect(index, geometry);
        var canvas = pskl.utils.CanvasUtils.createCanvas(
          geometry.tileWidth,
          geometry.tileHeight
        );
        canvas
          .getContext("2d")
          .drawImage(
            image,
            source.x,
            source.y,
            source.width,
            source.height,
            0,
            0,
            geometry.tileWidth,
            geometry.tileHeight
          );

        tiles.push({
          index: index,
          column: source.column,
          row: source.row,
          x: source.x,
          y: source.y,
          width: geometry.tileWidth,
          height: geometry.tileHeight,
          dataUrl: canvas.toDataURL("image/png")
        });
      }

      return {
        tileWidth: geometry.tileWidth,
        tileHeight: geometry.tileHeight,
        columns: geometry.columns,
        rows: geometry.rows,
        tileCount: geometry.tileCount,
        tiles: tiles
      };
    });
  }

  function composeRoom(dataUrl, options) {
    options = options || {};
    return createImageFromDataUrl(dataUrl).then(function (image) {
      var geometry = getTileGeometry(image, options);
      var layers = normalizeRoomLayers(options);
      var size = layers.reduce(
        function (currentSize, layer) {
          var layerSize = getMapSize(layer.map);
          return {
            columns: Math.max(currentSize.columns, layerSize.columns),
            rows: Math.max(currentSize.rows, layerSize.rows)
          };
        },
        { columns: 0, rows: 0 }
      );

      var roomColumns =
        options.roomColumns || options.columnsInRoom || size.columns;
      var roomRows = options.roomRows || options.rowsInRoom || size.rows;
      var scale = options.scale || 1;
      var canvas = pskl.utils.CanvasUtils.createCanvas(
        roomColumns * geometry.tileWidth * scale,
        roomRows * geometry.tileHeight * scale
      );
      pskl.utils.CanvasUtils.disableImageSmoothing(canvas);
      var context = canvas.getContext("2d");

      if (options.backgroundColor) {
        context.fillStyle = options.backgroundColor;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      layers.forEach(function (layer) {
        context.save();
        context.globalAlpha = layer.opacity;
        layer.map.forEach(function (row, y) {
          if (!row) {
            return;
          }
          row.forEach(function (cell, x) {
            drawTile(
              image,
              context,
              geometry,
              normalizeTileCell(cell),
              x,
              y,
              scale
            );
          });
        });
        context.restore();
      });

      if (options.importAsFrame) {
        importCanvasAsFrame(canvas, options);
      }

      return {
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        roomColumns: roomColumns,
        roomRows: roomRows,
        tileWidth: geometry.tileWidth,
        tileHeight: geometry.tileHeight,
        scale: scale,
        layers: layers.map(function (layer) {
          return layer.name;
        }),
        imported: !!options.importAsFrame
      };
    });
  }

  var commands = {
    addFrame: function (args) {
      return addFrame(args && args.index);
    },
    clearFrame: clearFrame,
    createSprite: createSprite,
    cutSpritesheet: function (args) {
      return cutSpritesheet(args.dataUrl, args);
    },
    cutTileset: function (args) {
      return cutTileset(args.dataUrl, args);
    },
    drawPixels: function (args) {
      return drawPixels(args.pixels || [], args);
    },
    duplicateFrame: function (args) {
      return duplicateFrame(args && args.index);
    },
    exportFrameDataUrl: exportFrameDataUrl,
    exportFramesheetDataUrl: exportFramesheetDataUrl,
    getState: getState,
    composeRoom: function (args) {
      return composeRoom(args.dataUrl || args.tilesetDataUrl, args);
    },
    composeRoomFromTileset: function (args) {
      return composeRoom(args.dataUrl || args.tilesetDataUrl, args);
    },
    importFrameDataUrl: function (args) {
      return importFrameDataUrl(args.dataUrl, args);
    },
    importSpritesheetDataUrl: function (args) {
      return importSpritesheetDataUrl(args.dataUrl, args);
    },
    loadPiskel: function (args) {
      return loadPiskel(args.serialized || args.piskel);
    },
    removeFrame: function (args) {
      return removeFrame(args.index);
    },
    selectFrame: function (args) {
      return selectFrame(args.index);
    },
    serializePiskel: serializePiskel,
    setFPS: function (args) {
      return setFPS(args.fps);
    },
    setFramePixels: setFramePixels,
    setPixel: function (args) {
      return setPixel(args.x, args.y, args.color, args);
    }
  };

  function execute(command) {
    if (!command || !command.name) {
      throw new Error("Command requires a name.");
    }
    if (!commands[command.name]) {
      throw new Error("Unknown command: " + command.name);
    }
    return commands[command.name](command.args || {});
  }

  function executeBatch(batch) {
    var chain = Promise.resolve([]);
    batch.forEach(function (command) {
      chain = chain.then(function (results) {
        return Promise.resolve(execute(command)).then(function (result) {
          results.push(result);
          return results;
        });
      });
    });
    return chain;
  }

  function shouldShowPanel() {
    return window.location.search.indexOf("agent=1") !== -1;
  }

  function createPanel() {
    if (!shouldShowPanel() || document.querySelector("[data-agent-panel]")) {
      return;
    }

    var panel = document.createElement("div");
    panel.setAttribute("data-agent-panel", "true");
    panel.style.cssText = [
      "position:fixed",
      "left:12px",
      "bottom:12px",
      "z-index:999999",
      "width:420px",
      "max-width:calc(100vw - 24px)",
      "background:#1f1f1f",
      "border:1px solid #555",
      "box-shadow:0 8px 24px rgba(0,0,0,.45)",
      "color:#ddd",
      "font:12px monospace",
      "padding:8px"
    ].join(";");

    var label = document.createElement("div");
    label.textContent = "Piskel Agent";
    label.style.cssText = "margin-bottom:6px;color:gold;font-weight:bold";

    var input = document.createElement("textarea");
    input.setAttribute("data-agent-command", "true");
    input.value = JSON.stringify(DEFAULT_COMMAND, null, 2);
    input.style.cssText = [
      "width:100%",
      "height:120px",
      "box-sizing:border-box",
      "background:#111",
      "color:#eee",
      "border:1px solid #555",
      "font:12px monospace",
      "padding:6px",
      "resize:vertical"
    ].join(";");

    var runButton = document.createElement("button");
    runButton.setAttribute("data-agent-run", "true");
    runButton.textContent = "Run";
    runButton.style.cssText = [
      "margin-top:6px",
      "margin-right:6px",
      "background:gold",
      "border:0",
      "color:#222",
      "padding:5px 10px",
      "font-weight:bold",
      "cursor:pointer"
    ].join(";");

    var closeButton = document.createElement("button");
    closeButton.setAttribute("data-agent-close", "true");
    closeButton.textContent = "Hide";
    closeButton.style.cssText = [
      "margin-top:6px",
      "background:#333",
      "border:1px solid #666",
      "color:#ddd",
      "padding:4px 8px",
      "cursor:pointer"
    ].join(";");

    var output = document.createElement("pre");
    output.setAttribute("data-agent-output", "true");
    output.textContent = "";
    output.style.cssText = [
      "max-height:180px",
      "overflow:auto",
      "white-space:pre-wrap",
      "background:#111",
      "border:1px solid #333",
      "padding:6px",
      "margin:8px 0 0"
    ].join(";");

    runButton.addEventListener("click", function () {
      runButton.disabled = true;
      output.textContent = "Running...";
      try {
        var command = JSON.parse(input.value);
        var result = Array.isArray(command)
          ? executeBatch(command)
          : execute(command);
        Promise.resolve(result)
          .then(function (value) {
            output.textContent = JSON.stringify(value, null, 2);
          })
          .catch(function (error) {
            output.textContent = JSON.stringify(
              { error: error.message || String(error) },
              null,
              2
            );
          })
          .then(function () {
            runButton.disabled = false;
          });
      } catch (error) {
        output.textContent = JSON.stringify(
          { error: error.message || String(error) },
          null,
          2
        );
        runButton.disabled = false;
      }
    });

    closeButton.addEventListener("click", function () {
      panel.style.display = "none";
    });

    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(runButton);
    panel.appendChild(closeButton);
    panel.appendChild(output);
    document.body.appendChild(panel);
  }

  function init() {
    ns.ready = true;
    ns.state = getState;
    ns.execute = execute;
    ns.executeBatch = executeBatch;
    ns.getState = getState;
    ns.createSprite = createSprite;
    ns.loadPiskel = loadPiskel;
    ns.serializePiskel = serializePiskel;
    ns.setFPS = setFPS;
    ns.selectFrame = selectFrame;
    ns.addFrame = addFrame;
    ns.duplicateFrame = duplicateFrame;
    ns.removeFrame = removeFrame;
    ns.setPixel = setPixel;
    ns.drawPixels = drawPixels;
    ns.clearFrame = clearFrame;
    ns.setFramePixels = setFramePixels;
    ns.importFrameDataUrl = importFrameDataUrl;
    ns.importSpritesheetDataUrl = importSpritesheetDataUrl;
    ns.cutSpritesheet = cutSpritesheet;
    ns.cutTileset = cutTileset;
    ns.composeRoom = composeRoom;
    ns.composeRoomFromTileset = composeRoom;
    ns.exportFrameDataUrl = exportFrameDataUrl;
    ns.exportFramesheetDataUrl = exportFramesheetDataUrl;

    window.piskelAgent = ns;
    createPanel();
    if (typeof window.CustomEvent === "function") {
      window.dispatchEvent(
        new window.CustomEvent(READY_EVENT, { detail: getState() })
      );
    }
  }

  ns.ready = false;
  ns.init = init;
  window.piskelReadyCallbacks = window.piskelReadyCallbacks || [];
  window.piskelReadyCallbacks.push(init);
})();
