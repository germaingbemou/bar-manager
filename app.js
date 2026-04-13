// ============================================
// CONFIGURATION SUPABASE + AUTH
// ============================================
const SUPABASE_URL = 'https://yhygidfyssfgxljbtlmd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KyUpAkclg-xjqMLjSvftIA_oJrJyefV';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// CACHE LOCAL — données mémorisées 5 minutes
// ============================================
const CACHE_TTL = 1 * 60 * 1000; // 1 minute
const _cache = {};

// Verrous pour éviter les requêtes parallèles sur la même table
var _pending = {};

async function dbGet(table, query) {
  const key = table + JSON.stringify(query || {});
  const now = Date.now();

  // Cache valide → retourner immédiatement
  if (_cache[key] && (now - _cache[key].ts) < CACHE_TTL) {
    return _cache[key].data;
  }

  // Requête déjà en cours → attendre qu'elle se termine
  if (_pending[key]) {
    await _pending[key];
    return _cache[key] ? _cache[key].data : [];
  }

  // Lancer la requête et enregistrer la promesse
  _pending[key] = (async function() {
    let q = db.from(table).select('*').limit(500000);
    if (query && query.order) q = q.order(query.order, {ascending: query.asc !== false});
    if (query && query.eq) q = q.eq(query.eq[0], query.eq[1]);
    const { data, error } = await q;
    if (!error && data) {
      _cache[key] = { data: data, ts: Date.now() };
    }
    delete _pending[key];
  })();

  await _pending[key];
  return _cache[key] ? _cache[key].data : [];
}

function invalidateCache(table) {
  Object.keys(_cache).forEach(function(k) {
    if (k.startsWith(table)) delete _cache[k];
  });
}


// ============================================
// CALCUL AUTOMATIQUE DES PRIMES GERANT
// Formule : 10 000 GNF par tranche de 500 000 GNF de CA
// ============================================
const PRIME_CONFIG = {
  tranche: 500000,   // CA par tranche
  montant: 10000,    // Prime par tranche
};

function calculerPrimeGerant(caJour) {
  var tranches = Math.floor(caJour / PRIME_CONFIG.tranche);
  return tranches * PRIME_CONFIG.montant;
}

async function calculerEtAfficherPrimes() {
  // Charger les ventes par jour avec leur gérant
  var ventes = await dbGet('ventes', {});
  var employes = await dbGet('employes', {});

  // Grouper le CA par jour et par gérant
  var caParJourGerant = {};
  ventes.forEach(function(v) {
    var key = v.date + '__' + v.gerant;
    caParJourGerant[key] = (caParJourGerant[key] || 0) + (v.quantite_vendue || 0) * (v.prix_vente || 0);
  });

  // Calculer les primes
  var primesCalculees = [];
  Object.entries(caParJourGerant).forEach(function(entry) {
    var key = entry[0], ca = entry[1];
    var parts = key.split('__');
    var date = parts[0], gerant = parts[1];
    if (!gerant) return;
    var prime = calculerPrimeGerant(ca);
    if (prime > 0) {
      var emp = employes.find(function(e) { return e.nom === gerant; });
      primesCalculees.push({
        date: date,
        gerant: gerant,
        employe_id: emp ? emp.id : null,
        ca: ca,
        tranches: Math.floor(ca / PRIME_CONFIG.tranche),
        prime: prime
      });
    }
  });

  return primesCalculees.sort(function(a,b) { return b.date > a.date ? 1 : -1; });
}

async function initPrimesGerant() {
  var primesCalculees = await calculerEtAfficherPrimes();
  var primesSaved = await dbGet('primes', {});

  // Afficher le panneau
  var panel = document.getElementById('primes-panel');
  if (!panel) return;

  // Config actuelle
  document.getElementById('prime-tranche').value = PRIME_CONFIG.tranche;
  document.getElementById('prime-montant').value = PRIME_CONFIG.montant;

  // Tableau des primes calculées
  var tbody = document.getElementById('primes-calc-body');
  if (!tbody) return;

  tbody.innerHTML = primesCalculees.map(function(p) {
    // Vérifier si déjà enregistrée
    var dejaEnr = primesSaved.some(function(ps) {
      return ps.date === p.date && ps.employe_id === p.employe_id && ps.type_prime === 'Prime CA gerant';
    });
    return '<tr>'
      + '<td>' + p.date + '</td>'
      + '<td style="font-weight:500;color:var(--accent)">' + p.gerant + '</td>'
      + '<td style="font-family:var(--mono)">' + fmt(p.ca) + ' GNF</td>'
      + '<td style="font-family:var(--mono)">' + p.tranches + ' tranches</td>'
      + '<td style="font-family:var(--mono);font-weight:500;color:var(--accent)">' + fmt(p.prime) + ' GNF</td>'
      + '<td>' + (dejaEnr
          ? '<span class="badge badge-green">Enregistree</span>'
          : '<button class="btn btn-accent" style="font-size:10px;padding:3px 8px" onclick="enregistrerPrime(this)" data-date="' + p.date + '" data-empid="' + (p.employe_id||'') + '" data-gerant="' + p.gerant + '" data-prime="' + p.prime + '">Ajouter</button>')
      + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="empty">Aucune vente enregistree</td></tr>';

  // Total primes du mois
  var totalPrimes = primesCalculees.reduce(function(s,p){return s+p.prime;}, 0);
  var el = document.getElementById('prime-total');
  if (el) el.textContent = 'Total primes gerants : ' + fmt(totalPrimes) + ' GNF';
}

async function enregistrerPrime(btn) {
  var date = btn.dataset.date;
  var empId = btn.dataset.empid;
  var gerant = btn.dataset.gerant;
  var montant = parseInt(btn.dataset.prime);
  if (!empId) { showToast('Employe introuvable pour ' + gerant, 'error'); return; }
  var r = await db.from('primes').insert({
    employe_id: empId,
    type_prime: 'Prime CA gerant',
    montant: montant,
    date: date
  });
  if (r.error) { showToast('Erreur: ' + r.error.message, 'error'); return; }
  invalidateCache('primes');
  showToast('Prime de ' + fmt(montant) + ' GNF enregistree pour ' + gerant + ' !');
  initPrimesGerant();
}

async function enregistrerToutesPrimes() {
  var primesCalculees = await calculerEtAfficherPrimes();
  var primesSaved = await dbGet('primes', {});
  var nouvelles = primesCalculees.filter(function(p) {
    return p.employe_id && !primesSaved.some(function(ps) {
      return ps.date === p.date && ps.employe_id === p.employe_id && ps.type_prime === 'Prime CA gerant';
    });
  });
  if (!nouvelles.length) { showToast('Toutes les primes sont deja enregistrees'); return; }
  var rows = nouvelles.map(function(p) {
    return { employe_id: p.employe_id, type_prime: 'Prime CA gerant', montant: p.prime, date: p.date };
  });
  var r = await db.from('primes').insert(rows);
  if (r.error) { showToast('Erreur: ' + r.error.message, 'error'); return; }
  invalidateCache('primes');
  showToast(nouvelles.length + ' prime(s) enregistree(s) !');
  initPrimesGerant();
}

function updatePrimeConfig() {
  var t = parseInt(document.getElementById('prime-tranche').value) || 500000;
  var m = parseInt(document.getElementById('prime-montant').value) || 10000;
  PRIME_CONFIG.tranche = t;
  PRIME_CONFIG.montant = m;
  showToast('Formule mise a jour : ' + fmt(m) + ' GNF / ' + fmt(t) + ' GNF de CA');
  initPrimesGerant();
}


// Précharger toutes les données au démarrage
async function preloadData() {
  await Promise.all([
    dbGet('produits', {order: 'nom'}),
    dbGet('ventes', {}),
    dbGet('depenses', {}),
    dbGet('achats', {}),
    dbGet('employes', {}),
    dbGet('presences', {}),
    dbGet('primes', {}),
    dbGet('avances', {})
  ]);
}



let currentUser = null;
let currentRole = null;

// ROLES: proprietaire > gerant > gerant_jour > comptable
const ROLE_LEVEL = { proprietaire: 4, gerant: 3, gerant_jour: 2, comptable: 1 };
const ROLE_LABELS = { proprietaire: 'Proprietaire', gerant: 'Gerant principal', gerant_jour: 'Gerant du jour', comptable: 'Comptable' };

function hasAccess(minRole) {
  return (ROLE_LEVEL[currentRole] || 0) >= (ROLE_LEVEL[minRole] || 0);
}

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  currentUser = session.user;
  // Charger le role
  const { data: u } = await db.from('utilisateurs').select('nom,role').eq('id', currentUser.id).single();
  currentRole = u ? u.role : 'gerant_jour';
  const nom = u ? u.nom : currentUser.email;
  // Afficher infos utilisateur
  const av = document.getElementById('user-avatar');
  const un = document.getElementById('user-name');
  const ur = document.getElementById('user-role');
  if(av) av.textContent = nom.substring(0,2).toUpperCase();
  if(un) un.textContent = nom;
  if(ur) ur.textContent = ROLE_LABELS[currentRole] || currentRole;
  // Masquer les sections selon le role
  applyRoleRestrictions();
}

function applyRoleRestrictions() {
  // Gerant du jour: saisie ventes uniquement
  if (currentRole === 'gerant_jour') {
    ['nav-stocks','nav-depenses','nav-achats','nav-employes','nav-presences','nav-salaires','nav-analyse'].forEach(function(id) {
      var el = document.getElementById(id);
      if(el) el.style.display = 'none';
    });
  }
  // Comptable: pas de saisie
  if (currentRole === 'comptable') {
    ['nav-employes','nav-presences','nav-salaires'].forEach(function(id) {
      var el = document.getElementById(id);
      if(el) el.style.display = 'none';
    });
  }
}

async function logout() {
  await db.auth.signOut();
  window.location.href = 'index.html';
}

// ============================================
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const fmtK = n => n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? Math.round(n/1000)+'k' : Math.round(n);
const charts = {};

function mk(id, cfg) {
  if (charts[id]) charts[id].destroy();
  const el = document.getElementById(id);
  if (!el) return;
  const COLORS = ['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171','#34d399','#60a5fa','#f472b6'];
  if (cfg.data && cfg.data.datasets) cfg.data.datasets.forEach((ds,i) => {
    if (!ds.backgroundColor) ds.backgroundColor = COLORS[i % COLORS.length];
    if (!ds.borderColor && cfg.type==='line') ds.borderColor = COLORS[i % COLORS.length];
  });
  const defaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: cfg.type === 'pie' || cfg.type === 'doughnut' ? {} : {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5a5a72', font: { size: 10, family: "'DM Mono'" } } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5a5a72', font: { size: 10, family: "'DM Mono'" }, callback: v => fmtK(v) } }
    }
  };
  charts[id] = new Chart(el, { ...cfg, options: { ...defaults, ...cfg.options, plugins: { ...defaults.plugins, ...((cfg.options||{}).plugins||{}) } } });
}

