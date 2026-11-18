// Vraies suggestions de recherche Google et YouTube pour un mot-clé.
// Appel : /api/suggest?q=photographie
const QUESTION_PREFIXES = [
  ["comment", ["comment"]],
  ["pourquoi", ["pourquoi"]],
  ["quel", ["quel", "quelle"]],
  ["combien", ["combien"]],
  ["quand", ["quand"]],
  ["où", ["où"]],
  ["qui", ["qui"]],
  ["est-ce que", ["est-ce que", "est ce que"]],
  ["peut-on", ["peut-on", "peut on"]],
];
const PREPOSITIONS = ["pour", "sans", "avec", "à", "en", "près de"];
const COMPARISONS = ["ou", "vs", "et"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

async function suggest(query, source) {
  const ds = source === "youtube" ? "&ds=yt" : "";
  const url = "https://suggestqueries.google.com/complete/search?client=firefox&hl=fr&gl=fr&ie=UTF-8&oe=UTF-8" + ds + "&q=" + encodeURIComponent(query);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "fr-FR,fr;q=0.9" } });
    if (!r.ok) return [];
    const buf = await r.arrayBuffer();
    const type = (r.headers.get("content-type") || "").toLowerCase();
    const enc = type.includes("iso-8859-1") || type.includes("latin1") ? "latin1" : "utf-8";
    const data = JSON.parse(new TextDecoder(enc).decode(buf));
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1].filter((s) => typeof s === "string") : [];
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function runAll(tasks, limit) {
  const out = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const k = i++;
      out[k] = await tasks[k]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

const clean = (list, exclude) => {
  const seen = new Set();
  return list.filter((s) => {
    const k = s.trim().toLowerCase();
    if (!k || k === exclude || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || "").trim().toLowerCase().slice(0, 60);
  if (!q) { res.status(400).json({ error: "Mot-clé manquant" }); return; }

  const jobs = [];
  const add = (query, source) => { const idx = jobs.length; jobs.push(() => suggest(query, source)); return idx; };

  const base = add(q, "google");
  const qIdx = QUESTION_PREFIXES.map(([, prefixes]) => prefixes.map((p) => add(p + " " + q, "google")));
  const pIdx = PREPOSITIONS.map((p) => add(q + " " + p, "google"));
  const cIdx = COMPARISONS.map((c) => add(q + " " + c, "google"));
  const aIdx = LETTERS.map((l) => add(q + " " + l, "google"));
  const yIdx = [add(q, "youtube"), add("comment " + q, "youtube"), add(q + " pour", "youtube")];

  const results = await runAll(jobs, 8);

  const payload = {
    keyword: q,
    base: clean(results[base], q),
    questions: QUESTION_PREFIXES.map(([mot], i) => ({ mot, items: clean(qIdx[i].flatMap((k) => results[k]), q) })),
    prepositions: clean(pIdx.flatMap((k) => results[k]), q),
    comparisons: clean(cIdx.flatMap((k) => results[k]), q),
    alphabet: LETTERS.map((l, i) => ({ letter: l, items: clean(results[aIdx[i]], q) })),
    youtube: clean(yIdx.flatMap((k) => results[k]), q),
  };
  payload.total = payload.base.length + payload.questions.reduce((a, g) => a + g.items.length, 0) +
    payload.prepositions.length + payload.comparisons.length + payload.alphabet.reduce((a, g) => a + g.items.length, 0);

  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  res.status(200).json(payload);
};
