/* Tests des fonctions de calcul. Lancer avec : node tests.js */
'use strict';
const assert = require('node:assert/strict');
const t = require('./app.js');

let n = 0;
const test = (nom, fn) => { fn(); n += 1; console.log(`ok  ${nom}`); };

const E = (id, date, sens, montant, categorie, mode, extra = {}) => ({
  id, date, sens, montant, categorie, mode, libelle: '', piece: '',
  annulee: false, cree: `${date}T10:00:00.000Z`, modifie: `${date}T10:00:00.000Z`, historique: [], ...extra,
});

test('lireMontant : formats acceptés', () => {
  assert.equal(t.lireMontant('12,50'), 1250);
  assert.equal(t.lireMontant('12.5'), 1250);
  assert.equal(t.lireMontant('12'), 1200);
  assert.equal(t.lireMontant(' 1 234,05 € '), 123405);
  assert.equal(t.lireMontant('0,01'), 1);
  assert.equal(t.lireMontant('19,99'), 1999); // 19.99 * 100 = 1998.9999… en flottant
  assert.equal(t.lireMontant('0,29'), 29);
});

test('lireMontant : saisies refusées', () => {
  for (const s of ['', '0', '0,00', 'abc', '-5', '12,345', '1,2,3', ',50', '12,', null, undefined]) {
    assert.equal(t.lireMontant(s), null, `devrait refuser « ${s} »`);
  }
});

test('montantSaisie : aller-retour', () => {
  assert.equal(t.montantSaisie(1250), '12,50');
  assert.equal(t.montantSaisie(5), '0,05');
  assert.equal(t.montantSaisie(-1999), '-19,99');
  for (const c of [1, 99, 100, 1999, 123405]) assert.equal(t.lireMontant(t.montantSaisie(c)), c);
});

test('dateValide', () => {
  assert.ok(t.dateValide('2026-11-13'));
  assert.ok(t.dateValide('2028-02-29'));
  assert.ok(!t.dateValide('2026-02-30'));
  assert.ok(!t.dateValide('13/11/2026'));
  assert.ok(!t.dateValide(''));
});

test('bornesPeriode', () => {
  const ex = [{ id: 'a', nom: 'Ex', debut: '2026-03-14', fin: '' }];
  assert.deepEqual(t.bornesPeriode('mois', '2026-11-13', ex), { debut: '2026-11-01', fin: '2026-11-30' });
  assert.deepEqual(t.bornesPeriode('mois', '2028-02-10', ex), { debut: '2028-02-01', fin: '2028-02-29' });
  assert.deepEqual(t.bornesPeriode('annee', '2026-11-13', ex), { debut: '2026-01-01', fin: '2026-12-31' });
  assert.deepEqual(t.bornesPeriode('exercice:a', '2026-11-13', ex), { debut: '2026-03-14', fin: '' });
  assert.deepEqual(t.bornesPeriode('exercice:zzz', '2026-11-13', ex), { debut: '', fin: '' });
  assert.deepEqual(t.bornesPeriode('tout', '2026-11-13', ex), { debut: '', fin: '' });
});

test('exerciceCourant : exercice d\'une AG à l\'autre', () => {
  const ex = [
    { id: 'a', nom: '2025-2026', debut: '2025-03-15', fin: '2026-03-13' },
    { id: 'b', nom: '2026-2027', debut: '2026-03-14', fin: '' },
  ];
  assert.equal(t.exerciceCourant(ex, '2026-11-13').id, 'b');
  assert.equal(t.exerciceCourant(ex, '2026-01-10').id, 'a');
  assert.equal(t.exerciceCourant(ex, '2024-01-10'), null);
});