function showToast(msg, type) {
  type = type || 'success';
  const t = document.getElementById('toast');
  t.textContent = (type==='success' ? '✓ ' : '✗ ') + msg;
  t.className = 'toast ' + type;
  t.style.display = 'block';
  setTimeout(function() { t.style.display = 'none'; }, 3000);
}

async function checkConnection() {
  await initAuth(); await Promise.all([preloadData(), chargerPostes()]); setDefaultDates();
  try {
    const { data, error } = await db.from('produits').select('count').limit(1);
    if (error) throw error;
    document.getElementById('conn-dot').classList.add('connected');
    document.getElementById('conn-text').textContent = 'Connecte';
    document.getElementById('pg-sub').textContent = 'Base de donnees en temps reel';
  } catch(e) {
    document.getElementById('conn-text').textContent = 'Erreur connexion';
    document.getElementById('pg-sub').textContent = 'Verifiez vos cles Supabase';
  }
}


// ============================================
// FILTRE PAR PÉRIODE
// ============================================
var filterDebut = null;  // null = pas de filtre
var filterFin = null;

function getWeekBounds() {
  // Semaine Dimanche → Samedi
  var today = new Date();
  var day = today.getDay(); // 0=Dim, 6=Sam
  var debut = new Date(today);
  debut.setDate(today.getDate() - day); // Dimanche
  var fin = new Date(debut);
  fin.setDate(debut.getDate() + 6); // Samedi
  return {
    debut: debut.toISOString().split('T')[0],
    fin: fin.toISOString().split('T')[0]
  };
}

function getMonthBounds() {
  var today = new Date();
  var debut = new Date(today.getFullYear(), today.getMonth(), 1);
  var fin = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    debut: debut.toISOString().split('T')[0],
    fin: fin.toISOString().split('T')[0]
  };
}

function setQuickFilter(type) {
  // Mettre à jour les boutons actifs
  ['btn-today','btn-week','btn-month','btn-all'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activeBtn = document.getElementById('btn-'+type);
  if (activeBtn) activeBtn.classList.add('active');

  var today = new Date().toISOString().split('T')[0];

  if (type === 'all') {
    filterDebut = null;
    filterFin = null;
    setDateInputs('', '');
  } else if (type === 'today') {
    filterDebut = today;
    filterFin = today;
    setDateInputs(today, today);
  } else if (type === 'week') {
    var bounds = getWeekBounds();
    filterDebut = bounds.debut;
    filterFin = bounds.fin;
    setDateInputs(bounds.debut, bounds.fin);
  } else if (type === 'month') {
    var bounds = getMonthBounds();
    filterDebut = bounds.debut;
    filterFin = bounds.fin;
    setDateInputs(bounds.debut, bounds.fin);
  }
  refreshDashboardWithFilter();
}

function setDateInputs(debut, fin) {
  ['flt-debut','flt-debut-mob'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = debut;
  });
  ['flt-fin','flt-fin-mob'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = fin;
  });
}

