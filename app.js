// ============================================
// CONFIGURATION SUPABASE
// ============================================
const SUPABASE_URL = 'https://yhygidfyssfgxljbtlmd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KyUpAkclg-xjqMLjSvftIA_oJrJyefV';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const fmt = n => Math.round(n).toLocaleString('fr-FR');
const fmtK = n => n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? Math.round(n/1000)+'k' : Math.round(n);
const charts = {};

function mk(id, cfg) {
  if (charts[id]) charts[id].destroy();
  const el = document.getElementById(id);
  if (!el) return;
  const COLORS = ['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171','#34d399','#60a5fa','#f472b6'];
  if (cfg.data?.datasets) cfg.data.datasets.forEach((ds,i) => {
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
  charts[id] = new Chart(el, { ...cfg, options: { ...defaults, ...cfg.options, plugins: { ...defaults.plugins, ...(cfg.options?.plugins||{}) } } });
}

function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = (type==='success'?'✓ ':'✗ ') + msg;
  t.className = 'toast ' + type;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3000);
}

// ============================================
// CONNEXION SUPABASE
// ============================================
async function checkConnection() {
  try {
    const { data, error } = await db.from('produits').select('count').limit(1);
    if (error) throw error;
    document.getElementById('conn-dot').classList.add('connected');
    document.getElementById('conn-text').textContent = 'Connecté';
    document.getElementById('pg-sub').textContent = 'Base de données en temps réel';
  } catch(e) {
    document.getElementById('conn-text').textContent = 'Erreur connexion';
    document.getElementById('pg-sub').textContent = 'Vérifiez vos clés Supabase';
  }
}

// ============================================
// FILTRE DATE
// ============================================
let filterDate = 'all';
function applyFilter() {
  filterDate = document.getElementById('flt-date').value;
  const page = document.querySelector('.page.active').id.replace('page-','');
  if (page === 'dashboard') initDashboard();
}

// ============================================
// DASHBOARD
// ============================================
async function initDashboard() {
  try {
    let qVentes = db.from('ventes').select('*');
    let qDep = db.from('depenses').select('*');
    if (filterDate !== 'all') { qVentes = qVentes.eq('date', filterDate); qDep = qDep.eq('date', filterDate); }

    const [{ data: ventes }, { data: deps }, { data: employes }, { data: primes }] = await Promise.all([
      qVentes, qDep,
      db.from('employes').select('*'),
      db.from('primes').select('*')
    ]);

    const ca = (ventes||[]).reduce((s,v) => s + (v.quantite_vendue||0)*(v.prix_vente||0), 0);
    const tdep = (deps||[]).reduce((s,d) => s + (d.montant||0), 0);
    const tsal = (employes||[]).reduce((s,e) => s + (e.salaire||0), 0);
    const tpr = (primes||[]).reduce((s,p) => s + (p.montant||0), 0);
    const ben = ca - tdep - tsal;

    document.getElementById('m-ca').textContent = fmtK(ca);
    document.getElementById('m-dep').textContent = fmtK(tdep);
    document.getElementById('m-sal').textContent = fmtK(tsal + tpr);
    document.getElementById('m-ben').textContent = fmtK(ben);
    document.getElementById('m-ben-s').className = 'metric-sub ' + (ben >= 0 ? 'up' : 'down');

    // CA par jour
    const byDay = {};
    (ventes||[]).forEach(v => {
      const d = v.date?.substring(5,10) || '';
      byDay[d] = (byDay[d]||0) + (v.quantite_vendue||0)*(v.prix_vente||0);
    });
    const dayLabels = Object.keys(byDay).sort();
    mk('c-dash1', { type:'bar', data: { labels: dayLabels, datasets: [{ data: dayLabels.map(d=>byDay[d]), backgroundColor: '#6ee7b7', borderRadius: 4 }] } });

    // Top 5 produits
    const byProd = {};
    (ventes||[]).forEach(v => { byProd[v.produit_nom] = (byProd[v.produit_nom]||0) + (v.quantite_vendue||0)*(v.prix_vente||0); });
    const top5 = Object.entries(byProd).sort((a,b)=>b[1]-a[1]).slice(0,5);
    mk('c-dash2', { type:'bar', data: { labels: top5.map(([n])=>n.split(' ').slice(0,2).join(' ')), datasets: [{ data: top5.map(([,v])=>v), backgroundColor: ['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171'], borderRadius: 4 }] }, options: { indexAxis:'y' } });

    // Dernières ventes
    const lastVentes = (ventes||[]).filter(v=>v.quantite_vendue>0).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
    document.getElementById('last-ventes-date').textContent = lastVentes[0]?.date || '';
    document.getElementById('dash-ventes-body').innerHTML = lastVentes.map(v =>
      `<tr><td>${v.produit_nom}</td><td>${v.quantite_vendue}</td><td>${fmt(v.prix_vente)}</td><td>${fmt((v.quantite_vendue||0)*(v.prix_vente||0))}</td><td>${v.gerant||'—'}</td></tr>`
    ).join('') || '<tr><td colspan="5" class="empty">Aucune vente</td></tr>';

  } catch(e) { showToast('Erreur chargement dashboard', 'error'); }
}

