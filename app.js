/* Trésorerie Repair Café — application locale (lot 1).
 *
 * Règles du projet (ne pas déroger sans décision explicite) :
 *  - montants stockés en centimes (entiers), jamais en flottants ;
 *  - aucune suppression d'écriture : on corrige ou on annule, avec trace dans `historique` ;
 *  - aucune donnée ne quitte l'appareil dans ce lot (la synchronisation arrive au lot 2) ;
 *  - chaque écriture porte `id` et `modifie` : c'est ce qui permettra la fusion au lot 2 ;
 *  - une écriture = un montant, une catégorie, une sous-catégorie. Un ticket à plusieurs achats
 *    devient plusieurs écritures reliées par le même champ `ticket` (pas de sous-lignes) ;
 *  - deux niveaux de catégories au maximum : une sous-catégorie est une catégorie avec `parent`.
 *
 * Le fichier est en deux parties : des fonctions pures (testables avec Node, voir tests.js),
 * puis l'interface, qui ne s'exécute que dans un navigateur.
 */
'use strict';

const VERSION = '1.2.0';
const FORMAT = 'tresorerie-rc';
const SCHEMA = 2; // 1 : catégories simples ; 2 : sous-catégories et tickets ventilés
const JOURS_ALERTE_SAUVEGARDE = 30;

const MODES = [
  { id: 'especes', nom: 'Espèces' },
  { id: 'carte', nom: 'Carte' },
  { id: 'cheque', nom: 'Chèque' },
  { id: 'virement', nom: 'Virement' },
];

const CATEGORIES_DEFAUT = [
  { id: 'd-outillage', nom: 'Outillage', sens: 'depense' },
  { id: 'd-pieces', nom: 'Pièces et consommables', sens: 'depense' },
  { id: 'd-convivialite', nom: 'Convivialité', sens: 'depense' },
  { id: 'd-communication', nom: 'Communication', sens: 'depense' },
  { id: 'd-assurance', nom: 'Assurance', sens: 'depense' },
  { id: 'd-divers', nom: 'Divers', sens: 'depense' },
  { id: 'r-dons', nom: 'Dons', sens: 'recette' },
  { id: 'r-cotisations', nom: 'Cotisations', sens: 'recette' },
  { id: 'r-subventions', nom: 'Subventions', sens: 'recette' },
  { id: 'r-autres', nom: 'Autres', sens: 'recette' },
];

const SOUS_CATEGORIES_DEFAUT = [
  ['d-outillage', ['main', 'Outillage à main'], ['electro', 'Électroportatif'], ['mesure', 'Appareils de mesure'], ['autre', 'Autre']],
  ['d-pieces', ['composants', 'Composants électroniques'], ['visserie', 'Visserie et quincaillerie'], ['colles', 'Colles et adhésifs'],
    ['soudure', 'Soudure'], ['piles', 'Piles et batteries'], ['couture', 'Fournitures de couture'], ['autre', 'Autre']],
  ['d-convivialite', ['boissons', 'Boissons'], ['alimentation', 'Alimentation'], ['vaisselle', 'Vaisselle et fournitures'], ['autre', 'Autre']],
  ['d-communication', ['impressions', 'Impressions'], ['signaletique', 'Signalétique'], ['abonnements', 'Abonnements en ligne'], ['autre', 'Autre']],
  ['d-divers', ['bureau', 'Fournitures de bureau'], ['postal', 'Frais postaux'], ['autre', 'Autre']],
].flatMap(([parent, ...liste]) => liste.map(([cle, nom]) => ({ id: `${parent}-${cle}`, nom, sens: 'depense', parent })));

/* Icônes des catégories : un repère visuel en plus du nom, jamais à sa place.
 * Une catégorie peut porter son propre champ `icone` (choisi dans les réglages) ; '' = aucune. */
const ICONES_DEFAUT = {
  'd-outillage': '🔧', 'd-pieces': '🔩', 'd-convivialite': '☕', 'd-communication': '📣', 'd-assurance': '🛡️', 'd-divers': '📦',
  'r-dons': '💝', 'r-cotisations': '👥', 'r-subventions': '🏛️', 'r-autres': '💶',
};
const ICONES_CHOIX = [
  ['', 'Aucune'], ['🔧', 'Clé'], ['🔩', 'Vis'], ['🪛', 'Tournevis'], ['🔌', 'Prise électrique'], ['💡', 'Ampoule'], ['🔋', 'Pile'],
  ['🧵', 'Fil à coudre'], ['🚲', 'Vélo'], ['💻', 'Ordinateur'], ['📱', 'Téléphone'], ['☕', 'Café'], ['🍰', 'Gâteau'],
  ['📣', 'Mégaphone'], ['🖨️', 'Imprimante'], ['🛡️', 'Bouclier'], ['📦', 'Carton'], ['✉️', 'Enveloppe'], ['🚗', 'Voiture'],
  ['🏠', 'Maison'], ['💝', 'Cadeau'], ['👥', 'Personnes'], ['🏛️', 'Institution'], ['💶', 'Billet'], ['🎟️', 'Ticket'], ['⭐', 'Étoile'],
];

/** Icône d'une catégorie : celle choisie, sinon celle d'origine, sinon aucune. */
function iconeCategorie(c) {
  return c ? (c.icone ?? ICONES_DEFAUT[c.id] ?? '') : '';
}