function applyCustomFilter() {
  var debut = document.getElementById('flt-debut');
  var fin = document.getElementById('flt-fin');
  if (!debut || !fin) return;
  filterDebut = debut.value || null;
  filterFin = fin.value || null;
  // Synchro mobile
  setDateInputs(debut.value, fin.value);
  // Désactiver les boutons rapides
  ['btn-today','btn-week','btn-month','btn-all'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  refreshDashboardWithFilter();
}

function applyCustomFilterMob() {
  var debut = document.getElementById('flt-debut-mob');
  var fin = document.getElementById('flt-fin-mob');
  if (!debut || !fin) return;
  filterDebut = debut.value || null;
  filterFin = fin.value || null;
  setDateInputs(debut.value, fin.value);
  refreshDashboardWithFilter();
}

function filterVentes(ventes) {
  if (!filterDebut && !filterFin) return ventes;
  return ventes.filter(function(v) {
    if (filterDebut && v.date < filterDebut) return false;
    if (filterFin && v.date > filterFin) return false;
    return true;
  });
}

function filterDeps(deps) {
  if (!filterDebut && !filterFin) return deps;
  return deps.filter(function(d) {
    if (filterDebut && d.date < filterDebut) return false;
    if (filterFin && d.date > filterFin) return false;
    return true;
  });
}

async function refreshDashboardWithFilter() {
  var page = document.querySelector('.page.active');
  if (!page) return;
  var pageId = page.id.replace('page-','');
  if (pageId === 'dashboard') initDashboard();
  else if (pageId === 'depenses') loadDepenses();
  else if (pageId === 'achats') loadAchats();
  else if (pageId === 'analyse') initAnalyse();
}

async function loadAchats() {
  document.getElementById('ach-loading').style.display = 'flex';
  var r = { data: (await dbGet('achats', {})).slice().sort(function(a,b){return b.date>a.date?1:-1;}) };
  document.getElementById('ach-loading').style.display = 'none';
  var data = filterDeps(r.data || []);
  var total = data.reduce(function(s,a){return s+(a.quantite||0)*(a.prix_unitaire||0);}, 0);
  var at = document.getElementById('ach-total');
  if(at) at.textContent = 'Total : ' + fmt(total) + ' GNF';
  document.getElementById('a-body').innerHTML = data.map(function(a) {
    var dateAff = a.date ? formatDateDisplay(a.date) : '—';
    return '<tr>'
      +'<td style="font-family:var(--mono)">'+dateAff+'</td>'
      +'<td>'+a.produit_nom+'</td>'
      +'<td style="font-family:var(--mono)">'+a.quantite+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(a.prix_unitaire)+' GNF</td>'
      +'<td style="font-family:var(--mono)">'+fmt((a.quantite||0)*(a.prix_unitaire||0))+' GNF</td>'
      +'<td style="display:flex;gap:4px">'
        +'<button class="btn btn-accent" style="padding:2px 7px;font-size:10px" '
          +'data-id="'+a.id+'" data-date="'+a.date+'" data-nom="'+a.produit_nom+'" '
          +'data-qte="'+a.quantite+'" data-prix="'+a.prix_unitaire+'" '
          +'onclick="ouvrirModifAchat(this)">Modifier</button>'
        +'<button class="btn btn-danger" style="padding:2px 7px;font-size:10px" '
          +'data-id="'+a.id+'" data-qte="'+a.quantite+'" data-prodid="'+(a.produit_id||'')+'" '
          +'onclick="supprimerAchat(this)">x</button>'
      +'</td>'
      +'</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">Aucun achat pour cette periode</td></tr>';
}



async function initDashboard() {
  try {
    const [ventesAll, depsAll, empAll, primesAll] = await Promise.all([
      dbGet('ventes', {}),
      dbGet('depenses', {}),
      dbGet('employes', {}),
      dbGet('primes', {})
    ]);
    const ventes = filterVentes(ventesAll);
    const deps = filterDeps(depsAll);
    const employes = empAll;
    const primes = primesAll;

    const ca = ventes.reduce(function(s,v) { return s + (v.quantite_vendue||0)*(v.prix_vente||0); }, 0);
    const tdep = deps.reduce(function(s,d) { return s + (d.montant||0); }, 0);
    const tsal = employes.reduce(function(s,e) { return s + (e.salaire||0); }, 0);
    const tpr = primes.reduce(function(s,p) { return s + (p.montant||0); }, 0);
    const ben = ca - tdep - tsal;

    document.getElementById('m-ca').textContent = fmtK(ca);
    document.getElementById('m-dep').textContent = fmtK(tdep);
    document.getElementById('m-sal').textContent = fmtK(tsal + tpr);
    document.getElementById('m-ben').textContent = fmtK(ben);
    document.getElementById('m-ben-s').className = 'metric-sub ' + (ben >= 0 ? 'up' : 'down');

    const byDay = {};
    ventes.forEach(function(v) {
      const d = (v.date||'').substring(5,10);
      byDay[d] = (byDay[d]||0) + (v.quantite_vendue||0)*(v.prix_vente||0);
    });
    const dayLabels = Object.keys(byDay).sort();
    mk('c-dash1', { type:'bar', data: { labels: dayLabels, datasets: [{ data: dayLabels.map(function(d){return byDay[d];}), backgroundColor: '#6ee7b7', borderRadius: 4 }] } });

    const byProd = {};
    ventes.forEach(function(v) { byProd[v.produit_nom] = (byProd[v.produit_nom]||0) + (v.quantite_vendue||0)*(v.prix_vente||0); });
    const top5 = Object.entries(byProd).sort(function(a,b){return b[1]-a[1];}).slice(0,5);
    mk('c-dash2', { type:'bar', data: { labels: top5.map(function(x){return x[0].split(' ').slice(0,2).join(' ');}), datasets: [{ data: top5.map(function(x){return x[1];}), backgroundColor: ['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171'], borderRadius: 4 }] }, options: { indexAxis:'y' } });

    const lastVentes = ventes.filter(function(v){return v.quantite_vendue>0;}).sort(function(a,b){return new Date(b.date)-new Date(a.date);}).slice(0,10);
    const lv = document.getElementById('last-ventes-date');
    if (lv) lv.textContent = lastVentes.length ? lastVentes[0].date : '';
    document.getElementById('dash-ventes-body').innerHTML = lastVentes.map(function(v) {
      return '<tr><td>'+v.produit_nom+'</td><td>'+v.quantite_vendue+'</td><td>'+fmt(v.prix_vente)+'</td><td>'+fmt((v.quantite_vendue||0)*(v.prix_vente||0))+'</td><td>'+(v.gerant||'—')+'</td></tr>';
    }).join('') || '<tr><td colspan="5" class="empty">Aucune vente</td></tr>';
  } catch(e) { showToast('Erreur chargement dashboard', 'error'); console.error(e); }
}

async function initVentes() {
  const r = { data: await dbGet('produits', {order: 'nom'}) };
  const produits = r.data || [];
  window._produits = produits;
  // Charger les gérants depuis la table employes
  await chargerGerants();
  // Charger les stocks pour la date sélectionnée
  var date = document.getElementById('v-date') ? document.getElementById('v-date').value : todayISO();
  await chargerStocksDate(date);
}

async function chargerGerants() {
  var employes = await dbGet('employes', {});
  // Filtrer les gérants uniquement
  var gerants = employes.filter(function(e) {
    return e.poste && e.poste.toLowerCase().includes('gerant');
  });
  // Si aucun gérant trouvé, prendre tous les employés
  if (!gerants.length) gerants = employes;
  var sel = document.getElementById('v-gerant');
  if (!sel) return;
  var current = sel.value;
  sel.innerHTML = gerants.map(function(e) {
    return '<option value="'+e.nom+'"'+(e.nom===current?' selected':'')+'>'+e.nom+'</option>';
  }).join('');
}

async function chargerStocksDate(date) {
  var produits = window._produits || [];
  if (!produits.length) {
    var r = await dbGet('produits', {order: 'nom'});
    produits = r || [];
    window._produits = produits;
  }

  // Chercher les ventes existantes pour cette date
  var ventesDate = (await dbGet('ventes', {})).filter(function(v){ return v.date === date; });
  // Si des ventes existent, mettre à jour le gérant automatiquement
  if (ventesDate.length > 0 && ventesDate[0].gerant) {
    var selGerant = document.getElementById('v-gerant');
    if (selGerant) {
      // Chercher l'option correspondante
      var found = false;
      for (var o = 0; o < selGerant.options.length; o++) {
        if (selGerant.options[o].value === ventesDate[0].gerant) {
          selGerant.selectedIndex = o;
          found = true;
          break;
        }
      }
      // Si gérant pas dans la liste, l'ajouter temporairement
      if (!found) {
        var opt = document.createElement('option');
        opt.value = ventesDate[0].gerant;
        opt.text = ventesDate[0].gerant;
        selGerant.add(opt);
        selGerant.value = ventesDate[0].gerant;
      }
    }
  }

  // Stock initial = restant de la veille SEULEMENT si la veille a été saisie
  var today = todayISO();
  var dateObj = new Date(date);
  dateObj.setDate(dateObj.getDate() - 1);
  var veille = dateObj.toISOString().split('T')[0];
  var ventesVeille = (await dbGet('ventes', {})).filter(function(v){ return v.date === veille; });
  // Si date dans le futur ou veille sans données → stock initial = 0
  var veilleDisponible = ventesVeille.length > 0;
  var dateFuture = date > today;

  document.getElementById('v-body').innerHTML = produits.map(function(p,i) {
    // Si vente existante pour cette date → préremplir avec ses valeurs
    var venteExist = ventesDate.find(function(v){ return v.produit_nom === p.nom; });
    var venteVeille = ventesVeille.find(function(v){ return v.produit_nom === p.nom; });

    // Logique stock initial :
    // 1. Date déjà saisie → utiliser la valeur saisie
    // 2. Veille disponible et date non future → restant de la veille
    // 3. Sinon → 0
    var stockInit;
    if (venteExist) {
      stockInit = venteExist.stock_initial || 0;
    } else if (veilleDisponible && !dateFuture && venteVeille) {
      stockInit = venteVeille.stock_apres || 0;
    } else {
      stockInit = 0;
    }
    var stockRecu = venteExist ? (venteExist.stock_recu || 0) : 0;
    var stockApres = venteExist ? (venteExist.stock_apres || 0) : 0;
    var estSaisi = venteExist ? true : false;

    var rowStyle = estSaisi ? 'background:rgba(110,231,183,0.04)' : '';
    var label = estSaisi ? '<span class="badge badge-green" style="font-size:9px">Saisi</span>' : '';

    return '<tr style="'+rowStyle+'">'
      +'<td>'+p.nom+' '+label+'</td>'
      +'<td><input type="number" value="'+stockInit+'" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>'
      +'<td><input type="number" value="'+stockRecu+'" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>'
      +'<td><input type="number" value="'+stockApres+'" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>'
      +'<td id="vs-'+i+'" style="font-weight:500;color:var(--accent);font-family:var(--mono)">0</td>'
      +'<td style="font-family:var(--mono)">'+fmt(p.prix_vente)+'</td>'
      +'<td id="vr-'+i+'" style="font-family:var(--mono)">0</td></tr>';
  }).join('');
  recalcV();
}

function recalcV() {
  var total = 0;
  (window._produits || []).forEach(function(p, i) {
    var row = document.getElementById('v-body') && document.getElementById('v-body').rows[i];
    if (!row) return;
    var init = parseInt(row.cells[1].querySelector('input').value)||0;
    var recu = parseInt(row.cells[2].querySelector('input').value)||0;
    var after = parseInt(row.cells[3].querySelector('input').value)||0;
    var sold = Math.max(0, init + recu - after);
    var es = document.getElementById('vs-'+i);
    var er = document.getElementById('vr-'+i);
    if(es) es.textContent = sold;
    if(er) er.textContent = fmt(sold * p.prix_vente);
    total += sold * p.prix_vente;
  });
  var vt = document.getElementById('v-total-label');
  if(vt) vt.textContent = 'Total : ' + fmt(total) + ' GNF';
}

async function saveVentes() {
  var date = document.getElementById('v-date').value;
  var gerant = document.getElementById('v-gerant').value;
  var rows = [];
  (window._produits || []).forEach(function(p, i) {
    var row = document.getElementById('v-body') && document.getElementById('v-body').rows[i];
    if (!row) return;
    var init = parseInt(row.cells[1].querySelector('input').value)||0;
    var recu = parseInt(row.cells[2].querySelector('input').value)||0;
    var after = parseInt(row.cells[3].querySelector('input').value)||0;
    var sold = Math.max(0, init + recu - after);
    if (sold > 0) rows.push({ date: date, produit_id: p.id, produit_nom: p.nom, stock_initial: init, stock_recu: recu, stock_apres: after, quantite_vendue: sold, prix_vente: p.prix_vente, gerant: gerant });
  });
  if (!rows.length) { showToast('Aucune vente a enregistrer', 'error'); return; }
  var r = await db.from('ventes').insert(rows);
  if (r.error) { showToast('Erreur: ' + r.error.message, 'error'); return; }
  for (var i=0; i<rows.length; i++) {
    await db.from('produits').update({ stock: rows[i].stock_apres }).eq('id', rows[i].produit_id);
  }
  invalidateCache('ventes'); invalidateCache('produits'); showToast(rows.length + ' ventes enregistrees !');
}


// ============================================
// FILTRE HISTORIQUE VENTES
// ============================================
var vhDebut = null;
var vhFin = null;

function setVhFilter(type) {
  // Boutons actifs
  ['vh-btn-today','vh-btn-week','vh-btn-month','vh-btn-all'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activeBtn = document.getElementById('vh-btn-'+type);
  if (activeBtn) activeBtn.classList.add('active');

  var today = todayISO();
  if (type === 'today') {
    vhDebut = today; vhFin = today;
  } else if (type === 'week') {
    var b = getWeekBounds(); vhDebut = b.debut; vhFin = b.fin;
  } else if (type === 'month') {
    var b = getMonthBounds(); vhDebut = b.debut; vhFin = b.fin;
  } else {
    vhDebut = null; vhFin = null;
  }
  // Mettre à jour les inputs date
  var deb = document.getElementById('vh-debut');
  var fin = document.getElementById('vh-fin');
  if (deb) deb.value = vhDebut || '';
  if (fin) fin.value = vhFin || '';
  loadHistVentes();
}

function applyVhCustomFilter() {
  var deb = document.getElementById('vh-debut');
  var fin = document.getElementById('vh-fin');
  vhDebut = deb ? deb.value || null : null;
  vhFin = fin ? fin.value || null : null;
  ['vh-btn-today','vh-btn-week','vh-btn-month','vh-btn-all'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  loadHistVentes();
}

var _loadingHist = false;
async function loadHistVentes() {
  if (_loadingHist) return; // éviter les appels simultanés
  _loadingHist = true;
  try {
  document.getElementById('hist-loading').style.display = 'flex';
  // Charger toutes les ventes depuis le cache
  var toutesVentes = await dbGet('ventes', {});
  document.getElementById('hist-loading').style.display = 'none';

  // Appliquer le filtre de période
  var ventes = toutesVentes.slice();
  if (vhDebut) ventes = ventes.filter(function(v){ return v.date >= vhDebut; });
  if (vhFin) ventes = ventes.filter(function(v){ return v.date <= vhFin; });

  // Trier par date décroissante
  ventes.sort(function(a,b){ return b.date > a.date ? 1 : -1; });

  // Afficher
  document.getElementById('vh-body').innerHTML = ventes.map(function(v) {
    var dateAff = v.date ? formatDateDisplay(v.date) : '—';
    var revenu = (v.quantite_vendue||0) * (v.prix_vente||0);
    return '<tr>'
      +'<td style="font-family:var(--mono)">'+dateAff+'</td>'
      +'<td>'+v.produit_nom+'</td>'
      +'<td style="font-family:var(--mono)">'+v.quantite_vendue+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(v.prix_vente)+' GNF</td>'
      +'<td style="font-family:var(--mono);font-weight:500;color:var(--accent)">'+fmt(revenu)+' GNF</td>'
      +'<td>'+(v.gerant||'—')+'</td>'
      +'</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">Aucune vente pour cette periode</td></tr>';
  } finally {
    _loadingHist = false;
  }
}

async function initStocks() {
  document.getElementById('stock-loading').style.display = 'flex';
  var r = await db.from('produits').select('*').order('stock', {ascending: false});
  document.getElementById('stock-loading').style.display = 'none';
  var produits = r.data || [];
  var ok=0, faible=0, rupture=0;
  var low = [];
  document.getElementById('s-body').innerHTML = produits.map(function(p) {
    var seuil = p.seuil_alerte || 10;
    var pct = Math.min(100, Math.round((p.stock||0)/120*100));
    var st = (p.stock||0) === 0 ? 'rupture' : (p.stock||0) <= seuil ? 'faible' : 'ok';
    if(st==='ok') ok++; else if(st==='faible'){faible++;low.push(p.nom);} else{rupture++;low.push(p.nom);}
    var col = st==='ok'?'#6ee7b7':st==='faible'?'#fbbf24':'#f87171';
    var bc = st==='ok'?'badge-green':st==='faible'?'badge-yellow':'badge-red';
    var bt = st==='ok'?'En stock':st==='faible'?'Faible':'Rupture';
    return '<tr>'
      +'<td>'+p.nom+'</td>'
      +'<td style="font-family:var(--mono);font-weight:500">'+(p.stock||0)+'</td>'
      +'<td style="min-width:80px"><div class="prog"><div class="prog-fill" style="width:'+pct+'%;background:'+col+'"></div></div></td>'
      +'<td style="font-family:var(--mono)">'+fmt(p.prix_vente||0)+' GNF</td>'
      +'<td>'
        +'<div style="display:flex;align-items:center;gap:4px">'
          +'<input type="number" value="'+(p.prix_achat||0)+'" min="0" id="prixachat-'+p.id+'" '
            +'style="width:80px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:2px 5px;font-size:11px;font-family:var(--mono)" placeholder="0">'
          +'<button class="btn" style="padding:2px 7px;font-size:10px" data-id="'+p.id+'" onclick="savePrixAchat(this.dataset.id)">OK</button>'
        +'</div>'
      +'</td>'
      +'<td><span class="badge '+bc+'">'+bt+'</span></td>'
      +'<td><div style="display:flex;align-items:center;gap:4px">'
        +'<input type="number" value="'+seuil+'" min="0" max="999" id="seuil-'+p.id+'" '
          +'style="width:55px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:2px 5px;font-size:11px;font-family:var(--mono)">'
        +'<button class="btn btn-accent" style="padding:2px 7px;font-size:10px" data-id="'+p.id+'" onclick="saveSeuil(this.dataset.id)">OK</button>'
      +'</div></td>'
      +'</tr>';
  }).join('');
  var al = document.getElementById('stock-alert-txt');
  if (low.length && al) al.textContent = String.fromCharCode(9888)+' '+low.length+' alerte(s)';
  else if (al) al.textContent = '';
  var top12 = produits.slice(0,12);
  mk('c-stock', {type:'bar',data:{labels:top12.map(function(p){return p.nom.split(' ').slice(0,2).join(' ');}),datasets:[{data:top12.map(function(p){return p.stock||0;}),backgroundColor:top12.map(function(p){return (p.stock||0)===0?'#f87171':(p.stock||0)<=(p.seuil_alerte||10)?'#fbbf24':'#6ee7b7';}),borderRadius:3}]},options:{indexAxis:'y'}});
  mk('c-stock-pie',{type:'pie',data:{labels:['En stock','Faible','Rupture'],datasets:[{data:[ok,faible,rupture],backgroundColor:['#6ee7b7','#fbbf24','#f87171'],borderWidth:0}]},options:{plugins:{legend:{display:true,position:'bottom',labels:{color:'#9090a8',font:{size:10}}}}}});
}


async function savePrixAchat(produitId) {
  var input = document.getElementById('prixachat-'+produitId);
  if (!input) return;
  var prix = parseInt(input.value) || 0;
  var r = await db.from('produits').update({ prix_achat: prix }).eq('id', produitId);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }
  invalidateCache('produits');
  showToast('Prix achat mis a jour !');
  // Mettre à jour aussi initAchats pour refléter le nouveau prix
  initStocks();
}

async function saveSeuil(produitId) {
  var input = document.getElementById('seuil-'+produitId);
  if (!input) return;
  var seuil = parseInt(input.value) || 0;
  var r = await db.from('produits').update({ seuil_alerte: seuil }).eq('id', produitId);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }
  invalidateCache('produits');
  showToast('Seuil mis a jour !');
  initStocks();
}

async function loadDepenses() {
  document.getElementById('dep-loading').style.display = 'flex';
  var r = { data: (await dbGet('depenses', {})).slice().sort(function(a,b){return b.date>a.date?1:-1;}) };
  document.getElementById('dep-loading').style.display = 'none';
  var data = filterDeps(r.data || []);
  var total = data.reduce(function(s,d){return s+d.montant;}, 0);
  var dt = document.getElementById('dep-total');
  if(dt) dt.textContent = 'Total : ' + fmt(total) + ' GNF';
  document.getElementById('d-body').innerHTML = data.map(function(d) {
    var dateD = d.date ? formatDateDisplay(d.date) : '—'; return '<tr><td style="font-family:var(--mono)">'+dateD+'</td><td>'+d.designation+'</td><td><span class="badge badge-blue">'+d.categorie+'</span></td>'
      +'<td style="font-family:var(--mono)">'+fmt(d.montant)+' GNF</td>'
      +'<td><button class="btn btn-danger" style="padding:2px 7px;font-size:10px" onclick="delDepense(\''+d.id+'\')">x</button></td></tr>';
  }).join('') || '<tr><td colspan="5" class="empty">Aucune depense</td></tr>';
  var cats = {};
  data.forEach(function(d){ cats[d.categorie]=(cats[d.categorie]||0)+d.montant; });
  mk('c-dep', { type:'doughnut', data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor:['#6ee7b7','#3b82f6','#fbbf24'], borderWidth:0 }] }, options: { plugins: { legend: { display:true, position:'bottom', labels:{color:'#9090a8',font:{size:10}} } } } });
}

async function addDepense() {
  var date = document.getElementById('d-date').value;
  var designation = document.getElementById('d-nom').value.trim();
  var montant = parseInt(document.getElementById('d-mont').value)||0;
  var categorie = document.getElementById('d-cat').value;
  if (!designation || !montant) { showToast('Remplissez tous les champs', 'error'); return; }
  var r = await db.from('depenses').insert({ date: date, designation: designation, montant: montant, categorie: categorie });
  if (r.error) { showToast('Erreur: ' + r.error.message, 'error'); return; }
  document.getElementById('d-nom').value = '';
  document.getElementById('d-mont').value = '';
  invalidateCache('depenses'); showToast('Depense enregistree !');
  loadDepenses();
}

async function delDepense(id) {
  await db.from('depenses').delete().eq('id', id);
  invalidateCache('depenses'); showToast('Depense supprimee');
  loadDepenses();
}

async function initAchats() {
  var produits = await dbGet('produits', {order: 'nom'});
  var sel = document.getElementById('a-prod');
  if (sel) {
    sel.innerHTML = produits.map(function(p){
      return '<option value="'+p.id+'" data-nom="'+p.nom+'" data-prix="'+(p.prix_achat||0)+'">'+p.nom+'</option>';
    }).join('');
    // Afficher le prix du premier produit par défaut
    remplirPrixAchat();
  }
  loadAchats();
}

function remplirPrixAchat() {
  var sel = document.getElementById('a-prod');
  var prixInput = document.getElementById('a-prix');
  if (!sel || !prixInput) return;
  var opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  var prix = parseInt(opt.dataset.prix) || 0;
  if (prix > 0) {
    prixInput.value = prix;
    prixInput.style.borderColor = 'rgba(110,231,183,0.4)'; // vert = rempli auto
  } else {
    prixInput.value = '';
    prixInput.style.borderColor = ''; // reset
  }
}

async function loadAchats() {
  document.getElementById('ach-loading').style.display = 'flex';
  var r = { data: (await dbGet('achats', {})).slice().sort(function(a,b){return b.date>a.date?1:-1;}) };
  document.getElementById('ach-loading').style.display = 'none';
  var data = filterDeps(r.data || []); // réutilise filterDeps car même logique date
  var total = data.reduce(function(s,a){return s+(a.quantite||0)*(a.prix_unitaire||0);}, 0);
  var at = document.getElementById('ach-total');
  if(at) at.textContent = 'Total : ' + fmt(total) + ' GNF';
  document.getElementById('a-body').innerHTML = data.map(function(a) {
    return '<tr><td>'+a.date+'</td><td>'+a.produit_nom+'</td>'
      +'<td style="font-family:var(--mono)">'+a.quantite+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(a.prix_unitaire)+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt((a.quantite||0)*(a.prix_unitaire||0))+' GNF</td></tr>';
  }).join('') || '<tr><td colspan="5" class="empty">Aucun achat</td></tr>';
}

async function addAchat() {
  var date = document.getElementById('a-date').value;
  var sel = document.getElementById('a-prod');
  var produit_id = sel.value;
  var produit_nom = sel.options[sel.selectedIndex].dataset.nom;
  var quantite = parseFloat(document.getElementById('a-qte').value)||0;
  var prix_unitaire = parseInt(document.getElementById('a-prix').value)||0;
  if (!quantite || !prix_unitaire) { showToast('Remplissez tous les champs', 'error'); return; }
  var r = await db.from('achats').insert({ date: date, produit_id: produit_id, produit_nom: produit_nom, quantite: quantite, prix_unitaire: prix_unitaire });
  if (r.error) { showToast('Erreur: ' + r.error.message, 'error'); return; }
  var rp = await db.from('produits').select('stock').eq('id', produit_id).single();
  if (rp.data) await db.from('produits').update({ stock: (rp.data.stock||0) + quantite }).eq('id', produit_id);
  document.getElementById('a-qte').value = '';
  document.getElementById('a-prix').value = '';
  invalidateCache('achats'); invalidateCache('produits'); showToast('Achat enregistre !');
  loadAchats();
}

async function loadEmployes() {
  document.getElementById('emp-loading').style.display = 'flex';
  const [emp_e, emp_p, emp_a, emp_pr] = await Promise.all([
    dbGet('employes', {}), dbGet('primes', {}), dbGet('avances', {}), dbGet('presences', {})
  ]);
  var r1={data:emp_e}, r2={data:emp_p}, r3={data:emp_a}, r4={data:emp_pr};
  document.getElementById('emp-loading').style.display = 'none';
  var employes = r1.data || [];
  var primes = r2.data || [];
  var avances = r3.data || [];
  var presences = r4.data || [];
  var COLORS = ['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171','#34d399','#60a5fa'];
  window._employes_data = employes;
  renderEmpListeGlobale(employes, primes, avances, presences);
  loadHistoriqueEmployes();
  if (document.getElementById('emp-grid')) document.getElementById('emp-grid').innerHTML = employes.map(function(e,i) {
    var pr = primes.filter(function(p){return p.employe_id===e.id;}).reduce(function(s,p){return s+p.montant;}, 0);
    var jours = presences.filter(function(p){return p.employe_id===e.id&&p.statut==='present';}).length;
    var col = COLORS[i%COLORS.length];
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px;transition:all .15s" onmouseenter="this.style.borderColor=\''+col+'44\'" onmouseleave="this.style.borderColor=\'rgba(255,255,255,0.07)\'">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
        +'<div style="width:36px;height:36px;border-radius:50%;background:'+col+'22;color:'+col+';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">'+e.nom.substring(0,2)+'</div>'
        +'<button style="background:rgba(110,231,183,0.1);border:1px solid rgba(110,231,183,0.3);color:#6ee7b7;padding:3px 9px;border-radius:6px;font-size:10px;cursor:pointer" data-id="'+e.id+'" onclick="ouvrirModifEmploye(this.dataset.id)">Modifier</button>'
      +'</div>'
      +'<div style="font-size:13px;font-weight:500;color:var(--text)">'+e.nom+'</div>'
      +'<div style="font-size:10px;color:var(--text3);margin-bottom:6px">'+e.poste+'</div>'
      +'<div style="font-size:11px;color:var(--text2);font-family:var(--mono)">'+fmt(e.salaire)+' GNF/mois</div>'
      +'<div style="font-size:10px;color:var(--text3);margin-top:2px">'+jours+' jours · Primes: '+fmt(pr)+' GNF</div>'
      +'<div class="prog" style="margin-top:8px"><div class="prog-fill" style="width:'+Math.min(100,jours/30*100)+'%;background:'+col+'"></div></div>'
      +'</div>';
  }).join('');
}

async function addEmploye() {
  var nom = document.getElementById('e-nom').value.trim();
  var poste = document.getElementById('e-poste').value;
  var date_embauche = document.getElementById('e-date').value;
  var salaire = parseInt(document.getElementById('e-salaire').value)||0;
  var bonus_pct = parseFloat(document.getElementById('e-bonus').value)||0;
  var telephone = document.getElementById('e-tel').value;
  if (!nom || !salaire) { showToast('Nom et salaire obligatoires', 'error'); return; }
  var r = await db.from('employes').insert({ nom: nom, poste: poste, date_embauche: date_embauche, salaire: salaire, bonus_pct: bonus_pct, telephone: telephone });
  if (r.error) { showToast('Erreur: ' + r.error.message, 'error'); return; }
  document.getElementById('e-nom').value = '';
  document.getElementById('e-salaire').value = '';
  invalidateCache('employes'); showToast('Employe ajoute !');
  loadEmployes();
}



// ============================================
// UTILITAIRES DATE
// ============================================
function todayISO() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD pour les inputs
}

function formatDateDisplay(isoDate) {
  if (!isoDate) return '';
  var parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return parts[2] + '/' + parts[1] + '/' + parts[0]; // DD/MM/YYYY
}

function setDefaultDates() {
  var today = todayISO();
  var inputs = ['v-date', 'd-date', 'a-date', 'e-date', 'pr-date', 'mod-date'];
  inputs.forEach(function(id) {
    var el = document.getElementById(id);
    if (el && !el.value) {
      el.value = today;
    }
  });
}

// ============================================
// POSTES — chargés dynamiquement depuis Supabase
// ============================================
var _postes = ['Gerant','Barman','DJ','Serveuse','Agent de securite','Autre']; // défaut

async function chargerPostes() {
  var r = await db.from('postes').select('nom').order('nom');
  if (r.data && r.data.length > 0) {
    _postes = r.data.map(function(p){ return p.nom; });
  }
  // Mettre à jour tous les selects de poste
  var selects = ['e-poste', 'mod-poste'];
  selects.forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = _postes.map(function(p) {
      return '<option value="'+p+'"'+(p===current?' selected':'')+'>'+p+'</option>';
    }).join('');
  });
}

