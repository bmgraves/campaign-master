/* ============================================================
   Campaign Master - campaign-master.js
   FoundryVTT V13 — Entry point
   ============================================================ */

import { startHighlighter, stopHighlighter }        from "./tools/hex-highlighter.js";
import { startTracker, stopTracker }                 from "./tools/token-tracker.js";
import { toggleMapManagerUI, refreshPanelLists }     from "./tools/map-manager-ui.js";
import {
  MODULE_ID,
  MM,
  initMapGfx, destroyMapGfx,
  migrateIfNeeded,
  renderTerrainOverlay, renderRegionOverlay,
  getTerrainAtPoint, getTerrainAtOffset,
  getRegionAtPoint, getRegionAtOffset,
} from "./tools/map-manager.js";

// ── Settings ──────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "highlighterActive", {
    scope: "client", config: false, type: Boolean, default: false,
  });
  game.settings.register(MODULE_ID, "trackerActive", {
    scope: "client", config: false, type: Boolean, default: false,
  });
  game.settings.register(MODULE_ID, "terrainVisible", {
    scope: "client", config: false, type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, "regionVisible", {
    scope: "client", config: false, type: Boolean, default: true,
  });
});

// ── Scene Controls ────────────────────────────────────────────────────────────

Hooks.on("getSceneControlButtons", (controls) => {
  controls[MODULE_ID] = {
    name:        MODULE_ID,
    title:       "Campaign Master",
    icon:        "fa-solid fa-hexagon",
    order:       99,
    visible:     true,
    activeTool:  "hex-highlight",
    tools: {
      "hex-highlight": {
        name:    "hex-highlight",
        title:   "Hex Highlighter",
        icon:    "fa-solid fa-highlighter",
        order:   1,
        toggle:  true,
        active:  game.settings.get(MODULE_ID, "highlighterActive"),
        visible: true,
        onChange: (event, active) => {
          game.settings.set(MODULE_ID, "highlighterActive", active);
          if (active) startHighlighter(); else stopHighlighter();
        },
      },
      "token-tracker": {
        name:    "token-tracker",
        title:   "Token Movement Tracker",
        icon:    "fa-solid fa-route",
        order:   2,
        toggle:  true,
        active:  game.settings.get(MODULE_ID, "trackerActive"),
        visible: true,
        onChange: (event, active) => {
          game.settings.set(MODULE_ID, "trackerActive", active);
          if (active) startTracker(getTerrainAtPoint); else stopTracker();
        },
      },
      "map-manager": {
        name:    "map-manager",
        title:   "Map Manager",
        icon:    "fa-solid fa-map",
        order:   3,
        button:  true,
        visible: game.user.isGM,
        onChange: () => toggleMapManagerUI(),
      },
    },
  };
});

// ── Ready ─────────────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  console.log("Campaign Master | Ready.");
  if (game.settings.get(MODULE_ID, "highlighterActive")) startHighlighter();
  if (game.settings.get(MODULE_ID, "trackerActive"))     startTracker(getTerrainAtPoint);
});

// ── Canvas hooks ──────────────────────────────────────────────────────────────

Hooks.on("canvasReady", async () => {
  destroyMapGfx();
  initMapGfx();

  await migrateIfNeeded();

  MM.terrainVisible = game.settings.get(MODULE_ID, "terrainVisible");
  MM.regionVisible  = game.settings.get(MODULE_ID, "regionVisible");
  if (MM.terrainGfx) MM.terrainGfx.visible = MM.terrainVisible;
  if (MM.regionGfx)  MM.regionGfx.visible  = MM.regionVisible;

  renderTerrainOverlay();
  renderRegionOverlay();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  if (!changes.flags?.[MODULE_ID]) return;
  if (MM._isPainting) return;
  renderTerrainOverlay();
  renderRegionOverlay();
  refreshPanelLists();
});

// ── Public API ────────────────────────────────────────────────────────────────

window.CampaignMaster = {
  /** World pixel → terrain type object or null */
  getTerrainAtPoint(x, y) { return getTerrainAtPoint(x, y); },

  /** Grid offset → terrain type object or null */
  getTerrainAtOffset(i, j) { return getTerrainAtOffset(i, j); },

  /** Token center → terrain type object or null */
  getTerrainForToken(token) {
    return getTerrainAtPoint(token.x + token.w / 2, token.y + token.h / 2);
  },

  /** World pixel → region object or null */
  getRegionAtPoint(x, y) { return getRegionAtPoint(x, y); },

  /** Grid offset → region object or null */
  getRegionAtOffset(i, j) { return getRegionAtOffset(i, j); },

  /** Token center → region object or null */
  getRegionForToken(token) {
    return getRegionAtPoint(token.x + token.w / 2, token.y + token.h / 2);
  },

  /** World pixel → { terrain, region } both resolved to objects (or null) */
  getCellStateAtPoint(x, y) {
    return {
      terrain: getTerrainAtPoint(x, y),
      region:  getRegionAtPoint(x, y),
    };
  },
};
