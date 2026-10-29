/* RADIO BYMAFFY — "Maffy va in onda".
   Quando la Regia di Maffy dice "vado in onda" (un messaggio FIRMATO, controllato in js/canale.js), la scaletta tace e nella testata
   compare la sua diretta di YouTube; quando dice "torno" (o smette di farsi sentire per 20 secondi), la radio riparte da sola.
   Chi stava ascoltando passa alla diretta da solo; chi era sul sito senza ascoltare deve toccare "Ascolta la diretta".
   Se qualcosa non funziona (nessun collegamento, firma sbagliata, niente chiave) non succede niente: la radio resta in scaletta. */
(() => {
  'use strict';
  const C = window.RbmCanale, R = window.RADIO;
  const sec = document.getElementById('radio'), box = document.getElementById('rdLive'), video = document.getElementById('rdLiveVideo'), fine = document.getElementById('rdLiveFine');
  if (!C || !R || !R.diretta || !C.verificaOnda || !sec || !box || !video) return;

  const VIVA = 20000;                   // dopo 20 secondi senza un "on" valido si torna alla scaletta
  let ultimoT = 0, scadeA = 0, y = '', iframe = null, iframeY = null, tFine = 0;

  // con l'id del video si apre quello; senza, la diretta in corso del canale
  const indirizzo = (id) => 'https://www.youtube-nocookie.com/embed/' + (id ? id + '?' : 'live_stream?channel=' + C.CANALE_YT + '&') + 'autoplay=1&playsinline=1&rel=0';

  // il riquadro di YouTube c'è solo se la diretta è in corso E chi guarda ha acceso la radio (così parte con l'audio); si toglie del tutto alla fine
  function aggiornaVideo() {
    const voglio = R.diretta.attiva() && R.suona();
    if (iframe && (!voglio || iframeY !== y)) { iframe.remove(); iframe = null; iframeY = null; }
    if (voglio && !iframe) {
      iframe = document.createElement('iframe');
      iframe.src = indirizzo(y);
      iframe.title = 'La diretta di Maffy su YouTube';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      video.appendChild(iframe); iframeY = y;
    }
    video.classList.toggle('con-video', !!iframe);
  }
  function entra(id) {
    y = id || '';
    if (!R.diretta.attiva()) {
      clearTimeout(tFine); fine.hidden = true;
      box.hidden = false;
      R.diretta.entra(y);
    }
    aggiornaVideo();
  }
  function esci() {
    if (!R.diretta.attiva()) return;
    R.diretta.esci();
    box.hidden = true; aggiornaVideo();
    fine.hidden = false; clearTimeout(tFine); tFine = setTimeout(() => { fine.hidden = true; }, 8000);
  }

  async function ricevi(grezzo) {
    const m = await C.verificaOnda(grezzo, R.orologio());
    if (!m || m.t <= ultimoT) return;                 // firma sbagliata, vecchio o strano: ignorato; anche un messaggio già visto
    ultimoT = m.t;
    if (m.s === 'on') { scadeA = Date.now() + VIVA; entra(m.y); } else esci();
  }
  document.addEventListener('radio-onda-messaggio', (e) => { ricevi(e.detail); });
  document.addEventListener('radio-stato', aggiornaVideo);          // ha acceso o spento la radio: il video compare o sparisce
  setInterval(() => { if (R.diretta.attiva() && Date.now() > scadeA) esci(); }, 1000);

  window.RADIO_ONDA = { attiva: () => R.diretta.attiva(), video: () => iframe && iframe.src };   // per le prove
})();