test('calculerEtat : totaux, bornes incluses, annulées exclues', () => {
  const liste = [
    E('1', '2026-03-14', 'recette', 5000, 'r-dons', 'especes'),
    E('2', '2026-06-01', 'recette', 2000, 'r-dons', 'cheque'),
    E('3', '2026-06-02', 'depense', 1999, 'd-outillage', 'carte'),
    E('4', '2026-11-13', 'depense', 501, 'd-pieces', 'especes'),
    E('5', '2026-07-01', 'depense', 9999, 'd-divers', 'carte', { annulee: true }),
    E('6', '2026-03-13', 'recette', 7777, 'r-dons', 'especes'), // veille du début : hors période
  ];
  const r = t.calculerEtat(liste, '2026-03-14', '2026-11-13');
  assert.equal(r.recettes, 7000);
  assert.equal(r.depenses, 2500);
  assert.equal(r.resultat, 4500);
  assert.equal(r.nombre, 4);
  assert.equal(r.annulees, 1);
  assert.deepEqual(r.parCategorie.recette, { 'r-dons': 7000 });
  assert.deepEqual(r.parCategorie.depense, { 'd-outillage': 1999, 'd-pieces': 501 });
  assert.deepEqual(r.parMode.recette, { especes: 5000, cheque: 2000 });
  assert.deepEqual(r.parMode.depense, { carte: 1999, especes: 501 });
  // Période ouverte des deux côtés
  assert.equal(t.calculerEtat(liste, '', '').recettes, 14777);
});

test('versCSV : séparateur, virgule décimale, neutralisation des formules', () => {
  const liste = [
    E('1', '2026-06-02', 'depense', 1999, 'd-outillage', 'carte', { libelle: '=SOMME(A1) "tournevis"; lot', piece: '12', sousCategorie: 'd-outillage-main' }),
    E('2', '2026-06-01', 'recette', 5000, 'r-dons', 'especes', { annulee: true }),
  ];
  const lignes = t.versCSV(liste, [...t.CATEGORIES_DEFAUT, ...t.SOUS_CATEGORIES_DEFAUT]).split('\r\n');
  assert.ok(lignes[0].startsWith('﻿"Date";"Type"'));
  assert.equal(lignes[0].slice(1), '"Date";"Type";"Catégorie";"Sous-catégorie";"Libellé";"Mode de paiement";"N° de pièce";"Recette";"Dépense";"Statut"');
  assert.equal(lignes[1], '"01/06/2026";"Recette";"Dons";"";"";"Espèces";"";50,00;;"Annulée"');
  assert.equal(lignes[2], '"02/06/2026";"Dépense";"Outillage";"Outillage à main";"\'=SOMME(A1) ""tournevis""; lot";"Carte";"12";;19,99;"Valide"');
});

test('corriger : trace de l\'ancienne version, rien si aucun changement', () => {
  const e = E('1', '2026-06-02', 'depense', 1999, 'd-outillage', 'carte');
  assert.equal(t.corriger(e, { montant: 1999 }), null);
  const c = t.corriger(e, { montant: 2100 }, '2026-06-03T08:00:00.000Z');
  assert.equal(c.montant, 2100);
  assert.equal(c.modifie, '2026-06-03T08:00:00.000Z');
  assert.equal(c.historique.length, 1);
  assert.equal(c.historique[0].action, 'correction');
  assert.equal(c.historique[0].avant.montant, 1999);
  assert.equal(e.montant, 1999, 'l\'original ne doit pas être modifié');
});

test('basculerAnnulation : annule puis rétablit, avec trace', () => {
  const e = E('1', '2026-06-02', 'depense', 1999, 'd-outillage', 'carte');
  const a = t.basculerAnnulation(e, '2026-06-03T08:00:00.000Z');
  assert.equal(a.annulee, true);
  const r = t.basculerAnnulation(a, '2026-06-04T08:00:00.000Z');
  assert.equal(r.annulee, false);
  assert.deepEqual(r.historique.map((x) => x.action), ['annulation', 'retablissement']);
});

