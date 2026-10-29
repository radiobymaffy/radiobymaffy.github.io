/* RADIO BYMAFFY — il canale in tempo reale e i contatori.
   Due cose, senza registrazioni e senza costi:
   1) un "telefono" tra le pagine di chi ascolta e la pagina riservata dei numeri (ascolti.html): MQTT su WebSocket
      con due server pubblici e gratuiti (HiveMQ ed EMQX). Serve solo a dire "sono qui" / "ho acceso la radio";
      i brani non passano di qui. Se un server non risponde si usa l'altro.
   2) i contatori che restano (oggi, in totale, ultimi giorni): il servizio gratuito Abacus, una chiamata alla volta.
   Nessun dato personale: ogni pagina aperta ha un numero a caso, e si dice solo se è un telefono o un computer. */
(() => {
  'use strict';
  const SERVER = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  const SITI = ['radiobymaffy.github.io'];               // solo qui si contano gli ascoltatori veri: ovunque altrove è una prova
  const prova = !SITI.includes(location.hostname) || /[?&]prova=1(&|$)/.test(location.search);
  const NOME = 'rbm-ascolti-5d1c8e3a';                   // nome dei contatori (tutto suo, scelto a caso)
  const NS = NOME + (prova ? '-prova' : '');
  const BASE = 'rbm1/5d1c8e3a7f20b4' + (prova ? '/prova' : '');
  const T = { hb: BASE + '/hb', q: BASE + '/q' };        // hb = "sono qui", q = "chi c'è?"
  const INIZIO = '20261029';                             // il primo giorno di conteggio
  const KEEP = 60;                                       // secondi: dopo questo silenzio il server ci dà per usciti

  const te = new TextEncoder(), td = new TextDecoder();
  const stringa = (s) => { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
  const lunghezza = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
  const pacchetto = (tipo, corpo) => Uint8Array.from([tipo, ...lunghezza(corpo.length), ...corpo]);
  const store = {
    mem: {},
    get(k) { let v = null; try { v = localStorage.getItem(k); } catch (e) { /* pazienza */ } return v !== null ? v : (this.mem[k] ?? null); },
    set(k, v) { this.mem[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* pazienza */ } }
  };

  /* ---------------- Un collegamento MQTT (la parte minima: collegarsi, scrivere, ascoltare, restare vivo) ---------------- */
  class Mqtt {
    constructor(url, o) { this.url = url; this.o = o; this.ws = null; this.ok = false; this.buf = new Uint8Array(0); this.finito = false; this.ultimo = 0; this.ping = 0; this.idPacchetto = 0; }
    apri() {
      let ws;
      try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { this.fine(); return; }
      this.ws = ws; ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const w = this.o.will;
        const corpo = [...stringa('MQTT'), 4, 0x02 | (w ? 0x04 : 0), 0, KEEP, ...stringa(this.o.id)];
        if (w) corpo.push(...stringa(w.topic), ...stringa(w.payload));
        ws.send(pacchetto(0x10, corpo));
      };
      ws.onmessage = (m) => { this.ultimo = Date.now(); this.dati(new Uint8Array(m.data)); };
      ws.onclose = () => this.fine();
      ws.onerror = () => this.fine();
    }
    dati(b) {
      const n = new Uint8Array(this.buf.length + b.length); n.set(this.buf); n.set(b, this.buf.length); this.buf = n;
      for (;;) {
        const x = this.buf;
        if (x.length < 2) return;
        let len = 0, mul = 1, i = 1, byte;
        do { if (i >= x.length) return; byte = x[i++]; len += (byte & 127) * mul; mul *= 128; } while ((byte & 128) && i < 5);
        if (x.length < i + len) return;
        const corpo = x.subarray(i, i + len), primo = x[0];
        this.buf = x.subarray(i + len);
        this.ricevuto(primo, corpo);
      }
    }
    ricevuto(primo, corpo) {
      const tipo = primo >> 4;
      if (tipo === 2) {                                    // risposta al collegamento
        if (corpo[1] !== 0) { try { this.ws.close(); } catch (e) { /* già chiuso */ } return; }
        this.ok = true; this.ultimo = Date.now();
        this.ping = setInterval(() => {
          if (Date.now() - this.ultimo > 70000) { try { this.ws.close(); } catch (e) { /* già chiuso */ } return; }
          this.manda(Uint8Array.of(0xC0, 0));
        }, 25000);
        this.o.onApri(this);
      } else if (tipo === 3) {                             // un messaggio arrivato
        const tl = (corpo[0] << 8) | corpo[1], topic = td.decode(corpo.subarray(2, 2 + tl));
        const da = 2 + tl + (((primo >> 1) & 3) ? 2 : 0);
        this.o.onMessaggio(topic, td.decode(corpo.subarray(da)));
      }
    }
    manda(b) { if (this.ws && this.ws.readyState === 1) this.ws.send(b); }
    pubblica(topic, testo) { if (this.ok) this.manda(pacchetto(0x30, [...stringa(topic), ...te.encode(testo)])); }
    iscrivi(topic) { this.idPacchetto = (this.idPacchetto % 65000) + 1; this.manda(pacchetto(0x82, [this.idPacchetto >> 8, this.idPacchetto & 255, ...stringa(topic), 0])); }
    chiudi() { this.o.onChiuso = () => {}; this.manda(Uint8Array.of(0xE0, 0)); try { this.ws && this.ws.close(); } catch (e) { /* già chiuso */ } this.fine(true); }
    fine(muto) { if (this.finito) return; this.finito = true; this.ok = false; clearInterval(this.ping); if (!muto) this.o.onChiuso(); }
  }

  /* ---------------- Il canale: tiene vivo il collegamento (se cade lo riapre, se un server non va passa all'altro) ----------------
     o = { id, will: {topic, payload}, iscrivi: [topic...], tutti: true = restare collegati a TUTTI i server (la pagina dei numeri),
           onApri(slot), onMessaggio(topic, testo), onStato() }                                                                */
  function apri(o) {
    const tutti = !!o.tutti, n = SERVER.length;
    const nuovoSlot = (k0) => {
      let k = k0, c = null, ok = false, fermo = false, prove = 0, t = 0;
      const s = { get ok() { return ok; }, get url() { return SERVER[k]; } };
      const parti = () => {
        clearTimeout(t);
        if (fermo) return;
        const m = new Mqtt(SERVER[k], {
          id: o.id, will: o.will,
          onApri: () => { ok = true; prove = 0; (o.iscrivi || []).forEach((x) => m.iscrivi(x)); if (o.onApri) o.onApri(s); if (o.onStato) o.onStato(); },
          onChiuso: () => {
            const era = ok; ok = false;
            if (o.onStato) o.onStato();
            if (fermo || c !== m) return;
            prove++;
            if (!tutti && !era) k = (k + 1) % n;                                   // il server non rispondeva: si prova l'altro
            t = setTimeout(parti, !era && !tutti && prove <= n ? 400 : Math.min(30000, 1500 * 2 ** Math.min(prove, 4)));
          },
          onMessaggio: (topic, testo) => { if (o.onMessaggio) o.onMessaggio(topic, testo, s); }
        });
        c = m; m.apri();
      };
      s.pubblica = (topic, testo) => { if (ok && c) c.pubblica(topic, testo); };
      s.ferma = () => { fermo = true; clearTimeout(t); ok = false; if (c) c.chiudi(); };
      s.riparti = () => { if (!fermo) return; fermo = false; prove = 0; parti(); };
      parti();
      return s;
    };
    const slot = (tutti ? SERVER.map((_, i) => i) : [0]).map(nuovoSlot);
    return {
      pubblica: (topic, testo) => slot.forEach((s) => s.pubblica(topic, testo)),
      stato: () => slot.map((s) => ({ url: s.url, ok: s.ok })),
      chiudi: () => slot.forEach((s) => s.ferma()),
      riapri: () => slot.forEach((s) => s.riparti())
    };
  }

  /* ---------------- I contatori che restano ---------------- */
  const AB = 'https://abacus.jasoncameron.dev/';
  const giornoRoma = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms == null ? Date.now() : ms).replace(/-/g, '');
  const conta = (chiave) => fetch(AB + 'hit/' + NS + '/' + chiave, { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
  // null = non so (il servizio non risponde), 0 = nessuno ancora
  const leggi = (chiave) => fetch(AB + 'get/' + NS + '/' + chiave, { cache: 'no-store' })
    .then((r) => (r.status === 404 ? 0 : r.ok ? r.json().then((j) => Number(j.value) || 0) : null)).catch(() => null);

  // Ogni apparecchio si conta UNA volta al giorno e UNA volta in tutto. tipo: 'v' = è passato dal sito, 'a' = ha acceso la radio.
  const inCorso = {};
  async function segna(tipo) {
    if (inCorso[tipo]) return;
    inCorso[tipo] = true;
    try {
      const oggi = giornoRoma(), suff = prova ? '-prova' : '';
      const kg = 'rbm-' + tipo + '-giorno' + suff, ks = 'rbm-' + tipo + '-sempre' + suff;
      if (store.get(kg) !== oggi && await conta(tipo + '-' + oggi)) store.set(kg, oggi);
      if (!store.get(ks) && await conta(tipo + '-tot')) store.set(ks, '1');
    } finally { inCorso[tipo] = false; }
  }

  window.RbmCanale = { apri, T, NS, INIZIO, prova, giornoRoma, conta, leggi, segna, store, SERVER };
})();
