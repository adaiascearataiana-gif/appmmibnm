#!/usr/bin/env node
/* Gera public/data.json a partir do Supabase (usa a mesma config do config.js).
 * Útil para ter um snapshot offline das tabelas usadas pelo app. */
const fs = require("fs");
const path = require("path");

// Lê SUPABASE_URL e SUPABASE_ANON_KEY do config.js (window.APP_CONFIG)
const cfgText = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
const urlMatch = cfgText.match(/SUPABASE_URL:\s*"([^"]+)"/);
const keyMatch = cfgText.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/);
const SUPABASE_URL = urlMatch && urlMatch[1];
const SUPABASE_ANON_KEY = keyMatch && keyMatch[1];

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Não consegui ler SUPABASE_URL/SUPABASE_ANON_KEY de config.js");
  process.exit(1);
}

async function sbSelect(table, select, limit = 2000) {
  const u = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}`;
  const res = await fetch(u, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const [cantadas, musicas, escala] = await Promise.all([
    sbSelect("musicas_cantadas", "id,data,evento,musica,artista,ordem,cantor"),
    sbSelect("musicas", "id,titulo,artista"),
    sbSelect("escala", "colunas,linhas"),
  ]);
  const out = {
    cantadas: cantadas || [],
    musicas: musicas || [],
    escala: escala || [],
    generatedAt: new Date().toISOString(),
  };
  const file = path.join(__dirname, "..", "data.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Snapshot gravado em ${file}`);
  console.log(`  musicas_cantadas: ${(cantadas || []).length}`);
  console.log(`  musicas: ${(musicas || []).length}`);
  console.log(`  escala docs: ${(escala || []).length}`);
})().catch((e) => {
  console.error("Erro ao gerar snapshot:", e.message);
  process.exit(1);
});