test('fusionner : sans doublon, la version la plus récente gagne, rien de local n\'est perdu', () => {
  const local = {
    ecritures: [
      E('1', '2026-06-01', 'recette', 5000, 'r-dons', 'especes'),
      E('2', '2026-06-02', 'depense', 1999, 'd-outillage', 'carte', { modifie: '2026-06-10T10:00:00.000Z' }),
      E('local', '2026-06-05', 'depense', 300, 'd-divers', 'especes'),
    ],
    categories: t.CATEGORIES_DEFAUT.map((c) => ({ ...c })),
    exercices: [],
  };
  const fichier = t.versSauvegarde({
    ecritures: [
      E('1', '2026-06-01', 'recette', 6000, 'r-dons', 'especes', { modifie: '2026-06-20T10:00:00.000Z' }), // plus récente
      E('2', '2026-06-02', 'depense', 100, 'd-outillage', 'carte', { modifie: '2026-06-05T10:00:00.000Z' }), // plus ancienne
      E('3', '2026-06-03', 'recette', 1000, 'r-perso', 'cheque'), // nouvelle
      { id: 'x', date: 'pas une date', sens: 'recette', montant: 10, categorie: 'r-dons', modifie: 'z' }, // invalide
      E('y', '2026-06-03', 'recette', 12.5, 'r-dons', 'cheque'), // montant non entier
    ],
    categories: [{ id: 'r-perso', nom: 'Buvette', sens: 'recette' }, { id: 'r-dons', nom: 'AUTRE NOM', sens: 'recette' }],
    exercices: [{ id: 'e1', nom: '2026-2027', debut: '2026-03-14', fin: '' }],
  });
  const { donnees, bilan } = t.fusionner(local, JSON.parse(JSON.stringify(fichier)));
  assert.deepEqual(bilan, { ajoutees: 1, misesAJour: 1, ignorees: 2 });
  const parId = Object.fromEntries(donnees.ecritures.map((e) => [e.id, e]));
  assert.equal(donnees.ecritures.length, 4);
  assert.equal(parId['1'].montant, 6000);
  assert.equal(parId['2'].montant, 1999);
  assert.ok(parId.local && parId['3']);
  assert.equal(donnees.categories.length, t.CATEGORIES_DEFAUT.length + 1);
  assert.equal(donnees.categories.find((c) => c.id === 'r-dons').nom, 'Dons', 'le nom local est conservé');
  assert.equal(donnees.exercices.length, 1);
  // Restaurer deux fois le même fichier ne change rien.
  assert.deepEqual(t.fusionner(donnees, JSON.parse(JSON.stringify(fichier))).bilan, { ajoutees: 0, misesAJour: 0, ignorees: 2 });
});

test('fusionner : refuse un fichier étranger', () => {
  const local = { ecritures: [], categories: [], exercices: [] };
  assert.throws(() => t.fusionner(local, { autre: 1 }));
  assert.throws(() => t.fusionner(local, null));
  assert.throws(() => t.fusionner(local, { format: 'tresorerie-rc' }));
});

/* ----- Version 1.1 : sous-catégories et tickets ventilés ----- */
const TOUTES = [...t.CATEGORIES_DEFAUT, ...t.SOUS_CATEGORIES_DEFAUT];

test('catégories de départ : chaque sous-catégorie a un parent existant, et un « Autre »', () => {
  const ids = new Set(TOUTES.map((c) => c.id));
  assert.equal(ids.size, TOUTES.length, 'identifiants uniques');
  for (const s of t.SOUS_CATEGORIES_DEFAUT) assert.ok(ids.has(s.parent) && s.sens === 'depense');
  for (const parent of new Set(t.SOUS_CATEGORIES_DEFAUT.map((s) => s.parent))) {
    assert.ok(t.sousCategories(TOUTES, parent).some((s) => s.nom === 'Autre'), `Autre manquant pour ${parent}`);
  }
  assert.equal(t.sousCategories(TOUTES, 'd-assurance').length, 0);
  assert.equal(t.principales(TOUTES, 'depense').length, 6);
  assert.equal(t.principales(TOUTES, 'recette').length, 4);
});

test('sousCategories : filtre des archivées', () => {
  const cats = [{ id: 'p', nom: 'P', sens: 'depense' }, { id: 'a', nom: 'A', sens: 'depense', parent: 'p' },
    { id: 'b', nom: 'B', sens: 'depense', parent: 'p', archivee: true }];
  assert.equal(t.sousCategories(cats, 'p').length, 2);
  assert.deepEqual(t.sousCategories(cats, 'p', true).map((c) => c.id), ['a']);
});

