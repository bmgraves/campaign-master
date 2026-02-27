/* ============================================================
   Campaign Master — Map Manager
   Data model, PIXI layers, paint engine, region border algorithm
   ============================================================ */

export const MODULE_ID = "campaign-master";

// ── Shared state ──────────────────────────────────────────────────────────────

export const MM = {
  terrainGfx:  null,   // PIXI.Graphics — terrain hex fills
  regionGfx:   null,   // PIXI.Graphics — region border outlines
  cursorGfx:   null,   // PIXI.Graphics — brush preview

  terrainVisible: true,
  regionVisible:  true,

  painting:    false,
  isDragging:  false,
  brushSize:   1,

  activeTerrainId: null,  // null = don't paint terrain
  activeRegionId:  null,  // null = don't paint region

  erasing:      false,
  eraseTerrain: true,
  eraseRegion:  true,

  _isPainting:     false,
  _pendingTerrain: null,
  _pendingRegion:  null,
  _paintHandlers:  null,
};

// ── Flag helpers ──────────────────────────────────────────────────────────────

export function getSceneFlag(key, fallback = null) {
  return canvas.scene?.getFlag(MODULE_ID, key) ?? fallback;
}

export async function setSceneFlag(key, value) {
  if (!canvas.scene) return;
  const existing = canvas.scene.getFlag(MODULE_ID, key);
  // Foundry's setFlag uses mergeObject(recursive:true), so deleted keys would
  // silently persist. For plain objects, build a diff with explicit -=deletions.
  if (existing !== null && existing !== undefined
      && typeof existing === "object" && !Array.isArray(existing)
      && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const update = {};
    for (const [k, v] of Object.entries(value)) {
      update[`flags.${MODULE_ID}.${key}.${k}`] = v;
    }
    for (const k of Object.keys(existing)) {
      if (!(k in value)) update[`flags.${MODULE_ID}.${key}.-=${k}`] = null;
    }
    if (!Object.keys(update).length) return;
    return canvas.scene.update(update);
  }
  return canvas.scene.setFlag(MODULE_ID, key, value);
}

export function getTerrainTypes()  { return getSceneFlag("terrainTypes", {}); }
export function getRegions()       { return getSceneFlag("regions",      {}); }
export function getTerrainCells()  { return getSceneFlag("terrainCells", {}); }
export function getRegionCells()   { return getSceneFlag("regionCells",  {}); }
export function cellKey(i, j)      { return `${i},${j}`; }

// ── Migration: paintedCells → terrainCells ───────────────────────────────────

export async function migrateIfNeeded() {
  if (!canvas.scene) return;
  const old = canvas.scene.getFlag(MODULE_ID, "paintedCells");
  if (!old) return;
  const hasTerrain = canvas.scene.getFlag(MODULE_ID, "terrainCells");
  if (!hasTerrain) {
    await canvas.scene.setFlag(MODULE_ID, "terrainCells", old);
  }
  await canvas.scene.update({ [`flags.${MODULE_ID}.-=paintedCells`]: null });
  console.log("Campaign Master | Migrated paintedCells → terrainCells");
}

// ── BFS brush footprint ───────────────────────────────────────────────────────

export function getBrushOffsets(centerI, centerJ) {
  if (MM.brushSize <= 1) return [{ i: centerI, j: centerJ }];
  const visited = new Set();
  const result  = [];
  let frontier  = [{ i: centerI, j: centerJ }];
  visited.add(cellKey(centerI, centerJ));
  result.push({ i: centerI, j: centerJ });

  for (let ring = 1; ring < MM.brushSize; ring++) {
    const next = [];
    for (const cell of frontier) {
      for (const n of canvas.grid.getAdjacentOffsets(cell)) {
        const k = cellKey(n.i, n.j);
        if (!visited.has(k)) {
          visited.add(k);
          result.push({ i: n.i, j: n.j });
          next.push({ i: n.i, j: n.j });
        }
      }
    }
    frontier = next;
  }
  return result;
}

// ── PIXI layer init / teardown ────────────────────────────────────────────────

export function initMapGfx() {
  const layer = canvas.interface ?? canvas.stage;

  if (!MM.terrainGfx) {
    MM.terrainGfx = new PIXI.Graphics();
    layer.addChildAt(MM.terrainGfx, 0);
  }
  if (!MM.regionGfx) {
    MM.regionGfx = new PIXI.Graphics();
    layer.addChild(MM.regionGfx);
  }
  if (!MM.cursorGfx) {
    MM.cursorGfx = new PIXI.Graphics();
    layer.addChild(MM.cursorGfx);
  }
}