// ============================================
// VENTES
// ============================================
async function initVentes() {
  const { data: produits } = await db.from('produits').select('*').order('nom');
  const tbody = document.getElementById('v-body');
  tbody.innerHTML = (produits||[]).map((p,i) => `
    <tr>
      <td>${p.nom}</td>
      <td><input type="number" value="${p.stock||0}" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>
      <td><input type="number" value="0" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" oninput="recalcV()"></td>
      <td><input type="number" value="${p.stock||0}" style="width:60px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 6px;font-size:11px" id="va-${i}" oninput="recalcV()"></td>
      <td id="vs-${i}" style="font-weight:500;color:var(--accent);font-family:var(--mono)">0</td>
      <td style="font-family:var(--mono)">${fmt(p.prix_vente)}</td>
      <td id="vr-${i}" style="font-family:var(--mono)">0</td>
    </tr>`
  ).join('');
  recalcV();
  window._produits = produits || [];
}

function recalcV() {
  let total = 0;
  (window._produits || []).forEach((p, i) => {
    const row = document.getElementById('v-body')?.rows[i];
    if (!row) return;
    const init = parseInt(row.cells[1].querySelector('input').value)||0;
    const recu = parseInt(row.cells[2].querySelector('input').value)||0;
    const after = parseInt(row.cells[3].querySelector('input').value)||0;
    const sold = Math.max(0, init + recu - after);
    const el_s = document.getElementById('vs-'+i);
    const el_r = document.getElementById('vr-'+i);
    if(el_s) el_s.textContent = sold;
    if(el_r) el_r.textContent = fmt(sold * p.prix_vente);
    total += sold * p.prix_vente;
  });
  document.getElementById('v-total-label').textContent = 'Total : ' + fmt(total) + ' GNF';
}

async function saveVentes() {
  const date = document.getElementById('v-date').value;
  const gerant = document.getElementById('v-gerant').value;
  const rows = [];
  (window._produits || []).forEach((p, i) => {
    const row = document.getElementById('v-body')?.rows[i];
    if (!row) return;
    const init = parseInt(row.cells[1].querySelector('input').value)||0;
    const recu = parseInt(row.cells[2].querySelector('input').value)||0;
    const after = parseInt(row.cells[3].querySelector('input').value)||0;
    const sold = Math.max(0, init + recu - after);
    if (sold > 0) rows.push({ date, produit_id: p.id, produit_nom: p.nom, stock_initial: init, stock_recu: recu, stock_apres: after, quantite_vendue: sold, prix_vente: p.prix_vente, gerant });
  });
  if (!rows.length) { showToast('Aucune vente à enregistrer', 'error'); return; }
  const { error } = await db.from('ventes').insert(rows);
  if (error) { showToast('Erreur: ' + error.message, 'error'); return; }
  // Mettre à jour le stock dans produits
  for (const r of rows) {
    await db.from('produits').update({ stock: r.stock_apres }).eq('id', r.produit_id);
  }
  showToast(`${rows.length} ventes enregistrées !`);
}

async function loadHistVentes() {
  document.getElementById('hist-loading').style.display = 'flex';
  const { data } = await db.from('ventes').select('*').order('date', {ascending: false}).limit(100);
  document.getElementById('hist-loading').style.display = 'none';
  document.getElementById('vh-body').innerHTML = (data||[]).map(v =>
    `<tr><td>${v.date}</td><td>${v.produit_nom}</td><td>${v.quantite_vendue}</td><td>${fmt(v.prix_vente)}</td><td>${fmt((v.quantite_vendue||0)*(v.prix_vente||0))}</td><td>${v.gerant||'—'}</td></tr>`
  ).join('') || '<tr><td colspan="6" class="empty">Aucune vente</td></tr>';
}

