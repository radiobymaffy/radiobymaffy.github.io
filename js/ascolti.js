/* RADIO BYMAFFY — la pagina riservata "Chi ascolta".
   In alto il numero di chi ascolta adesso (si aggiorna da solo, con un avviso quando arriva qualcuno);
   sotto i contatori di oggi e del totale, il grafico degli ultimi giorni e l'elenco di chi arriva e se ne va. */
(() => {
  'use strict';
  const C = window.RbmCanale;
  if (!C) return;
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = C.store;
  if (C.prova) $('#aProva').hidden = false;

  /* ---------------- Chi c'è adesso ---------------- */
  const presenti = new Map();        // id -> { s: 'p' ascolta | 'v' solo sul sito, d, r, w, ultimo, dal }
  const visti = new Map();           // id -> ultima volta visto: chi si ricollega subito non è "nuovo"
  const SCADE = 100000;              // se una pagina non si fa sentire per 100 secondi, la si dà per uscita
  const RIENTRO = 10 * 60000;
  const testo = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const dettaglio = (m) => [m.d, m.r ? 'da ' + m.r : '', m.w ? 'sentiva: ' + m.w : ''].filter(Boolean).join(' · ');

  function ricevi(grezzo) {
    let m;
    try { m = JSON.parse(grezzo); } catch (e) { return; }
    if (!m || typeof m.i !== 'string' || !/^[vpx]$/.test(m.s)) return;
    const i = m.i.slice(0, 16), s = m.s, ora = Date.now();
    const novita = m.e === 'n';        // "sono appena arrivato / ho acceso / ho messo in pausa" (e non un semplice "ci sono ancora")
    const dati = { d: testo(m.d, 12), r: testo(m.r, 40), w: testo(m.w, 90) };
    const prima = presenti.get(i);
    if (s === 'x') {
      if (prima) {
        presenti.delete(i); visti.set(i, ora);
        evento('x', prima.s === 'p' ? '👋 Ha smesso di ascoltare ed è uscito' : '👋 È uscito dal sito', dettaglio(prima));
      }
    } else if (!prima) {
      presenti.set(i, { s, ...dati, ultimo: ora, dal: ora, giaPresente: !novita });
      const rientro = visti.has(i) && ora - visti.get(i) < RIENTRO;      // si è solo ricollegato: non è una novità
      visti.set(i, ora);
      if (novita && !rientro) {
        evento(s, s === 'p' ? '🎧 Nuovo ascoltatore!' : '👀 Nuovo visitatore sul sito', dettaglio(dati), s === 'p' ? 2 : 1);
        ricaricaPresto();
      }
    } else {
      const cambio = prima.s !== s;
      Object.assign(prima, { s, ...dati, ultimo: ora }); visti.set(i, ora);
      if (cambio && novita) { evento(s, s === 'p' ? '🎧 Ha acceso la radio' : '⏸ Ha messo in pausa', dettaglio(prima), s === 'p' ? 2 : 0); ricaricaPresto(); }
    }
    aggiorna();
  }
  setInterval(() => {
    const ora = Date.now();
    presenti.forEach((p, i) => { if (ora - p.ultimo > SCADE) { presenti.delete(i); evento('x', '👋 Non si fa più sentire', dettaglio(p)); } });
    aggiorna();
    if (C.giornoRoma() !== giornoCaricato) caricaTutto();            // è passata la mezzanotte
  }, 1000);

  let ultimaCifra = '';
  function aggiorna() {
    let a = 0, v = 0;
    presenti.forEach((p) => { if (p.s === 'p') a++; else v++; });
    const grande = $('#aAscolto');
    if (grande.textContent !== String(a)) { grande.textContent = String(a); if (ultimaCifra !== '') { grande.classList.remove('salta'); void grande.offsetWidth; grande.classList.add('salta'); } }
    ultimaCifra = String(a);
    $('#aSito').textContent = v ? 'Sul sito, senza radio accesa: ' + v : (a ? 'Nessun altro sul sito in questo momento' : 'Nessuno sul sito in questo momento');
    document.title = (a ? '🎧 ' + a + ' · ' : '') + 'Chi ascolta — Radio ByMaffy';
  }

  /* ---------------- L'elenco "in diretta" ---------------- */
  const lista = $('#aEventi');
  function evento(classe, titolo, sotto, suono) {
    const vuoto = lista.querySelector('.vuoto'); if (vuoto) vuoto.remove();
    const d = new Date(), li = document.createElement('li');
    li.className = (classe || '') + ' nuovo';
    li.innerHTML = `<time>${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}</time><b>${esc(titolo)}</b>${sotto ? `<small>${esc(sotto)}</small>` : ''}`;
    lista.insertBefore(li, lista.firstChild);
    setTimeout(() => li.classList.remove('nuovo'), 1200);
    while (lista.children.length > 80) lista.lastChild.remove();
    if (suono) suonaEvento(suono === 2);
  }

  /* ---------------- L'avviso sonoro (si attiva dopo il primo tocco sulla pagina: lo vogliono i browser) ---------------- */
  let ctx = null, suono = store.get('rbm-ascolti-suono') !== 'no';
  const sbloccato = () => !!ctx && ctx.state === 'running';
  function sblocca() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume().then(tasto).catch(() => {});
    tasto();
  }
  function tono(freq, inizio, durata, volume) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + inizio;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(volume, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + durata);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + durata + 0.05);
  }
  function suonaEvento(grande) {
    if (!suono || !sbloccato()) return;
    if (grande) { tono(660, 0, 0.35, 0.25); tono(880, 0.16, 0.5, 0.25); } else tono(520, 0, 0.25, 0.1);
  }
  const bottone = $('#aSuono');
  function tasto() {
    bottone.textContent = !suono ? '🔕 Suono: no' : sbloccato() ? '🔔 Suono: sì' : '🔔 Suono: sì (tocca qui per attivarlo)';
    bottone.setAttribute('aria-pressed', String(suono));
  }
  bottone.addEventListener('click', () => {
    if (suono && !sbloccato()) { sblocca(); setTimeout(() => suonaEvento(true), 150); return; }     // il primo tocco attiva soltanto
    suono = !suono; store.set('rbm-ascolti-suono', suono ? 'si' : 'no'); sblocca(); if (suono) setTimeout(() => suonaEvento(true), 150);
    tasto();
  });
  document.addEventListener('pointerdown', () => { if (!ctx || ctx.state === 'suspended') sblocca(); });
  tasto();

  /* ---------------- I contatori che restano ---------------- */
  const dati = {};                                           // chiave -> numero (o null se il servizio non risponde)
  const COPIA = 'rbm-ascolti-copia' + (C.prova ? '-prova' : '');
  let giornoCaricato = '', giorni = [], daCopia = false;
  try { Object.assign(dati, JSON.parse(store.get(COPIA) || '{}')); } catch (e) { /* nessuna copia */ }

  function giorniRecenti(n) {
    const oggi = C.giornoRoma(), y = +oggi.slice(0, 4), m = +oggi.slice(4, 6), d = +oggi.slice(6, 8), out = [];
    for (let k = n - 1; k >= 0; k--) {
      const t = new Date(Date.UTC(y, m - 1, d - k)), g = t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate());
      if (g >= C.INIZIO) out.push(g);
    }
    return out;
  }
  const breve = (g) => g.slice(6, 8) + '/' + g.slice(4, 6);
  async function leggiMolti(chiavi) {
    let k = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (k < chiavi.length) {
        const chiave = chiavi[k++], v = await C.leggi(chiave);
        if (v === null) daCopia = true; else dati[chiave] = v;
      }
    }));
    store.set(COPIA, JSON.stringify(dati));
  }
  async function caricaTutto() {
    giornoCaricato = C.giornoRoma(); giorni = giorniRecenti(14);
    daCopia = false;
    await leggiMolti(['a-tot', 'v-tot', ...giorni.flatMap((g) => ['a-' + g, 'v-' + g])]);
    mostra();
  }
  async function ricarica() {
    const oggi = C.giornoRoma();
    daCopia = false;
    await leggiMolti(['a-' + oggi, 'v-' + oggi, 'a-tot', 'v-tot']);
    mostra();
  }
  let attesa = 0;
  function ricaricaPresto() { clearTimeout(attesa); attesa = setTimeout(ricarica, 3500); }   // il contatore dell'ascoltatore ha bisogno di un attimo

  function metti(sel, v) {
    const e = $(sel), t = v == null ? '–' : Number(v).toLocaleString('it-IT');
    if (e.textContent === t) return;
    const prima = e.dataset.pronto; e.textContent = t; e.dataset.pronto = '1';
    if (prima) { e.classList.remove('salta'); void e.offsetWidth; e.classList.add('salta'); }
  }
  function mostra() {
    const oggi = C.giornoRoma();
    metti('#aOggiA', dati['a-' + oggi]); metti('#aOggiV', dati['v-' + oggi]);
    metti('#aTotA', dati['a-tot']); metti('#aTotV', dati['v-tot']);
    $('#aDal').textContent = 'Dal ' + breve(C.INIZIO) + '/' + C.INIZIO.slice(0, 4) + (daCopia ? ' · alcuni numeri sono quelli salvati: il servizio dei contatori non risponde' : '');
    const val = (g) => ({ a: dati['a-' + g] || 0, v: dati['v-' + g] || 0 });
    const massimo = Math.max(1, ...giorni.map((g) => Math.max(val(g).a, val(g).v)));
    $('#aBarre').innerHTML = giorni.length ? giorni.map((g) => {
      const { a, v } = val(g);
      return `<div class="g${g === oggi ? ' oggi' : ''}"><span class="n">${a || ''}</span><div class="col"><div class="v" style="height:${(v / massimo) * 100}%" title="${v} dal sito"></div><div class="a" style="height:${(a / massimo) * 100}%" title="${a} hanno ascoltato"></div></div><span class="d">${g === oggi ? 'oggi' : breve(g)}</span></div>`;
    }).join('') : '<p class="vuoto">Il grafico comincia domani.</p>';
  }

  /* ---------------- Il collegamento in tempo reale ---------------- */
  const idDash = 'd' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  let canale = null;
  function statoCanale() {
    const st = canale ? canale.stato() : [], n = st.filter((x) => x.ok).length;
    const e = $('#aConn');
    e.className = 'conn ' + (n ? 'ok' : 'no');
    $('#aConnTxt').textContent = n ? 'In diretta' + (n < st.length ? ' (un canale su ' + st.length + ')' : '') : 'Canale non raggiungibile: riprovo…';
  }
  let riassuntoFissato = false;
  function riassunto() {                                         // chi c'era già quando hai aperto la pagina, in una riga sola
    let a = 0, v = 0; presenti.forEach((p) => { if (p.giaPresente) { if (p.s === 'p') a++; else v++; } });
    if (a + v) evento('', 'Già collegati quando hai aperto la pagina: ' + (a + v), a + ' in ascolto · ' + v + ' sul sito');
  }
  canale = C.apri({
    id: idDash, tutti: true, iscrivi: [C.T.hb],
    onApri: (s) => {
      if (!riassuntoFissato) { riassuntoFissato = true; setTimeout(riassunto, 4000); }
      s.pubblica(C.T.q, '?');                                    // "chi c'è?": tutti quelli già collegati rispondono
      statoCanale();
    },
    onMessaggio: (topic, x) => { if (topic === C.T.hb) ricevi(x); },
    onStato: statoCanale
  });
  statoCanale();
  caricaTutto();
  setInterval(ricarica, 30000);
  mostra();

  window.ASCOLTI = { presenti: () => [...presenti].map(([i, p]) => ({ i, ...p })), dati, canale };      // per le prove
})();
