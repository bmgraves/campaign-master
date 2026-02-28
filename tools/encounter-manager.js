/* ============================================================
   Campaign Master — Encounter Manager
   Handles encounter rolls triggered by:
     - Daily check   (updateWorldTime crosses the configured check hour per entry)
     - Entering hex  (updateToken with position change)
     - Leaving hex   (preUpdateToken with position change)
   Only fires for the GM client.
   ============================================================ */

const CM_EM = { watcher: null };

// ── Threshold parser ──────────────────────────────────────────────────────────
// ""  / null  → [] (always trigger)
// "1,2"       → [1, 2]
// "1-3"       → [1, 2, 3]

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

// ── Daily check-time crossing detector ───────────────────────────────────────

function _crossedCheckTime(prevTime, worldTime, secsPerDay, checkOffset) {
  const dayStart = Math.floor(prevTime  / secsPerDay);
  const dayEnd   = Math.floor(worldTime / secsPerDay);
  for (let d = dayStart; d <= dayEnd; d++) {
    const t = d * secsPerDay + checkOffset;
    if (t > prevTime && t <= worldTime) return true;
  }
  return false;
}

// ── Core roll ─────────────────────────────────────────────────────────────────
// enc: { uuid, die?, threshold?, frequency, checkHour, inheritedFrom }
// ctx: { tokenName, locationLabel }
// subtables: [{ uuid, keyword, inheritedFrom }] — checked against draw results
//
// If enc.die is empty the table draws automatically (100% chance).

