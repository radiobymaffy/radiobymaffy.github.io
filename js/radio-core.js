/* RADIO BYMAFFY — il cervello della radio.
   Dato un istante, dice cosa va in onda: quale programma, quale brano, a che punto del brano.
   Nessun server: bastano l'orario (Europe/Rome) e i due elenchi dati/radio.js e dati/radio-voci.js.
   Tutti gli ascoltatori ottengono lo stesso risultato nello stesso momento, perché ogni "scaletta" è
   mescolata con un seme che dipende solo dalla data e dalla fascia. Funziona anche in Node (per le prove). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadioCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TZ = 'Europe/Rome';
  const MIN = 60000;
  const FADE_MS = 2500;        // dissolvenza finale quando un brano viene tagliato dall'orario

  /* ---------------- Orario di Roma ---------------- */
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function parts(ms) {
    const o = {};
    for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
    return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
  }
  const offsetAt = (ms) => { const p = parts(ms); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
  function muroToEpoch(y, m, d, h, mi) {          // "ore 6:00 del 20 ottobre a Roma" -> millisecondi
    const g = Date.UTC(y, m - 1, d, h, mi, 0);
    return g - offsetAt(g - offsetAt(g));
  }
  function pasqua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return { m: Math.floor((h + l - 7 * m + 114) / 31), d: ((h + l - 7 * m + 114) % 31) + 1 };
  }
  function isVenerdiSanto(y, m, d) {
    const p = pasqua(y), v = new Date(Date.UTC(y, p.m - 1, p.d - 2));
    return v.getUTCMonth() + 1 === m && v.getUTCDate() === d;
  }

  /* ---------------- Numeri a caso, ma uguali per tutti ---------------- */
  function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rngDa(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mescola(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------------- I programmi (minuti dalla mezzanotte, ora di Roma) ----------------
     mix = quanta musica di ogni tipo, in proporzione. */
  // Le proporzioni sono pensate perché ogni brano giri più o meno lo stesso numero di volte al giorno:
  // le canzoni di ByMaffy sono poche (7) e quelle del Napoli poche (9), quindi pesano poco in ogni programma.
  // Quando arriveranno le interviste (Fase 2) si potrà dare più spazio al parlato e meno alla musica.
  const PROGRAMMI = [
    { id: 'notte-taurano',     nome: 'Notte Taurano',            da: 0,    a: 360,  mix: { strumentali: .55, religiosa: .45 }, desc: 'Musica senza interruzioni, mentre il paese dorme.' },
    { id: 'buongiorno',        nome: 'Buongiorno Taurano',       da: 360,  a: 540,  mix: { strumentali: .4, bymaffy: .15, religiosa: .35, napoli: .1 }, desc: 'Musica e buonumore per cominciare la giornata.' },
    { id: 'paese-si-racconta', nome: 'Il paese si racconta',     da: 540,  a: 720,  mix: { strumentali: .35, bymaffy: .1, religiosa: .4, napoli: .15 }, desc: 'Musica e, presto, le interviste del canale.' },
    { id: 'pausa-pranzo',      nome: 'Pausa pranzo con ByMaffy', da: 720,  a: 840,  mix: { bymaffy: .4, strumentali: .4, religiosa: .1, napoli: .1 }, desc: 'Le canzoni di casa, da ascoltare a tavola.' },
    { id: 'pomeriggio',        nome: 'Pomeriggio in musica',     da: 840,  a: 900,  mix: { strumentali: .3, bymaffy: .1, religiosa: .3, napoli: .3 }, desc: 'Musica per il pomeriggio.' },
    { id: 'azzurro-napoli',    nome: 'Azzurro Napoli',           da: 900,  a: 960,  mix: { napoli: .85, strumentali: .15 }, desc: 'Un\'ora di cori e musica per chi ha il Napoli nel cuore.' },
    { id: 'pomeriggio',        nome: 'Pomeriggio in musica',     da: 960,  a: 1020, mix: { strumentali: .3, bymaffy: .1, religiosa: .3, napoli: .3 }, desc: 'Musica per il pomeriggio.' },
    { id: 'sagre',             nome: 'Sagre e tradizioni',       da: 1020, a: 1200, mix: { religiosa: .85, strumentali: .15 }, desc: 'Le feste, le processioni e i canti del paese.' },
    { id: 'fiaba',             nome: 'La fiaba della buonanotte', da: 1200, a: 1230, fiaba: true, mix: { fiabe: 1 }, desc: 'Le fiabe dei Cuginetti Cowboy, per i più piccoli.' },
    { id: 'serata',            nome: 'Serata in musica',         da: 1230, a: 1320, mix: { bymaffy: .3, strumentali: .3, religiosa: .3, napoli: .1 }, desc: 'Le canzoni di casa per finire bene la giornata.' },
    { id: 'notte-stelle',      nome: 'Notte sotto le stelle',    da: 1320, a: 1440, mix: { strumentali: .6, religiosa: .4 }, desc: 'Musica calma per chiudere la giornata.' }
  ];
  const VENERDI_SANTO = { id: 'venerdi-santo', nome: 'Venerdì Santo', da: 1230, a: 1260, mix: { crucis: .8, strumentali: .2 }, desc: 'Musica di raccoglimento.' };
  const NOMI_MUSICA = { bymaffy: 'Canzoni di ByMaffy', napoli: 'Azzurro Napoli', religiosa: 'Canti e tradizioni', strumentali: 'Musica strumentale', fiabe: 'Fiabe dei Cuginetti Cowboy', crucis: 'Venerdì Santo' };

  function slotsDelGiorno(y, m, d) {
    let lista = PROGRAMMI.map((p) => Object.assign({}, p));
    if (isVenerdiSanto(y, m, d)) {
      // dalle 20:30 alle 21:00 la musica del Venerdì Santo, poi la serata riprende
      lista = lista.flatMap((p) => p.id === 'serata' ? [Object.assign({}, VENERDI_SANTO), Object.assign({}, p, { da: 1260 })] : [p]);
    }
    return lista.map((p, i) => {
      const prec = lista[i - 1];
      return Object.assign({}, p, {
        chiave: `${y}-${m}-${d}|${p.da}|${p.id}`,
        start: muroToEpoch(y, m, d, 0, p.da),
        end: muroToEpoch(y, m, d, 0, p.a),         // 1440 minuti = mezzanotte del giorno dopo
        presentazione: !prec || prec.id !== p.id   // "Pomeriggio in musica" non si ripresenta dopo Azzurro Napoli solo se è lo stesso di prima
      });
    });
  }

  /* ---------------- La scaletta di una fascia ---------------- */
  function preparaDati(radio, voci, mese) {
    // pool[tipo] = i brani; gruppi[tipo] = per ogni titolo, le sue varianti ("Titolo (1)", "Titolo (2)"…)
    const pool = {}, gruppi = {};
    for (const t of radio.tracks) {
      if (t.r === 'scarto' || t.r === 'apertura' || t.c === 'sigla') continue;
      if (t.s === 'natale' && mese !== 12) continue;
      (pool[t.c] = pool[t.c] || []).push(t);
      const m = gruppi[t.c] || (gruppi[t.c] = new Map());
      if (!m.has(t.g)) m.set(t.g, []);
      m.get(t.g).push(t);
    }
    const chiavi = {};
    for (const c of Object.keys(gruppi)) chiavi[c] = [...gruppi[c].keys()];
    const apertura = radio.tracks.find((t) => t.r === 'apertura') || null;
    return { pool, gruppi, chiavi, apertura, voci: voci || {}, chiave: (radio.generated || '') + '|' + ((voci && voci.generated) || '') + '|' + mese };
  }

  // carry = gli ultimi brani della fascia prima ({c, g}): così un brano non torna subito dopo il cambio di programma
  function simulaSlot(slot, dati, carry) {
    const rng = rngDa(hash(slot.chiave));
    const voci = dati.voci;
    const bags = {}, storia = {};                  // storia[tipo] = titoli suonati da ultimo, per tipo di musica
    (carry || []).forEach((x) => { (storia[x.c] = storia[x.c] || []).push(x.g); });
    let fiabeSuonate = 0;
    const items = [];
    let t = slot.start;

    const scegliCat = (mix) => {
      const cats = Object.keys(mix).filter((c) => dati.pool[c] && dati.pool[c].length);
      if (!cats.length) return Object.keys(dati.pool)[0] || null;
      let r = rng() * cats.reduce((a, c) => a + mix[c], 0);
      for (const c of cats) { r -= mix[c]; if (r <= 0) return c; }
      return cats[cats.length - 1];
    };
    const variante = {};
    // Si estraggono i TITOLI (non i file): ogni titolo gira lo stesso numero di volte, e le sue varianti si alternano.
    // Un titolo appena suonato viene rimandato più avanti, senza perderne il turno.
    function prossimoBrano(cat) {
      const chiavi = dati.chiavi[cat];
      if (!chiavi || !chiavi.length) return null;
      const b = bags[cat] || (bags[cat] = { list: mescola(chiavi, rng), i: 0 });
      const h = storia[cat] || (storia[cat] = []);
      const K = Math.min(6, Math.max(0, chiavi.length - 1));                // quanti titoli vanno "tenuti a distanza"
      if (b.i >= b.list.length) { b.list = mescola(chiavi, rng); b.i = 0; }
      let j = b.i;
      if (K) { const rec = h.slice(-K); for (let q = b.i; q < b.list.length; q++) if (!rec.includes(b.list[q])) { j = q; break; } }
      [b.list[b.i], b.list[j]] = [b.list[j], b.list[b.i]];
      const g = b.list[b.i++];
      h.push(g); if (h.length > 12) h.shift();
      const vars = dati.gruppi[cat].get(g), k = cat + '|' + g;
      variante[k] = variante[k] === undefined ? Math.floor(rng() * vars.length) : (variante[k] + 1) % vars.length;
      return vars[variante[k]];
    }
    const clipScelta = (lista) => (lista && lista.length ? lista[Math.floor(rng() * lista.length)] : null);
    const voce = (clip, extra, limite) => {         // una voce o uno stacchetto: se non ci sta, si salta (non si taglia mai)
      if (!clip || !clip.d) return false;
      const dur = clip.d * 1000;
      if (t + dur > limite) return false;
      items.push(Object.assign({ k: 'voce', src: clip.f, ini: t, fine: t + dur, dur, taglio: false, prog: slot.id }, extra));
      t += dur; return true;
    };
    const musica = (tr, limite) => {
      const dur = tr.d * 1000, tagliato = t + dur > limite;
      items.push({ k: 'musica', src: tr.f, ini: t, fine: tagliato ? limite : t + dur, dur, taglio: tagliato, t: tr.t, c: tr.c, g: tr.g, prog: slot.id });
      t = items[items.length - 1].fine;
    };

    for (let bs = slot.start; bs < slot.end; bs += 30 * MIN) {
      const be = Math.min(bs + 30 * MIN, slot.end);
      const p = parts(bs), allOra = p.mi === 0;
      t = Math.max(t, bs);
      if (allOra) { voce(voci.sting, { tipo: 'sting', t: 'Radio ByMaffy' }, be); voce(voci.ora && voci.ora[p.h], { tipo: 'ora', t: 'L\'ora esatta' }, be); }
      else voce(clipScelta(voci.id), { tipo: 'id', t: 'Radio ByMaffy' }, be);
      if (bs === slot.start && slot.presentazione) voce(voci.prog && voci.prog[slot.id], { tipo: 'programma', t: slot.nome }, be);
      if (bs === slot.start && slot.fiaba && dati.apertura) musica(dati.apertura, be);

      let dopoSigla = 0, notiziaFatta = !allOra;
      while (be - t >= 20000) {
        if (!notiziaFatta && t - bs >= 12 * MIN && voci.news && voci.news.length) {
          notiziaFatta = true;
          const n = voci.news[hash(slot.chiave + '|' + bs) % voci.news.length];
          voce(n, { tipo: 'notizia', t: n.t, video: n.v }, be);
          continue;
        }
        if (dopoSigla >= 3 && voci.id && voci.id.length) { dopoSigla = 0; if (voce(clipScelta(voci.id), { tipo: 'id', t: 'Radio ByMaffy' }, be)) continue; }
        let cat = scegliCat(slot.mix);
        if (slot.fiaba) {
          if (fiabeSuonate >= (dati.pool.fiabe || []).length) cat = scegliCat({ strumentali: 1 }); else fiabeSuonate++;
        }
        const tr = cat && prossimoBrano(cat);
        if (!tr) break;
        musica(tr, be);
        dopoSigla++;
      }
      if (be - t >= 3000) voce(clipScelta(voci.id), { tipo: 'id', t: 'Radio ByMaffy' }, be);
    }
    return items;
  }

  /* ---------------- La radio ---------------- */
  function crea(radio, voci) {
    const cacheDati = new Map(), cacheSlot = new Map();
    const dati = (mese) => { if (!cacheDati.has(mese)) cacheDati.set(mese, preparaDati(radio, voci, mese)); return cacheDati.get(mese); };
    // la scaletta della fascia i del giorno; per non ripetere i brani appena suonati parte dalla fascia prima
    function scaletta(slots, i, mese) {
      const slot = slots[i], d = dati(mese), k = slot.chiave + '|' + d.chiave;
      if (!cacheSlot.has(k)) {
        const carry = [];
        if (i > 0) { const prec = scaletta(slots, i - 1, mese); for (let j = prec.length - 1; j >= 0 && carry.length < 16; j--) if (prec[j].g) carry.unshift({ c: prec[j].c, g: prec[j].g }); }
        if (cacheSlot.size > 60) cacheSlot.delete(cacheSlot.keys().next().value);
        cacheSlot.set(k, simulaSlot(slot, d, carry));
      }
      return cacheSlot.get(k);
    }
    function giorno(ms) { const p = parts(ms); return { p, slots: slotsDelGiorno(p.y, p.m, p.d) }; }

    function adesso(ms) {
      const { p, slots } = giorno(ms);
      let i = slots.findIndex((s) => s.start <= ms && ms < s.end);
      if (i < 0) i = ms < slots[0].start ? 0 : slots.length - 1;
      const slot = slots[i], items = scaletta(slots, i, p.m);
      let k = items.findIndex((it) => it.ini <= ms && ms < it.fine);
      const cur = k >= 0 ? items[k] : null;
      let next = k >= 0 ? items[k + 1] : items.find((it) => it.ini > ms);
      if (!next) {                                         // l'ultima voce della fascia: guarda la prossima fascia
        const altro = i + 1 < slots.length ? { slots, i: i + 1, m: p.m } : (() => { const q = parts(slot.end + 3600000); return { slots: slotsDelGiorno(q.y, q.m, q.d), i: 0, m: q.m }; })();
        next = scaletta(altro.slots, altro.i, altro.m)[0] || null;
      }
      // prossimo programma diverso da questo
      let prossimo = null;
      for (let j = i + 1; j < slots.length; j++) if (slots[j].id !== slot.id) { prossimo = slots[j]; break; }
      if (!prossimo) { const q = parts(slot.end + 3600000); prossimo = slotsDelGiorno(q.y, q.m, q.d)[0]; }
      return { ms, slot, items, k, cur, next, offset: cur ? ms - cur.ini : 0, prossimo };
    }

    function ultimiBrani(ms, quanti) {
      const a = adesso(ms), out = [];
      for (let k = a.k - 1; k >= 0 && out.length < quanti; k--) if (a.items[k].k === 'musica') out.push(a.items[k]);
      return out;
    }
    function ultimaNotizia(ms) {
      const a = adesso(ms);
      for (let k = a.k; k >= 0; k--) if (a.items[k].tipo === 'notizia') return a.items[k];
      return null;
    }
    function programmiDelGiorno(ms) {                        // elenco per la pagina: "Oggi in radio"
      const { slots } = giorno(ms);
      const sh = (min) => String(Math.floor(min / 60) % 24).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
      return slots.map((s) => ({ id: s.id, nome: s.nome, desc: s.desc, da: sh(s.da), a: sh(s.a), start: s.start, end: s.end }));
    }
    return { adesso, ultimiBrani, ultimaNotizia, programmiDelGiorno, giorno };
  }

  return { crea, parts, muroToEpoch, isVenerdiSanto, PROGRAMMI, NOMI_MUSICA, FADE_MS, hash };
});
