/* ============================================================
   Campaign Master — Encounter Manager
   Handles encounter rolls triggered by:
     - Daily check   (updateWorldTime crosses the configured hour)
     - Entering hex  (updateToken with position change)
     - Leaving hex   (preUpdateToken with position change)
   Only fires for the GM client.
   ============================================================ */

const CM_EM = { watcher: null };

// ── Threshold parser ──────────────────────────────────────────────────────────
// "" / null  → [] (always trigger)
// "1,2"      → [1, 2]
// "1-3"      → [1, 2, 3]

function _parseThreshold(str) {
  if (!str?.trim()) return [];
  const s = str.trim();
  if (s.includes("-")) {
    const [a, b] = s.split("-").map(Number);
    const arr = [];
    for (let i = a; i <= b; i++) arr.push(i);
    return arr;
  }
  return s.split(",").map(p => parseInt(p.trim())).filter(n => !isNaN(n));
}

// ── Core roll ─────────────────────────────────────────────────────────────────
// enc: { uuid, die, threshold, frequency, inheritedFrom }
// ctx: { tokenName, locationLabel }

export async function rollEncounterCheck(enc, { tokenName, locationLabel }) {
  if (!enc?.uuid || !enc?.die) return;

  let roll;
  try {
    roll = await new Roll(enc.die).evaluate();
  } catch (e) {
    console.warn("Campaign Master | Bad encounter die formula:", enc.die, e);
    return;
  }

  const threshold = _parseThreshold(enc.threshold);
  const triggered = !threshold.length || threshold.includes(roll.total);
  const thrLabel  = threshold.length ? enc.threshold : "any";
  const doc       = fromUuidSync(enc.uuid);
  const tableName = doc?.name ?? enc.uuid;
  const viaLabel  = enc.inheritedFrom
    ? `<span style="color:#555;font-size:10px;"> via ${enc.inheritedFrom}</span>` : "";

  if (!triggered) {
    ChatMessage.create({
      content: `
        <div style="border:1px solid #444;border-radius:6px;padding:6px 10px;
            background:#1a1a1a;font-size:12px;line-height:1.7;color:#aaa;">
          <b style="color:#888;">🎲 No Encounter</b>
          <div><span style="color:#666;">Token:</span> ${tokenName} → <b>${locationLabel}</b></div>
          <div><span style="color:#666;">Rolled:</span>
            <b style="color:#ccc;">${roll.total}</b> on <code>${enc.die}</code>
            — threshold: ${thrLabel} — <i>no trigger</i>
          </div>
          <div><span style="color:#666;">Table:</span> ${tableName}${viaLabel}</div>
        </div>`,
      speaker: { alias: "Campaign Master" },
      whisper: ChatMessage.getWhisperRecipients("GM"),
    });
    return;
  }

  // Triggered — announce then draw from table
  ChatMessage.create({
    content: `
      <div style="border:1px solid #c0a020;border-radius:6px;padding:6px 10px;
          background:#1a1500;font-size:12px;line-height:1.7;color:#aaa;">
        <b style="color:#e8c040;">⚔️ Encounter!</b>
        <div><span style="color:#666;">Token:</span> ${tokenName} → <b>${locationLabel}</b></div>
        <div><span style="color:#666;">Rolled:</span>
          <b style="color:#e8c040;">${roll.total}</b> on <code>${enc.die}</code>
          — threshold: ${thrLabel} — <b style="color:#e8c040;">triggered!</b>
        </div>
        <div><span style="color:#666;">Table:</span> ${tableName}${viaLabel}</div>
      </div>`,
    speaker: { alias: "Campaign Master" },
    whisper: ChatMessage.getWhisperRecipients("GM"),
  });

  if (doc?.documentName === "RollTable") {
    await doc.draw({ rollMode: "gmroll" });
  } else if (doc?.documentName === "Macro") {
    await doc.execute();
  }
}

// ── Token center helper ───────────────────────────────────────────────────────