test('migrerCategories : de la 1.0 à la 1.1 sans toucher aux choix de l\'utilisateur', () => {
  // L'utilisateur a renommé une catégorie, supprimé « Divers » et créé « Vélo ».
  const v1 = t.CATEGORIES_DEFAUT.filter((c) => c.id !== 'd-divers')
    .map((c) => (c.id === 'd-pieces' ? { ...c, nom: 'Pièces détachées' } : { ...c }));
  v1.push({ id: 'perso', nom: 'Vélo', sens: 'depense' });
  const v2 = t.migrerCategories(v1, 1);
  assert.equal(v2.find((c) => c.id === 'd-pieces').nom, 'Pièces détachées');
  assert.ok(t.sousCategories(v2, 'd-pieces').length >= 5);
  assert.equal(v2.filter((c) => c.parent === 'd-divers').length, 0, 'pas de sous-catégories orphelines');
  assert.equal(t.sousCategories(v2, 'perso').length, 0);
  assert.equal(t.migrerCategories(v2, 2), v2, 'aucun changement si le schéma est à jour');
  assert.equal(t.migrerCategories(v2, 1).length, v2.length, 'rejouer la migration ne crée pas de doublon');
});

test('utilisations', () => {
  const liste = [
    E('1', '2026-06-01', 'depense', 100, 'd-pieces', 'carte', { sousCategorie: 'd-pieces-visserie' }),
    E('2', '2026-06-01', 'depense', 100, 'd-pieces', 'carte', { sousCategorie: 'd-pieces-colles', annulee: true }),
  ];
  assert.equal(t.utilisations('d-pieces', liste), 2);
  assert.equal(t.utilisations('d-pieces-colles', liste), 1, 'une écriture annulée compte : elle existe toujours');
  assert.equal(t.utilisations('d-outillage', liste), 0);
});

test('calculerEtat : détail par sous-catégorie, anciennes écritures sans sous-catégorie', () => {
  const liste = [
    E('1', '2026-06-01', 'depense', 1000, 'd-pieces', 'carte', { sousCategorie: 'd-pieces-visserie' }),
    E('2', '2026-06-02', 'depense', 250, 'd-pieces', 'carte', { sousCategorie: 'd-pieces-visserie' }),
    E('3', '2026-06-03', 'depense', 400, 'd-pieces', 'especes', { sousCategorie: 'd-pieces-colles' }),
    E('4', '2026-06-04', 'depense', 300, 'd-pieces', 'carte'), // saisie en 1.0
    E('5', '2026-06-05', 'depense', 999, 'd-pieces', 'carte', { sousCategorie: 'd-pieces-colles', annulee: true }),
  ];
  const r = t.calculerEtat(liste, '', '');
  assert.equal(r.parCategorie.depense['d-pieces'], 1950);
  assert.deepEqual(r.parSous.depense['d-pieces'], { 'd-pieces-visserie': 1250, 'd-pieces-colles': 400, '': 300 });
  const sommeDetail = Object.values(r.parSous.depense['d-pieces']).reduce((a, b) => a + b, 0);
  assert.equal(sommeDetail, r.parCategorie.depense['d-pieces'], 'le détail retombe sur le total');
});

test('resteARepartir', () => {
  assert.equal(t.resteARepartir(2340, [1200, 1140]), 0);
  assert.equal(t.resteARepartir(2340, [1200]), 1140);
  assert.equal(t.resteARepartir(2340, [1200, null, 2000]), -860, 'une ligne vide compte pour zéro');
  assert.equal(t.resteARepartir(2340, []), 2340);
});

test('construireTicket : une écriture par ligne, reliées, somme égale au total', () => {
  let i = 0;
  const lignes = [
    { montant: 1200, categorie: 'd-pieces', sousCategorie: 'd-pieces-visserie', libelle: 'vis' },
    { montant: 890, categorie: 'd-outillage', sousCategorie: 'd-outillage-main', libelle: '' },
    { montant: 250, categorie: 'd-assurance' },
  ];
  const es = t.construireTicket({ date: '2026-11-13', mode: 'carte', piece: '42', lignes }, () => `id${i++}`, '2026-11-13T10:00:00.000Z');
  assert.equal(es.length, 3);
  assert.equal(new Set(es.map((e) => e.id)).size, 3);
  assert.ok(es.every((e) => e.ticket === 'id0' && e.sens === 'depense' && e.piece === '42' && e.mode === 'carte' && e.date === '2026-11-13'));
  assert.ok(!es.some((e) => e.id === 'id0'), 'l\'identifiant du ticket n\'est pas celui d\'une écriture');
  assert.equal(es.reduce((s, e) => s + e.montant, 0), 2340);
  assert.equal(es[2].sousCategorie, '');
  assert.deepEqual(t.trier([es[2], es[0], es[1]]).map((e) => e.rang), [0, 1, 2], 'ordre de saisie conservé');
  // Chaque écriture du ticket est une écriture valide pour la sauvegarde et la restauration.
  const { bilan } = t.fusionner({ ecritures: [], categories: [], exercices: [] }, JSON.parse(JSON.stringify(t.versSauvegarde({ ecritures: es, categories: TOUTES, exercices: [] }))));
  assert.deepEqual(bilan, { ajoutees: 3, misesAJour: 0, ignorees: 0 });
});