var presencesCache = {};
async function initPresences() {
  const [pres_e, pres_p] = await Promise.all([dbGet('employes', {order:'nom'}), dbGet('presences', {})]);
  var r1={data:pres_e}, r2={data:pres_p};
  window._employes = r1.data || [];
  presencesCache = {};
  (r2.data || []).forEach(function(p) {
    if (!presencesCache[p.employe_id]) presencesCache[p.employe_id] = {};
    var day = parseInt((p.date||'').split('-')[2]);
    presencesCache[p.employe_id][day] = p.statut;
  });
  var sel = document.getElementById('pres-emp');
  sel.innerHTML = window._employes.map(function(e){ return '<option value="'+e.id+'">'+e.nom+'</option>'; }).join('');
  renderCalendar();
  renderPresSummary();
}

function renderCalendar() {
  var empId = document.getElementById('pres-emp').value;
  var hdrs = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  document.getElementById('cal-headers').innerHTML = hdrs.map(function(h){ return '<div class="cal-day header">'+h+'</div>'; }).join('');
  var offset = 6;
  var html = '';
  for(var i=0;i<offset;i++) html += '<div></div>';
  for(var d=1;d<=30;d++) {
    var st = (presencesCache[empId]||{})[d] || '';
    html += '<div class="cal-day '+st+'" onclick="cycleDay(\''+empId+'\','+d+',this)">'+d+'</div>';
  }
  document.getElementById('cal-grid').innerHTML = html;
  var p = presencesCache[empId] || {};
  var pr = Object.values(p).filter(function(v){return v==='present';}).length;
  var ab = Object.values(p).filter(function(v){return v==='absent';}).length;
  var co = Object.values(p).filter(function(v){return v==='conge';}).length;
  var ps = document.getElementById('pres-stats');
  if(ps) ps.textContent = pr+' present(s) - '+ab+' absent(s) - '+co+' conge(s)';
}