export function destroyMapGfx() {
  if (MM.terrainGfx)  { MM.terrainGfx.destroy();  MM.terrainGfx  = null; }
  if (MM.regionGfx)   { MM.regionGfx.destroy();   MM.regionGfx   = null; }
  if (MM.cursorGfx)   { MM.cursorGfx.destroy();   MM.cursorGfx   = null; }
}

// ── Terrain overlay ───────────────────────────────────────────────────────────

export function renderTerrainOverlay(cellsOverride = null) {
  if (!canvas.scene || !MM.terrainGfx) return;
  const cells = cellsOverride ?? getTerrainCells();
  const types = getTerrainTypes();
  const shape = canvas.grid.getShape();
  MM.terrainGfx.clear();
  for (const [key, typeId] of Object.entries(cells)) {
    const type = types[typeId];
    if (!type) continue;
    const [i, j] = key.split(",").map(Number);
    _drawFilledCell(MM.terrainGfx, i, j, parseInt(type.color.replace("#", ""), 16), shape, 0.4);
  }
}

function _drawFilledCell(gfx, i, j, color, shape, alpha = 0.4) {
  const center = canvas.grid.getCenterPoint({ i, j });
  gfx.beginFill(color, alpha);
  gfx.lineStyle(1, color, 0.7);
  if (shape?.length > 0) {
    gfx.moveTo(center.x + shape[0].x, center.y + shape[0].y);
    for (let k = 1; k < shape.length; k++) gfx.lineTo(center.x + shape[k].x, center.y + shape[k].y);
    gfx.closePath();
  } else {
    gfx.drawCircle(center.x, center.y, canvas.grid.size / 2);
  }
  gfx.endFill();
}

// ── Region border overlay ─────────────────────────────────────────────────────

export function renderRegionOverlay(cellsOverride = null) {
  if (!canvas.scene || !MM.regionGfx) return;
  const cells   = cellsOverride ?? getRegionCells();
  const regions = getRegions();
  MM.regionGfx.clear();

  // Group cell keys by regionId
  const byRegion = {};
  for (const [key, regionId] of Object.entries(cells)) {
    if (!regions[regionId]) continue;
    if (!byRegion[regionId]) byRegion[regionId] = [];
    byRegion[regionId].push(key);
  }

  const shape = canvas.grid.getShape();

  for (const [regionId, keys] of Object.entries(byRegion)) {
    const region  = regions[regionId];
    const color   = parseInt(region.color.replace("#", ""), 16);
    const cellSet = new Set(keys);

    // BFS → connected components
    const visited    = new Set();
    const components = [];
    for (const startKey of keys) {
      if (visited.has(startKey)) continue;
      const component = [];
      const queue     = [startKey];
      visited.add(startKey);
      while (queue.length) {
        const k = queue.shift();
        component.push(k);
        const [ci, cj] = k.split(",").map(Number);
        for (const n of canvas.grid.getAdjacentOffsets({ i: ci, j: cj })) {
          const nk = cellKey(n.i, n.j);
          if (cellSet.has(nk) && !visited.has(nk)) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }
      components.push(component);
    }

    // Draw border for each connected component
    for (const component of components) {
      const compSet    = new Set(component);
      const edgeSegs   = _getBoundaryEdges(compSet, shape);
      const polygons   = _tracePolygons(edgeSegs);
      for (const poly of polygons) {
        _drawRegionPolygon(MM.regionGfx, poly, color);
      }
    }
  }
}

/**
 * For each hex in compSet, find edges where the neighbor is NOT in compSet.
 * Uses edge-midpoint → closest-neighbor to identify which neighbor is across each edge.
 * This is grid-type-agnostic.
 */
function _getBoundaryEdges(compSet, shape) {
  const edges = [];
  const N = shape.length;

  for (const key of compSet) {
    const [i, j] = key.split(",").map(Number);
    const center    = canvas.grid.getCenterPoint({ i, j });
    const neighbors = canvas.grid.getAdjacentOffsets({ i, j });

    for (let k = 0; k < N; k++) {
      const v1 = { x: center.x + shape[k].x,         y: center.y + shape[k].y };
      const v2 = { x: center.x + shape[(k+1)%N].x,   y: center.y + shape[(k+1)%N].y };
      const mid = { x: (v1.x + v2.x) / 2,             y: (v1.y + v2.y) / 2 };

      // Find the neighbor whose center is closest to this edge's midpoint
      let closestKey = null;
      let minDist    = Infinity;
      for (const n of neighbors) {
        const nc = canvas.grid.getCenterPoint(n);
        const d  = Math.hypot(nc.x - mid.x, nc.y - mid.y);
        if (d < minDist) { minDist = d; closestKey = cellKey(n.i, n.j); }
      }

      // Boundary edge if the neighbor across it is not in the component
      if (!closestKey || !compSet.has(closestKey)) {
        edges.push({ v1, v2 });
      }
    }
  }
  return edges;
}

/**
 * Chain a flat list of edge segments {v1,v2} into closed polygon loops.
 * Uses a vertex-key adjacency map; rounds coordinates to 0.1px for stability.
 */
function _tracePolygons(edges) {
  const vKey = ({ x, y }) => `${Math.round(x * 10)},${Math.round(y * 10)}`;

  // Build adjacency map: vertKey → [{neighborKey, point}]
  const adj      = new Map();
  const pointMap = new Map();

  for (const { v1, v2 } of edges) {
    const k1 = vKey(v1), k2 = vKey(v2);
    pointMap.set(k1, v1);
    pointMap.set(k2, v2);
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1).push(k2);
    adj.get(k2).push(k1);
  }

  const visitedEdges = new Set();
  const polygons     = [];

  for (const startKey of adj.keys()) {
    for (const nextKey of (adj.get(startKey) ?? [])) {
      const edgeId = `${startKey}|${nextKey}`;
      if (visitedEdges.has(edgeId)) continue;

      const polygon = [pointMap.get(startKey)];
      let current   = startKey;
      let next      = nextKey;

      while (next !== startKey) {
        visitedEdges.add(`${current}|${next}`);
        visitedEdges.add(`${next}|${current}`);
        polygon.push(pointMap.get(next));
        const neighbors = adj.get(next) ?? [];
        const forward   = neighbors.find(k => k !== current);
        if (!forward) break;
        current = next;
        next    = forward;
      }
      visitedEdges.add(`${current}|${next}`);
      visitedEdges.add(`${next}|${current}`);

      if (polygon.length >= 3) polygons.push(polygon);
    }
  }
  return polygons;
}