/** "2026-11" -> "novembre 2026" */
function moisFR(cle) {
  const [a, m] = cle.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/** Solde d'une liste d'écritures (recettes moins dépenses, annulées exclues). */
function solde(ecritures) {
  return ecritures.reduce((s, e) => s + (e.annulee ? 0 : (e.sens === 'recette' ? e.montant : -e.montant)), 0);
}

/* =====================================================================
 * 1. FONCTIONS PURES
 * ===================================================================== */

/** "12,50" -> 1250. Renvoie null si la saisie n'est pas un montant positif valide. */
function lireMontant(texte) {
  const t = String(texte ?? '').replace(/[\s  €]/g, '');
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const centimes = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return centimes > 0 ? centimes : null;
}

/** 1250 -> "12,50" (pour un champ de saisie ou un CSV). */
function montantSaisie(centimes) {
  const signe = centimes < 0 ? '-' : '';
  const abs = Math.abs(centimes);
  return `${signe}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

const formatEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
/** 1250 -> "12,50 €" */
function euros(centimes) {
  return formatEuro.format(centimes / 100);
}

/** Date locale au format AAAA-MM-JJ (pas d'UTC : une saisie à 23 h 30 reste datée du jour). */
function dateISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateValide(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) return false;
  const [a, m, j] = s.split('-').map(Number);
  const d = new Date(a, m - 1, j);
  return d.getFullYear() === a && d.getMonth() === m - 1 && d.getDate() === j;
}

/** "2026-11-13" -> "13 nov. 2026" */
function dateFR(s) {
  if (!dateValide(s)) return s || '';
  const [a, m, j] = s.split('-').map(Number);
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Bornes d'une période prédéfinie. Une borne vide signifie « ouverte ». */
function bornesPeriode(choix, aujourdhui, exercices) {
  const [a, m] = aujourdhui.split('-').map(Number);
  if (choix === 'mois') {
    const dernier = new Date(a, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    return { debut: `${a}-${mm}-01`, fin: `${a}-${mm}-${String(dernier).padStart(2, '0')}` };
  }
  if (choix === 'annee') return { debut: `${a}-01-01`, fin: `${a}-12-31` };
  if (choix.startsWith('exercice:')) {
    const ex = exercices.find((e) => e.id === choix.slice(9));
    if (ex) return { debut: ex.debut, fin: ex.fin || '' };
  }
  return { debut: '', fin: '' };
}

function dansPeriode(date, debut, fin) {
  return (!debut || date >= debut) && (!fin || date <= fin);
}

/** Exercice qui contient la date donnée (le plus récent si plusieurs se chevauchent). */
function exerciceCourant(exercices, aujourdhui) {
  return exercices
    .filter((e) => dansPeriode(aujourdhui, e.debut, e.fin))
    .sort((x, y) => y.debut.localeCompare(x.debut))[0] ?? null;
}

/** Plus récentes d'abord ; à date égale, la dernière saisie d'abord ;
 *  les achats d'un même ticket restent dans leur ordre de saisie (`rang`). */
function trier(ecritures) {
  return [...ecritures].sort((x, y) => y.date.localeCompare(x.date) || y.cree.localeCompare(x.cree)
    || (x.rang ?? 0) - (y.rang ?? 0));
}

/* ---------- Catégories à deux niveaux ---------- */

/** Catégories de premier niveau d'un sens donné. */
function principales(categories, sens) {
  return categories.filter((c) => !c.parent && c.sens === sens);
}

/** Sous-catégories d'une catégorie (toutes, ou seulement les non archivées). */
function sousCategories(categories, parentId, activesSeulement = false) {
  return categories.filter((c) => c.parent === parentId && !(activesSeulement && c.archivee));
}

/** Nombre d'écritures qui utilisent une catégorie ou une sous-catégorie. */
function utilisations(id, ecritures) {
  return ecritures.filter((e) => e.categorie === id || e.sousCategorie === id).length;
}

/** Passage d'un ancien schéma au schéma courant : ajoute les sous-catégories de départ
 *  aux catégories d'origine encore présentes, sans toucher à ce que l'utilisateur a créé. */
function migrerCategories(categories, schema) {
  if (schema >= 2) return categories;
  const ids = new Set(categories.map((c) => c.id));
  const ajouts = SOUS_CATEGORIES_DEFAUT.filter((s) => ids.has(s.parent) && !ids.has(s.id)).map((s) => ({ ...s }));
  return [...categories, ...ajouts];
}

/** Totaux d'une période. Les écritures annulées sont comptées à part et exclues des sommes.
 *  `parSous[sens][catégorie][sous-catégorie]` : la clé '' regroupe les écritures sans sous-catégorie. */
function calculerEtat(ecritures, debut, fin) {
  const etat = {
    recettes: 0, depenses: 0, resultat: 0, nombre: 0, annulees: 0,
    parCategorie: { recette: {}, depense: {} },
    parSous: { recette: {}, depense: {} },
    parMode: { recette: {}, depense: {} },
  };
  for (const e of ecritures) {
    if (!dansPeriode(e.date, debut, fin)) continue;
    if (e.annulee) { etat.annulees += 1; continue; }
    etat.nombre += 1;
    if (e.sens === 'recette') etat.recettes += e.montant; else etat.depenses += e.montant;
    const c = etat.parCategorie[e.sens];
    c[e.categorie] = (c[e.categorie] ?? 0) + e.montant;
    const s = (etat.parSous[e.sens][e.categorie] ??= {});
    const cle = e.sousCategorie ?? '';
    s[cle] = (s[cle] ?? 0) + e.montant;
    const md = etat.parMode[e.sens];
    md[e.mode] = (md[e.mode] ?? 0) + e.montant;
  }
  etat.resultat = etat.recettes - etat.depenses;
  return etat;
}

/* ---------- Ticket à plusieurs achats ---------- */

/** Ce qu'il reste à répartir : positif s'il manque des lignes, négatif si les lignes dépassent le total. */
function resteARepartir(total, montants) {
  return total - montants.reduce((somme, m) => somme + (m ?? 0), 0);
}

/** Transforme un ticket en écritures de dépense reliées par le même identifiant `ticket`. */
function construireTicket({ date, mode, piece, lignes }, creerId, maintenant = new Date().toISOString()) {
  const ticket = creerId();
  return lignes.map((l, i) => ({
    id: creerId(), date, sens: 'depense', montant: l.montant,
    categorie: l.categorie, sousCategorie: l.sousCategorie ?? '',
    libelle: l.libelle ?? '', mode, piece: piece ?? '', ticket, rang: i,
    annulee: false, cree: maintenant, modifie: maintenant, historique: [],
  }));
}

/* ---------- Exports ---------- */

/** Cellule CSV : guillemets doublés, et neutralisation des formules (=, +, -, @) pour les tableurs. */
function celluleCSV(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV pour LibreOffice / Excel en français : séparateur « ; », virgule décimale, BOM UTF-8. */
function versCSV(ecritures, categories) {
  const nomCat = Object.fromEntries(categories.map((c) => [c.id, c.nom]));
  const nomMode = Object.fromEntries(MODES.map((m) => [m.id, m.nom]));
  const lignes = [['Date', 'Type', 'Catégorie', 'Sous-catégorie', 'Libellé', 'Mode de paiement', 'N° de pièce', 'Recette', 'Dépense', 'Statut']
    .map(celluleCSV).join(';')];
  // Ordre chronologique ; les achats d'un même ticket restent dans leur ordre de saisie.
  const chronologique = [...ecritures].sort((x, y) => x.date.localeCompare(y.date) || x.cree.localeCompare(y.cree)
    || (x.rang ?? 0) - (y.rang ?? 0));
  for (const e of chronologique) {
    const [a, m, j] = e.date.split('-');
    lignes.push([
      celluleCSV(`${j}/${m}/${a}`),
      celluleCSV(e.sens === 'recette' ? 'Recette' : 'Dépense'),
      celluleCSV(nomCat[e.categorie] ?? e.categorie),
      celluleCSV(e.sousCategorie ? (nomCat[e.sousCategorie] ?? e.sousCategorie) : ''),
      celluleCSV(e.libelle),
      celluleCSV(nomMode[e.mode] ?? e.mode),
      celluleCSV(e.piece),
      e.sens === 'recette' ? montantSaisie(e.montant) : '',
      e.sens === 'depense' ? montantSaisie(e.montant) : '',
      celluleCSV(e.annulee ? 'Annulée' : 'Valide'),
    ].join(';'));
  }
  return `﻿${lignes.join('\r\n')}\r\n`;
}

function ecritureValide(e) {
  return !!e && typeof e === 'object'
    && typeof e.id === 'string' && e.id.length > 0
    && dateValide(e.date)
    && (e.sens === 'recette' || e.sens === 'depense')
    && Number.isInteger(e.montant) && e.montant > 0
    && typeof e.categorie === 'string'
    && typeof e.modifie === 'string';
}

/** Contenu d'un fichier de sauvegarde. */
function versSauvegarde(donnees, maintenant = new Date().toISOString()) {
  return {
    format: FORMAT, version: SCHEMA, exporteLe: maintenant,
    ecritures: donnees.ecritures, categories: donnees.categories, exercices: donnees.exercices,
  };
}

/** Fusion sans doublon : même `id` -> on garde la version modifiée le plus récemment
 *  (écritures comme catégories : un renommage ou un archivage survit à une restauration
 *  sur un téléphone neuf). Ne détruit jamais une donnée locale absente du fichier ;
 *  en contrepartie, une catégorie supprimée ici mais présente dans le fichier revient. */
function fusionner(local, importe) {
  if (!importe || importe.format !== FORMAT || !Array.isArray(importe.ecritures)) {
    throw new Error('Ce fichier n\'est pas une sauvegarde de cette application.');
  }
  const bilan = { ajoutees: 0, misesAJour: 0, ignorees: 0 };
  const parId = new Map(local.ecritures.map((e) => [e.id, e]));
  for (const e of importe.ecritures) {
    if (!ecritureValide(e)) { bilan.ignorees += 1; continue; }
    const actuelle = parId.get(e.id);
    if (!actuelle) { parId.set(e.id, e); bilan.ajoutees += 1; }
    else if (e.modifie > actuelle.modifie) { parId.set(e.id, e); bilan.misesAJour += 1; }
  }
  const completer = (liste, ajouts, ok) => {
    const ids = new Set(liste.map((x) => x.id));
    return [...liste, ...(Array.isArray(ajouts) ? ajouts : []).filter((x) => ok(x) && !ids.has(x.id))];
  };
  const catOK = (c) => c && typeof c.id === 'string' && typeof c.nom === 'string'
    && (c.sens === 'recette' || c.sens === 'depense') && (c.parent == null || typeof c.parent === 'string');
  const exOK = (x) => x && typeof x.id === 'string' && typeof x.nom === 'string' && dateValide(x.debut) && (!x.fin || dateValide(x.fin));
  return {
    donnees: {
      ecritures: [...parId.values()],
      categories: completer(
        local.categories.map((c) => {
          const autre = (Array.isArray(importe.categories) ? importe.categories : []).find((x) => catOK(x) && x.id === c.id);
          return autre && (autre.modifie ?? '') > (c.modifie ?? '') ? autre : c;
        }),
        importe.categories, catOK,
      ),
      exercices: completer(local.exercices, importe.exercices, exOK),
    },
    bilan,
  };
}

/** Champs « métier » d'une écriture, pour comparer avant/après et tracer une correction. */
function champsMetier(e) {
  return {
    date: e.date, sens: e.sens, montant: e.montant, categorie: e.categorie, sousCategorie: e.sousCategorie ?? '',
    libelle: e.libelle ?? '', mode: e.mode, piece: e.piece ?? '',
  };
}

/** Applique une correction en gardant l'ancienne version dans l'historique. Renvoie null si rien n'a changé. */
function corriger(e, nouveaux, maintenant = new Date().toISOString()) {
  const avant = champsMetier(e);
  const apres = { ...avant, ...nouveaux };
  if (JSON.stringify(avant) === JSON.stringify(apres)) return null;
  return { ...e, ...apres, modifie: maintenant, historique: [...(e.historique ?? []), { le: maintenant, action: 'correction', avant }] };
}

/** Annule ou rétablit une écriture, avec trace. */
function basculerAnnulation(e, maintenant = new Date().toISOString()) {
  const action = e.annulee ? 'retablissement' : 'annulation';
  return { ...e, annulee: !e.annulee, modifie: maintenant, historique: [...(e.historique ?? []), { le: maintenant, action }] };
}

if (typeof module !== 'undefined') {
  module.exports = {
    lireMontant, montantSaisie, euros, dateISO, dateValide, dateFR, bornesPeriode, dansPeriode,
    exerciceCourant, trier, principales, sousCategories, utilisations, migrerCategories, calculerEtat,
    resteARepartir, construireTicket, celluleCSV, versCSV, versSauvegarde, fusionner,
    corriger, basculerAnnulation, iconeCategorie, moisFR, solde,
    CATEGORIES_DEFAUT, SOUS_CATEGORIES_DEFAUT, ICONES_DEFAUT, ICONES_CHOIX, MODES, SCHEMA,
  };
}

/* =====================================================================
 * 2. INTERFACE (navigateur uniquement)
 * ===================================================================== */
if (typeof document !== 'undefined') {
  const $ = (sel) => document.querySelector(sel);

  /** Petit constructeur d'éléments : jamais d'innerHTML avec du texte saisi. */
  function h(balise, attributs = {}, ...enfants) {
    const el = document.createElement(balise);
    for (const [cle, val] of Object.entries(attributs)) {
      if (val === false || val == null) continue;
      if (cle === 'class') el.className = val;
      else if (cle.startsWith('on')) el.addEventListener(cle.slice(2), val);
      else if (val === true) el.setAttribute(cle, '');
      else el.setAttribute(cle, val);
    }
    for (const enfant of enfants.flat()) {
      if (enfant != null && enfant !== false) el.append(enfant);
    }
    return el;
  }

  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

  /* ---------- Stockage IndexedDB ---------- */
  let db;
  const demande = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });

  function ouvrirBase() {
    return new Promise((ok, ko) => {
      const r = indexedDB.open('tresorerie-rc', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('ecritures', { keyPath: 'id' });
        r.result.createObjectStore('reglages');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  }
  const lireTout = (magasin) => demande(db.transaction(magasin).objectStore(magasin).getAll());
  const lireReglage = (cle) => demande(db.transaction('reglages').objectStore('reglages').get(cle));
  const ecrireReglage = (cle, val) => demande(db.transaction('reglages', 'readwrite').objectStore('reglages').put(val, cle));
  /** Une seule transaction : un ticket de plusieurs lignes est enregistré en entier ou pas du tout. */
  function ecrireEcritures(liste) {
    return new Promise((ok, ko) => {
      const t = db.transaction('ecritures', 'readwrite');
      for (const e of liste) t.objectStore('ecritures').put(e);
      t.oncomplete = () => ok();
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
    });
  }

  /* ---------- État en mémoire ---------- */
  const etat = { ecritures: [], categories: [], exercices: [], prefs: {} };
  let vueActive = 'saisie';
  let enEdition = null;
  let periodeEcritures; let periodeEtat;
  const categoriesOuvertes = new Set(); // panneaux dépliés dans les réglages

  const nouvelId = () => (crypto.randomUUID ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const categorie = (id) => etat.categories.find((c) => c.id === id);
  const nomCategorie = (id) => categorie(id)?.nom ?? 'Catégorie inconnue';
  const nomMode = (id) => MODES.find((m) => m.id === id)?.nom ?? id;
  const nomComplet = (e) => nomCategorie(e.categorie) + (e.sousCategorie ? ` › ${nomCategorie(e.sousCategorie)}` : '');
  const lignesDuTicket = (ticket) => etat.ecritures.filter((e) => e.ticket === ticket);
  const totalTicket = (ticket) => lignesDuTicket(ticket).reduce((s, e) => s + (e.annulee ? 0 : e.montant), 0);

  let minuterieAnnonce;
  /** Message de confirmation, lu par les lecteurs d'écran. `action` ajoute un bouton, par exemple « Corriger ». */
  function annoncer(message, action = null) {
    const zone = $('#annonce');
    const bouton = $('#annonce-action');
    zone.textContent = '';
    clearTimeout(minuterieAnnonce);
    $('#bandeau').hidden = false;
    bouton.hidden = !action;
    if (action) {
      bouton.textContent = action.libelle;
      bouton.onclick = () => { $('#bandeau').hidden = true; action.faire(); };
    }
    // Léger délai : laisse le lecteur d'écran détecter le changement de contenu.
    setTimeout(() => { zone.textContent = message; }, 50);
    // Avec un bouton, on laisse plus de temps pour le lire et l'atteindre.
    minuterieAnnonce = setTimeout(() => { zone.textContent = ''; $('#bandeau').hidden = true; }, action ? 10000 : 6000);
  }

  const marqueIcone = (c) => { const i = iconeCategorie(c); return i && h('span', { class: 'icone', 'aria-hidden': 'true' }, i); };

  function erreur(idChamp, idErreur, message) {
    const p = $(idErreur);
    p.textContent = message ?? '';
    p.hidden = !message;
    if (idChamp) {
      if (message) $(idChamp).setAttribute('aria-invalid', 'true'); else $(idChamp).removeAttribute('aria-invalid');
    }
  }

  function remplirModes(select, valeur) {
    select.replaceChildren(...MODES.map((m) => h('option', { value: m.id }, m.nom)));
    select.value = valeur;
  }

  function modeParDefaut(sens) {
    return etat.prefs.dernierMode?.[sens] ?? (sens === 'recette' ? 'especes' : 'carte');
  }

  /** Remplit une liste déroulante de sous-catégories. Renvoie true si un choix est obligatoire. */
  function remplirSelectSous(select, bloc, idCategorie, valeur) {
    const proposees = sousCategories(etat.categories, idCategorie).filter((c) => !c.archivee || c.id === valeur);
    bloc.hidden = !proposees.length;
    select.replaceChildren(h('option', { value: '' }, 'Choisir…'),
      ...proposees.map((c) => h('option', { value: c.id }, c.nom + (c.archivee ? ' (archivée)' : ''))));
    select.value = valeur || '';
    if (select.selectedIndex < 0) select.value = '';
    return sousCategories(etat.categories, idCategorie, true).length > 0;
  }

  /* ---------- Sélecteur de période (réutilisé par Écritures et État) ---------- */
  function monterPeriode(conteneur, prefixe, surChangement) {
    const choix = h('select', { id: `${prefixe}-choix` });
    const debut = h('input', { id: `${prefixe}-debut`, type: 'date' });
    const fin = h('input', { id: `${prefixe}-fin`, type: 'date' });

    function remplirChoix(valeur) {
      choix.replaceChildren(
        ...etat.exercices.map((e) => h('option', { value: `exercice:${e.id}` }, e.nom)),
        h('option', { value: 'mois' }, 'Mois en cours'),
        h('option', { value: 'annee' }, 'Année civile en cours'),
        h('option', { value: 'tout' }, 'Tout'),
        h('option', { value: 'perso' }, 'Dates au choix'),
      );
      choix.value = valeur;
      if (choix.selectedIndex < 0) choix.value = 'annee';
    }
    function appliquerChoix() {
      if (choix.value === 'perso') return;
      const b = bornesPeriode(choix.value, dateISO(), etat.exercices);
      debut.value = b.debut;
      fin.value = b.fin;
    }
    choix.addEventListener('change', () => { appliquerChoix(); surChangement(); });
    for (const champ of [debut, fin]) {
      champ.addEventListener('change', () => { choix.value = 'perso'; surChangement(); });
    }

    conteneur.append(
      h('div', { class: 'champ' }, h('label', { for: choix.id }, 'Période'), choix),
      h('div', { class: 'ligne-champs' },
        h('div', { class: 'champ' }, h('label', { for: debut.id }, 'Du'), debut),
        h('div', { class: 'champ' }, h('label', { for: fin.id }, 'Au'), fin)),
    );

    const courant = exerciceCourant(etat.exercices, dateISO());
    remplirChoix(courant ? `exercice:${courant.id}` : 'annee');
    appliquerChoix();

    return {
      bornes: () => ({ debut: debut.value, fin: fin.value }),
      // Après ajout ou suppression d'un exercice : on reconstruit la liste sans perdre le choix.
      rafraichir() { remplirChoix(choix.value); appliquerChoix(); },
      choisir(valeur) { remplirChoix(valeur); appliquerChoix(); },
      texte() {
        const { debut: d, fin: f } = this.bornes();
        if (d && f) return `Du ${dateFR(d)} au ${dateFR(f)}`;
        if (d) return `Depuis le ${dateFR(d)}`;
        if (f) return `Jusqu'au ${dateFR(f)}`;
        return 'Toutes les écritures';
      },
    };
  }

  /* ---------- Rendu d'une écriture dans une liste ---------- */
  function ligneEcriture(e) {
    const signe = e.sens === 'recette' ? '+' : '−';
    const details = [
      dateFR(e.date), e.libelle, nomMode(e.mode), e.piece && `pièce ${e.piece}`,
      e.ticket && `ticket de ${euros(totalTicket(e.ticket))}`,
    ].filter(Boolean).join(' · ');
    const lecture = [
      `${e.sens === 'recette' ? 'Recette' : 'Dépense'} de ${euros(e.montant)}`,
      nomComplet(e).replace(' › ', ', '), details, e.annulee && 'annulée', 'Ouvrir pour corriger',
    ].filter(Boolean).join(', ');
    return h('li', { class: e.annulee ? 'annulee' : '' },
      h('button', { type: 'button', 'aria-label': lecture, onclick: () => ouvrirEdition(e.id) },
        h('span', { class: `pastille-icone ${e.sens}`, 'aria-hidden': 'true' },
          iconeCategorie(categorie(e.categorie)) || nomCategorie(e.categorie).charAt(0).toUpperCase()),
        h('span', { class: 'ligne1' }, nomComplet(e), e.annulee && h('span', { class: 'etiquette' }, 'Annulée')),
        h('span', { class: `somme ${e.sens}` }, `${signe} ${euros(e.montant)}`),
        h('span', { class: 'ligne2' }, details)));
  }

  function remplirListe(ul, ecritures, messageVide) {
    ul.replaceChildren(...(ecritures.length
      ? ecritures.map(ligneEcriture)
      : [h('li', { class: 'vide' }, messageVide)]));
  }

  /* ---------- Vue Saisie ---------- */
  const sensSaisie = () => document.querySelector('input[name="sens"]:checked').value;

  function rendreChoixSous() {
    const choisie = document.querySelector('input[name="categorie"]:checked');
    const actives = choisie ? sousCategories(etat.categories, choisie.value, true) : [];
    $('#bloc-sous-categorie').hidden = !actives.length;
    $('#choix-sous-categorie').replaceChildren(...actives.map((c) => h('label', {},
      h('input', { type: 'radio', name: 'sous-categorie', value: c.id }), h('span', {}, c.nom))));
    erreur(null, '#err-sous-categorie');
  }

  function rendreChoixCategorie() {
    const sens = sensSaisie();
    const actives = principales(etat.categories, sens).filter((c) => !c.archivee);
    $('#choix-categorie').replaceChildren(...actives.map((c) => h('label', {},
      h('input', { type: 'radio', name: 'categorie', value: c.id }), h('span', {}, marqueIcone(c), c.nom))));
    $('#mode').value = modeParDefaut(sens);
    $('#btn-ticket').hidden = sens !== 'depense';
    $('#btn-enregistrer').textContent = sens === 'recette' ? 'Enregistrer la recette' : 'Enregistrer la dépense';
    erreur(null, '#err-categorie');
    rendreChoixSous();
  }

  /** Période de la synthèse d'accueil : l'exercice en cours s'il est défini, sinon l'année civile. */
  function periodeSynthese() {
    const ex = exerciceCourant(etat.exercices, dateISO());
    return ex ? { choix: `exercice:${ex.id}`, nom: ex.nom, debut: ex.debut, fin: ex.fin || '' }
      : { choix: 'annee', nom: `Année ${dateISO().slice(0, 4)}`, ...bornesPeriode('annee', dateISO(), []) };
  }

  function rendreSynthese() {
    const p = periodeSynthese();
    const r = calculerEtat(etat.ecritures, p.debut, p.fin);
    $('#synthese-periode').textContent = `Résultat — ${p.nom}`;
    $('#synthese-resultat').textContent = (r.resultat > 0 ? '+ ' : '') + euros(r.resultat);
    $('#synthese-recettes').textContent = `Recettes ${euros(r.recettes)}`;
    $('#synthese-depenses').textContent = `Dépenses ${euros(r.depenses)}`;
  }

  function rendreSaisie() {
    rendreSynthese();
    remplirListe($('#liste-dernieres'), trier(etat.ecritures).slice(0, 5), 'Aucune écriture pour le moment. La première apparaîtra ici.');
    rendreAlerteSauvegarde();
  }

  async function memoriserMode(sens, mode) {
    etat.prefs.dernierMode = { ...etat.prefs.dernierMode, [sens]: mode };
    await ecrireReglage('prefs', etat.prefs);
  }

  async function enregistrerSaisie(evenement) {
    evenement.preventDefault();
    const montant = lireMontant($('#montant').value);
    const choisie = document.querySelector('input[name="categorie"]:checked');
    const sousChoisie = document.querySelector('input[name="sous-categorie"]:checked');
    const sousObligatoire = !!choisie && sousCategories(etat.categories, choisie.value, true).length > 0;
    const date = $('#date').value;
    erreur('#montant', '#err-montant', montant ? null : 'Saisissez un montant, par exemple 12,50.');
    erreur(null, '#err-categorie', choisie ? null : 'Choisissez une catégorie.');
    erreur(null, '#err-sous-categorie', sousObligatoire && !sousChoisie ? 'Choisissez une sous-catégorie.' : null);
    if (!montant) { $('#montant').focus(); return; }
    if (!choisie) { document.querySelector('input[name="categorie"]')?.focus(); return; }
    if (sousObligatoire && !sousChoisie) { document.querySelector('input[name="sous-categorie"]')?.focus(); return; }
    if (!dateValide(date)) { document.querySelector('#form-saisie details').open = true; $('#date').focus(); return; }

    const maintenant = new Date().toISOString();
    const sens = sensSaisie();
    const e = {
      id: nouvelId(), date, sens, montant, categorie: choisie.value, sousCategorie: sousChoisie?.value ?? '',
      libelle: $('#libelle').value.trim(), mode: $('#mode').value, piece: $('#piece').value.trim(), ticket: '',
      annulee: false, cree: maintenant, modifie: maintenant, historique: [],
    };
    try {
      await ecrireEcritures([e]);
    } catch (err) {
      annoncer('Échec de l\'enregistrement. L\'écriture n\'a pas été sauvegardée.');
      return;
    }
    etat.ecritures.push(e);
    await memoriserMode(sens, e.mode);
    demanderPersistance();

    // On garde le type et la date : pratique pour saisir plusieurs tickets à la suite.
    $('#montant').value = '';
    $('#libelle').value = '';
    $('#piece').value = '';
    choisie.checked = false;
    rendreChoixSous();
    rendreSaisie();
    annoncer(`${sens === 'recette' ? 'Recette' : 'Dépense'} de ${euros(montant)} enregistrée (${nomComplet(e)}).`,
      { libelle: 'Corriger', faire: () => ouvrirEdition(e.id) });
    $('#montant').focus();
  }

  /* ---------- Ticket à plusieurs achats ---------- */
  let rangLigne = 0;

  const lignesTicket = () => [...document.querySelectorAll('#tk-lignes .ligne-ticket')];

  function resteTicket() {
    const total = lireMontant($('#tk-total').value);
    if (!total) return null;
    return resteARepartir(total, lignesTicket().map((fs) => lireMontant(fs.querySelector('.tk-montant').value)));
  }

  function majResteTicket() {
    const reste = resteTicket();
    $('#tk-reste').textContent = reste === null ? 'Saisissez le total du ticket.'
      : reste === 0 ? '✓ Le compte est bon : tout le ticket est réparti.'
        : reste > 0 ? `Reste à répartir : ${euros(reste)}`
          : `Les lignes dépassent le total de ${euros(-reste)}.`;
  }

  function numeroterLignes() {
    lignesTicket().forEach((fs, i) => {
      fs.querySelector('legend').textContent = `Achat ${i + 1}`;
      fs.querySelector('.tk-retirer').setAttribute('aria-label', `Retirer l'achat ${i + 1}`);
      fs.querySelector('.tk-retirer').hidden = lignesTicket().length <= 1;
    });
  }

  function ajouterLigneTicket(montantInitial = '') {
    rangLigne += 1;
    const n = rangLigne;
    const montant = h('input', { id: `tk-m-${n}`, class: 'tk-montant', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: montantInitial });
    const cat = h('select', { id: `tk-c-${n}`, class: 'tk-cat' }, h('option', { value: '' }, 'Choisir…'),
      ...principales(etat.categories, 'depense').filter((c) => !c.archivee).map((c) => h('option', { value: c.id }, c.nom)));
    const sous = h('select', { id: `tk-s-${n}`, class: 'tk-sous' });
    const blocSous = h('div', { class: 'champ', hidden: true }, h('label', { for: sous.id }, 'Sous-catégorie'), sous);
    const libelle = h('input', { id: `tk-l-${n}`, class: 'tk-libelle', type: 'text', maxlength: 120, autocomplete: 'off' });
    cat.addEventListener('change', () => { cat.removeAttribute('aria-invalid'); remplirSelectSous(sous, blocSous, cat.value, ''); });
    sous.addEventListener('change', () => sous.removeAttribute('aria-invalid'));
    montant.addEventListener('input', () => { montant.removeAttribute('aria-invalid'); majResteTicket(); });
    const fs = h('fieldset', { class: 'ligne-ticket' },
      h('legend', {}),
      h('div', { class: 'champ' }, h('label', { for: montant.id }, 'Montant en euros'),
        h('div', { class: 'champ-montant' }, montant, h('span', { 'aria-hidden': 'true' }, '€'))),
      h('div', { class: 'champ' }, h('label', { for: cat.id }, 'Catégorie'), cat),
      blocSous,
      h('div', { class: 'champ' }, h('label', { for: libelle.id }, 'Libellé ', h('span', { class: 'facultatif' }, '(facultatif)')), libelle),
      h('button', {
        type: 'button', class: 'bouton petit tk-retirer',
        onclick: () => { fs.remove(); numeroterLignes(); majResteTicket(); $('#tk-ajouter').focus(); },
      }, 'Retirer cet achat'));
    $('#tk-lignes').append(fs);
    numeroterLignes();
    majResteTicket();
    return fs;
  }

  function ouvrirTicket() {
    // On reprend ce qui est déjà saisi dans le formulaire principal.
    const dejaSaisi = lireMontant($('#montant').value);
    $('#tk-total').value = dejaSaisi ? montantSaisie(dejaSaisi) : '';
    $('#tk-date').value = $('#date').value || dateISO();
    remplirModes($('#tk-mode'), $('#mode').value || modeParDefaut('depense'));
    $('#tk-piece').value = $('#piece').value;
    $('#tk-lignes').replaceChildren();
    erreur('#tk-total', '#tk-err-total');
    erreur(null, '#tk-err');
    ajouterLigneTicket();
    ajouterLigneTicket();
    $('#dlg-ticket-saisie').showModal();
    $('#tk-total').focus();
  }

  async function enregistrerTicket(evenement) {
    evenement.preventDefault();
    const total = lireMontant($('#tk-total').value);
    erreur('#tk-total', '#tk-err-total', total ? null : 'Saisissez le total du ticket, par exemple 23,40.');
    erreur(null, '#tk-err');
    if (!total) { $('#tk-total').focus(); return; }
    if (!dateValide($('#tk-date').value)) { $('#tk-date').focus(); return; }

    const lignes = [];
    let fautif = null; let message = null;
    for (const fs of lignesTicket()) {
      const champMontant = fs.querySelector('.tk-montant');
      const champCat = fs.querySelector('.tk-cat');
      const champSous = fs.querySelector('.tk-sous');
      const montant = lireMontant(champMontant.value);
      const sousObligatoire = !!champCat.value && sousCategories(etat.categories, champCat.value, true).length > 0;
      const nom = fs.querySelector('legend').textContent;
      const signaler = (champ, texte) => {
        champ.setAttribute('aria-invalid', 'true');
        if (!fautif) { fautif = champ; message = `${nom} : ${texte}`; }
      };
      if (!montant) signaler(champMontant, 'saisissez un montant.');
      if (!champCat.value) signaler(champCat, 'choisissez une catégorie.');
      else if (sousObligatoire && !champSous.value) signaler(champSous, 'choisissez une sous-catégorie.');
      lignes.push({ montant, categorie: champCat.value, sousCategorie: champSous.value, libelle: fs.querySelector('.tk-libelle').value.trim() });
    }
    if (!fautif) {
      const reste = resteTicket();
      if (reste > 0) message = `Il reste ${euros(reste)} à répartir. Ajoutez un achat ou corrigez les montants.`;
      else if (reste < 0) message = `Les achats dépassent le total de ${euros(-reste)}. Corrigez les montants ou le total.`;
      if (message) fautif = reste > 0 ? $('#tk-ajouter') : $('#tk-total');
    }
    if (message) { erreur(null, '#tk-err', message); fautif.focus(); return; }

    const mode = $('#tk-mode').value;
    const ecritures = construireTicket({ date: $('#tk-date').value, mode, piece: $('#tk-piece').value.trim(), lignes }, nouvelId);
    try {
      await ecrireEcritures(ecritures);
    } catch (err) {
      erreur(null, '#tk-err', 'Échec de l\'enregistrement. Le ticket n\'a pas été sauvegardé.');
      return;
    }
    etat.ecritures.push(...ecritures);
    await memoriserMode('depense', mode);
    demanderPersistance();
    $('#dlg-ticket-saisie').close();
    $('#montant').value = '';
    $('#piece').value = '';
    rendreVue();
    annoncer(`Ticket de ${euros(total)} enregistré en ${pluriel(ecritures.length, 'écriture')}.`);
    $('#montant').focus();
  }

  /* ---------- Vue Écritures ---------- */
  function rendreFiltreCategorie() {
    const select = $('#filtre-categorie');
    const valeur = select.value;
    select.replaceChildren(h('option', { value: '' }, 'Toutes'),
      ...etat.categories.filter((c) => !c.parent).flatMap((c) => [
        h('option', { value: `c:${c.id}` }, `${c.nom} (${c.sens === 'recette' ? 'recette' : 'dépense'})`),
        ...sousCategories(etat.categories, c.id).map((s) => h('option', { value: `s:${s.id}` }, `  › ${s.nom}`)),
      ]));
    select.value = valeur;
    if (select.selectedIndex < 0) select.value = '';
  }

  function rendreEcritures() {
    const { debut, fin } = periodeEcritures.bornes();
    const sens = $('#filtre-sens').value;
    const [niveau, idFiltre] = $('#filtre-categorie').value.split(/:(.*)/);
    const liste = trier(etat.ecritures).filter((e) => dansPeriode(e.date, debut, fin)
      && (!sens || e.sens === sens)
      && (!idFiltre || (niveau === 'c' ? e.categorie === idFiltre : e.sousCategorie === idFiltre)));
    // Regroupement par mois, avec le solde du mois en regard : la liste se lit comme un relevé.
    const parMois = new Map();
    for (const e of liste) {
      const cle = e.date.slice(0, 7);
      if (!parMois.has(cle)) parMois.set(cle, []);
      parMois.get(cle).push(e);
    }
    $('#liste-ecritures').replaceChildren(...(liste.length ? [...parMois].flatMap(([cle, groupe]) => [
      h('li', { class: 'mois' }, h('span', {}, moisFR(cle)), h('span', {}, `solde ${euros(solde(groupe))}`)),
      ...groupe.map(ligneEcriture),
    ]) : [h('li', { class: 'vide' }, 'Aucune écriture pour ces critères.')]));
    const total = solde(liste);
    $('#resume-ecritures').textContent = `${pluriel(liste.length, 'écriture')} — ${periodeEcritures.texte().toLowerCase()}`
      + (liste.length ? ` — solde\u00a0: ${euros(total)}` : '');
  }

  /* ---------- Vue État ---------- */
  function tableauCategories(titre, sens, r) {
    const sommes = r.parCategorie[sens];
    const total = sens === 'recette' ? r.recettes : r.depenses;
    const part = (somme) => (total ? Math.round((somme / total) * 100) : 0);
    const connues = principales(etat.categories, sens).filter((c) => sommes[c.id]).sort((x, y) => sommes[y.id] - sommes[x.id]);
    // Catégories référencées par des écritures mais absentes de la liste (cas d'un import partiel).
    const inconnues = Object.keys(sommes).filter((id) => !categorie(id) || categorie(id).parent);
    const blocs = [...connues.map((c) => [c.id, [marqueIcone(c), ` ${c.nom}`]]), ...inconnues.map((id) => [id, 'Catégorie inconnue'])];
    if (!blocs.length) return h('p', { class: 'vide' }, `${titre} : aucune écriture sur la période.`);

    const lignes = blocs.flatMap(([id, nom]) => {
      const detail = r.parSous[sens][id] ?? {};
      const cles = Object.keys(detail).filter((k) => k !== '').sort((x, y) => detail[y] - detail[x]);
      const sousLignes = cles.length ? [...cles, ...(detail[''] ? [''] : [])].map((k) => h('tr', { class: 'sous' },
        h('th', { scope: 'row', class: 'sous' }, k ? nomCategorie(k) : 'Non précisé'),
        h('td', { class: 'nombre' }, euros(detail[k])), h('td', { class: 'nombre' }, `${part(detail[k])} %`))) : [];
      return [h('tr', {},
        h('th', { scope: 'row' }, nom, h('div', { class: 'barre', 'aria-hidden': 'true' }, h('span', { style: `width:${part(sommes[id])}%` }))),
        h('td', { class: 'nombre' }, h('strong', {}, euros(sommes[id]))), h('td', { class: 'nombre' }, `${part(sommes[id])} %`)),
      ...sousLignes];
    });
    return h('table', {},
      h('caption', {}, titre),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Catégorie'), h('th', { scope: 'col', class: 'nombre' }, 'Montant'), h('th', { scope: 'col', class: 'nombre' }, 'Part'))),
      h('tbody', {}, lignes),
      h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, 'Total'), h('td', { class: 'nombre' }, euros(total)), h('td', {}))));
  }

  function rendreEtat() {
    const { debut, fin } = periodeEtat.bornes();
    const r = calculerEtat(etat.ecritures, debut, fin);
    const modesUtilises = MODES.filter((m) => r.parMode.recette[m.id] || r.parMode.depense[m.id]);
    const signeResultat = r.resultat > 0 ? 'excédent' : r.resultat < 0 ? 'déficit' : 'équilibre';
    $('#rapport-etat').replaceChildren(
      h('h2', {}, periodeEtat.texte()),
      h('p', { class: 'aide' }, `${pluriel(r.nombre, 'écriture')} prise${r.nombre > 1 ? 's' : ''} en compte`
        + (r.annulees ? `, ${r.annulees} annulée${r.annulees > 1 ? 's' : ''} exclue${r.annulees > 1 ? 's' : ''}` : '')
        + '. Les frais bancaires ne sont pas suivis ici.'),
      h('div', { class: 'totaux' },
        h('div', { class: 'total' }, h('span', {}, 'Recettes'), h('strong', { class: 'somme recette' }, `+ ${euros(r.recettes)}`)),
        h('div', { class: 'total' }, h('span', {}, 'Dépenses'), h('strong', { class: 'somme depense' }, `− ${euros(r.depenses)}`)),
        h('div', { class: 'total resultat' }, h('span', {}, `Résultat (${signeResultat})`), h('strong', {}, euros(r.resultat)))),
      tableauCategories('Recettes par catégorie', 'recette', r),
      tableauCategories('Dépenses par catégorie', 'depense', r),
      modesUtilises.length ? h('table', { class: 'modes' },
        h('caption', {}, 'Par mode de paiement'),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Mode'), h('th', { scope: 'col', class: 'nombre' }, 'Recettes'), h('th', { scope: 'col', class: 'nombre' }, 'Dépenses'))),
        h('tbody', {}, modesUtilises.map((m) => h('tr', {},
          h('th', { scope: 'row' }, m.nom),
          h('td', { class: 'nombre' }, euros(r.parMode.recette[m.id] ?? 0)),
          h('td', { class: 'nombre' }, euros(r.parMode.depense[m.id] ?? 0)))))) : null,
    );
  }

  /* ---------- Fenêtre de correction ---------- */
  function remplirCategoriesEdition(sens, valeur) {
    const select = $('#e-categorie');
    const proposees = principales(etat.categories, sens).filter((c) => !c.archivee || c.id === valeur);
    select.replaceChildren(...proposees.map((c) => h('option', { value: c.id }, c.nom + (c.archivee ? ' (archivée)' : ''))));
    select.value = valeur;
    if (select.selectedIndex < 0) select.selectedIndex = 0;
  }

  const remplirSousEdition = (valeur) => remplirSelectSous($('#e-sous'), $('#e-bloc-sous'), $('#e-categorie').value, valeur);

  const LIBELLES_ACTION = { correction: 'Correction', annulation: 'Annulation', retablissement: 'Rétablissement' };

  function ouvrirEdition(id) {
    const e = etat.ecritures.find((x) => x.id === id);
    if (!e) return;
    enEdition = e;
    document.querySelector(`input[name="e-sens"][value="${e.sens}"]`).checked = true;
    $('#e-montant').value = montantSaisie(e.montant);
    $('#e-date').value = e.date;
    $('#e-libelle').value = e.libelle ?? '';
    $('#e-piece').value = e.piece ?? '';
    remplirModes($('#e-mode'), e.mode);
    remplirCategoriesEdition(e.sens, e.categorie);
    remplirSousEdition(e.sousCategorie ?? '');
    erreur('#e-montant', '#e-err-montant');
    erreur('#e-sous', '#e-err-sous');

    // Une écriture annulée ne se corrige pas : il faut d'abord la rétablir.
    for (const champ of $('#form-edition').querySelectorAll('input, select')) champ.disabled = e.annulee;
    $('#btn-edit-valider').hidden = e.annulee;
    $('#btn-edit-annuler-ecriture').textContent = e.annulee ? 'Rétablir cette écriture' : 'Annuler cette écriture';
    $('#dlg-titre').textContent = e.annulee ? 'Écriture annulée' : 'Corriger l\'écriture';
    $('#dlg-statut').textContent = `Saisie le ${new Date(e.cree).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}.`;

    // Rappel des autres achats du même ticket : une correction ici change le total du ticket.
    const soeurs = e.ticket ? lignesDuTicket(e.ticket).filter((x) => x.id !== e.id) : [];
    $('#dlg-ticket').hidden = !e.ticket;
    if (e.ticket) {
      $('#dlg-ticket-texte').textContent = `Cette écriture fait partie d'un ticket de ${euros(totalTicket(e.ticket))} `
        + `(${pluriel(soeurs.length + 1, 'achat')}). La corriger change le total du ticket. Autres achats :`;
      $('#dlg-ticket-liste').replaceChildren(...soeurs.sort((x, y) => (x.rang ?? 0) - (y.rang ?? 0)).map((x) => h('li', {},
        `${nomComplet(x)} : ${euros(x.montant)}${x.annulee ? ' (annulée)' : ''}`)));
    }

    const historique = e.historique ?? [];
    $('#dlg-historique').hidden = !historique.length;
    $('#dlg-liste-historique').replaceChildren(...historique.map((x) => {
      const quand = new Date(x.le).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
      const avant = x.avant
        ? ` — avant : ${euros(x.avant.montant)}, ${nomComplet(x.avant)}, ${dateFR(x.avant.date)}, ${nomMode(x.avant.mode)}`
          + (x.avant.libelle ? `, « ${x.avant.libelle} »` : '') + (x.avant.piece ? `, pièce ${x.avant.piece}` : '')
        : '';
      return h('li', {}, `${quand} : ${LIBELLES_ACTION[x.action] ?? x.action}${avant}`);
    }));
    $('#dlg-ecriture').showModal();
  }

  async function remplacerEcriture(nouvelle, message) {
    try {
      await ecrireEcritures([nouvelle]);
    } catch (err) {
      annoncer('Échec de l\'enregistrement. Rien n\'a été modifié.');
      return;
    }
    etat.ecritures[etat.ecritures.findIndex((x) => x.id === nouvelle.id)] = nouvelle;
    $('#dlg-ecriture').close();
    rendreVue();
    annoncer(message);
  }

  async function validerEdition(evenement) {
    evenement.preventDefault();
    if (!enEdition || enEdition.annulee) return;
    const montant = lireMontant($('#e-montant').value);
    const idCategorie = $('#e-categorie').value;
    const idSous = $('#e-bloc-sous').hidden ? '' : $('#e-sous').value;
    const sousManquante = sousCategories(etat.categories, idCategorie, true).length > 0 && !idSous;
    erreur('#e-montant', '#e-err-montant', montant ? null : 'Saisissez un montant, par exemple 12,50.');
    erreur('#e-sous', '#e-err-sous', sousManquante ? 'Choisissez une sous-catégorie.' : null);
    if (!montant) { $('#e-montant').focus(); return; }
    if (sousManquante) { $('#e-sous').focus(); return; }
    if (!dateValide($('#e-date').value)) { $('#e-date').focus(); return; }
    const nouvelle = corriger(enEdition, {
      date: $('#e-date').value, sens: document.querySelector('input[name="e-sens"]:checked').value, montant,
      categorie: idCategorie, sousCategorie: idSous, libelle: $('#e-libelle').value.trim(),
      mode: $('#e-mode').value, piece: $('#e-piece').value.trim(),
    });
    if (!nouvelle) { $('#dlg-ecriture').close(); return; }
    await remplacerEcriture(nouvelle, 'Correction enregistrée. L\'ancienne version reste dans l\'historique.');
  }

  async function annulerOuRetablir() {
    if (!enEdition) return;
    const question = enEdition.annulee
      ? 'Rétablir cette écriture ? Elle sera de nouveau comptée dans les totaux.'
      : 'Annuler cette écriture ? Elle restera visible, marquée « Annulée », et ne sera plus comptée dans les totaux.';
    if (!confirm(question)) return;
    const etaitAnnulee = enEdition.annulee;
    await remplacerEcriture(basculerAnnulation(enEdition), etaitAnnulee ? 'Écriture rétablie.' : 'Écriture annulée.');
  }

  /* ---------- Vue Réglages : sauvegarde ---------- */
  function joursDepuisSauvegarde() {
    const d = etat.prefs.derniereSauvegarde;
    return d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
  }

  function texteSauvegarde() {
    const j = joursDepuisSauvegarde();
    if (j === null) return 'Aucune sauvegarde n\'a encore été faite.';
    if (j === 0) return 'Dernière sauvegarde : aujourd\'hui.';
    return `Dernière sauvegarde : il y a ${pluriel(j, 'jour')}.`;
  }

  function rendreAlerteSauvegarde() {
    const j = joursDepuisSauvegarde();
    const aAlerter = etat.ecritures.length > 0 && (j === null || j >= JOURS_ALERTE_SAUVEGARDE);
    $('#alerte-sauvegarde').hidden = !aAlerter;
    $('#texte-alerte-sauvegarde').textContent = `${texteSauvegarde()} Les données ne sont que sur ce téléphone.`;
  }

  /** Propose le fichier via le menu Partager (Fichiers, Drive, mail…), sinon le télécharge. */
  async function livrerFichier(nom, contenu, type) {
    const fichier = new File([contenu], nom, { type });
    if (navigator.canShare?.({ files: [fichier] })) {
      try {
        await navigator.share({ files: [fichier], title: nom });
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false; // partage annulé par l'utilisateur
      }
    }
    const lien = h('a', { href: URL.createObjectURL(fichier), download: nom });
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
    return true;
  }

  async function sauvegarder() {
    const contenu = JSON.stringify(versSauvegarde(etat), null, 1);
    const fait = await livrerFichier(`tresorerie-repair-cafe-${dateISO()}.json`, contenu, 'application/json');
    if (!fait) { annoncer('Sauvegarde annulée.'); return; }
    etat.prefs.derniereSauvegarde = new Date().toISOString();
    await ecrireReglage('prefs', etat.prefs);
    rendreVue();
    rendreAlerteSauvegarde();
    annoncer('Fichier de sauvegarde créé. Rangez-le hors du téléphone.');
  }

  async function exporterCSV(ecritures, suffixe) {
    if (!ecritures.length) { annoncer('Aucune écriture à exporter.'); return; }
    const fait = await livrerFichier(`tresorerie-repair-cafe-${suffixe}.csv`, versCSV(ecritures, etat.categories), 'text/csv');
    if (fait) annoncer(`${pluriel(ecritures.length, 'écriture')} exportée${ecritures.length > 1 ? 's' : ''} en CSV.`);
  }

  async function restaurer(evenement) {
    const fichier = evenement.target.files[0];
    evenement.target.value = '';
    if (!fichier) return;
    let resultat;
    try {
      resultat = fusionner(etat, JSON.parse(await fichier.text()));
    } catch (err) {
      annoncer(err instanceof SyntaxError ? 'Fichier illisible : ce n\'est pas un fichier JSON valide.' : err.message);
      return;
    }
    try {
      await ecrireEcritures(resultat.donnees.ecritures);
      await ecrireReglage('categories', resultat.donnees.categories);
      await ecrireReglage('exercices', resultat.donnees.exercices);
    } catch (err) {
      annoncer('Échec de la restauration. Les données existantes n\'ont pas été modifiées.');
      return;
    }
    Object.assign(etat, resultat.donnees);
    periodeEcritures.rafraichir();
    periodeEtat.rafraichir();
    rendreChoixCategorie();
    rendreVue();
    const b = resultat.bilan;
    annoncer(`Restauration terminée : ${b.ajoutees} ajoutée${b.ajoutees > 1 ? 's' : ''}, ${b.misesAJour} mise${b.misesAJour > 1 ? 's' : ''} à jour`
      + (b.ignorees ? `, ${b.ignorees} ignorée${b.ignorees > 1 ? 's' : ''} car invalide${b.ignorees > 1 ? 's' : ''}` : '') + '.');
  }

  async function demanderPersistance() {
    try { await navigator.storage?.persist?.(); } catch (err) { /* non bloquant */ }
  }

  async function rendrePersistance() {
    let protege = false;
    try { protege = (await navigator.storage?.persisted?.()) ?? false; } catch (err) { /* non bloquant */ }
    $('#etat-persistance').textContent = protege
      ? 'Le navigateur protège ces données contre le nettoyage automatique.'
      : 'Le navigateur peut effacer ces données s\'il manque de place : installez l\'application sur l\'écran d\'accueil et sauvegardez régulièrement.';
  }

  /* ---------- Vue Réglages : exercices ---------- */
  async function enregistrerExercices() {
    etat.exercices.sort((x, y) => y.debut.localeCompare(x.debut));
    await ecrireReglage('exercices', etat.exercices);
    periodeEcritures.rafraichir();
    periodeEtat.rafraichir();
    rendreReglages();
  }

  function rendreExercices() {
    $('#liste-exercices').replaceChildren(...(etat.exercices.length ? etat.exercices.map((ex) => h('li', {},
      h('span', { class: 'grandit' }, h('strong', {}, ex.nom), h('br'),
        ex.fin ? `du ${dateFR(ex.debut)} au ${dateFR(ex.fin)}` : `depuis le ${dateFR(ex.debut)} (en cours)`),
      h('button', {
        type: 'button', class: 'bouton petit', 'aria-label': `Retirer ${ex.nom}`,
        onclick: async () => {
          if (!confirm(`Retirer « ${ex.nom} » ? Les écritures ne sont pas touchées, seul le raccourci de période disparaît.`)) return;
          etat.exercices = etat.exercices.filter((x) => x.id !== ex.id);
          await enregistrerExercices();
          annoncer('Exercice retiré.');
        },
      }, 'Retirer'))) : [h('li', { class: 'vide' }, 'Aucun exercice défini.')]));
  }

  async function ajouterExercice(evenement) {
    evenement.preventDefault();
    const nom = $('#ex-nom').value.trim();
    const debut = $('#ex-debut').value;
    const fin = $('#ex-fin').value;
    let message = null;
    if (!nom) message = 'Donnez un nom à l\'exercice.';
    else if (!dateValide(debut)) message = 'Indiquez la date de début.';
    else if (fin && fin < debut) message = 'La date de fin doit être après la date de début.';
    erreur(null, '#err-exercice', message);
    if (message) { (!nom ? $('#ex-nom') : !dateValide(debut) ? $('#ex-debut') : $('#ex-fin')).focus(); return; }
    const exercice = { id: nouvelId(), nom, debut, fin };
    etat.exercices.push(exercice);
    await enregistrerExercices();
    // Un exercice qui couvre aujourd'hui devient la période affichée par défaut.
    if (dansPeriode(dateISO(), debut, fin)) {
      periodeEcritures.choisir(`exercice:${exercice.id}`);
      periodeEtat.choisir(`exercice:${exercice.id}`);
    }
    evenement.target.reset();
    annoncer(`Exercice « ${nom} » ajouté.`);
  }

  /* ---------- Vue Réglages : catégories et sous-catégories ---------- */
  async function enregistrerCategories() {
    await ecrireReglage('categories', etat.categories);
    rendreChoixCategorie();
    rendreFiltreCategorie();
    rendreReglages();
  }

  const nomExiste = (nom, sens, parent, saufId) => etat.categories.some((c) => c.id !== saufId && c.sens === sens
    && (c.parent ?? null) === (parent ?? null) && c.nom.toLowerCase() === nom.toLowerCase());

  /** Renommer, archiver, supprimer : les mêmes commandes pour une catégorie et une sous-catégorie. */
  function commandesCategorie(c) {
    const genre = c.parent ? 'la sous-catégorie' : 'la catégorie';
    const usages = c.parent ? utilisations(c.id, etat.ecritures) : etat.ecritures.filter((e) => e.categorie === c.id).length;
    return [
      h('input', {
        type: 'text', class: 'grandit', value: c.nom, maxlength: 30,
        'aria-label': `Nom de ${genre} ${c.nom}${c.archivee ? ' (archivée)' : ''}`,
        onchange: async (ev) => {
          const nom = ev.target.value.trim();
          if (!nom || nom === c.nom) { ev.target.value = c.nom; return; }
          if (nomExiste(nom, c.sens, c.parent, c.id)) { ev.target.value = c.nom; annoncer(`« ${nom} » existe déjà.`); return; }
          c.nom = nom;
          c.modifie = new Date().toISOString();
          await enregistrerCategories();
          annoncer(`Renommée en « ${nom} ».`);
        },
      }),
      h('button', {
        type: 'button', class: 'bouton petit', 'aria-label': `${c.archivee ? 'Rétablir' : 'Archiver'} ${genre} ${c.nom}`,
        onclick: async () => {
          c.archivee = !c.archivee;
          c.modifie = new Date().toISOString();
          await enregistrerCategories();
          annoncer(`« ${c.nom} » ${c.archivee ? 'archivée' : 'rétablie'}.`);
        },
      }, c.archivee ? 'Rétablir' : 'Archiver'),
      // Règle du projet : on ne supprime que ce qui n'a jamais servi, pour ne laisser aucune écriture orpheline.
      usages === 0 ? h('button', {
        type: 'button', class: 'bouton petit danger', 'aria-label': `Supprimer ${genre} ${c.nom}`,
        onclick: async () => {
          const enfants = c.parent ? 0 : sousCategories(etat.categories, c.id).length;
          if (!confirm(`Supprimer « ${c.nom} »${enfants ? ` et ses ${pluriel(enfants, 'sous-catégorie')}` : ''} ? Aucune écriture ne l'utilise.`)) return;
          etat.categories = etat.categories.filter((x) => x.id !== c.id && x.parent !== c.id);
          categoriesOuvertes.delete(c.id);
          await enregistrerCategories();
          annoncer(`« ${c.nom} » supprimée.`);
        },
      }, 'Supprimer') : h('span', { class: 'aide' }, `Utilisée par ${pluriel(usages, 'écriture')}`),
    ];
  }

  function panneauCategorie(c) {
    const sous = sousCategories(etat.categories, c.id);
    const champ = h('input', { id: `sous-nom-${c.id}`, type: 'text', maxlength: 30 });
    const idErreur = `sous-err-${c.id}`;
    const ajouter = async () => {
      const nom = champ.value.trim();
      const message = !nom ? 'Donnez un nom à la sous-catégorie.' : nomExiste(nom, c.sens, c.id) ? 'Cette sous-catégorie existe déjà.' : null;
      const p = document.getElementById(idErreur);
      p.textContent = message ?? '';
      p.hidden = !message;
      if (message) { champ.focus(); return; }
      etat.categories.push({ id: nouvelId(), nom, sens: c.sens, parent: c.id });
      // Première sous-catégorie : on crée aussi « Autre », puisque le choix devient obligatoire à la saisie.
      const autreAjoutee = !sous.length && !nomExiste('Autre', c.sens, c.id);
      if (autreAjoutee) etat.categories.push({ id: nouvelId(), nom: 'Autre', sens: c.sens, parent: c.id });
      await enregistrerCategories();
      annoncer(`Sous-catégorie « ${nom} » ajoutée${autreAjoutee ? ', ainsi que « Autre »' : ''}.`);
      document.getElementById(`sous-nom-${c.id}`)?.focus();
    };
    const panneau = h('details', { class: 'details cat', open: categoriesOuvertes.has(c.id) },
      h('summary', {}, marqueIcone(c), h('span', {}, c.nom), c.archivee && h('span', { class: 'etiquette' }, 'Archivée'),
        h('span', { class: 'facultatif' }, sous.length ? `— ${pluriel(sous.length, 'sous-catégorie')}` : '— sans sous-catégorie')),
      h('ul', { class: 'liste-simple' }, h('li', {}, commandesCategorie(c))),
      h('div', { class: 'champ icone-choix' }, h('label', { for: `icone-${c.id}` }, 'Icône'),
        h('select', {
          id: `icone-${c.id}`,
          onchange: async (ev) => {
            c.icone = ev.target.value;
            c.modifie = new Date().toISOString();
            await enregistrerCategories();
            annoncer(c.icone ? `Icône de « ${c.nom} » changée.` : `Icône de « ${c.nom} » retirée.`);
          },
        }, ICONES_CHOIX.map(([valeur, nom]) => h('option', { value: valeur, selected: valeur === iconeCategorie(c) }, valeur ? `${valeur}  ${nom}` : nom)))),
      h('h4', {}, 'Sous-catégories'),
      h('ul', { class: 'liste-simple' }, sous.length ? sous.map((s) => h('li', {}, commandesCategorie(s)))
        : h('li', { class: 'vide' }, 'Aucune : la saisie ne demande que la catégorie.')),
      h('div', { class: 'ajout' },
        h('div', { class: 'champ' }, h('label', { for: champ.id }, `Nouvelle sous-catégorie de ${c.nom}`), champ),
        h('button', { type: 'button', class: 'bouton', onclick: ajouter }, 'Ajouter')),
      h('p', { id: idErreur, class: 'erreur', hidden: true }));
    champ.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ajouter(); } });
    panneau.addEventListener('toggle', () => { if (panneau.open) categoriesOuvertes.add(c.id); else categoriesOuvertes.delete(c.id); });
    return panneau;
  }

  function rendreCategories() {
    for (const sens of ['depense', 'recette']) {
      $(`#liste-cat-${sens}`).replaceChildren(...principales(etat.categories, sens).map(panneauCategorie));
    }
  }

  async function ajouterCategorie(evenement) {
    evenement.preventDefault();
    const nom = $('#cat-nom').value.trim();
    const sens = $('#cat-sens').value;
    const message = !nom ? 'Donnez un nom à la catégorie.' : nomExiste(nom, sens, null) ? 'Cette catégorie existe déjà.' : null;
    erreur('#cat-nom', '#err-cat-nom', message);
    if (message) { $('#cat-nom').focus(); return; }
    const nouvelle = { id: nouvelId(), nom, sens };
    etat.categories.push(nouvelle);
    categoriesOuvertes.add(nouvelle.id); // dépliée : on peut tout de suite lui donner des sous-catégories
    await enregistrerCategories();
    $('#cat-nom').value = '';
    annoncer(`Catégorie « ${nom} » ajoutée.`);
  }

  function rendreReglages() {
    $('#etat-sauvegarde').textContent = `${texteSauvegarde()} ${pluriel(etat.ecritures.length, 'écriture')} sur cet appareil.`;
    rendrePersistance();
    rendreExercices();
    rendreCategories();
  }

  /* ---------- Navigation ---------- */
  const TITRES = { saisie: 'Saisie', ecritures: 'Écritures', etat: 'État par période', reglages: 'Réglages' };

  function rendreVue() {
    if (vueActive === 'saisie') rendreSaisie();
    else if (vueActive === 'ecritures') { rendreFiltreCategorie(); rendreEcritures(); }
    else if (vueActive === 'etat') rendreEtat();
    else rendreReglages();
  }

  function allerA(vue, deplacerFocus = true) {
    vueActive = vue;
    for (const section of document.querySelectorAll('.vue')) section.hidden = section.id !== `vue-${vue}`;
    for (const bouton of document.querySelectorAll('.onglets button')) {
      if (bouton.dataset.vue === vue) bouton.setAttribute('aria-current', 'page'); else bouton.removeAttribute('aria-current');
    }
    document.body.dataset.vue = vue;
    $('#titre-vue').textContent = TITRES[vue];
    document.title = `${TITRES[vue]} — Trésorerie Repair Café`;
    rendreVue();
    window.scrollTo(0, 0);
    if (deplacerFocus) $('#titre-vue').focus();
  }

  /* ---------- Démarrage ---------- */
  async function demarrer() {
    try {
      db = await ouvrirBase();
      const [ecritures, categories, exercices, prefs] = await Promise.all([
        lireTout('ecritures'), lireReglage('categories'), lireReglage('exercices'), lireReglage('prefs'),
      ]);
      etat.ecritures = ecritures;
      etat.exercices = exercices ?? [];
      etat.prefs = prefs ?? {};
      // Installation neuve : schéma courant. Données d'une version antérieure sans numéro : schéma 1.
      const schema = categories ? (etat.prefs.schema ?? 1) : SCHEMA;
      etat.categories = categories
        ? migrerCategories(categories, schema)
        : [...CATEGORIES_DEFAUT, ...SOUS_CATEGORIES_DEFAUT].map((c) => ({ ...c }));
      if (!categories || schema < SCHEMA) {
        await ecrireReglage('categories', etat.categories);
        etat.prefs.schema = SCHEMA;
        await ecrireReglage('prefs', etat.prefs);
      }
    } catch (err) {
      $('#contenu').replaceChildren(h('div', { class: 'alerte', role: 'alert' },
        h('p', {}, 'Impossible d\'ouvrir le stockage de ce navigateur. En navigation privée, l\'application ne peut pas conserver les données.')));
      return;
    }

    $('#version').textContent = VERSION;
    $('#date').value = dateISO();
    remplirModes($('#mode'), modeParDefaut('depense'));
    rendreChoixCategorie();
    periodeEcritures = monterPeriode($('#periode-ecritures'), 'pe', rendreEcritures);
    periodeEtat = monterPeriode($('#periode-etat'), 'pt', rendreEtat);

    $('#form-saisie').addEventListener('submit', enregistrerSaisie);
    for (const radio of document.querySelectorAll('input[name="sens"]')) radio.addEventListener('change', rendreChoixCategorie);
    $('#choix-categorie').addEventListener('change', () => { erreur(null, '#err-categorie'); rendreChoixSous(); });
    $('#choix-sous-categorie').addEventListener('change', () => erreur(null, '#err-sous-categorie'));

    $('#synthese').addEventListener('click', () => { periodeEtat.choisir(periodeSynthese().choix); allerA('etat'); });
    $('#btn-ticket').addEventListener('click', ouvrirTicket);
    $('#form-ticket').addEventListener('submit', enregistrerTicket);
    $('#tk-total').addEventListener('input', majResteTicket);
    $('#tk-ajouter').addEventListener('click', () => {
      const reste = resteTicket();
      // La nouvelle ligne propose d'office ce qu'il reste à répartir.
      ajouterLigneTicket(reste > 0 ? montantSaisie(reste) : '').querySelector('.tk-cat').focus();
    });
    $('#tk-fermer').addEventListener('click', () => $('#dlg-ticket-saisie').close());

    $('#filtre-sens').addEventListener('change', rendreEcritures);
    $('#filtre-categorie').addEventListener('change', rendreEcritures);

    $('#form-edition').addEventListener('submit', validerEdition);
    for (const radio of document.querySelectorAll('input[name="e-sens"]')) {
      radio.addEventListener('change', () => { remplirCategoriesEdition(radio.value, ''); remplirSousEdition(''); });
    }
    $('#e-categorie').addEventListener('change', () => remplirSousEdition(''));
    $('#btn-edit-annuler-ecriture').addEventListener('click', annulerOuRetablir);
    $('#btn-edit-fermer').addEventListener('click', () => $('#dlg-ecriture').close());
    $('#dlg-ecriture').addEventListener('close', () => { enEdition = null; });

    $('#btn-sauver').addEventListener('click', sauvegarder);
    $('#btn-sauver-alerte').addEventListener('click', sauvegarder);
    $('#btn-csv-tout').addEventListener('click', () => exporterCSV(etat.ecritures, dateISO()));
    $('#btn-csv-periode').addEventListener('click', () => {
      const { debut, fin } = periodeEtat.bornes();
      exporterCSV(etat.ecritures.filter((e) => dansPeriode(e.date, debut, fin)), `${debut || 'debut'}_${fin || dateISO()}`);
    });
    $('#btn-imprimer').addEventListener('click', () => window.print());
    $('#fichier-import').addEventListener('change', restaurer);
    $('#form-exercice').addEventListener('submit', ajouterExercice);
    $('#form-categorie').addEventListener('submit', ajouterCategorie);
    for (const bouton of document.querySelectorAll('.onglets button')) {
      bouton.addEventListener('click', () => allerA(bouton.dataset.vue));
    }

    allerA('saisie', false);

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* l'appli fonctionne sans, mais pas hors-ligne */ });
    }
  }

  demarrer();
}