async function cycleDay(empId, day, el) {
  var cur = (presencesCache[empId]||{})[day] || '';
  var next = cur===''?'present':cur==='present'?'absent':cur==='absent'?'conge':'';
  if (!presencesCache[empId]) presencesCache[empId] = {};
  presencesCache[empId][day] = next;
  el.className = 'cal-day ' + next;
  var dateStr = '2025-06-' + (day < 10 ? '0'+day : ''+day);
  if (next === '') {
    await db.from('presences').delete().eq('employe_id', empId).eq('date', dateStr);
  } else {
    invalidateCache('presences'); await db.from('presences').upsert({ employe_id: empId, date: dateStr, statut: next }, { onConflict: 'employe_id,date' });
  }
  renderPresSummary();
}

function renderPresSummary() {
  document.getElementById('pres-summary').innerHTML = (window._employes||[]).map(function(e) {
    var p = presencesCache[e.id] || {};
    var pr = Object.values(p).filter(function(v){return v==='present';}).length;
    var ab = Object.values(p).filter(function(v){return v==='absent';}).length;
    var co = Object.values(p).filter(function(v){return v==='conge';}).length;
    var taux = pr+ab+co > 0 ? Math.round(pr/(pr+ab+co)*100) : 0;
    return '<tr><td>'+e.nom+'</td><td>'+e.poste+'</td>'
      +'<td><span class="badge badge-green">'+pr+'</span></td>'
      +'<td><span class="badge badge-red">'+ab+'</span></td>'
      +'<td><span class="badge badge-yellow">'+co+'</span></td>'
      +'<td style="font-family:var(--mono)">'+taux+'%</td></tr>';
  }).join('');
}