function _drawRegionPolygon(gfx, polygon, color) {
  gfx.lineStyle(3, color, 0.9);
  gfx.beginFill(color, 0.04);
  gfx.moveTo(polygon[0].x, polygon[0].y);
  for (let i = 1; i < polygon.length; i++) gfx.lineTo(polygon[i].x, polygon[i].y);
  gfx.closePath();
  gfx.endFill();
}

// ── Cursor preview ────────────────────────────────────────────────────────────

export function renderCursorPreview(centerI, centerJ) {
  if (!MM.cursorGfx) return;
  const gfx     = MM.cursorGfx;
  const shape   = canvas.grid.getShape();
  const offsets = getBrushOffsets(centerI, centerJ);

  gfx.clear();

  const terrainType = !MM.erasing && MM.activeTerrainId
    ? getTerrainTypes()[MM.activeTerrainId] : null;
  const region = !MM.erasing && MM.activeRegionId
    ? getRegions()[MM.activeRegionId] : null;

  for (const { i, j } of offsets) {
    const center = canvas.grid.getCenterPoint({ i, j });

    // Terrain fill preview
    if (MM.erasing && MM.eraseTerrain) {
      _drawCursorCell(gfx, center, shape, 0xe07070, 0xff4444, 0.2, 1);
    } else if (terrainType) {
      const c = parseInt(terrainType.color.replace("#", ""), 16);
      _drawCursorCell(gfx, center, shape, c, c, 0.35, 1);
    }

    // Region border preview (drawn on top of terrain preview)
    if (MM.erasing && MM.eraseRegion) {
      _drawCursorCell(gfx, center, shape, 0x000000, 0xff4444, 0, 2);
    } else if (region) {
      const c = parseInt(region.color.replace("#", ""), 16);
      _drawCursorCell(gfx, center, shape, c, c, 0.1, 2);
    }
  }
}

function _drawCursorCell(gfx, center, shape, fillColor, lineColor, fillAlpha, lineWidth) {
  gfx.beginFill(fillColor, fillAlpha);
  gfx.lineStyle(lineWidth, lineColor, 0.9);
  if (shape?.length > 0) {
    gfx.moveTo(center.x + shape[0].x, center.y + shape[0].y);
    for (let k = 1; k < shape.length; k++) gfx.lineTo(center.x + shape[k].x, center.y + shape[k].y);
    gfx.closePath();
  } else {
    gfx.drawCircle(center.x, center.y, canvas.grid.size / 2);
  }
  gfx.endFill();
}

export function clearCursorPreview() {
  MM.cursorGfx?.clear();
}

// ── Paint engine ──────────────────────────────────────────────────────────────

let _paintDebounce = null;