// ============================================
// STOCKS
// ============================================
async function initStocks() {
  document.getElementById('stock-loading').style.display = 'flex';
  const { data: produits } = await db.from('produits').select('*').order('stock', {ascending: false});
  document.getElementById('stock-loading').style.display = 'none';

  let ok=0, faible=0, rupture=0;
  const low = [];
  document.getElementById('s-body').innerHTML = (produits||[]).map(p => {
    const pct = Math.min(100, Math.round((p.stock||0)/120*100));
    const st = (p.stock||0) === 0 ? 'rupture' : (p.stock||0) < 10 ? 'faible' : 'ok';
    if(st==='ok') ok++; else if(st==='faible'){faible++;low.push(p.nom);} else{rupture++;low.push(p.nom);}
    const col = st==='ok'?'#6ee7b7':st==='faible'?'#fbbf24':'#f87171';
    const bc = st==='ok'?'badge-green':st==='faible'?'badge-yellow':'badge-red';
    const bt = st==='ok'?'En stock':st==='faible'?'Faible':'Rupture';
    return `<tr><td>${p.nom}</td><td style="font-family:var(--mono)">${p.stock||0}</td>
      <td style="min-width:90px"><div class="prog"><div class="prog-fill" style="width:${pct}%;background:${col}"></div></div></td>
      <td style="font-family:var(--mono)">${fmt(p.prix_vente||0)}</td>
      <td style="font-family:var(--mono)">${p.prix_achat>0?fmt(p.prix_achat):'—'}</td>
      <td><span class="badge ${bc}">${bt}</span></td></tr>`;
  }).join('');

  if (low.length) document.getElementById('stock-alert-txt').textContent = `⚠ ${low.length} alerte(s)`;

  const top12 = (produits||[]).slice(0,12);
  mk('c-stock', { type:'bar', data: { labels: top12.map(p=>p.nom.split(' ').slice(0,2).join(' ')), datasets: [{ data: top12.map(p=>p.stock||0), backgroundColor: top12.map(p=>(p.stock||0)===0?'#f87171':(p.stock||0)<10?'#fbbf24':'#6ee7b7'), borderRadius: 3 }] }, options: { indexAxis:'y' } });
  mk('c-stock-pie', { type:'pie', data: { labels: ['En stock','Faible','Rupture'], datasets: [{ data:[ok,faible,rupture], backgroundColor:['#6ee7b7','#fbbf24','#f87171'], borderWidth:0 }] }, options: { plugins: { legend: { display:true, position:'bottom', labels:{color:'#9090a8',font:{size:10}} } } } });
}

// ============================================
// DÉPENSES
// ============================================
async function loadDepenses() {
  document.getElementById('dep-loading').style.display = 'flex';
  const { data } = await db.from('depenses').select('*').order('date', {ascending: false});
  document.getElementById('dep-loading').style.display = 'none';
  const total = (data||[]).reduce((s,d)=>s+d.montant,0);
  document.getElementById('dep-total').textContent = 'Total : ' + fmt(total) + ' GNF';
  document.getElementById('d-body').innerHTML = (data||[]).map(d =>
    `<tr><td>${d.date}</td><td>${d.designation}</td><td><span class="badge badge-blue">${d.categorie}</span></td><td style="font-family:var(--mono)">${fmt(d.montant)} GNF</td>
     <td><button class="btn btn-danger" style="padding:2px 7px;font-size:10px" onclick="delDepense('${d.id}')">×</button></td></tr>`
  ).join('') || '<tr><td colspan="5" class="empty">Aucune dépense</td></tr>';
  const cats = {};
  (data||[]).forEach(d => { cats[d.categorie]=(cats[d.categorie]||0)+d.montant; });
  mk('c-dep', { type:'doughnut', data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor:['#6ee7b7','#3b82f6','#fbbf24'], borderWidth:0 }] }, options: { plugins: { legend: { display:true, position:'bottom', labels:{color:'#9090a8',font:{size:10}} } } } });
}