async function initSalaires() {
  document.getElementById('sal-loading').style.display = 'flex';
  const [sal_e, sal_p, sal_a] = await Promise.all([dbGet('employes',{}), dbGet('primes',{}), dbGet('avances',{})]);
  var r1={data:sal_e}, r2={data:sal_p}, r3={data:sal_a};
  document.getElementById('sal-loading').style.display = 'none';
  var employes = r1.data || [];
  var primes = r2.data || [];
  var avances = r3.data || [];
  var tsal = employes.reduce(function(s,e){return s+e.salaire;}, 0);
  var tpr = primes.reduce(function(s,p){return s+p.montant;}, 0);
  var tav = avances.reduce(function(s,a){return s+a.montant;}, 0);
  document.getElementById('sal-metrics').innerHTML =
    '<div class="metric"><div class="metric-label">Masse salariale</div><div class="metric-value">'+fmtK(tsal)+'</div><div class="metric-sub down">GNF/mois</div></div>'
    +'<div class="metric"><div class="metric-label">Total primes</div><div class="metric-value">'+fmtK(tpr)+'</div><div class="metric-sub up">GNF</div></div>'
    +'<div class="metric"><div class="metric-label">Total avances</div><div class="metric-value">'+fmtK(tav)+'</div><div class="metric-sub down">GNF</div></div>';
  var empData = employes.map(function(e) {
    return {
      nom: e.nom, poste: e.poste, salaire: e.salaire,
      pr: primes.filter(function(p){return p.employe_id===e.id;}).reduce(function(s,p){return s+p.montant;}, 0),
      av: avances.filter(function(a){return a.employe_id===e.id;}).reduce(function(s,a){return s+a.montant;}, 0)
    };
  });
  mk('c-sal', { type:'bar', data: { labels: empData.map(function(e){return e.nom;}), datasets: [
    { label:'Salaire', data: empData.map(function(e){return e.salaire;}), backgroundColor:'#6ee7b7', borderRadius:3 },
    { label:'Primes', data: empData.map(function(e){return e.pr;}), backgroundColor:'#3b82f6', borderRadius:3 }
  ]}, options: { scales: { x:{stacked:true,grid:{display:false},ticks:{color:'#5a5a72',font:{size:10}}}, y:{stacked:true,grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#5a5a72',font:{size:10},callback:function(v){return fmtK(v);}}} }, plugins:{legend:{display:true,position:'bottom',labels:{color:'#9090a8',font:{size:10}}}}} });
  mk('c-sal-pie', { type:'doughnut', data: { labels: empData.map(function(e){return e.nom;}), datasets:[{ data: empData.map(function(e){return e.salaire+e.pr;}), backgroundColor:['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171','#34d399','#60a5fa'], borderWidth:0 }] }, options: { plugins:{legend:{display:true,position:'bottom',labels:{color:'#9090a8',font:{size:10}}}} }});
  document.getElementById('sal-body').innerHTML = empData.map(function(e) {
    var net = e.salaire + e.pr - e.av;
    return '<tr><td>'+e.nom+'</td><td>'+e.poste+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(e.salaire)+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(e.pr)+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(e.av)+'</td>'
      +'<td style="font-family:var(--mono);font-weight:500;color:var(--accent)">'+fmt(net)+' GNF</td></tr>';
  }).join('');
}


// Postes charges depuis Supabase via chargerPostes()

async function ouvrirModifEmploye(empId) {
  var emp = (window._employes_data||[]).find(function(e){return e.id===empId;});
  if (!emp) return;
  // Recharger les postes depuis Supabase
  await chargerPostes();
  // Remplir le formulaire
  document.getElementById('mod-id').value = emp.id;
  document.getElementById('mod-nom').value = emp.nom;
  // Sélectionner le bon poste
  var selPoste = document.getElementById('mod-poste');
  if (selPoste) selPoste.value = emp.poste;
  // Date d'embauche
  var modDate = document.getElementById('mod-date');
  if (modDate && emp.date_embauche) modDate.value = emp.date_embauche;
  document.getElementById('mod-salaire').value = emp.salaire;
  document.getElementById('mod-bonus').value = emp.bonus_pct || 0;
  document.getElementById('mod-tel').value = emp.telephone || '';
  var modObs = document.getElementById('mod-observation');
  if (modObs) modObs.value = emp.observation || '';
  // Afficher le panneau
  document.getElementById('modif-panel').style.display = 'block';
  document.getElementById('modif-panel').scrollIntoView({behavior:'smooth'});
}

async function sauvegarderModifEmploye() {
  var id = document.getElementById('mod-id').value;
  var nom = document.getElementById('mod-nom').value.trim();
  var poste = document.getElementById('mod-poste').value;
  var salaire = parseInt(document.getElementById('mod-salaire').value)||0;
  var bonus_pct = parseFloat(document.getElementById('mod-bonus').value)||0;
  var telephone = document.getElementById('mod-tel').value.trim();
  if (!nom || !salaire) { showToast('Nom et salaire obligatoires', 'error'); return; }
  var observation = document.getElementById('mod-observation') ? document.getElementById('mod-observation').value.trim() : '';
  // Récupérer l'ancien employé pour comparer
  var empAvant = (window._employes_data||[]).find(function(e){return e.id===id;});
  var r = await db.from('employes').update({nom:nom, poste:poste, salaire:salaire, bonus_pct:bonus_pct, telephone:telephone, observation:observation}).eq('id', id);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }
  // Enregistrer l'historique des changements
  if (empAvant) {
    var lignesHistorique = [];
    var champs = [
      {champ:'Nom', avant:empAvant.nom, apres:nom},
      {champ:'Poste', avant:empAvant.poste, apres:poste},
      {champ:'Salaire', avant:String(empAvant.salaire), apres:String(salaire)},
      {champ:'Bonus %', avant:String(empAvant.bonus_pct||0), apres:String(bonus_pct)},
      {champ:'Telephone', avant:empAvant.telephone||'', apres:telephone},
    ];
    champs.forEach(function(c) {
      if (c.avant !== c.apres) {
        lignesHistorique.push({
          employe_id: id,
          employe_nom: nom,
          champ_modifie: c.champ,
          ancienne_valeur: c.avant || '—',
          nouvelle_valeur: c.apres || '—',
          observation: observation || '—',
          modifie_par: currentUser ? currentUser.email : 'inconnu'
        });
      }
    });
    if (lignesHistorique.length > 0) {
      await db.from('employes_historique').insert(lignesHistorique);
    }
  }
  invalidateCache('employes');
  document.getElementById('modif-panel').style.display = 'none';
  showToast('Employe mis a jour !');
  loadEmployes();
}

async function supprimerEmploye() {
  var id = document.getElementById('mod-id').value;
  var nom = document.getElementById('mod-nom').value;
  if (!confirm('Supprimer '+nom+' ? Cette action est irreversible.')) return;
  var r = await db.from('employes').delete().eq('id', id);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }
  invalidateCache('employes');
  document.getElementById('modif-panel').style.display = 'none';
  showToast('Employe supprime');
  loadEmployes();
}

async function openAddPrime() {
  var r = await db.from('employes').select('id,nom').order('nom');
  var employes = r.data || [];
  var type = prompt('Type (Prime performance / Bonus / Avance) :');
  if (!type) return;
  var list = employes.map(function(e){return e.nom+': '+e.id;}).join('\n');
  var empId = prompt('ID employe :\n' + list);
  if (!empId) return;
  var montant = parseInt(prompt('Montant (GNF) :'))||0;
  if (!montant) return;
  var date = prompt('Date (YYYY-MM-DD) :') || new Date().toISOString().split('T')[0];
  if (type.toLowerCase().indexOf('avance') !== -1) {
    await db.from('avances').insert({ employe_id: empId, montant: montant, date: date, note: 'Avance sur salaire' });
  } else {
    await db.from('primes').insert({ employe_id: empId, type_prime: type, montant: montant, date: date });
  }
  invalidateCache('primes'); invalidateCache('avances'); showToast('Enregistre !');
  initSalaires();
}

async function initAnalyse() {
  const [an_v, an_a, an_e] = await Promise.all([dbGet('ventes',{}), dbGet('achats',{}), dbGet('employes',{})]);
  var r1={data:an_v}, r2={data:an_a}, r3={data:an_e};
  var ventes = r1.data || [];
  var achats = r2.data || [];
  var employes = r3.data || [];
  var byProd = {};
  ventes.forEach(function(v) {
    if (!byProd[v.produit_nom]) byProd[v.produit_nom] = { rev:0, qVen:0, cAch:0, qAch:0 };
    byProd[v.produit_nom].rev += (v.quantite_vendue||0)*(v.prix_vente||0);
    byProd[v.produit_nom].qVen += v.quantite_vendue||0;
  });
  achats.forEach(function(a) {
    if (!byProd[a.produit_nom]) byProd[a.produit_nom] = { rev:0, qVen:0, cAch:0, qAch:0 };
    byProd[a.produit_nom].cAch += (a.quantite||0)*(a.prix_unitaire||0);
    byProd[a.produit_nom].qAch += a.quantite||0;
  });
  var prodData = Object.entries(byProd).map(function(x) {
    var n=x[0], d=x[1];
    return { n:n, rev:d.rev, qVen:d.qVen, cAch:d.cAch, qAch:d.qAch, marge:d.rev-d.cAch, pct:d.rev>0?Math.round((d.rev-d.cAch)/d.rev*100):0 };
  }).sort(function(a,b){return b.marge-a.marge;});
  var totRev = prodData.reduce(function(s,d){return s+d.rev;}, 0);
  var totAch = prodData.reduce(function(s,d){return s+d.cAch;}, 0);
  var totMarge = totRev - totAch;
  document.getElementById('an-metrics').innerHTML =
    '<div class="metric"><div class="metric-label">Revenus totaux</div><div class="metric-value">'+fmtK(totRev)+'</div><div class="metric-sub up">GNF</div></div>'
    +'<div class="metric"><div class="metric-label">Couts achat</div><div class="metric-value">'+fmtK(totAch)+'</div><div class="metric-sub down">GNF</div></div>'
    +'<div class="metric"><div class="metric-label">Marge brute</div><div class="metric-value '+(totMarge>=0?'up':'down')+'">'+fmtK(totMarge)+'</div><div class="metric-sub '+(totMarge>=0?'up':'down')+'">GNF</div></div>';
  var top10 = prodData.slice(0,10);
  mk('c-an1', { type:'bar', data: { labels: top10.map(function(d){return d.n.split(' ').slice(0,2).join(' ');}), datasets:[{ data: top10.map(function(d){return d.marge;}), backgroundColor: top10.map(function(d){return d.marge>=0?'#6ee7b7':'#f87171';}), borderRadius:3 }] }, options:{indexAxis:'y'} });
  document.getElementById('an-body').innerHTML = prodData.filter(function(d){return d.rev>0||d.cAch>0;}).map(function(d) {
    return '<tr><td>'+d.n+'</td><td style="font-family:var(--mono)">'+d.qAch+'</td><td style="font-family:var(--mono)">'+fmt(d.cAch)+'</td><td style="font-family:var(--mono)">'+d.qVen+'</td><td style="font-family:var(--mono)">'+fmt(d.rev)+'</td>'
      +'<td><span class="badge '+(d.marge>=0?'badge-green':'badge-red')+'">'+fmt(d.marge)+' GNF</span></td><td style="font-family:var(--mono)">'+d.pct+'%</td></tr>';
  }).join('');
  var tsal = employes.reduce(function(s,e){return s+e.salaire;}, 0);
  var salJour = Math.round(tsal/30);
  var byDay = {};
  ventes.forEach(function(v){ byDay[v.date]=(byDay[v.date]||0)+(v.quantite_vendue||0)*(v.prix_vente||0); });
  var days = Object.keys(byDay).sort();
  var caVals = days.map(function(d){return byDay[d];});
  var ratio = caVals.map(function(ca){return ca>0?Math.round(salJour/ca*100):0;});
  var validRatio = ratio.filter(function(r){return r>0;});
  var avgRatio = validRatio.length>0 ? Math.round(validRatio.reduce(function(s,r){return s+r;},0)/validRatio.length) : 0;
  document.getElementById('an-rh-metrics').innerHTML =
    '<div class="metric"><div class="metric-label">Masse salariale/mois</div><div class="metric-value">'+fmtK(tsal)+'</div><div class="metric-sub down">GNF</div></div>'
    +'<div class="metric"><div class="metric-label">Cout RH/jour</div><div class="metric-value">'+fmtK(salJour)+'</div><div class="metric-sub neu">GNF</div></div>'
    +'<div class="metric"><div class="metric-label">Ratio RH/CA moyen</div><div class="metric-value">'+avgRatio+'%</div><div class="metric-sub neu">du CA</div></div>';
  mk('c-an2', { type:'line', data: { labels: days.map(function(d){return d.substring(5);}), datasets:[
    { label:'CA', data:caVals, borderColor:'#6ee7b7', backgroundColor:'rgba(110,231,183,.05)', tension:.3, fill:true, pointRadius:3 },
    { label:'RH/jour', data:days.map(function(){return salJour;}), borderColor:'#f87171', backgroundColor:'rgba(248,113,113,.05)', tension:.3, fill:true, pointRadius:3 }
  ]}, options:{plugins:{legend:{display:true,position:'bottom',labels:{color:'#9090a8',font:{size:10}}}}} });
  mk('c-an3', { type:'bar', data: { labels: days.map(function(d){return d.substring(5);}), datasets:[{ data:ratio, backgroundColor:ratio.map(function(r){return r>50?'#f87171':r>30?'#fbbf24':'#6ee7b7';}), borderRadius:3 }] }, options:{scales:{y:{ticks:{callback:function(v){return v+'%';},color:'#5a5a72',font:{size:10}}}}} });
}

async function exportCSV() {
  var r1 = await db.from('ventes').select('*').order('date');
  var r2 = await db.from('depenses').select('*').order('date');
  var ventes = r1.data || [];
  var deps = r2.data || [];
  var csv = 'RAPPORT BAR MANAGER\n\n=== VENTES ===\nDate,Produit,Vendus,Prix,Revenu,Gerant\n';
  ventes.forEach(function(v){ if(v.quantite_vendue>0) csv+=v.date+','+v.produit_nom+','+v.quantite_vendue+','+v.prix_vente+','+(v.quantite_vendue||0)*(v.prix_vente||0)+','+(v.gerant||'')+'\n'; });
  csv += '\n=== DEPENSES ===\nDate,Designation,Categorie,Montant\n';
  deps.forEach(function(d){ csv+=d.date+','+d.designation+','+d.categorie+','+d.montant+'\n'; });
  var blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bar_rapport.csv'; a.click();
  showToast('Export CSV telecharge');
}

async function exportPDF() {
  var r1 = await db.from('ventes').select('*');
  var r2 = await db.from('depenses').select('*');
  var r3 = await db.from('employes').select('*');
  var ventes = r1.data || [];
  var deps = r2.data || [];
  var employes = r3.data || [];
  var ca = ventes.reduce(function(s,v){return s+(v.quantite_vendue||0)*(v.prix_vente||0);}, 0);
  var tdep = deps.reduce(function(s,d){return s+d.montant;}, 0);
  var tsal = employes.reduce(function(s,e){return s+e.salaire;}, 0);
  var win = window.open('','_blank');
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rapport Bar</title>'
    +'<style>body{font-family:Arial,sans-serif;padding:24px;color:#222;max-width:800px;margin:0 auto}'
    +'h1{font-size:20px;margin-bottom:4px}.sum{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}'
    +'.sc{background:#f5f5f5;padding:12px;border-radius:8px}.sc .l{font-size:10px;color:#888}.sc .v{font-size:18px;font-weight:700;margin-top:2px}'
    +'@media print{button{display:none}}</style></head><body>'
    +'<h1>Rapport Bar Manager</h1>'
    +'<p style="font-size:11px;color:#888">'+new Date().toLocaleDateString('fr-FR')+' '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</p>'
    +'<div class="sum">'
    +'<div class="sc"><div class="l">Chiffre d affaires</div><div class="v">'+fmt(ca)+' GNF</div></div>'
    +'<div class="sc"><div class="l">Depenses</div><div class="v">'+fmt(tdep)+' GNF</div></div>'
    +'<div class="sc"><div class="l">Masse salariale</div><div class="v">'+fmt(tsal)+' GNF</div></div>'
    +'</div>'
    +'<button onclick="window.print()" style="padding:8px 18px;background:#222;color:#fff;border:none;border-radius:6px;cursor:pointer">Imprimer / PDF</button>'
    +'</body></html>');
  win.document.close();
}


// ============================================
// GESTION DES POSTES
// ============================================
async function loadPostes() {
  var loading = document.getElementById('postes-loading');
  if (loading) loading.style.display = 'flex';
  var r = await db.from('postes').select('*').order('nom');
  if (loading) loading.style.display = 'none';
  var postes = r.data || [];
  var tbody = document.getElementById('postes-body');
  if (!tbody) return;
  tbody.innerHTML = postes.map(function(p) {
    return '<tr>'
      +'<td style="font-weight:500">'+p.nom+'</td>'
      +'<td><button class="btn btn-danger" style="padding:2px 8px;font-size:10px" '
        +'data-id="'+p.id+'" data-nom="'+p.nom+'" onclick="supprimerPoste(this.dataset.id, this.dataset.nom)">Supprimer</button></td>'
      +'</tr>';
  }).join('') || '<tr><td colspan="2" class="empty">Aucun poste</td></tr>';
}

async function ajouterPoste() {
  var nom = document.getElementById('new-poste-nom').value.trim();
  if (!nom) { showToast('Entrez un nom de poste', 'error'); return; }
  var r = await db.from('postes').insert({ nom: nom });
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }
  document.getElementById('new-poste-nom').value = '';
  showToast('Poste "'+nom+'" ajoute !');
  await chargerPostes();
  loadPostes();
}

async function supprimerPoste(id, nom) {
  if (!confirm('Supprimer le poste "'+nom+'" ?')) return;
  var r = await db.from('postes').delete().eq('id', id);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }
  showToast('Poste supprime');
  await chargerPostes();
  loadPostes();
}




