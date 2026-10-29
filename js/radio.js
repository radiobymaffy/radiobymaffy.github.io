/* RADIO BYMAFFY — la pagina e il lettore.
   radio-core.js decide cosa va in onda ora; qui c'è il lettore (due "casse" che si alternano, così tra un brano
   e l'altro non c'è buco) e la parte che si vede: saluto, programma in onda, brano, "tra poco", scaletta di oggi. */
(() => {
  'use strict';
  const sec = document.getElementById('radio');
  if (!sec) return;
  const core = window.RadioCore, R = window.RADIO_DATA, V = window.RADIO_VOCI || {};
  const $ = (s, r = document) => r.querySelector(s);
  if (!core || !R || !Array.isArray(R.tracks) || !R.tracks.length) {
    $('#rdNote').hidden = false; $('#rdNote').textContent = 'La radio non è disponibile in questo momento. Riprova tra poco.';
    return;
  }

  const TV = 'https://tauranowebtv.netlify.app/';        // il sito della TV: serve solo per "Guardalo in TV"
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (ms) => { const p = core.parts(ms); return pad(p.h) + ':' + pad(p.mi); };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* pazienza */ } }
  };

  /* In locale si legge dal deposito dei brani (il server lo collega a /radio-audio/); online dall'indirizzo dei brani (baseOnline). */
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  const BASE = local ? R.base : (R.baseOnline || '');
  const ENABLED = !!BASE;
  const url = (src) => BASE + src;

  const radio = core.crea(R, V);
  let skew = 0;                                    // se l'orologio del telefono è sbagliato, ci si regola sull'ora del sito
  const now = () => Date.now() + skew;
  if (!local) {
    const t0 = Date.now();
    fetch('data/radio.js', { method: 'HEAD', cache: 'no-store' }).then((r) => {
      const d = Date.parse(r.headers.get('date') || ''), t1 = Date.now();
      if (d && Math.abs(d - (t0 + t1) / 2) > 2000 && Math.abs(d - t1) < 864e5) skew = d - (t0 + t1) / 2;
    }).catch(() => {});
  }

  /* ---------------- Elementi della pagina ---------------- */
  const el = {
    play: $('#rdPlay'), cta: $('#rdCta'), ctaTxt: $('#rdCtaTxt'), hi: $('#rdHi'), sub: $('#rdSub'),
    prog: $('#rdProg'), title: $('#rdTitle'), next: $('#rdNext'),
    vol: $('#rdVol'), list: $('#rdList'), recent: $('#rdRecent'), news: $('#rdNews'), hero: $('#rdHero'), note: $('#rdNote')
  };
  // Al primo ascolto non c'è un volume salvato: Number(null) darebbe 0 (silenzio), quindi si parte da 0,8. Un volume scelto dall'ascoltatore (anche 0) si rispetta.
  const volSalvato = store.get('rbm-volume');
  let vol = volSalvato === null || volSalvato === '' ? NaN : Number(volSalvato);
  if (!(vol >= 0 && vol <= 1)) vol = 0.8;
  el.vol.value = vol;

  // barra fissa in basso: compare quando la radio suona e la testata non si vede
  const bar = document.createElement('div');
  bar.className = 'rdbar'; bar.id = 'rdBar'; bar.hidden = true;
  bar.innerHTML = '<button class="rdbar__btn" id="rdBarBtn" type="button" aria-label="Metti in pausa la radio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg></button>' +
    '<div class="rdbar__txt"><b>Radio ByMaffy</b><span id="rdBarTxt"></span></div><a class="rdbar__go" href="#radio">Apri la radio</a>';
  document.body.appendChild(bar);
  const barTxt = $('#rdBarTxt', bar);

  /* ---------------- Il saluto, secondo l'ora di Roma ---------------- */
  const saluto = (h) => (h >= 5 && h < 13 ? 'Buongiorno e bentrovati!' : h >= 13 && h < 18 ? 'Buon pomeriggio e bentrovati!' : h >= 18 && h < 22 ? 'Buonasera e bentrovati!' : 'Buonanotte, ma la radio resta accesa!');

  /* ---------------- Il lettore ---------------- */
  const SILENZIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  const deck = [0, 1].map(() => { const a = new Audio(); a.preload = 'auto'; return { a, key: null, bad: false }; });
  deck.forEach((d) => d.a.addEventListener('error', () => { if (d.key) d.bad = true; }));
  let cur = 0, playing = false, current = null, timer = 0;
  let diretta = null;                              // { y } mentre Maffy è in diretta: la scaletta tace, ma chi voleva ascoltare resta "in ascolto"
  const keyOf = (it) => it.src + '@' + it.ini;

  function carica(d, it) {
    d.key = keyOf(it); d.bad = false;
    d.a.src = url(it.src);
    d.a.volume = vol;
    d.a.load();
  }
  function vaiA(it, offsetMs) {
    const k = keyOf(it);
    const nd = deck[1 - cur], old = deck[cur];
    if (nd.key !== k) carica(nd, it);
    nd.a.volume = vol;
    const parti = () => {
      if (offsetMs > 300) { try { nd.a.currentTime = offsetMs / 1000; } catch (e) { /* si parte dall'inizio */ } }
      const p = nd.a.play(); if (p && p.catch) p.catch(() => {});
    };
    if (nd.a.readyState >= 1) parti(); else nd.a.addEventListener('loadedmetadata', parti, { once: true });
    if (old !== nd) { old.a.pause(); old.key = null; }
    cur = 1 - cur;
    current = { it, d: nd };
    metadati(it);
  }
  function tick() {
    if (!playing || diretta) return;
    const t = now(), a = radio.adesso(t), it = a.cur;
    if (!it) { if (current) { current.d.a.pause(); current = null; } return; }
    if (!current || current.d.key !== keyOf(it)) vaiA(it, a.offset);
    else {
      const au = current.d.a;
      const atteso = (t - it.ini) / 1000;
      if (!au.paused && !au.seeking && au.readyState >= 3 && Math.abs(au.currentTime - atteso) > 3) { try { au.currentTime = atteso; } catch (e) { /* pazienza */ } }
      if (au.paused && !au.ended && au.readyState >= 2 && !current.d.bad) { const p = au.play(); if (p && p.catch) p.catch(() => {}); }
      const resto = it.fine - t;                                   // dissolvenza quando l'orario taglia un brano
      au.volume = it.taglio && resto < core.FADE_MS ? vol * Math.max(0, resto / core.FADE_MS) : vol;
    }
    // prepara in anticipo la voce o il brano che viene dopo
    const nx = a.next, pre = deck[1 - cur];
    if (nx && nx.ini - t < 25000 && pre.key !== keyOf(nx)) carica(pre, nx);
  }

  function accendi() {
    if (!ENABLED || playing) return;
    playing = true;
    // il tocco dell'utente "sblocca" entrambe le casse: così il passaggio al brano dopo non viene bloccato dal telefono
    deck.forEach((d) => { d.key = null; d.a.src = SILENZIO; const p = d.a.play(); if (p && p.catch) p.catch(() => {}); });
    clearInterval(timer);
    current = null; cur = 1;                                       // la prima cassa usata sarà la numero 0
    tick();
    timer = setInterval(tick, 250);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    paint(true);
    document.dispatchEvent(new CustomEvent('radio-stato', { detail: { suona: true } }));   // lo ascolta il conteggio degli ascoltatori
  }
  function spegni() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    deck.forEach((d) => { d.a.pause(); d.key = null; });
    current = null;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    paint(true);
    document.dispatchEvent(new CustomEvent('radio-stato', { detail: { suona: false } }));
  }
  // Maffy va in onda (lo decide js/onda.js, solo con un segnale firmato dalla Regia): le due casse tacciono; alla fine la scaletta riparte
  // dal punto in cui è adesso (come una radio vera), grazie al solito controllo sull'orario.
  function entraDiretta(y) {
    diretta = { y: y || '' };
    deck.forEach((d) => { d.a.pause(); d.key = null; });
    current = null;
    if ('mediaSession' in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'In diretta con Maffy', artist: 'Radio ByMaffy', album: 'Diretta',
        artwork: [{ src: 'img/icona-512.png', sizes: '512x512', type: 'image/png' }, { src: 'img/icona-180.png', sizes: '180x180', type: 'image/png' }]
      });
    }
    paint(true);
  }
  function esciDiretta() {
    if (!diretta) return;
    diretta = null; current = null;
    paint(true);
    if (playing) tick();
  }
  const alterna = () => (playing ? spegni() : accendi());
  el.play.addEventListener('click', alterna);
  el.cta.addEventListener('click', alterna);
  $('#rdBarBtn', bar).addEventListener('click', alterna);
  el.vol.addEventListener('input', () => { vol = Number(el.vol.value); store.set('rbm-volume', String(vol)); if (current) current.d.a.volume = vol; });

  function metadati(it) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const a = radio.adesso(now());
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titoloBrano(it), artist: 'Radio ByMaffy', album: a.slot.nome,
      artwork: [{ src: 'img/icona-512.png', sizes: '512x512', type: 'image/png' }, { src: 'img/icona-180.png', sizes: '180x180', type: 'image/png' }]
    });
    navigator.mediaSession.setActionHandler('play', accendi);
    navigator.mediaSession.setActionHandler('pause', spegni);
  }

  /* ---------------- Cosa si vede ---------------- */
  function titoloBrano(it) {
    if (!it) return 'Radio ByMaffy';
    if (it.k === 'musica') return it.t;
    if (it.tipo === 'ora') return "L'ora esatta";
    if (it.tipo === 'notizia') return 'Dal canale: ' + it.t;
    if (it.tipo === 'programma') return 'Adesso: ' + it.t;
    return 'Radio ByMaffy, la radio del paese';
  }
  const dettaglio = (it) => (it && it.k === 'musica' ? (core.NOMI_MUSICA[it.c] || '') : '');

  let ultimaChiave = '', listaGiorno = '', salutoTesto = '', heroVisibile = true;
  function paint(forza) {
    const t = now(), a = radio.adesso(t), it = a.cur;
    const s = saluto(core.parts(t).h);
    if (s !== salutoTesto) { salutoTesto = s; el.hi.textContent = s; }
    const chiave = (it ? keyOf(it) : 'x') + '|' + playing + '|' + a.slot.chiave + '|' + (diretta ? 'D' + diretta.y : '');
    if (forza || chiave !== ultimaChiave) {
      ultimaChiave = chiave;
      el.prog.textContent = diretta ? 'IN DIRETTA' : a.slot.nome;
      el.title.textContent = ENABLED ? (diretta ? 'Maffy è in diretta' : it ? titoloBrano(it) + (dettaglio(it) ? ' · ' + dettaglio(it) : '') : 'Radio ByMaffy') : 'A breve in onda';
      el.next.textContent = hhmm(a.prossimo.start) + ' · ' + a.prossimo.nome;
      barTxt.textContent = diretta ? 'IN DIRETTA con Maffy' : a.slot.nome + ' · ' + titoloBrano(it);
      sec.classList.toggle('is-playing', playing);
      sec.classList.toggle('is-live', !!diretta);
      for (const b of [el.play, el.cta]) b.setAttribute('aria-pressed', String(playing));
      el.play.setAttribute('aria-label', playing ? 'Metti in pausa la radio' : diretta ? 'Ascolta la diretta' : 'Accendi la radio');
      $('#rdPlayTxt').textContent = !ENABLED ? 'A breve' : playing ? 'In ascolto' : diretta ? 'Ascolta la diretta' : 'Accendi la radio';
      el.ctaTxt.textContent = !ENABLED ? 'A breve in onda' : diretta ? (playing ? 'In diretta · pausa' : 'Ascolta la diretta') : playing ? 'In ascolto · pausa' : 'Ascolta ora';
      el.sub.textContent = diretta ? (playing ? 'Maffy è in diretta: quando finisce, la radio riparte da sola.' : 'Maffy è in diretta adesso: tocca il tasto per ascoltarlo.') : playing ? 'La radio è accesa: puoi anche muoverti nella pagina, la musica continua.' : 'Basta un tocco: la radio parte subito, proprio a metà di quello che sta andando in onda.';
      document.body.classList.toggle('radio-on', playing);
      const ult = radio.ultimiBrani(t, 5);
      el.recent.innerHTML = ult.length ? ult.map((x) => `<li><span>${hhmm(x.ini)}</span><b>${esc(x.t)}</b><small>${esc(core.NOMI_MUSICA[x.c] || '')}</small></li>`).join('') : '<li class="rd__empty">Appena iniziato: i brani suonati compariranno qui.</li>';
      const nz = radio.ultimaNotizia(t) || (V.news && V.news[0] ? { t: V.news[0].t, video: V.news[0].v, ini: null } : null);
      el.news.innerHTML = nz && nz.video
        ? `<div class="rd__tv"><div><span>${nz.ini ? 'Annunciato in radio alle ' + hhmm(nz.ini) : 'Novità dal canale'}</span><b>${esc(nz.t)}</b></div><a href="${TV}#v=${encodeURIComponent(nz.video)}" target="_blank" rel="noopener">Guardalo in TV ↗</a></div>` : '';
    }
    bar.hidden = !(playing && !heroVisibile);
    // la scaletta di oggi (si ridisegna a ogni cambio di giorno; si colora quella in onda)
    const prog = radio.programmiDelGiorno(t);
    const gk = prog[0].start + '|' + prog.length;
    if (gk !== listaGiorno) {
      listaGiorno = gk;
      el.list.innerHTML = prog.map((p, i) => `<li data-i="${i}"><time>${p.da}–${p.a}</time><div><b>${esc(p.nome)}</b><span>${esc(p.desc)}</span></div><em>IN ONDA</em></li>`).join('');
    }
    [...el.list.children].forEach((li, i) => li.classList.toggle('is-now', prog[i].start <= t && t < prog[i].end));
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { heroVisibile = es[0].isIntersecting; bar.hidden = !(playing && !heroVisibile); }, { threshold: 0.15 }).observe(el.hero);
  }

  if (!ENABLED) {
    el.play.disabled = true; el.cta.disabled = true; sec.classList.add('is-off');
    if (el.note) el.note.hidden = false;
  }
  paint(true);
  setInterval(() => paint(false), 1000);

  // per le prove: cosa stanno facendo le due casse
  window.RADIO = {
    adesso: (t) => radio.adesso(t == null ? now() : t), core: radio,
    ora: () => { if (diretta) return { programma: 'In diretta', titolo: 'Maffy in diretta' }; const a = radio.adesso(now()); return { programma: a.slot.nome, titolo: titoloBrano(a.cur) }; },   // cosa sta andando in onda (per il conteggio)
    orologio: now,                                                       // l'ora del sito (corretta se l'orologio del telefono è sbagliato)
    suona: () => playing,                                                // chi ascolta ha acceso la radio?
    diretta: { entra: entraDiretta, esci: esciDiretta, attiva: () => !!diretta },
    stato: () => deck.map((d) => ({ chiave: d.key, secondi: Math.round(d.a.currentTime * 10) / 10, pausa: d.a.paused, pronto: d.a.readyState, errore: d.a.error ? d.a.error.code : 0, file: d.a.src.slice(-48), inizio: d.a.src.slice(0, 48) }))
  };
})();