async function addDepense() {
  const date = document.getElementById('d-date').value;
  const designation = document.getElementById('d-nom').value.trim();
  const montant = parseInt(document.getElementById('d-mont').value)||0;
  const categorie = document.getElementById('d-cat').value;
  if (!designation || !montant) { showToast('Remplissez tous les champs', 'error'); return; }
  const { error } = await db.from('depenses').insert({ date, designation, montant, categorie });
  if (error) { showToast('Erreur: ' + error.message, 'error'); return; }
  document.getElementById('d-nom').value = '';
  document.getElementById('d-mont').value = '';
  showToast('Dépense enregistrée !');
  loadDepenses();
}

async function delDepense(id) {
  await db.from('depenses').delete().eq('id', id);
  showToast('Dépense supprimée');
  loadDepenses();
}

// ============================================
// ACHATS
// ============================================
async function initAchats() {
  const { data: produits } = await db.from('produits').select('id,nom').order('nom');
  const sel = document.getElementById('a-prod');
  sel.innerHTML = (produits||[]).map(p=>`<option value="${p.id}" data-nom="${p.nom}">${p.nom}</option>`).join('');
  loadAchats();
}

async function loadAchats() {
  document.getElementById('ach-loading').style.display = 'flex';
  const { data } = await db.from('achats').select('*').order('date', {ascending:false});
  document.getElementById('ach-loading').style.display = 'none';
  const total = (data||[]).reduce((s,a)=>s+(a.quantite||0)*(a.prix_unitaire||0),0);
  document.getElementById('ach-total').textContent = 'Total : ' + fmt(total) + ' GNF';
  document.getElementById('a-body').innerHTML = (data||[]).map(a =>
    `<tr><td>${a.date}</td><td>${a.produit_nom}</td><td style="font-family:var(--mono)">${a.quantite}</td><td style="font-family:var(--mono)">${fmt(a.prix_unitaire)}</td><td style="font-family:var(--mono)">${fmt((a.quantite||0)*(a.prix_unitaire||0))} GNF</td></tr>`
  ).join('') || '<tr><td colspan="5" class="empty">Aucun achat</td></tr>';
}

async function addAchat() {
  const date = document.getElementById('a-date').value;
  const sel = document.getElementById('a-prod');
  const produit_id = sel.value;
  const produit_nom = sel.options[sel.selectedIndex].dataset.nom;
  const quantite = parseFloat(document.getElementById('a-qte').value)||0;
  const prix_unitaire = parseInt(document.getElementById('a-prix').value)||0;
  if (!quantite || !prix_unitaire) { showToast('Remplissez tous les champs', 'error'); return; }
  const { error } = await db.from('achats').insert({ date, produit_id, produit_nom, quantite, prix_unitaire });
  if (error) { showToast('Erreur: ' + error.message, 'error'); return; }
  // Mettre à jour le stock
  const { data: prod } = await db.from('produits').select('stock').eq('id', produit_id).single();
  if (prod) await db.from('produits').update({ stock: (prod.stock||0) + quantite }).eq('id', produit_id);
  document.getElementById('a-qte').value = '';
  document.getElementById('a-prix').value = '';
  showToast('Achat enregistré !');
  loadAchats();
}

