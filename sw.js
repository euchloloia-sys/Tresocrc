/* Service worker : rend l'application utilisable hors-ligne.
 *
 * Mise à jour « tout ou rien » : les fichiers de l'appli sont téléchargés ensemble à
 * l'installation, puis toujours servis depuis ce lot. On n'a donc jamais un index.html
 * d'une version avec un app.js d'une autre. Une nouvelle version poussée sur GitHub est
 * téléchargée au premier lancement qui suit, et utilisée au lancement d'après.
 *
 * IMPORTANT : changer CACHE à chaque mise en ligne (même numéro que VERSION dans app.js),
 * sinon les téléphones ne voient pas la nouvelle version. `node tests.js` le vérifie. */
const CACHE = 'tresorerie-rc-1.2.0';
const FICHIERS = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' contourne le cache HTTP du navigateur (GitHub Pages garde les fichiers 10 minutes) :
  // sans cela, on pourrait ranger d'anciens fichiers sous le nouveau numéro de version.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // On ne touche qu'aux fichiers de l'appli : les appels vers l'API GitHub (lot 2) passeront tels quels.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(e.request, { ignoreSearch: true }))
      .then((enCache) => enCache || fetch(e.request)),
  );
});