// ============================================
// HISTORIQUE DES MODIFICATIONS EMPLOYÉS
// ============================================
async function loadHistoriqueEmployes() {
  var r = await db.from('employes_historique')
    .select('*')
    .order('modifie_le', {ascending: false})
    .limit(100);
  var data = r.data || [];
  var tbody = document.getElementById('historique-body');
  if (!tbody) return;
  tbody.innerHTML = data.map(function(h) {
    var date = h.modifie_le
      ? formatDateDisplay(h.modifie_le.split('T')[0]) + ' ' + h.modifie_le.split('T')[1].substring(0,5)
      : '—';
    return '<tr>'
      +'<td style="font-family:var(--mono);font-size:10px">'+date+'</td>'
      +'<td style="font-weight:500;color:var(--text)">'+h.employe_nom+'</td>'
      +'<td><span class="badge badge-blue">'+h.champ_modifie+'</span></td>'
      +'<td style="font-family:var(--mono);color:var(--danger)">'+h.ancienne_valeur+'</td>'
      +'<td style="font-family:var(--mono);color:var(--accent)">'+h.nouvelle_valeur+'</td>'
      +'<td style="font-size:10px;color:var(--text3)">'+h.observation+'</td>'
      +'<td style="font-size:10px;color:var(--text3)">'+h.modifie_par+'</td>'
      +'</tr>';
  }).join('') || '<tr><td colspan="7" class="empty">Aucune modification enregistree</td></tr>';
}

