# Histórico de Músicas (IBNM · projeto `mmibnm`)

Página web simples (HTML/CSS/JS puro, **sem build**) que lê o histórico de músicas
do Supabase e mostra:

- **Busca por nome** da música ou do autor/banda.
- **Filtro por ano** (as estatísticas passam a considerar só aquele ano).
- **Autor/banda ao lado da música**, no formato `TÍTULO — Autor` (ex.: `ACLAME AO SENHOR — Diante do Trono`).
- Botão **📊 Estatísticas** em cada música, com:
  - quantas vezes foi cantada,
  - a última data,
  - e, **para cada execução**, o culto (evento) e as **pessoas escaladas com suas funções**
    (Vocal, Instrumentos, Direção do Culto, Devocional, Equipe de Som) vindas da `escala`.

A contagem vem do **histórico** (`musicas_cantadas`); a `escala` só identifica a
formação prevista. Se não houver escala para aquela data, a execução **continua
contando** — aparece "Sem escala correspondente para esta data".

## Como funciona

Lê direto da API REST do Supabase (anon key, só leitura via RLS):

- `musicas_cantadas` → histórico (cada linha = uma música cantada num culto)
- `musicas` → catálogo (usado para enriquecer o autor quando o histórico não traz)
- `escala` → grade de escalas (formação por culto)

Falhando o Supabase, cai automaticamente para um `data.json` local (snapshot).
O botão **📥 Snapshot** baixa esse arquivo a partir dos dados atuais.

## Configuração

Edite `config.js` (a anon key é pública por design e só permite leitura):

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://whtbzermbyuxicswyvsy.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
  USE_LIVE: true   // false = usa só o data.json local
};
```

## Rodar本地 (local)

Precisa de um servidor (não abra via `file://` porque o `fetch` é bloqueado):

```bash
python3 -m http.server 8080
# abra http://localhost:8080
```

ou

```bash
npx serve .
```

## Deploy (estático)

É um site estático — funciona em GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.
No GitHub Pages: envie estes arquivos e ative Pages na branch.

---

## Baixar o ZIP e commitar no GitHub via Termux

No celular, no **Termux**, depois de baixar o `historico-musicas.zip` (pelo navegador,
do link do preview):

```bash
# 1) instalar o necessário
pkg update -y && pkg install -y unzip git

# 2) preparar pasta e descompactar
cd ~
mkdir -p appmmibnm && cd appmmibnm
# coloque o historico-musicas.zip dentro desta pasta (via download do navegador do Termux)
unzip -o historico-musicas.zip

# 3) commitar e enviar para o GitHub
git init
git remote add origin https://github.com/adaiascearataiana-gif/appmmibnm.git
git checkout -b main 2>/dev/null || git checkout main
git add -A
git commit -m "Adiciona histórico de músicas: busca, filtro por ano e estatísticas"
git push -u origin main
```

Se o repositório já existir no seu GitHub, basta o `git clone` no lugar do `git init`:

```bash
cd ~
git clone https://github.com/adaiascearataiana-gif/appmmibnm.git
cd appmmibnm
unzip -o ../historico-musicas.zip
git add -A
git commit -m "Adiciona histórico de músicas: busca, filtro por ano e estatísticas"
git push
```

## Gerar snapshot offline (opcional)

```bash
node scripts/fetch-snapshot.js   # cria data.json a partir do Supabase
```
