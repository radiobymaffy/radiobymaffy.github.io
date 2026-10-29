/* RADIO BYMAFFY — "sono qui": ogni pagina aperta dice, in forma anonima, se è solo sul sito o se ha la radio accesa.
   La pagina riservata dei numeri (ascolti.html) lo vede subito; i contatori di oggi e del totale crescono una volta
   per apparecchio. Se qualcosa non risponde, la radio suona lo stesso: qui non c'è niente da cui dipenda l'ascolto. */
(() => {
  'use strict';
  const C = window.RbmCanale;
  if (!C || !window.RADIO) return;

  const id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  const dispositivo = () => {
    const u = navigator.userAgent;
    return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'altro';
  };
  // da dove arriva: l'indirizzo della pagina da cui ha cliccato (solo il nome del sito) oppure ?da=nome nel collegamento
  const provenienza = () => {
    const da = new URLSearchParams(location.search).get('da');
    if (da) return da.replace(/[^\w.-]/g, '').slice(0, 24);
    try { const h = new URL(document.referrer).hostname.replace(/^www\./, ''); return h && h !== location.hostname ? h.slice(0, 40) : ''; } catch (e) { return ''; }
  };
  const info = { d: dispositivo(), r: provenienza() };
  let suona = false;

  // e = 'n': una novità (sono appena arrivato, ho acceso, ho messo in pausa) · 'h': solo "ci sono ancora" (ogni tanto, o in risposta a "chi c'è?")
  const messaggio = (e) => {
    const m = { i: id, s: suona ? 'p' : 'v', e, d: info.d };
    if (info.r) m.r = info.r;
    if (suona) { const o = window.RADIO.ora(); m.w = (o.programma + ' · ' + o.titolo).slice(0, 90); }
    return JSON.stringify(m);
  };
  const canale = C.apri({
    id: 'l' + id,
    will: { topic: C.T.hb, payload: JSON.stringify({ i: id, s: 'x' }) },     // se la pagina sparisce di colpo, il server avvisa lui
    iscrivi: [C.T.q, C.T.onda],
    onApri: (s) => s.pubblica(C.T.hb, messaggio('n')),
    onMessaggio: (topic, testo) => {
      if (topic === C.T.q) setTimeout(() => annuncia('h'), Math.random() * 1500);                       // "chi c'è?": rispondo, ma non tutti insieme
      else if (topic === C.T.onda) document.dispatchEvent(new CustomEvent('radio-onda-messaggio', { detail: testo }));   // "Maffy va in onda": lo controlla js/onda.js
    }
  });
  function annuncia(e) { canale.pubblica(C.T.hb, messaggio(e)); }
  function conta() { C.segna('v'); if (suona) C.segna('a'); }

  document.addEventListener('radio-stato', (e) => { suona = !!(e.detail && e.detail.suona); annuncia('n'); conta(); });
  setInterval(() => { annuncia('h'); conta(); }, 25000);                      // anche a mezzanotte, con la radio accesa, si conta il giorno nuovo
  setTimeout(conta, 1500);

  // chi chiude la pagina o torna indietro: si saluta; se la pagina viene "congelata" dal telefono e poi riaperta, ci si ricollega
  window.addEventListener('pagehide', () => { canale.pubblica(C.T.hb, JSON.stringify({ i: id, s: 'x' })); canale.chiudi(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { canale.riapri(); } });

  window.RADIO_PRESENZA = { id, stato: () => canale.stato(), prova: C.prova };      // per le prove
})();