test('corriger : la sous-catégorie est tracée, une écriture 1.0 reste comparable', () => {
  const ancienne = E('1', '2026-06-02', 'depense', 1999, 'd-outillage', 'carte'); // sans champ sousCategorie
  assert.equal(t.corriger(ancienne, { sousCategorie: '' }), null, 'absence et chaîne vide sont équivalentes');
  const c = t.corriger(ancienne, { sousCategorie: 'd-outillage-main' }, '2026-06-03T08:00:00.000Z');
  assert.equal(c.sousCategorie, 'd-outillage-main');
  assert.equal(c.historique[0].avant.sousCategorie, '');
});

test('fusionner : une sauvegarde 1.0 se restaure dans la 1.1', () => {
  const sauvegardeV1 = { format: 'tresorerie-rc', version: 1, exporteLe: 'x',
    ecritures: [E('1', '2026-06-02', 'depense', 1999, 'd-outillage', 'carte')],
    categories: t.CATEGORIES_DEFAUT, exercices: [] };
  const { donnees, bilan } = t.fusionner({ ecritures: [], categories: TOUTES.map((c) => ({ ...c })), exercices: [] }, sauvegardeV1);
  assert.equal(bilan.ajoutees, 1);
  assert.equal(donnees.categories.length, TOUTES.length, 'pas de doublon de catégorie');
});

test('fusionner : un renommage ou un archivage de catégorie survit à une restauration sur un téléphone neuf', () => {
  const telephoneNeuf = { ecritures: [], categories: TOUTES.map((c) => ({ ...c })), exercices: [] };
  const sauvegarde = t.versSauvegarde({
    ecritures: [],
    categories: TOUTES.map((c) => (c.id === 'd-outillage-electro' ? { ...c, nom: 'Outils électriques', modifie: '2026-11-13T10:00:00.000Z' }
      : c.id === 'd-outillage-mesure' ? { ...c, archivee: true, modifie: '2026-11-13T10:00:00.000Z' } : { ...c })),
    exercices: [],
  });
  const { donnees } = t.fusionner(telephoneNeuf, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal(donnees.categories.length, TOUTES.length);
  assert.equal(donnees.categories.find((c) => c.id === 'd-outillage-electro').nom, 'Outils électriques');
  assert.equal(donnees.categories.find((c) => c.id === 'd-outillage-mesure').archivee, true);
  // Dans l'autre sens : un renommage local plus récent n'est pas écrasé par une vieille sauvegarde.
  const local = { ecritures: [], exercices: [], categories: TOUTES.map((c) => (c.id === 'd-outillage-electro'
    ? { ...c, nom: 'Machines', modifie: '2026-12-01T10:00:00.000Z' } : { ...c })) };
  assert.equal(t.fusionner(local, JSON.parse(JSON.stringify(sauvegarde))).donnees.categories.find((c) => c.id === 'd-outillage-electro').nom, 'Machines');
});

test('numéro de version identique dans app.js, sw.js, et liste des fichiers du cache complète', () => {
  const fs = require('node:fs');
  const lire = (f) => fs.readFileSync(`${__dirname}/${f}`, 'utf8');
  const version = /const VERSION = '([^']+)'/.exec(lire('app.js'))[1];
  const cache = /const CACHE = 'tresorerie-rc-([^']+)'/.exec(lire('sw.js'))[1];
  assert.equal(cache, version, 'changer CACHE dans sw.js en même temps que VERSION dans app.js');
  const liste = /const FICHIERS = \[([^\]]+)\]/.exec(lire('sw.js'))[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  for (const f of liste.filter((x) => x !== './')) assert.ok(fs.existsSync(`${__dirname}/${f}`), `fichier absent : ${f}`);
  for (const f of ['index.html', 'style.css', 'app.js']) assert.ok(liste.includes(f));
});

console.log(`\n${n} tests réussis`);