export async function rollEncounterCheck(enc, { tokenName, locationLabel }, subtables = []) {
  if (!enc?.uuid) return;

  // Use async fromUuid — fromUuidSync can miss compendium/embedded documents
  const doc       = await fromUuid(enc.uuid);
  const tableName = doc?.name ?? enc.uuid;
  const typeLabel = enc.type === "secondary" ? "Secondary" : "Primary";
  const viaLabel  = enc.inheritedFrom
    ? `<span style="color:#555;font-size:10px;"> via ${enc.inheritedFrom}</span>` : "";

  // ── Roll check (optional) ─────────────────────────────────────────────────
  const hasDie = !!(enc.die?.trim());
  let roll      = null;
  let triggered = true;
  let thrLabel  = "auto";

  if (hasDie) {
    try {
      roll = await new Roll(enc.die).evaluate();
    } catch (e) {
      console.warn("Campaign Master | Bad encounter die formula:", enc.die, e);
      return;
    }
    const threshold = _parseThreshold(enc.threshold);
    triggered = !threshold.length || threshold.includes(roll.total);
    thrLabel  = threshold.length ? enc.threshold : "any";
  }

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
          <div><span style="color:#666;">[${typeLabel}] Table:</span> ${tableName}${viaLabel}</div>
        </div>`,
      speaker: { alias: "Campaign Master" },
      whisper: ChatMessage.getWhisperRecipients("GM"),
    });
    return;
  }

  // ── Announce trigger ──────────────────────────────────────────────────────
  const rollLine = roll
    ? `<b style="color:#e8c040;">${roll.total}</b> on <code>${enc.die}</code> — threshold: ${thrLabel} — <b style="color:#e8c040;">triggered!</b>`
    : `<span style="color:#e8c040;">automatic</span>`;

  ChatMessage.create({
    content: `
      <div style="border:1px solid #c0a020;border-radius:6px;padding:6px 10px;
          background:#1a1500;font-size:12px;line-height:1.7;color:#aaa;">
        <b style="color:#e8c040;">⚔️ Encounter!</b>
        <div><span style="color:#666;">Token:</span> ${tokenName} → <b>${locationLabel}</b></div>
        <div><span style="color:#666;">Rolled:</span> ${rollLine}</div>
        <div><span style="color:#666;">[${typeLabel}] Table:</span> ${tableName}${viaLabel}</div>
      </div>`,
    speaker: { alias: "Campaign Master" },
    whisper: ChatMessage.getWhisperRecipients("GM"),
  });

  // ── Draw from table / execute macro ───────────────────────────────────────
  // Use roll({ displayChat: false }) to get results without auto-posting to chat,
  // then extract text (getChatText is async in V13), then post manually via toMessage.
  let resultText = "";
  if (doc?.documentName === "RollTable") {
    const rolled  = await doc.roll({ displayChat: false });
    const results = rolled?.results ?? [];

    const textParts = [];
    for (const r of results) {
      // Include both the rich-text body AND the Result Name field so keywords
      // can match against either without requiring the text body to be filled in.
      let body = "";
      if (typeof r.getChatText === "function") {
        const html = await r.getChatText();
        body = html ? html.replace(/<[^>]*>/g, "").trim() : "";
      }
      if (!body) body = (r.text ?? r.data?.text ?? r._source?.text ?? "").trim();
      const name = (r.name ?? r.data?.name ?? r._source?.name ?? "").trim();
      const combined = [body, name].filter(Boolean).join(" ");
      if (combined) textParts.push(combined);
    }
    resultText = textParts.join(" ").trim();
    console.log(`Campaign Master | Roll resultText="${resultText}" | ${subtables.length} subtable(s)`);

    // Post the table result to chat as a GM-only roll
    try {
      await doc.toMessage(results, { roll: rolled.roll, rollMode: "gmroll" });
    } catch (e) {
      console.warn("Campaign Master | toMessage failed, falling back to draw:", e);
      await doc.draw({ rollMode: "gmroll" });
    }
  } else if (doc?.documentName === "Macro") {
    await doc.execute();
  }

  // ── Sub-table keyword matching ────────────────────────────────────────────
  for (const sub of subtables) {
    if (!sub.keyword || !sub.uuid) continue;
    const matched = resultText.toLowerCase().includes(sub.keyword.toLowerCase());
    if (!matched) continue;

    // Resolve sub-table document (async for compendium support)
    const subDoc  = await fromUuid(sub.uuid);
    const subName = subDoc?.name ?? sub.uuid;
    const subVia  = `<span style="color:#555;font-size:10px;"> via ${sub.inheritedFrom}</span>`;

    // Announce keyword match — always visible even if UUID was bad
    ChatMessage.create({
      content: `
        <div style="border:1px solid #4a5a7a;border-radius:6px;padding:6px 10px;
            background:#0d1020;font-size:12px;line-height:1.7;color:#aaa;">
          <b style="color:#7ab0dd;">📋 Sub-Table</b>
          — keyword <code>${sub.keyword}</code> matched
          <div><span style="color:#666;">Table:</span> ${subName}${subVia}</div>
        </div>`,
      speaker: { alias: "Campaign Master" },
      whisper: ChatMessage.getWhisperRecipients("GM"),
    });

    if (!subDoc) {
      console.warn(`Campaign Master | Sub-table UUID not found: "${sub.uuid}"`);
      continue;
    }
    if (subDoc.documentName === "RollTable") await subDoc.draw({ rollMode: "gmroll" });
    else if (subDoc.documentName === "Macro") await subDoc.execute();
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
  // Fires when world time crosses the per-entry check hour on any day.

  const hookTime = Hooks.on("updateWorldTime", async (worldTime, delta) => {
    if (!game.user.isGM) return;
    if (!canvas?.scene)  return;
    if (delta <= 0)      return;

    const mapCfg      = getMapConfig() ?? {};
    const hoursPerDay = mapCfg.hoursPerDay ?? 24;
    const secsPerDay  = hoursPerDay * 3600;
    const prevTime    = worldTime - delta;

    const tokens = canvas.tokens?.placeables ?? [];
    for (const token of tokens) {
      const c   = _tokenCenter(token.document, token.x, token.y);
      const off = canvas.grid.getOffset(c);
      const resolved = getResolvedConfig(off.i, off.j);
      const ctx = {
        tokenName:     token.name,
        locationLabel: resolved.hexName || `[${off.i},${off.j}]`,
      };

      // Primary — daily
      if (resolved.primary?.frequency === "daily") {
        const checkOffset = (resolved.primary.checkHour ?? 6) * 3600;
        if (_crossedCheckTime(prevTime, worldTime, secsPerDay, checkOffset)) {
          await rollEncounterCheck(resolved.primary, ctx, resolved.subtables ?? []);
        }
      }

      // Secondaries — daily
      for (const enc of resolved.secondaries ?? []) {
        if (enc.frequency !== "daily") continue;
        const checkOffset = (enc.checkHour ?? 6) * 3600;
        if (_crossedCheckTime(prevTime, worldTime, secsPerDay, checkOffset)) {
          await rollEncounterCheck(enc, ctx, resolved.subtables ?? []);
        }
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
    const ctx = {
      tokenName:     tokenDoc.name,
      locationLabel: resolved.hexName || `[${off.i},${off.j}]`,
    };

    if (resolved.primary?.frequency === "entering") {
      await rollEncounterCheck(resolved.primary, ctx, resolved.subtables ?? []);
    }
    for (const enc of resolved.secondaries ?? []) {
      if (enc.frequency === "entering") {
        await rollEncounterCheck(enc, ctx, resolved.subtables ?? []);
      }
    }
  });

  // ── Leaving hex ────────────────────────────────────────────────────────────

  const hookLeave = Hooks.on("preUpdateToken", (tokenDoc, changes) => {
    if (!game.user.isGM) return;
    if (changes.x === undefined && changes.y === undefined) return;

    const c   = _tokenCenter(tokenDoc, tokenDoc.x, tokenDoc.y);
    const off = canvas.grid.getOffset(c);
    const resolved = getResolvedConfig(off.i, off.j);
    const ctx = {
      tokenName:     tokenDoc.name,
      locationLabel: resolved.hexName || `[${off.i},${off.j}]`,
    };

    if (resolved.primary?.frequency === "leaving") {
      rollEncounterCheck(resolved.primary, ctx, resolved.subtables ?? []);
    }
    for (const enc of resolved.secondaries ?? []) {
      if (enc.frequency === "leaving") {
        rollEncounterCheck(enc, ctx, resolved.subtables ?? []);
      }
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
