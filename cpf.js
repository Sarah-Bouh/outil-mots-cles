// Offres de formation du catalogue Mon Compte Formation (open data de la Caisse des Dépôts).
// Appel : /api/cpf?q=photographie
const DATASET = "moncompteformation_catalogueformation";
const HOST = "https://opendata.caissedesdepots.fr";

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pick(obj, patterns) {
  const keys = Object.keys(obj || {});
  for (const p of patterns) {
    const k = keys.find((key) => p.test(key) && obj[key] != null && obj[key] !== "");
    if (k) return obj[k];
  }
  return null;
}

function toItem(f) {
  return {
    titre: pick(f, [/^intitule_formation$/, /intitule.*formation/, /intitule/]),
    organisme: pick(f, [/^nom_of$/, /nom.*of/, /organisme/, /raison_sociale/]),
    certification: pick(f, [/intitule.*certif/, /libelle.*certif/, /certif/]),
    ville: pick(f, [/ville/, /commune/, /nom_departement/, /departement/]),
  };
}

module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || "").trim().slice(0, 60);
  if (!q) { res.status(400).json({ error: "Mot-clé manquant" }); return; }

  let total = null, records = [];

  // API Opendatasoft v2.1 : recherche plein texte sur tous les champs
  const v2 = await getJson(HOST + "/api/explore/v2.1/catalog/datasets/" + DATASET + "/records?limit=40&where=" + encodeURIComponent('"' + q.replace(/"/g, "") + '"'));
  if (v2 && typeof v2.total_count === "number") {
    total = v2.total_count;
    records = (v2.results || []).map(toItem);
  } else {
    // Repli : ancienne API v1
    const v1 = await getJson(HOST + "/api/records/1.0/search/?dataset=" + DATASET + "&rows=40&q=" + encodeURIComponent(q));
    if (v1 && typeof v1.nhits === "number") {
      total = v1.nhits;
      records = (v1.records || []).map((r) => toItem(r.fields));
    }
  }

  if (total === null) { res.status(502).json({ error: "Catalogue CPF indisponible" }); return; }

  const seen = new Set();
  const items = records.filter((r) => {
    if (!r.titre) return false;
    const k = String(r.titre).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);

  res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=604800");
  res.status(200).json({ keyword: q, total, items });
};
