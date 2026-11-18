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

const FICHE = "https://www.moncompteformation.gouv.fr/espace-prive/html/#/formation/recherche/";

function toItem(f) {
  const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const item = {
    titre: pick(f, [/^intitule_formation$/]),
    organisme: pick(f, [/^nom_of$/]),
    certification: pick(f, [/^intitule_certification$/]),
    ville: pick(f, [/^nom_departement$/, /^nom_region$/]),
    prix: num(pick(f, [/^frais_ttc_tot_mean$/])),
    heures: num(pick(f, [/^nombre_heures_total_mean$/])),
    distance: (num(pick(f, [/^nb_session_a_distance$/])) || 0) > 0,
    lien: null,
  };
  // Lien vers la fiche : SIRET + identifiant de formation (le catalogue ne fournit pas l'identifiant d'action,
  // on reprend celui de la formation, comme dans les liens publiés par de nombreux organismes)
  const siret = pick(f, [/^siret$/]);
  const idf = pick(f, [/^numero_formation$/]);
  if (siret && idf) {
    const s = String(siret).replace(/\D/g, "");
    const id = String(idf).startsWith(s + "_") ? String(idf) : s + "_" + idf;
    item.lien = FICHE + id + "/" + id;
  }
  return item;
}

module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || "").trim().slice(0, 60);
  if (!q) { res.status(400).json({ error: "Mot-clé manquant" }); return; }

  let total = null, records = [], raw = null;

  // API Opendatasoft v2.1 : recherche plein texte sur tous les champs
  const v2 = await getJson(HOST + "/api/explore/v2.1/catalog/datasets/" + DATASET + "/records?limit=100&where=" + encodeURIComponent('"' + q.replace(/"/g, "") + '"'));
  if (v2 && typeof v2.total_count === "number") {
    total = v2.total_count;
    records = (v2.results || []).map(toItem);
    raw = (v2.results || [])[0] || null;
  } else {
    // Repli : ancienne API v1
    const v1 = await getJson(HOST + "/api/records/1.0/search/?dataset=" + DATASET + "&rows=100&q=" + encodeURIComponent(q));
    if (v1 && typeof v1.nhits === "number") {
      total = v1.nhits;
      records = (v1.records || []).map((r) => toItem(r.fields));
      raw = ((v1.records || [])[0] || {}).fields || null;
    }
  }

  if (total === null) { res.status(502).json({ error: "Catalogue CPF indisponible" }); return; }

  // Varier les organismes : au plus 2 formations par organisme
  const seen = new Set(), perOrg = {};
  const items = records.filter((r) => {
    if (!r.titre) return false;
    const k = String(r.titre).toLowerCase();
    if (seen.has(k)) return false;
    const org = String(r.organisme || "?").toLowerCase();
    if ((perOrg[org] || 0) >= 2) return false;
    seen.add(k);
    perOrg[org] = (perOrg[org] || 0) + 1;
    return true;
  }).slice(0, 10);
  const organismes = new Set(records.map((r) => String(r.organisme || "").toLowerCase()).filter(Boolean)).size;
    const avg = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };
  const heuresMoyennes = avg(records.map((r) => r.heures).filter((v) => v != null && v > 0));

  res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=604800");
  const out = { keyword: q, total, items, organismes, prixMoyen, heuresMoyennes };
  // Diagnostic : /api/cpf?q=photographie&debug=1 affiche les colonnes du catalogue
  if (req.query && req.query.debug) out.colonnes = raw ? Object.keys(raw) : [];
  res.status(200).json(out);
};
