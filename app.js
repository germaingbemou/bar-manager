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
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const _cache = {};

async function dbGet(table, query) {
  const key = table + JSON.stringify(query || {});
  const now = Date.now();
  if (_cache[key] && (now - _cache[key].ts) < CACHE_TTL) {
    return _cache[key].data;
  }
  let q = db.from(table).select('*');
  if (query && query.order) q = q.order(query.order, {ascending: query.asc !== false});
  if (query && query.limit) q = q.limit(query.limit);
  if (query && query.eq) q = q.eq(query.eq[0], query.eq[1]);
  const { data, error } = await q;
  if (!error && data) {
    _cache[key] = { data: data, ts: now };
  }
  return data || [];
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
  await initAuth(); await preloadData();
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

let filterDate = 'all';
function applyFilter() {
  filterDate = document.getElementById('flt-date').value;
  const page = document.querySelector('.page.active').id.replace('page-','');
  if (page === 'dashboard') initDashboard();
}

async function initDashboard() {
  try {
    const [ventesAll, depsAll, empAll, primesAll] = await Promise.all([
      dbGet('ventes', {}),
      dbGet('depenses', {}),
      dbGet('employes', {}),
      dbGet('primes', {})
    ]);
    const ventes = filterDate !== 'all' ? ventesAll.filter(function(v){return v.date===filterDate;}) : ventesAll;
    const deps = filterDate !== 'all' ? depsAll.filter(function(d){return d.date===filterDate;}) : depsAll;
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
  document.getElementById('v-body').innerHTML = produits.map(function(p,i) {
    return '<tr><td>'+p.nom+'</td>'
      +'<td><input type="number" value="'+(p.stock||0)+'" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>'
      +'<td><input type="number" value="0" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>'
      +'<td><input type="number" value="'+(p.stock||0)+'" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>'
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

async function loadHistVentes() {
  document.getElementById('hist-loading').style.display = 'flex';
  var r = await db.from('ventes').select('*').order('date', {ascending: false}).limit(100);
  document.getElementById('hist-loading').style.display = 'none';
  var data = r.data || [];
  document.getElementById('vh-body').innerHTML = data.map(function(v) {
    return '<tr><td>'+v.date+'</td><td>'+v.produit_nom+'</td><td>'+v.quantite_vendue+'</td><td>'+fmt(v.prix_vente)+'</td><td>'+fmt((v.quantite_vendue||0)*(v.prix_vente||0))+'</td><td>'+(v.gerant||'—')+'</td></tr>';
  }).join('') || '<tr><td colspan="6" class="empty">Aucune vente</td></tr>';
}

async function initStocks() {
  document.getElementById('stock-loading').style.display = 'flex';
  var allProds = await dbGet('produits', {order: 'nom'}); var r = { data: allProds.slice().sort(function(a,b){return (b.stock||0)-(a.stock||0);}) };
  document.getElementById('stock-loading').style.display = 'none';
  var produits = r.data || [];
  var ok=0, faible=0, rupture=0;
  var low = [];
  document.getElementById('s-body').innerHTML = produits.map(function(p) {
    var pct = Math.min(100, Math.round((p.stock||0)/120*100));
    var st = (p.stock||0) === 0 ? 'rupture' : (p.stock||0) < 10 ? 'faible' : 'ok';
    if(st==='ok') ok++; else if(st==='faible'){faible++;low.push(p.nom);} else{rupture++;low.push(p.nom);}
    var col = st==='ok'?'#6ee7b7':st==='faible'?'#fbbf24':'#f87171';
    var bc = st==='ok'?'badge-green':st==='faible'?'badge-yellow':'badge-red';
    var bt = st==='ok'?'En stock':st==='faible'?'Faible':'Rupture';
    return '<tr><td>'+p.nom+'</td><td style="font-family:var(--mono)">'+(p.stock||0)+'</td>'
      +'<td style="min-width:90px"><div class="prog"><div class="prog-fill" style="width:'+pct+'%;background:'+col+'"></div></div></td>'
      +'<td style="font-family:var(--mono)">'+fmt(p.prix_vente||0)+'</td>'
      +'<td style="font-family:var(--mono)">'+(p.prix_achat>0?fmt(p.prix_achat):'—')+'</td>'
      +'<td><span class="badge '+bc+'">'+bt+'</span></td></tr>';
  }).join('');
  var al = document.getElementById('stock-alert-txt');
  if (low.length && al) al.textContent = '⚠ '+low.length+' alerte(s)';
  var top12 = produits.slice(0,12);
  mk('c-stock', { type:'bar', data: { labels: top12.map(function(p){return p.nom.split(' ').slice(0,2).join(' ');}), datasets: [{ data: top12.map(function(p){return p.stock||0;}), backgroundColor: top12.map(function(p){return (p.stock||0)===0?'#f87171':(p.stock||0)<10?'#fbbf24':'#6ee7b7';}), borderRadius: 3 }] }, options: { indexAxis:'y' } });
  mk('c-stock-pie', { type:'pie', data: { labels: ['En stock','Faible','Rupture'], datasets: [{ data:[ok,faible,rupture], backgroundColor:['#6ee7b7','#fbbf24','#f87171'], borderWidth:0 }] }, options: { plugins: { legend: { display:true, position:'bottom', labels:{color:'#9090a8',font:{size:10}} } } } });
}

async function loadDepenses() {
  document.getElementById('dep-loading').style.display = 'flex';
  var r = { data: (await dbGet('depenses', {})).slice().sort(function(a,b){return b.date>a.date?1:-1;}) };
  document.getElementById('dep-loading').style.display = 'none';
  var data = r.data || [];
  var total = data.reduce(function(s,d){return s+d.montant;}, 0);
  var dt = document.getElementById('dep-total');
  if(dt) dt.textContent = 'Total : ' + fmt(total) + ' GNF';
  document.getElementById('d-body').innerHTML = data.map(function(d) {
    return '<tr><td>'+d.date+'</td><td>'+d.designation+'</td><td><span class="badge badge-blue">'+d.categorie+'</span></td>'
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
  var r = await db.from('produits').select('id,nom').order('nom');
  var produits = r.data || [];
  var sel = document.getElementById('a-prod');
  sel.innerHTML = produits.map(function(p){ return '<option value="'+p.id+'" data-nom="'+p.nom+'">'+p.nom+'</option>'; }).join('');
  loadAchats();
}

async function loadAchats() {
  document.getElementById('ach-loading').style.display = 'flex';
  var r = { data: (await dbGet('achats', {})).slice().sort(function(a,b){return b.date>a.date?1:-1;}) };
  document.getElementById('ach-loading').style.display = 'none';
  var data = r.data || [];
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
  document.getElementById('emp-grid').innerHTML = employes.map(function(e,i) {
    var pr = primes.filter(function(p){return p.employe_id===e.id;}).reduce(function(s,p){return s+p.montant;}, 0);
    var jours = presences.filter(function(p){return p.employe_id===e.id&&p.statut==='present';}).length;
    var col = COLORS[i%COLORS.length];
    return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px;cursor:pointer;transition:all .15s" onmouseenter="this.style.borderColor=\''+col+'44\'" onmouseleave="this.style.borderColor=\'rgba(255,255,255,0.07)\'">'
      +'<div style="width:36px;height:36px;border-radius:50%;background:'+col+'22;color:'+col+';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;margin-bottom:8px">'+e.nom.substring(0,2)+'</div>'
      +'<div style="font-size:13px;font-weight:500;color:var(--text)">'+e.nom+'</div>'
      +'<div style="font-size:10px;color:var(--text3);margin-bottom:8px">'+e.poste+'</div>'
      +'<div style="font-size:11px;color:var(--text2);font-family:var(--mono)">'+fmt(e.salaire)+' GNF</div>'
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

function go(id, el) {
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  document.getElementById('page-'+id).classList.add('active');
  if(el) el.classList.add('active');
  var titles = { dashboard:'Tableau de bord', ventes:'Ventes', stocks:'Stocks', depenses:'Depenses', achats:'Achats', employes:'Employes', presences:'Presences', salaires:'Salaires', analyse:'Rapports & Analyses' };
  document.getElementById('pg-title').textContent = titles[id]||id;
  if(id==='dashboard') initDashboard();
  else if(id==='ventes') initVentes();
  else if(id==='stocks') initStocks();
  else if(id==='depenses') loadDepenses();
  else if(id==='achats') initAchats();
  else if(id==='employes') loadEmployes();
  else if(id==='presences') initPresences();
  else if(id==='salaires') initSalaires();
  else if(id==='analyse') initAnalyse();
  else if(id==='admin') loadAdminUsers();
  else if(id==='primes-gerant') initPrimesGerant();
}

function swTab(el, tabId) {
  el.closest('.tabs').querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  el.classList.add('active');
  var all = ['vt-saisie','vt-hist','emp-list','emp-add','an-prod','an-rh'];
  all.forEach(function(id){ var e=document.getElementById(id); if(e) e.style.display='none'; });
  var target = document.getElementById(tabId);
  if(target) target.style.display='';
  if(tabId==='vt-hist') loadHistVentes();
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