export function startPainting() {
  if (MM.painting) return;
  MM.painting = true;

  const onDown = (event) => {
    if (event.data.button !== 0) return;
    MM.isDragging = true;
    applyBrush(event);
  };
  const onMove = (event) => {
    const pos    = event.data.getLocalPosition(canvas.stage);
    const center = canvas.grid.getOffset({ x: pos.x, y: pos.y });
    renderCursorPreview(center.i, center.j);
    if (MM.isDragging) applyBrush(event);
  };
  const onUp = async () => {
    MM.isDragging = false;
    await flushPaint();
  };

  canvas.stage.on("mousedown", onDown);
  canvas.stage.on("mousemove", onMove);
  canvas.stage.on("mouseup",   onUp);
  MM._paintHandlers = { onDown, onMove, onUp };
}

export function stopPainting() {
  if (!MM.painting) return;
  MM.painting   = false;
  MM.isDragging = false;
  clearCursorPreview();

  const h = MM._paintHandlers;
  if (h) {
    canvas.stage.off("mousedown", h.onDown);
    canvas.stage.off("mousemove", h.onMove);
    canvas.stage.off("mouseup",   h.onUp);
    MM._paintHandlers = null;
  }

  // Flush any uncommitted paint synchronously
  if (MM._pendingTerrain !== null || MM._pendingRegion !== null) {
    clearTimeout(_paintDebounce);
    const terrain = MM._pendingTerrain;
    const region  = MM._pendingRegion;
    MM._pendingTerrain = null;
    MM._pendingRegion  = null;
    MM._isPainting     = false;
    if (terrain !== null) setSceneFlag("terrainCells", terrain);
    if (region  !== null) setSceneFlag("regionCells",  region);
  }
}

export function applyBrush(event) {
  const pos     = event.data.getLocalPosition(canvas.stage);
  const center  = canvas.grid.getOffset({ x: pos.x, y: pos.y });
  const offsets = getBrushOffsets(center.i, center.j);

  // Lazy-init pending snapshots from current flag state
  if (MM._pendingTerrain === null) MM._pendingTerrain = foundry.utils.deepClone(getTerrainCells());
  if (MM._pendingRegion  === null) MM._pendingRegion  = foundry.utils.deepClone(getRegionCells());

  let changed = false;

  for (const { i, j } of offsets) {
    const key = cellKey(i, j);

    if (MM.erasing) {
      if (MM.eraseTerrain && key in MM._pendingTerrain) { delete MM._pendingTerrain[key]; changed = true; }
      if (MM.eraseRegion  && key in MM._pendingRegion)  { delete MM._pendingRegion[key];  changed = true; }
    } else {
      if (MM.activeTerrainId && MM._pendingTerrain[key] !== MM.activeTerrainId) {
        MM._pendingTerrain[key] = MM.activeTerrainId; changed = true;
      }
      if (MM.activeRegionId && MM._pendingRegion[key] !== MM.activeRegionId) {
        MM._pendingRegion[key] = MM.activeRegionId; changed = true;
      }
    }
  }

  if (!changed) return;

  MM._isPainting = true;
  renderTerrainOverlay(MM._pendingTerrain);
  renderRegionOverlay(MM._pendingRegion);

  clearTimeout(_paintDebounce);
  _paintDebounce = setTimeout(flushPaint, 200);
}

export async function flushPaint() {
  clearTimeout(_paintDebounce);
  if (MM._pendingTerrain === null && MM._pendingRegion === null) {
    MM._isPainting = false;
    return;
  }

  const terrain = MM._pendingTerrain;
  const region  = MM._pendingRegion;
  MM._pendingTerrain = null;
  MM._pendingRegion  = null;

  // Render from snapshots BEFORE saving to avoid flag-cache snap-back
  if (terrain !== null) renderTerrainOverlay(terrain);
  if (region  !== null) renderRegionOverlay(region);

  await Promise.all([
    terrain !== null ? setSceneFlag("terrainCells", terrain) : Promise.resolve(),
    region  !== null ? setSceneFlag("regionCells",  region)  : Promise.resolve(),
  ]);
  MM._isPainting = false;
}

// ── Full re-render (called from updateScene hook) ─────────────────────────────

export function renderAllOverlays() {
  renderTerrainOverlay();
  renderRegionOverlay();
}

// ── Public API helpers ────────────────────────────────────────────────────────

export function getTerrainAtOffset(i, j) {
  const typeId = getTerrainCells()[cellKey(i, j)];
  return typeId ? (getTerrainTypes()[typeId] ?? null) : null;
}

export function getTerrainAtPoint(x, y) {
  const offset = canvas.grid.getOffset({ x, y });
  return getTerrainAtOffset(offset.i, offset.j);
}

export function getRegionAtOffset(i, j) {
  const regionId = getRegionCells()[cellKey(i, j)];
  return regionId ? (getRegions()[regionId] ?? null) : null;
}

export function getRegionAtPoint(x, y) {
  const offset = canvas.grid.getOffset({ x, y });
  return getRegionAtOffset(offset.i, offset.j);
}
