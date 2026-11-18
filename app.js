/* Histórico de Músicas — lê do Supabase (ao vivo) e calcula estatísticas.
 * Fallback para data.json (snapshot local) caso o Supabase não responda. */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const MON_ABBR = { 1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
                     7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec" };
  // Colunas da escala que são metadados (não funções/pessoas)
  const META_KEYS = new Set(["DATA", "DIA", "EVENTO", "Coluna 9", "Coluna 9".normalize("NFC")]);

  const $ = (sel) => document.querySelector(sel);
  const norm = (s) => (s || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  const escapeHtml = (s) =>
    (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ----- Estado -----
  let STATE = {
    cantadas: [],
    musicas: [],
    escalaRows: [],
    escalaByKey: new Map(),   // "7-Jun|CULTO DA NOITE" -> celulas
    escalaByDate: new Map(),  // "7-Jun" -> [celulas, ...]
    musicasByTitle: new Map(),
    songs: [],                // agregado por música
    source: "live",
    search: "",
    year: "",
    sort: "count_desc",
  };

  // ----- Supabase REST -----
  async function sbSelect(table, select, limit = 2000) {
    const url = `${CFG.SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}`;
    const res = await fetch(url, {
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase ${table}: HTTP ${res.status}`);
    return res.json();
  }

  async function loadLive() {
    const [cantadas, musicas, escala] = await Promise.all([
      sbSelect("musicas_cantadas", "id,data,evento,musica,artista,ordem,cantor"),
      sbSelect("musicas", "id,titulo,artista"),
      sbSelect("escala", "colunas,linhas"),
    ]);
    return { cantadas: cantadas || [], musicas: musicas || [], escala: escala || [] };
  }

  async function loadSnapshot() {
    const res = await fetch("./data.json");
    if (!res.ok) throw new Error("Snapshot não encontrado");
    return res.json();
  }

  // ----- Parse / matching helpers -----
  function parseDate(data) {
    if (!data || !data.includes("/")) return null;
    const [d, m, y] = data.split("/").map((x) => parseInt(x, 10));
    if (!y) return null;
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function yearOf(data) {
    const p = (data || "").split("/");
    return p[2] ? parseInt(p[2], 10) : null;
  }
  function keyFromData(data) {
    const p = (data || "").split("/");
    const day = parseInt(p[0], 10), mon = MON_ABBR[parseInt(p[1], 10)];
    return Number.isFinite(day) && mon ? `${day}-${mon}` : null;
  }
  function keyFromEscala(dateStr) {
    const p = (dateStr || "").split("-");
    const day = parseInt(p[0], 10), mon = p[1];
    return Number.isFinite(day) && mon ? `${day}-${mon}` : null;
  }
  const normEvento = (e) => norm(e);

  function buildEscalaMaps(rows) {
    const byKey = new Map();
    const byDate = new Map();
    (rows || []).forEach((doc) => {
      const linhas = (doc && doc.linhas) || [];
      linhas.forEach((ln) => {
        const cel = (ln && ln.celulas) || {};
        const k = keyFromEscala(cel.DATA);
        const ev = normEvento(cel.EVENTO);
        if (k) {
          if (ev) byKey.set(`${k}|${ev}`, cel);
          if (!byDate.has(k)) byDate.set(k, []);
          byDate.get(k).push(cel);
        }
      });
    });
    return { byKey, byDate };
  }

  function matchEscala(exec) {
    const k = keyFromData(exec.data);
    if (!k) return null;
    const exact = STATE.escalaByKey.get(`${k}|${normEvento(exec.evento)}`);
    if (exact) return exact;
    const sameDate = STATE.escalaByDate.get(k);
    return sameDate && sameDate.length ? sameDate[0] : null;
  }

  function formationLines(cel) {
    if (!cel) return [];
    const out = [];
    for (const [k, v] of Object.entries(cel)) {
      if (META_KEYS.has(k)) continue;
      const val = (v == null ? "" : String(v)).trim();
      if (!val) continue;
      out.push({ funcao: k, pessoas: val });
    }
    return out;
  }

  // ----- Agregação -----
  function buildModel(raw) {
    STATE.cantadas = raw.cantadas || [];
    STATE.musicas = raw.musicas || [];
    const escalaRows = (raw.escala || []).flatMap((d) => (d && d.linhas ? d.linhas : []));
    STATE.escalaRows = escalaRows;
    const maps = buildEscalaMaps(raw.escala || []);
    STATE.escalaByKey = maps.byKey;
    STATE.escalaByDate = maps.byDate;

    // Catálogo de músicas para enriquecer o autor
    const mt = new Map();
    STATE.musicas.forEach((m) => {
      mt.set(norm(m.titulo), m.artista);
      const variant = (m.titulo || "").replace(/\s*-\s*\d+\s*$/, "").trim();
      if (variant && variant !== m.titulo) mt.set(norm(variant), m.artista);
    });
    STATE.musicasByTitle = mt;

    // Agrupa histórico por música (título normalizado)
    const songMap = new Map();
    STATE.cantadas.forEach((row) => {
      if (!row.musica) return;
      const key = norm(row.musica);
      if (!songMap.has(key)) {
        songMap.set(key, { titulo: row.musica, artistas: new Map(), execs: [] });
      }
      const s = songMap.get(key);
      s.execs.push(row);
      if (row.artista && row.artista.trim()) s.artistas.set(norm(row.artista), row.artista.trim());
    });

    // Resolve o autor (histórico > catálogo > vazio)
    STATE.songs = Array.from(songMap.values()).map((s) => {
      let artist = "";
      for (const a of s.artistas.values()) if (a) { artist = a; break; }
      if (!artist) {
        const a1 = STATE.musicasByTitle.get(norm(s.titulo));
        if (a1 && a1.trim()) artist = a1.trim();
      }
      if (!artist) {
        const v = s.titulo.replace(/\s*-\s*\d+\s*$/, "").trim();
        const a2 = STATE.musicasByTitle.get(norm(v));
        if (a2 && a2.trim()) artist = a2.trim();
      }
      s.artista = artist;
      return s;
    });
  }

  function songStats(song, year) {
    const execs = year ? song.execs.filter((e) => yearOf(e.data) === year) : song.execs;
    let last = null;
    execs.forEach((e) => {
      const d = parseDate(e.data);
      if (d && (!last || d > last.d)) last = { raw: e.data, d };
    });
    return { execs, count: execs.length, lastRaw: last ? last.raw : null };
  }

  // ----- Render -----
  function songDisplayName(song) {
    if (song.artista) {
      return `${escapeHtml(song.titulo)}<span class="dash">—</span><span class="artist">${escapeHtml(song.artista)}</span>`;
    }
    return escapeHtml(song.titulo);
  }

  function renderYears() {
    const sel = $("#yearSelect");
    const years = Array.from(new Set(STATE.cantadas.map((e) => yearOf(e.data)).filter(Boolean))).sort((a, b) => b - a);
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todos os anos</option>' +
      years.map((y) => `<option value="${y}">${y}</option>`).join("");
    if (cur) sel.value = cur;
    STATE.year = sel.value ? parseInt(sel.value, 10) : "";
  }

  function getFilteredSongs() {
    const q = norm(STATE.search);
    let list = STATE.songs.filter((s) => {
      if (q && !norm(s.titulo).includes(q) && !norm(s.artista).includes(q)) return false;
      if (STATE.year && !s.execs.some((e) => yearOf(e.data) === STATE.year)) return false;
      return true;
    });
    // estatísticas por ano para ordenação/contagem
    list.forEach((s) => (s._stats = songStats(s, STATE.year)));
    const by = STATE.sort;
    list.sort((a, b) => {
      if (by === "name_asc") return a.titulo.localeCompare(b.titulo, "pt-BR");
      if (by === "last_desc") {
        const da = parseDate(a._stats.lastRaw), db = parseDate(b._stats.lastRaw);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      }
      if (by === "count_asc") return a._stats.count - b._stats.count;
      return b._stats.count - a._stats.count; // count_desc
    });
    return list;
  }

  function render() {
    const list = getFilteredSongs();
    const totalExec = STATE.cantadas.length;
    const totalSongs = STATE.songs.length;
    const shownExec = list.reduce((acc, s) => acc + s._stats.count, 0);

    $("#summary").innerHTML =
      `Exibindo <b>${list.length}</b> música(s) ` +
      (STATE.year ? `em <b>${STATE.year}</b> ` : "") +
      `· <b>${shownExec}</b> execução(ões) neste filtro ` +
      `· <b>${totalSongs}</b> músicas e <b>${totalExec}</b> execuções no total.`;

    const container = $("#songList");
    if (!list.length) {
      container.innerHTML = `<div class="empty">Nenhuma música encontrada para este filtro.</div>`;
      return;
    }
    container.innerHTML = list
      .map((s, i) => {
        const st = s._stats;
        const last = st.lastRaw ? `última em <b>${escapeHtml(st.lastRaw)}</b>` : "ainda não cantada";
        return `
        <div class="song-card" data-idx="${i}">
          <div class="song-main">
            <div class="song-title">${songDisplayName(s)}</div>
            <div class="song-sub">
              <span class="pill">${st.count}× cantada</span> ${last}
            </div>
          </div>
          <button class="stats-btn" data-idx="${i}">📊 Estatísticas</button>
        </div>`;
      })
      .join("");

    const openIdx = (el) => {
      const card = el.closest(".song-card");
      if (!card) return;
      openModal(list[parseInt(card.dataset.idx, 10)]);
    };
    container.querySelectorAll(".song-card").forEach((card) => {
      card.addEventListener("click", (ev) => {
        if (ev.target.closest(".stats-btn")) return; // o botão já trata
        openIdx(card);
      });
    });
    container.querySelectorAll(".stats-btn").forEach((btn) => {
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); openIdx(btn); });
    });
  }

  function openModal(song) {
    const st = songStats(song, STATE.year);
    const execs = st.execs.slice().sort((a, b) => {
      const da = parseDate(a.data), db = parseDate(b.data);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    const execHtml = execs.length
      ? execs
          .map((e) => {
            const cel = matchEscala(e);
            const lines = formationLines(cel);
            const formation = lines.length
              ? `<div class="formation">${lines
                  .map(
                    (l) =>
                      `<div class="f-line"><div class="f-func">${escapeHtml(l.funcao)}</div><div class="f-people">${escapeHtml(l.pessoas)}</div></div>`
                  )
                  .join("")}</div>`
              : `<div class="no-formation">Sem escala correspondente para esta data.</div>`;
            const cantor = e.cantor && e.cantor.trim()
              ? `<span class="exec-cantor">· Cantor: <b>${escapeHtml(e.cantor.trim())}</b></span>`
              : "";
            return `
            <div class="exec">
              <div class="exec-head">
                <span class="exec-date">${escapeHtml(e.data || "—")}</span>
                <span class="exec-culto">${escapeHtml(e.evento || "Culto")}</span>
                ${cantor}
              </div>
              ${formation}
            </div>`;
          })
          .join("")
      : `<div class="empty">Nenhuma execução neste filtro.</div>`;

    const title = song.artista
      ? `${escapeHtml(song.titulo)} <span class="artist">— ${escapeHtml(song.artista)}</span>`
      : escapeHtml(song.titulo);

    // Tom (afinação) com o lápis alinhado na mesma linha
    const tom = (song.execs.map((e) => e.tom).find((t) => t && String(t).trim()) || "").toString().trim();
    const tomLine = tom
      ? `<div class="tom-line"><span class="tom-label">Tom</span><span class="tom-value">${escapeHtml(tom)}</span><span class="tom-edit" title="Editar tom">✏️</span></div>`
      : "";

    // Última formação da banda (cruzamento histórico × escala)
    const lastExecEsc = execs.find((e) => matchEscala(e));
    const lastFormLines = lastExecEsc ? formationLines(matchEscala(lastExecEsc)) : [];
    const lastFormationHtml = lastFormLines.length
      ? `<div class="last-formation">
           <h3>Última formação da banda <span class="lf-meta">${escapeHtml(lastExecEsc.data || "")} · ${escapeHtml(lastExecEsc.evento || "Culto")}</span></h3>
           <div class="formation">${lastFormLines
             .map(
               (l) =>
                 `<div class="f-line"><div class="f-func">${escapeHtml(l.funcao)}</div><div class="f-people">${escapeHtml(l.pessoas)}</div></div>`
             )
             .join("")}</div>
         </div>`
      : `<div class="last-formation"><h3>Última formação da banda</h3><div class="no-formation">Sem escala registrada para as execuções${STATE.year ? " de " + STATE.year : ""}.</div></div>`;

    $("#modalContent").innerHTML = `
      <h2 id="modalTitle">${title}</h2>
      <p class="modal-sub">Estatísticas ${STATE.year ? "de " + STATE.year : "de todo o histórico"}</p>
      ${tomLine}
      <div class="kpi-row">
        <div class="kpi"><div class="k-label">Vezes cantada</div><div class="k-value">${st.count}</div></div>
        <div class="kpi"><div class="k-label">Última vez</div><div class="k-value">${escapeHtml(st.lastRaw || "—")}</div></div>
        <div class="kpi"><div class="k-label">1ª vez</div><div class="k-value">${escapeHtml(execs.length ? execs[execs.length - 1].data || "—" : "—")}</div></div>
      </div>
      ${lastFormationHtml}
      <h3 class="exec-title">Execuções (culto e equipe escalada)</h3>
      ${execHtml}
    `;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    $("#modal").hidden = true;
    document.body.style.overflow = "";
  }

  // ----- Snapshot -----
  async function downloadSnapshot() {
    const payload = {
      cantadas: STATE.cantadas,
      musicas: STATE.musicas,
      escala: [{ colunas: [], linhas: STATE.escalaRows }],
      generatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "data.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ----- Init -----
  function setStatus(msg, kind) {
    const el = $("#status");
    el.className = "status" + (kind ? " " + kind : "");
    el.textContent = msg || "";
  }

  function setBadge() {
    const b = $("#sourceBadge");
    if (STATE.source === "live") {
      b.textContent = "● Ao vivo (Supabase)";
      b.className = "source-badge live";
    } else {
      b.textContent = "● Snapshot local";
      b.className = "source-badge snap";
    }
  }

  async function init() {
    $("#searchInput").addEventListener("input", (e) => { STATE.search = e.target.value; render(); });
    $("#yearSelect").addEventListener("change", (e) => { STATE.year = e.target.value ? parseInt(e.target.value, 10) : ""; render(); });
    $("#sortSelect").addEventListener("change", (e) => { STATE.sort = e.target.value; render(); });
    $("#snapshotBtn").addEventListener("click", downloadSnapshot);
    $("#modalClose").addEventListener("click", closeModal);
    $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    setStatus("Carregando dados do Supabase…", "loading");
    let raw;
    try {
      if (CFG.USE_LIVE) {
        raw = await loadLive();
        STATE.source = "live";
      } else {
        raw = await loadSnapshot();
        STATE.source = "snapshot";
      }
    } catch (err) {
      console.warn("Falha ao carregar ao vivo, tentando snapshot:", err);
      try {
        raw = await loadSnapshot();
        STATE.source = "snapshot";
      } catch (err2) {
        setStatus("Não foi possível carregar os dados (Supabase e snapshot local indisponíveis). Verifique a conexão e o config.js.", "error");
        return;
      }
    }

    buildModel(raw);
    setBadge();
    setStatus("");
    renderYears();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