function _tokenCenter(doc, x, y) {
  return {
    x: x + (doc.width  * canvas.grid.sizeX) / 2,
    y: y + (doc.height * canvas.grid.sizeY) / 2,
  };
}

// ── Watcher ───────────────────────────────────────────────────────────────────

export function startEncounterWatcher({ getResolvedConfig, getMapConfig }) {
  if (CM_EM.watcher) return;

  // ── Daily ──────────────────────────────────────────────────────────────────
  // Fires when world time crosses the configured check hour on any day.

  const hookTime = Hooks.on("updateWorldTime", async (worldTime, delta) => {
    if (!game.user.isGM) return;
    if (!canvas?.scene)  return;
    if (delta <= 0)      return;

    const mapCfg      = getMapConfig() ?? {};
    const hoursPerDay = mapCfg.hoursPerDay    ?? 24;
    const checkHour   = mapCfg.dailyCheckHour ?? 6;
    const secsPerDay  = hoursPerDay * 3600;
    const checkOffset = checkHour   * 3600;
    const prevTime    = worldTime - delta;

    // Was any "check boundary" crossed?
    let triggered = false;
    const dayStart = Math.floor(prevTime    / secsPerDay);
    const dayEnd   = Math.floor(worldTime   / secsPerDay);
    for (let d = dayStart; d <= dayEnd; d++) {
      const t = d * secsPerDay + checkOffset;
      if (t > prevTime && t <= worldTime) { triggered = true; break; }
    }
    if (!triggered) return;

    const tokens = canvas.tokens?.placeables ?? [];
    for (const token of tokens) {
      const c   = _tokenCenter(token.document, token.x, token.y);
      const off = canvas.grid.getOffset(c);
      const resolved = getResolvedConfig(off.i, off.j);
      if (resolved?.encounter?.frequency === "daily") {
        await rollEncounterCheck(resolved.encounter, {
          tokenName:     token.name,
          locationLabel: resolved.hexName || `[${off.i},${off.j}]`,
        });
      }
    }
  });

  // ── Entering hex ───────────────────────────────────────────────────────────

  const hookEnter = Hooks.on("updateToken", async (tokenDoc, changes) => {
    if (!game.user.isGM) return;
    if (changes.x === undefined && changes.y === undefined) return;

    const c   = _tokenCenter(tokenDoc, changes.x ?? tokenDoc.x, changes.y ?? tokenDoc.y);
    const off = canvas.grid.getOffset(c);
    const resolved = getResolvedConfig(off.i, off.j);
    if (resolved?.encounter?.frequency === "entering") {
      await rollEncounterCheck(resolved.encounter, {
        tokenName:     tokenDoc.name,
        locationLabel: resolved.hexName || `[${off.i},${off.j}]`,
      });
    }
  });

  // ── Leaving hex ────────────────────────────────────────────────────────────

  const hookLeave = Hooks.on("preUpdateToken", (tokenDoc, changes) => {
    if (!game.user.isGM) return;
    if (changes.x === undefined && changes.y === undefined) return;

    const c   = _tokenCenter(tokenDoc, tokenDoc.x, tokenDoc.y);
    const off = canvas.grid.getOffset(c);
    const resolved = getResolvedConfig(off.i, off.j);
    if (resolved?.encounter?.frequency === "leaving") {
      rollEncounterCheck(resolved.encounter, {
        tokenName:     tokenDoc.name,
        locationLabel: resolved.hexName || `[${off.i},${off.j}]`,
      });
    }
  });

  CM_EM.watcher = { hookTime, hookEnter, hookLeave };
}

export function stopEncounterWatcher() {
  if (!CM_EM.watcher) return;
  Hooks.off("updateWorldTime", CM_EM.watcher.hookTime);
  Hooks.off("updateToken",     CM_EM.watcher.hookEnter);
  Hooks.off("preUpdateToken",  CM_EM.watcher.hookLeave);
  CM_EM.watcher = null;
}