function renderEmpListeGlobale(employes, primes, avances, presences) {
  var tbody = document.getElementById('emp-liste-body');
  if (!tbody) return;

  var COLORS = ['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171','#34d399','#60a5fa'];

  tbody.innerHTML = employes.map(function(e, i) {
    var pr = (primes||[]).filter(function(p){return p.employe_id===e.id;}).reduce(function(s,p){return s+p.montant;}, 0);
    var av = (avances||[]).filter(function(a){return a.employe_id===e.id;}).reduce(function(s,a){return s+a.montant;}, 0);
    var jours = (presences||[]).filter(function(p){return p.employe_id===e.id&&p.statut==='present';}).length;
    var col = COLORS[i % COLORS.length];
    var dateEmb = e.date_embauche ? formatDateDisplay(e.date_embauche) : '—';
    var net = e.salaire + pr - av;

    // updated_at null = jamais modifié intentionnellement
    var updatedAt = '—';
    var updatedBadge = false;
    if (e.updated_at) {
      var d = new Date(e.updated_at);
      var c = new Date(e.created_at || e.updated_at);
      var diffSec = Math.abs(d - c) / 1000;
      if (diffSec > 5) { // modifié plus de 5 secondes après la création
        updatedAt = formatDateDisplay(e.updated_at.split('T')[0]) + ' ' + e.updated_at.split('T')[1].substring(0,5);
        updatedBadge = true;
      }
    }
    return '<tr onclick="ouvrirModifEmploye(this.dataset.id)" data-id="'+e.id+'" style="cursor:pointer">'
      +'<td>'
        +'<div style="display:flex;align-items:center;gap:8px">'
          +'<div style="width:26px;height:26px;border-radius:50%;background:'+col+'22;color:'+col+';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">'+e.nom.substring(0,2)+'</div>'
          +'<span style="font-weight:500;color:var(--text)">'+e.nom+'</span>'
        +'</div>'
      +'</td>'
      +'<td><span class="badge badge-blue">'+e.poste+'</span></td>'
      +'<td style="font-family:var(--mono)">'+dateEmb+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(e.salaire)+' GNF</td>'
      +'<td style="font-family:var(--mono);text-align:center">'+(e.bonus_pct>0?e.bonus_pct+'%':'—')+'</td>'
      +'<td style="font-family:var(--mono)">'+(e.telephone||'—')+'</td>'
      +'<td style="font-size:10px">'+(updatedBadge?'<span class="badge badge-green">'+updatedAt+'</span>':'<span style="color:var(--text3)">—</span>')+'</td>'
      +'<td style="font-size:10px;color:var(--text3);max-width:150px;white-space:normal">'+(e.observation||'—')+'</td>'
      +'</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">Aucun employe</td></tr>';
}


// ============================================
// STOCKS PAR PÉRIODE
// ============================================
var spDebut = null;
var spFin = null;

function setSpFilter(type) {
  ['sp-btn-today','sp-btn-week','sp-btn-month','sp-btn-all'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var btn = document.getElementById('sp-btn-'+type);
  if (btn) btn.classList.add('active');

  var today = todayISO();
  if (type === 'today') {
    spDebut = today; spFin = today;
  } else if (type === 'week') {
    var b = getWeekBounds(); spDebut = b.debut; spFin = b.fin;
  } else if (type === 'month') {
    var b = getMonthBounds(); spDebut = b.debut; spFin = b.fin;
  } else {
    spDebut = null; spFin = null;
  }
  var deb = document.getElementById('sp-debut');
  var fin = document.getElementById('sp-fin');
  if (deb) deb.value = spDebut || '';
  if (fin) fin.value = spFin || '';
  loadStockPeriode();
}

function applySpCustomFilter() {
  var deb = document.getElementById('sp-debut');
  var fin = document.getElementById('sp-fin');
  spDebut = deb ? deb.value || null : null;
  spFin = fin ? fin.value || null : null;
  ['sp-btn-today','sp-btn-week','sp-btn-month','sp-btn-all'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  loadStockPeriode();
}

async function loadStockPeriode() {
  var loading = document.getElementById('sp-loading');
  if (loading) loading.style.display = 'flex';

  var [toutesVentes, tousAchats, produits] = await Promise.all([
    dbGet('ventes', {}),
    dbGet('achats', {}),
    dbGet('produits', {order: 'nom'})
  ]);

  // Filtrer par période
  var ventes = toutesVentes.filter(function(v) {
    if (spDebut && v.date < spDebut) return false;
    if (spFin && v.date > spFin) return false;
    return true;
  });
  var achats = tousAchats.filter(function(a) {
    if (spDebut && a.date < spDebut) return false;
    if (spFin && a.date > spFin) return false;
    return true;
  });

  if (loading) loading.style.display = 'none';

  // Calculer par produit
  var totalRevenu = 0, totalCout = 0, totalMarge = 0;

  var rows = produits.map(function(p) {
    // Ventes du produit sur la période
    var ventesP = ventes.filter(function(v){ return v.produit_nom === p.nom; });
    var qteVendue = ventesP.reduce(function(s,v){ return s+(v.quantite_vendue||0); }, 0);
    var revenu = qteVendue * (p.prix_vente || 0);

    // Achats du produit sur la période
    var achatsP = achats.filter(function(a){ return a.produit_nom === p.nom; });
    var qteAchetee = achatsP.reduce(function(s,a){ return s+(a.quantite||0); }, 0);
    var coutAchat = achatsP.reduce(function(s,a){ return s+(a.quantite||0)*(a.prix_unitaire||0); }, 0);

    // Variation nette = acheté - vendu
    var variation = qteAchetee - qteVendue;
    var marge = revenu - coutAchat;

    totalRevenu += revenu;
    totalCout += coutAchat;
    totalMarge += marge;

    if (qteVendue === 0 && qteAchetee === 0) return null; // ignorer produits sans mouvement

    var varColor = variation >= 0 ? 'var(--accent)' : 'var(--danger)';
    var varSign = variation >= 0 ? '+' : '';
    var margeColor = marge >= 0 ? 'var(--accent)' : 'var(--danger)';

    return '<tr>'
      +'<td style="font-weight:500">'+p.nom+'</td>'
      +'<td style="font-family:var(--mono)">'+fmt(p.prix_vente)+' GNF</td>'
      +'<td style="font-family:var(--mono);text-align:center">'+qteVendue+'</td>'
      +'<td style="font-family:var(--mono);color:var(--accent)">'+fmt(revenu)+' GNF</td>'
      +'<td style="font-family:var(--mono);text-align:center">'+qteAchetee+'</td>'
      +'<td style="font-family:var(--mono);color:var(--danger)">'+fmt(coutAchat)+' GNF</td>'
      +'<td style="font-family:var(--mono);color:'+varColor+';font-weight:500">'+varSign+variation+'</td>'
      +'<td style="font-family:var(--mono);color:'+margeColor+';font-weight:500">'+fmt(marge)+' GNF</td>'
      +'</tr>';
  }).filter(Boolean);

  var tbody = document.getElementById('sp-body');
  if (tbody) tbody.innerHTML = rows.join('') || '<tr><td colspan="8" class="empty">Aucun mouvement sur cette periode</td></tr>';

  // Totaux
  var totaux = document.getElementById('sp-totaux');
  if (totaux) {
    var margeColor = totalMarge >= 0 ? 'var(--accent)' : 'var(--danger)';
    totaux.innerHTML = '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;font-family:var(--mono)">'
      +'<span>Total revenu : <strong style="color:var(--accent)">'+fmt(totalRevenu)+' GNF</strong></span>'
      +'<span>Total cout achats : <strong style="color:var(--danger)">'+fmt(totalCout)+' GNF</strong></span>'
      +'<span>Marge brute totale : <strong style="color:'+margeColor+'">'+fmt(totalMarge)+' GNF</strong></span>'
      +'</div>';
  }

  // Graphiques
  var top8 = produits
    .map(function(p) {
      var qv = ventes.filter(function(v){return v.produit_nom===p.nom;}).reduce(function(s,v){return s+(v.quantite_vendue||0);},0);
      return {nom: p.nom, qv: qv, rev: qv*(p.prix_vente||0)};
    })
    .filter(function(p){return p.qv>0;})
    .sort(function(a,b){return b.qv-a.qv;})
    .slice(0,8);

  mk('c-sp-ventes', {type:'bar', data:{
    labels: top8.map(function(p){return p.nom.split(' ').slice(0,2).join(' ');}),
    datasets:[{data:top8.map(function(p){return p.qv;}), backgroundColor:'rgba(110,231,183,0.6)', borderRadius:3, label:'Qte vendue'}]
  }, options:{plugins:{legend:{display:false}}}});

  var top8m = produits
    .map(function(p) {
      var qv = ventes.filter(function(v){return v.produit_nom===p.nom;}).reduce(function(s,v){return s+(v.quantite_vendue||0);},0);
      var rev = qv*(p.prix_vente||0);
      var cout = achats.filter(function(a){return a.produit_nom===p.nom;}).reduce(function(s,a){return s+(a.quantite||0)*(a.prix_unitaire||0);},0);
      return {nom:p.nom, rev:rev, cout:cout};
    })
    .filter(function(p){return p.rev>0||p.cout>0;})
    .sort(function(a,b){return b.rev-a.rev;})
    .slice(0,8);

  mk('c-sp-marge', {type:'bar', data:{
    labels: top8m.map(function(p){return p.nom.split(' ').slice(0,2).join(' ');}),
    datasets:[
      {data:top8m.map(function(p){return p.rev;}), backgroundColor:'rgba(110,231,183,0.6)', label:'Revenu', borderRadius:3},
      {data:top8m.map(function(p){return p.cout;}), backgroundColor:'rgba(248,113,113,0.6)', label:'Cout', borderRadius:3}
    ]
  }, options:{plugins:{legend:{display:true, position:'bottom', labels:{color:'#9090a8',font:{size:10}}}}}});
}


// ============================================
// MODIFICATION ET SUPPRESSION DES ACHATS
// ============================================
var _achatEnCoursId = null; // id de l'achat en cours de modification

function ouvrirModifAchat(btn) {
  _achatEnCoursId = btn.dataset.id;
  // Remplir le formulaire avec les valeurs existantes
  document.getElementById('a-date').value = btn.dataset.date;
  document.getElementById('a-qte').value = btn.dataset.qte;
  document.getElementById('a-prix').value = btn.dataset.prix;
  // Sélectionner le bon produit
  var sel = document.getElementById('a-prod');
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].dataset.nom === btn.dataset.nom) {
      sel.selectedIndex = i;
      break;
    }
  }
  // Changer le bouton Enregistrer en Mettre à jour
  var btnSave = document.querySelector('#page-achats .btn.btn-accent[onclick="addAchat()"]');
  if (btnSave) {
    btnSave.textContent = 'Mettre a jour';
    btnSave.setAttribute('onclick', 'updateAchat()');
  }
  // Scroller vers le formulaire
  document.getElementById('a-date').scrollIntoView({behavior:'smooth'});
  showToast('Modifiez les valeurs puis cliquez Mettre a jour');
}

async function updateAchat() {
  if (!_achatEnCoursId) { addAchat(); return; }
  var date = document.getElementById('a-date').value;
  var sel = document.getElementById('a-prod');
  var produit_id = sel.value;
  var produit_nom = sel.options[sel.selectedIndex].dataset.nom;
  var quantite = parseFloat(document.getElementById('a-qte').value)||0;
  var prix_unitaire = parseInt(document.getElementById('a-prix').value)||0;
  if (!quantite || !prix_unitaire) { showToast('Remplissez tous les champs', 'error'); return; }

  // Récupérer l'ancienne quantité pour ajuster le stock
  var r0 = await db.from('achats').select('quantite,produit_id').eq('id', _achatEnCoursId).single();
  var ancienneQte = r0.data ? (r0.data.quantite || 0) : 0;
  var ancienProdId = r0.data ? r0.data.produit_id : produit_id;

  // Mettre à jour l'achat
  var r = await db.from('achats').update({
    date: date, produit_id: produit_id, produit_nom: produit_nom,
    quantite: quantite, prix_unitaire: prix_unitaire
  }).eq('id', _achatEnCoursId);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }

  // Ajuster le stock : retirer l'ancienne quantité, ajouter la nouvelle
  var rp = await db.from('produits').select('stock').eq('id', ancienProdId).single();
  if (rp.data) {
    var newStock = (rp.data.stock || 0) - ancienneQte + quantite;
    await db.from('produits').update({ stock: newStock }).eq('id', ancienProdId);
  }

  // Réinitialiser le formulaire
  _achatEnCoursId = null;
  document.getElementById('a-qte').value = '';
  document.getElementById('a-prix').value = '';
  var btnSave = document.querySelector('#page-achats .btn.btn-accent[onclick="updateAchat()"]');
  if (btnSave) {
    btnSave.textContent = 'Enregistrer';
    btnSave.setAttribute('onclick', 'addAchat()');
  }
  invalidateCache('achats'); invalidateCache('produits');
  showToast('Achat mis a jour !');
  loadAchats();
}

async function supprimerAchat(btn) {
  if (!confirm('Supprimer cet achat ?')) return;
  var id = btn.dataset.id;
  var qte = parseFloat(btn.dataset.qte) || 0;
  var prodId = btn.dataset.prodid;

  var r = await db.from('achats').delete().eq('id', id);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }

  // Soustraire la quantité du stock
  if (prodId) {
    var rp = await db.from('produits').select('stock').eq('id', prodId).single();
    if (rp.data) {
      await db.from('produits').update({ stock: Math.max(0, (rp.data.stock||0) - qte) }).eq('id', prodId);
    }
  }
  invalidateCache('achats'); invalidateCache('produits');
  showToast('Achat supprime');
  loadAchats();
}

function go(id, el) {
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  document.getElementById('page-'+id).classList.add('active');
  if(el) el.classList.add('active');
  var titles = { dashboard:'Tableau de bord', ventes:'Ventes', stocks:'Stocks', depenses:'Depenses', achats:'Achats', employes:'Employes', presences:'Presences', salaires:'Salaires', analyse:'Rapports & Analyses' };
  document.getElementById('pg-title').textContent = titles[id]||id;
  if(id==='dashboard') { initDashboard(); setDefaultDates(); }
  else if(id==='ventes') initVentes();
  else if(id==='stocks') initStocks();
  else if(id==='depenses') loadDepenses();
  else if(id==='achats') initAchats();
  else if(id==='employes') { chargerPostes(); loadEmployes(); setDefaultDates(); }
  else if(id==='presences') initPresences();
  else if(id==='salaires') initSalaires();
  else if(id==='analyse') initAnalyse();
  else if(id==='admin') loadAdminUsers();
  else if(id==='primes-gerant') initPrimesGerant();
  // Masquer barre filtre topbar sur Ventes
  var ta = document.getElementById('topbar-actions');
  if (ta) ta.style.display = (id === 'ventes' || id === 'stocks') ? 'none' : 'flex';
}

function swTab(el, tabId) {
  el.closest('.tabs').querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  el.classList.add('active');
  var all = ['vt-saisie','vt-hist','st-actuel','st-periode','emp-list','emp-add','an-prod','an-rh'];
  all.forEach(function(id){ var e=document.getElementById(id); if(e) e.style.display='none'; });
  var target = document.getElementById(tabId);
  if(target) target.style.display='';
  if(tabId==='vt-hist') {
    // Initialiser filtre à Aujourd'hui par défaut
    if (!vhDebut) setVhFilter('today');
    else loadHistVentes();
  }
  if(tabId==='emp-add') loadPostes();
  if(tabId==='st-periode') { if(!spDebut) setSpFilter('month'); else loadStockPeriode(); }
  if(tabId==='st-actuel') initStocks();

}

checkConnection();
initDashboard();

async function loadAdminUsers() {
  var r = await db.from('utilisateurs').select('id,nom,role');
  var users = r.data || [];
  var roles = ['proprietaire','gerant','gerant_jour','comptable'];
  var labels = {'proprietaire':'Proprietaire','gerant':'Gerant principal','gerant_jour':'Gerant du jour','comptable':'Comptable'};
  document.getElementById('admin-users-body').innerHTML = users.map(function(u) {
    var opts = roles.map(function(r){ return '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+labels[r]+'</option>'; }).join('');
    return '<tr><td>'+u.nom+'</td><td><span class="badge badge-green">'+labels[u.role]+'</span></td>'
      +'<td><select onchange="updateUserRole(this.getAttribute(\'data-uid\'),this.value)" data-uid="'+u.id+'" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);font-size:11px;padding:4px 7px;border-radius:6px">'+opts+'</select></td></tr>';
  }).join('');
}

async function updateUserRole(userId, newRole) {
  var r = await db.from('utilisateurs').update({role: newRole}).eq('id', userId);
  if (r.error) { showToast('Erreur: '+r.error.message, 'error'); return; }
  showToast('Role mis a jour !');
}