// ============================================
// EMPLOYÉS
// ============================================
async function loadEmployes() {
  document.getElementById('emp-loading').style.display = 'flex';
  const { data: employes } = await db.from('employes').select('*');
  const { data: primes } = await db.from('primes').select('*');
  const { data: avances } = await db.from('avances').select('*');
  const { data: presences } = await db.from('presences').select('*');
  document.getElementById('emp-loading').style.display = 'none';

  const COLORS = ['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171','#34d399','#60a5fa'];
  document.getElementById('emp-grid').innerHTML = (employes||[]).map((e,i) => {
    const pr = (primes||[]).filter(p=>p.employe_id===e.id).reduce((s,p)=>s+p.montant,0);
    const av = (avances||[]).filter(a=>a.employe_id===e.id).reduce((s,a)=>s+a.montant,0);
    const jours = (presences||[]).filter(p=>p.employe_id===e.id&&p.statut==='present').length;
    const col = COLORS[i%COLORS.length];
    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px;cursor:pointer;transition:all .15s" onmouseenter="this.style.borderColor='${col}44'" onmouseleave="this.style.borderColor='rgba(255,255,255,0.07)'">
      <div style="width:36px;height:36px;border-radius:50%;background:${col}22;color:${col};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;margin-bottom:8px">${e.nom.substring(0,2)}</div>
      <div style="font-size:13px;font-weight:500;color:var(--text)">${e.nom}</div>
      <div style="font-size:10px;color:var(--text3);margin-bottom:8px">${e.poste}</div>
      <div style="font-size:11px;color:var(--text2);font-family:var(--mono)">${fmt(e.salaire)} GNF</div>
      <div style="font-size:10px;color:var(--text3);margin-top:2px">${jours} jours · Primes: ${fmt(pr)} GNF</div>
      <div class="prog" style="margin-top:8px"><div class="prog-fill" style="width:${Math.min(100,jours/30*100)}%;background:${col}"></div></div>
    </div>`;
  }).join('');
}

async function addEmploye() {
  const nom = document.getElementById('e-nom').value.trim();
  const poste = document.getElementById('e-poste').value;
  const date_embauche = document.getElementById('e-date').value;
  const salaire = parseInt(document.getElementById('e-salaire').value)||0;
  const bonus_pct = parseFloat(document.getElementById('e-bonus').value)||0;
  const telephone = document.getElementById('e-tel').value;
  if (!nom || !salaire) { showToast('Nom et salaire obligatoires', 'error'); return; }
  const { error } = await db.from('employes').insert({ nom, poste, date_embauche, salaire, bonus_pct, telephone });
  if (error) { showToast('Erreur: ' + error.message, 'error'); return; }
  document.getElementById('e-nom').value = '';
  document.getElementById('e-salaire').value = '';
  showToast('Employé ajouté !');
  loadEmployes();
}

// ============================================
// PRÉSENCES
// ============================================
let presencesCache = {};
async function initPresences() {
  const { data: employes } = await db.from('employes').select('*').order('nom');
  const { data: presences } = await db.from('presences').select('*');

  window._employes = employes || [];
  presencesCache = {};
  (presences||[]).forEach(p => {
    if (!presencesCache[p.employe_id]) presencesCache[p.employe_id] = {};
    const day = parseInt(p.date?.split('-')[2]);
    presencesCache[p.employe_id][day] = p.statut;
  });

  const sel = document.getElementById('pres-emp');
  sel.innerHTML = (employes||[]).map(e=>`<option value="${e.id}">${e.nom}</option>`).join('');
  renderCalendar();
  renderPresSummary();
}

function renderCalendar() {
  const empId = document.getElementById('pres-emp').value;
  const hdrs = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  document.getElementById('cal-headers').innerHTML = hdrs.map(h=>`<div class="cal-day header">${h}</div>`).join('');
  const offset = 6; // 1er juin 2025 = Dimanche
  let html = '';
  for(let i=0;i<offset;i++) html += `<div></div>`;
  for(let d=1;d<=30;d++) {
    const st = presencesCache[empId]?.[d] || '';
    html += `<div class="cal-day ${st}" onclick="cycleDay('${empId}',${d},this)">${d}</div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
  const p = presencesCache[empId]||{};
  const pr = Object.values(p).filter(v=>v==='present').length;
  const ab = Object.values(p).filter(v=>v==='absent').length;
  const co = Object.values(p).filter(v=>v==='conge').length;
  document.getElementById('pres-stats').textContent = `${pr} présent(s) · ${ab} absent(s) · ${co} congé(s)`;
}

async function cycleDay(empId, day, el) {
  const cur = presencesCache[empId]?.[day] || '';
  const next = cur===''?'present':cur==='present'?'absent':cur==='absent'?'conge':'';
  if (!presencesCache[empId]) presencesCache[empId] = {};
  presencesCache[empId][day] = next;
  el.className = 'cal-day ' + next;

  const dateStr = `2025-06-${String(day).padStart(2,'0')}`;
  if (next === '') {
    await db.from('presences').delete().eq('employe_id', empId).eq('date', dateStr);
  } else {
    await db.from('presences').upsert({ employe_id: empId, date: dateStr, statut: next }, { onConflict: 'employe_id,date' });
  }
  renderPresSummary();
}

function renderPresSummary() {
  document.getElementById('pres-summary').innerHTML = (window._employes||[]).map(e => {
    const p = presencesCache[e.id]||{};
    const pr = Object.values(p).filter(v=>v==='present').length;
    const ab = Object.values(p).filter(v=>v==='absent').length;
    const co = Object.values(p).filter(v=>v==='conge').length;
    const taux = pr+ab+co > 0 ? Math.round(pr/(pr+ab+co)*100) : 0;
    return `<tr><td>${e.nom}</td><td>${e.poste}</td>
      <td><span class="badge badge-green">${pr}</span></td>
      <td><span class="badge badge-red">${ab}</span></td>
      <td><span class="badge badge-yellow">${co}</span></td>
      <td style="font-family:var(--mono)">${taux}%</td></tr>`;
  }).join('');
}

// ============================================
// SALAIRES
// ============================================
async function initSalaires() {
  document.getElementById('sal-loading').style.display = 'flex';
  const [{ data: employes }, { data: primes }, { data: avances }] = await Promise.all([
    db.from('employes').select('*'),
    db.from('primes').select('*'),
    db.from('avances').select('*')
  ]);
  document.getElementById('sal-loading').style.display = 'none';

  const tsal = (employes||[]).reduce((s,e)=>s+e.salaire,0);
  const tpr = (primes||[]).reduce((s,p)=>s+p.montant,0);
  const tav = (avances||[]).reduce((s,a)=>s+a.montant,0);

  document.getElementById('sal-metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Masse salariale</div><div class="metric-value">${fmtK(tsal)}</div><div class="metric-sub down">GNF/mois</div></div>
    <div class="metric"><div class="metric-label">Total primes</div><div class="metric-value">${fmtK(tpr)}</div><div class="metric-sub up">GNF</div></div>
    <div class="metric"><div class="metric-label">Total avances</div><div class="metric-value">${fmtK(tav)}</div><div class="metric-sub down">GNF</div></div>`;

  const empData = (employes||[]).map(e => ({
    ...e,
    pr: (primes||[]).filter(p=>p.employe_id===e.id).reduce((s,p)=>s+p.montant,0),
    av: (avances||[]).filter(a=>a.employe_id===e.id).reduce((s,a)=>s+a.montant,0)
  }));

  mk('c-sal', { type:'bar', data: { labels: empData.map(e=>e.nom), datasets: [
    { label:'Salaire', data: empData.map(e=>e.salaire), backgroundColor:'#6ee7b7', borderRadius:3 },
    { label:'Primes', data: empData.map(e=>e.pr), backgroundColor:'#3b82f6', borderRadius:3 }
  ]}, options: { scales: { x:{stacked:true,grid:{display:false},ticks:{color:'#5a5a72',font:{size:10}}}, y:{stacked:true,grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#5a5a72',font:{size:10,family:"'DM Mono'"},callback:v=>fmtK(v)}} }, plugins:{legend:{display:true,position:'bottom',labels:{color:'#9090a8',font:{size:10}}}} }});

  mk('c-sal-pie', { type:'doughnut', data: { labels: empData.map(e=>e.nom), datasets:[{ data: empData.map(e=>e.salaire+e.pr), backgroundColor:['#6ee7b7','#3b82f6','#fbbf24','#a78bfa','#f87171','#34d399','#60a5fa'], borderWidth:0 }] }, options: { plugins:{legend:{display:true,position:'bottom',labels:{color:'#9090a8',font:{size:10}}}} }});

  document.getElementById('sal-body').innerHTML = empData.map(e => {
    const net = e.salaire + e.pr - e.av;
    return `<tr><td>${e.nom}</td><td>${e.poste}</td>
      <td style="font-family:var(--mono)">${fmt(e.salaire)}</td>
      <td style="font-family:var(--mono)">${fmt(e.pr)}</td>
      <td style="font-family:var(--mono)">${fmt(e.av)}</td>
      <td style="font-family:var(--mono);font-weight:500;color:var(--accent)">${fmt(net)} GNF</td></tr>`;
  }).join('');
}

async function openAddPrime() {
  const { data: employes } = await db.from('employes').select('id,nom').order('nom');
  const empOpts = (employes||[]).map(e=>`<option value="${e.id}">${e.nom}</option>`).join('');
  const type = prompt('Type (Prime performance / Bonus / Avance) :');
  if (!type) return;
  const empId = prompt('ID employé :\n' + (employes||[]).map(e=>`${e.nom}: ${e.id}`).join('\n'));
  if (!empId) return;
  const montant = parseInt(prompt('Montant (GNF) :'))||0;
  if (!montant) return;
  const date = prompt('Date (YYYY-MM-DD) :') || new Date().toISOString().split('T')[0];
  if (type.toLowerCase().includes('avance')) {
    await db.from('avances').insert({ employe_id: empId, montant, date, note: 'Avance sur salaire' });
  } else {
    await db.from('primes').insert({ employe_id: empId, type_prime: type, montant, date });
  }
  showToast('Enregistré !');
  initSalaires();
}

// ============================================
// ANALYSE
// ============================================
async function initAnalyse() {
  const [{ data: ventes }, { data: achats }, { data: employes }] = await Promise.all([
    db.from('ventes').select('*'),
    db.from('achats').select('*'),
    db.from('employes').select('*')
  ]);

  // Par produit
  const byProd = {};
  (ventes||[]).forEach(v => {
    if (!byProd[v.produit_nom]) byProd[v.produit_nom] = { rev:0, qVen:0, cAch:0, qAch:0 };
    byProd[v.produit_nom].rev += (v.quantite_vendue||0)*(v.prix_vente||0);
    byProd[v.produit_nom].qVen += v.quantite_vendue||0;
  });
  (achats||[]).forEach(a => {
    if (!byProd[a.produit_nom]) byProd[a.produit_nom] = { rev:0, qVen:0, cAch:0, qAch:0 };
    byProd[a.produit_nom].cAch += (a.quantite||0)*(a.prix_unitaire||0);
    byProd[a.produit_nom].qAch += a.quantite||0;
  });

  const prodData = Object.entries(byProd).map(([n,d]) => ({ n, ...d, marge: d.rev - d.cAch, pct: d.rev>0?Math.round((d.rev-d.cAch)/d.rev*100):0 })).sort((a,b)=>b.marge-a.marge);

  const totRev = prodData.reduce((s,d)=>s+d.rev,0);
  const totAch = prodData.reduce((s,d)=>s+d.cAch,0);
  const totMarge = totRev - totAch;

  document.getElementById('an-metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Revenus totaux</div><div class="metric-value">${fmtK(totRev)}</div><div class="metric-sub up">GNF</div></div>
    <div class="metric"><div class="metric-label">Coûts d'achat</div><div class="metric-value">${fmtK(totAch)}</div><div class="metric-sub down">GNF</div></div>
    <div class="metric"><div class="metric-label">Marge brute</div><div class="metric-value ${totMarge>=0?'up':'down'}">${fmtK(totMarge)}</div><div class="metric-sub ${totMarge>=0?'up':'down'}">GNF</div></div>`;

  const top10 = prodData.slice(0,10);
  mk('c-an1', { type:'bar', data: { labels: top10.map(d=>d.n.split(' ').slice(0,2).join(' ')), datasets:[{ data: top10.map(d=>d.marge), backgroundColor: top10.map(d=>d.marge>=0?'#6ee7b7':'#f87171'), borderRadius:3 }] }, options:{indexAxis:'y'} });

  document.getElementById('an-body').innerHTML = prodData.filter(d=>d.rev>0||d.cAch>0).map(d =>
    `<tr><td>${d.n}</td><td style="font-family:var(--mono)">${d.qAch}</td><td style="font-family:var(--mono)">${fmt(d.cAch)}</td><td style="font-family:var(--mono)">${d.qVen}</td><td style="font-family:var(--mono)">${fmt(d.rev)}</td>
    <td><span class="badge ${d.marge>=0?'badge-green':'badge-red'}">${fmt(d.marge)} GNF</span></td><td style="font-family:var(--mono)">${d.pct}%</td></tr>`
  ).join('');

  // RH vs CA
  const tsal = (employes||[]).reduce((s,e)=>s+e.salaire,0);
  const salJour = Math.round(tsal/30);
  const byDay = {};
  (ventes||[]).forEach(v => { byDay[v.date]=(byDay[v.date]||0)+(v.quantite_vendue||0)*(v.prix_vente||0); });
  const days = Object.keys(byDay).sort();
  const caVals = days.map(d=>byDay[d]);
  const ratio = caVals.map(ca=>ca>0?Math.round(salJour/ca*100):0);
  const avgRatio = ratio.filter(r=>r>0).length>0 ? Math.round(ratio.filter(r=>r>0).reduce((s,r)=>s+r,0)/ratio.filter(r=>r>0).length) : 0;

  document.getElementById('an-rh-metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Masse salariale/mois</div><div class="metric-value">${fmtK(tsal)}</div><div class="metric-sub down">GNF</div></div>
    <div class="metric"><div class="metric-label">Coût RH/jour</div><div class="metric-value">${fmtK(salJour)}</div><div class="metric-sub neu">GNF</div></div>
    <div class="metric"><div class="metric-label">Ratio RH/CA moyen</div><div class="metric-value">${avgRatio}%</div><div class="metric-sub neu">du CA</div></div>`;

  mk('c-an2', { type:'line', data: { labels: days.map(d=>d.substring(5)), datasets:[
    { label:'CA', data:caVals, borderColor:'#6ee7b7', backgroundColor:'rgba(110,231,183,.05)', tension:.3, fill:true, pointRadius:3 },
    { label:'RH/jour', data:days.map(()=>salJour), borderColor:'#f87171', backgroundColor:'rgba(248,113,113,.05)', tension:.3, fill:true, pointRadius:3 }
  ]}, options:{plugins:{legend:{display:true,position:'bottom',labels:{color:'#9090a8',font:{size:10}}}}} });

  mk('c-an3', { type:'bar', data: { labels: days.map(d=>d.substring(5)), datasets:[{ data:ratio, backgroundColor:ratio.map(r=>r>50?'#f87171':r>30?'#fbbf24':'#6ee7b7'), borderRadius:3 }] }, options:{scales:{y:{ticks:{callback:v=>v+'%',color:'#5a5a72',font:{size:10,family:"'DM Mono'"}}}}} });
}

// ============================================
// EXPORT
// ============================================
async function exportCSV() {
  const { data: ventes } = await db.from('ventes').select('*').order('date');
  const { data: deps } = await db.from('depenses').select('*').order('date');
  let csv = 'RAPPORT BAR MANAGER\n\n=== VENTES ===\nDate,Produit,Vendus,Prix,Revenu,Gérant\n';
  (ventes||[]).forEach(v => { if(v.quantite_vendue>0) csv+=`${v.date},${v.produit_nom},${v.quantite_vendue},${v.prix_vente},${(v.quantite_vendue||0)*(v.prix_vente||0)},${v.gerant||''}\n`; });
  csv += '\n=== DÉPENSES ===\nDate,Désignation,Catégorie,Montant\n';
  (deps||[]).forEach(d => csv+=`${d.date},${d.designation},${d.categorie},${d.montant}\n`);
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bar_rapport.csv'; a.click();
  showToast('Export CSV téléchargé');
}

async function exportPDF() {
  const { data: ventes } = await db.from('ventes').select('*');
  const { data: deps } = await db.from('depenses').select('*');
  const { data: employes } = await db.from('employes').select('*');
  const ca = (ventes||[]).reduce((s,v)=>s+(v.quantite_vendue||0)*(v.prix_vente||0),0);
  const tdep = (deps||[]).reduce((s,d)=>s+d.montant,0);
  const tsal = (employes||[]).reduce((s,e)=>s+e.salaire,0);
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rapport Bar</title>
  <style>body{font-family:Arial,sans-serif;padding:24px;color:#222;max-width:800px;margin:0 auto}
  h1{font-size:20px;margin-bottom:4px}.sum{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
  .sc{background:#f5f5f5;padding:12px;border-radius:8px}.sc .l{font-size:10px;color:#888}.sc .v{font-size:18px;font-weight:700;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:12px}th{background:#f0f0f0;padding:7px;text-align:left;border:1px solid #ddd}
  td{padding:6px 7px;border:1px solid #eee}tr:nth-child(even){background:#fafafa}@media print{button{display:none}}</style>  <!-- PWA -->
  <link rel="manifest" href="manifest.json">
  <meta name="theme-color" content="#0f0f11">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Bar Manager">
  <link rel="apple-touch-icon" href="icon-192.png">
</head><body>
  <h1>Rapport Bar Manager</h1><p style="font-size:11px;color:#888">${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</p>
  <div class="sum">
    <div class="sc"><div class="l">Chiffre d'affaires</div><div class="v">${fmt(ca)} GNF</div></div>
    <div class="sc"><div class="l">Dépenses</div><div class="v">${fmt(tdep)} GNF</div></div>
    <div class="sc"><div class="l">Masse salariale</div><div class="v">${fmt(tsal)} GNF</div></div>
  </div>
  <button onclick="window.print()" style="padding:8px 18px;background:#222;color:#fff;border:none;border-radius:6px;cursor:pointer">Imprimer / PDF</button>
  <script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('SW OK'))
      .catch(e => console.log('SW erreur:', e));
  });
}