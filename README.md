# Trésorerie Repair Café

Application de suivi de trésorerie du Carembault Repair Café : saisie des dépenses et des recettes, état par période, sauvegarde. Elle s'installe sur l'écran d'accueil du téléphone et fonctionne hors-ligne.

**Version 1.2.0 — lot 1** : les données restent sur l'appareil. La synchronisation vers un dépôt privé et le mode lecture seule du président arrivent au lot 2.

Nouveautés de la 1.2 : identité du Carembault Repair Café (logo, couleurs), synthèse de l'exercice sur l'accueil, icônes de catégories, écritures regroupées par mois, bouton « Corriger » après chaque saisie, mise en page revue pour les petits écrans et le texte agrandi.

Nouveautés de la 1.1 : sous-catégories, ticket à plusieurs achats, gestion complète des catégories. Les données des versions précédentes sont conservées.

## Mise en ligne (GitHub Pages)

1. Le dépôt est `euchloloia-sys/Tresocrc` (il doit être **public** pour GitHub Pages gratuit).
2. Les fichiers de l'appli sont à la racine du dépôt, branche `main`.
3. Dans le dépôt : *Settings → Pages → Build and deployment → Deploy from a branch*, branche `main`, dossier `/ (root)`.
4. Après une minute, l'appli est à l'adresse `https://euchloloia-sys.github.io/Tresocrc/`.

Ce dépôt ne contient que le code. Aucune donnée de trésorerie n'y est envoyée.

## Installation sur le téléphone

- **iPhone** : ouvrir l'adresse dans Safari, bouton Partager, « Sur l'écran d'accueil ».
- **Android** : ouvrir l'adresse dans Chrome, menu ⋮, « Installer l'application ».

Sur iPhone, l'appli installée a son propre stockage, séparé de Safari : toujours saisir depuis l'icône de l'écran d'accueil.

## Règles du projet

- Montants stockés en centimes (entiers).
- Aucune suppression d'écriture : on corrige ou on annule, et la trace reste dans l'historique.
- Aucun nom de donateur dans les libellés.
- Les frais bancaires ne sont pas suivis : le résultat affiché n'est pas le solde du compte.
- Le mode de paiement est informatif : il n'y a pas de solde de caisse séparé.
- Deux niveaux de catégories au maximum. La catégorie sert à l'état financier, la sous-catégorie aux statistiques d'achat. Le détail de l'article va dans le libellé.
- Dès qu'une catégorie a des sous-catégories, il faut en choisir une à chaque saisie.
- Une écriture = un montant, une catégorie, une sous-catégorie. Un ticket à plusieurs achats devient plusieurs écritures reliées entre elles, dont la somme doit égaler le total du ticket.
- Une catégorie déjà utilisée ne se supprime pas, elle s'archive.

## Catégories

*Réglages → Catégories* : toucher une catégorie pour la renommer, l'archiver, la supprimer si elle n'a jamais servi, et gérer ses sous-catégories. La première sous-catégorie ajoutée à une catégorie crée aussi « Autre ».

## Sauvegarde

*Réglages → Sauvegarder (JSON)* crée un fichier à ranger hors du téléphone. *Restaurer une sauvegarde* fusionne sans doublon : une écriture déjà présente n'est remplacée que si la version du fichier est plus récente. Un rappel s'affiche après 30 jours sans sauvegarde.

L'export CSV (séparateur `;`, virgule décimale) s'ouvre directement dans LibreOffice Calc ou Excel.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure des quatre écrans et de la fenêtre de correction |
| `style.css` | Mise en forme, thème clair et sombre, impression. Aucune largeur fixe : tout est en `rem` et les grilles passent sur une colonne quand la place manque |
| `app.js` | Fonctions de calcul (première partie) puis interface |
| `sw.js` | Fonctionnement hors-ligne |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `tests.js` | Tests des fonctions de calcul : `node tests.js` |

## Publier une nouvelle version

Changer le numéro dans **deux** endroits, sinon les téléphones gardent l'ancienne version : `VERSION` dans `app.js` et `CACHE` dans `sw.js`. `node tests.js` vérifie que les deux concordent. La nouvelle version est téléchargée au premier lancement qui suit la mise en ligne, et utilisée au lancement d'après. Le numéro affiché en bas des Réglages permet de vérifier.
