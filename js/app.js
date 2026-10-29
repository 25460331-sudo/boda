(() => {
  const body = document.body;
  const opening = document.getElementById('opening');
  const envelope = document.getElementById('envelope');
  const scene = document.querySelector('.env-scene');
  const sealBtn = document.getElementById('openInvitation');
  const codeGate = document.getElementById('codeGate');
  const codeForm = document.getElementById('codeForm');
  const codeInput = document.getElementById('inviteCode');
  const codeButton = document.getElementById('codeButton');
  const codeError = document.getElementById('codeError');
  const app = document.getElementById('wedding-app');

  let currentCode = '';
  let currentInvitation = null;

  const CFG = window.BODA || {};
  const DEMO_MODE = !CFG.supabaseUrl || !CFG.supabaseKey;

  // MODO PRUEBA: solo existe mientras la página no está conectada a la base.
  // (Los datos de abajo son de ejemplo: los reales viven en la base.)
  const DEMOS = !DEMO_MODE ? {} : {
    '2027': {
      ok: true, invitationId: 'DEMO-DIRECTO', groupName: 'Familia Demo',
      guests: [{id:'1', name:'Invitado 1', attendance:''}, {id:'2', name:'Invitado 2', attendance:''}],
      paysCard: false,
      bank: { name: 'Banco de ejemplo', holders: 'Titular de ejemplo', cbu: '0000000000000000000000', alias: 'alias.ejemplo' }
    },
    '5050': {
      ok: true, invitationId: 'DEMO-PAGA', groupName: 'Familia Demo con tarjeta',
      guests: [{id:'3', name:'Invitado 1', attendance:''}, {id:'4', name:'Invitado 2', attendance:''}],
      paysCard: true,
      bank: { name: 'Banco de ejemplo', holders: 'Titular de ejemplo', cbu: '0000000000000000000000', alias: 'alias.ejemplo' }
    }
  };
  if (DEMO_MODE) document.getElementById('demoHelp').hidden = false;

  // Link personal: https://tusitio/?c=1234 deja el código ya escrito.
  try {
    const pre = new URLSearchParams(location.search).get('c');
    if (pre && /^\d{4}$/.test(pre)) document.getElementById('inviteCode').value = pre;
  } catch (e) { /* sin código en el link */ }

  // Llamada a una función de la base (Supabase). La clave "publishable" es pública por diseño:
  // la protección está en la base (tablas cerradas + funciones que piden el código).
  async function rpc(name, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseKey };
    if (/^eyJ/.test(CFG.supabaseKey)) headers.Authorization = 'Bearer ' + CFG.supabaseKey; // claves antiguas (JWT)
    try {
      const res = await fetch(CFG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
        method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Foto de "Nuestra historia"
  if (CFG.storyPhoto) {
    const img = document.getElementById('storyImg');
    img.addEventListener('load', () => {
      img.hidden = false;
      document.getElementById('storyPlaceholder').hidden = true;
    });
    img.src = CFG.storyPhoto;
  }
  if (CFG.rsvpDeadlineText) document.getElementById('rsvpDeadline').textContent = CFG.rsvpDeadlineText;

  /* ---------- Sobre: el sello se rompe, se abre la solapa y aparece el código ---------- */
  sealBtn.addEventListener('click', () => {
    if (envelope.classList.contains('is-open')) return;
    sealBtn.disabled = true;
    scene.classList.add('is-opening');
    envelope.classList.add('is-open');
    const wait = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 1750;
    setTimeout(() => {
      scene.classList.add('is-done');
      codeGate.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => codeGate.classList.add('gate-visible')));
      setTimeout(() => { try { codeInput.focus({ preventScroll: true }); } catch (e) { codeInput.focus(); } }, 700);
    }, wait);
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
    codeError.textContent = '';
  });

  codeForm.addEventListener('submit', event => {
    event.preventDefault();
    const code = codeInput.value.trim();

    if (!/^\d{4}$/.test(code)) {
      codeError.textContent = 'Ingresá los 4 números de tu invitación.';
      return;
    }

    setSearching(true);
    codeError.textContent = '';

    if (DEMO_MODE) {
      setTimeout(() => {
        if (DEMOS[code]) openLoadedInvitation(code, DEMOS[code]);
        else { setSearching(false); codeError.textContent = 'Código no encontrado. Para probar usá 2027 o 5050.'; }
      }, 350);
      return;
    }

    rpc('get_invitation', { p_pin: code })
      .then(data => {
        if (!data || !data.ok) {
          setSearching(false);
          codeError.textContent = (data && data.message) || 'No encontramos ese código.';
          codeInput.select();
          return;
        }
        openLoadedInvitation(code, data);
      })
      .catch(error => {
        console.error('Error de conexión:', error);
        setSearching(false);
        codeError.textContent = error && error.name === 'AbortError'
          ? 'La consulta tardó demasiado. Probá nuevamente.'
          : 'No pudimos consultar la invitación. Probá nuevamente.';
      });
  });

  function setSearching(searching) {
    codeButton.disabled = searching;
    codeButton.textContent = searching ? 'Buscando…' : 'Abrir mi invitación';
  }

  function openLoadedInvitation(code, data) {
    setSearching(false);
    currentCode = code;
    currentInvitation = data;
    hydrateInvitation(data);

    app.hidden = false;
    body.classList.remove('is-locked');
    window.scrollTo(0, 0);
    opening.classList.add('is-gone');
    setTimeout(() => { opening.hidden = true; }, 900);
    // la portada arranca su entrada una vez visible
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('.hero').classList.add('in')));
  }

  /* ---------- Regalos / pago de la tarjeta ---------- */
  const giftMicro = document.getElementById('giftMicro');
  const giftText = document.getElementById('giftText');
  const giftToggle = document.getElementById('giftToggle');
  const bankData = document.getElementById('bankData');
  const copyStatus = document.getElementById('copyStatus');

  const giftLabels = { show: 'Ver datos bancarios', hide: 'Ocultar datos bancarios' };

  function refreshGiftToggle() {
    giftToggle.textContent = bankData.hidden ? giftLabels.show : giftLabels.hide;
  }

  // El tipo de invitación SOLO cambia los colores. Los regalos (datos bancarios) son iguales para todos;
  // el control de quién pagó la tarjeta vive únicamente en el panel privado.
  function applyVariant(paysCard) {
    body.classList.remove('theme-green', 'theme-card');
    body.classList.add(paysCard ? 'theme-card' : 'theme-green');
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', paysCard ? '#fcfbf9' : '#f7f9f5');
    refreshGiftToggle();
  }

  // Los datos bancarios llegan desde la base recién cuando el código es válido.
  function fillBank(bank) {
    const has = !!(bank && bank.cbu);
    giftToggle.hidden = !has;
    bankData.hidden = true;
    giftToggle.setAttribute('aria-expanded', 'false');
    refreshGiftToggle();
    if (!has) return;
    const cbu = String(bank.cbu);
    const shown = {
      name: bank.name, holders: bank.holders, alias: bank.alias,
      cbu: cbu.length > 8 ? cbu.slice(0, 8) + ' ' + cbu.slice(8) : cbu
    };
    bankData.querySelectorAll('.bank-row').forEach(row => {
      const valueEl = row.querySelector('[data-bank]');
      const key = valueEl.dataset.bank;
      valueEl.textContent = shown[key] || '';
      row.querySelector('.copy-btn').dataset.copy = key === 'cbu' ? cbu : (bank[key] || '');
    });
  }

  function hydrateInvitation(data) {
    const groupName = document.getElementById('groupName');
    const guestCount = document.getElementById('guestCount');
    const guestList = document.getElementById('guestList');

    groupName.textContent = data.groupName || 'Tu invitación';

    const count = (data.guests || []).length;
    guestCount.textContent = count === 1
      ? 'Tenemos 1 lugar reservado para vos'
      : `Tenemos ${count} lugares reservados para ustedes`;

    guestList.innerHTML = '';

    (data.guests || []).forEach((guest, index) => {
      const item = document.createElement('div');
      item.className = 'guest';
      item.dataset.personId = guest.id;
      item.dataset.personName = guest.name;

      const name = document.createElement('span');
      name.className = 'guest-name';
      name.textContent = guest.name;

      const answers = document.createElement('div');
      answers.className = 'answer';
      answers.appendChild(makeOption(index, 'si', 'Sí, asistiré', guest.attendance === 'si'));
      answers.appendChild(makeOption(index, 'no', 'No podré asistir', guest.attendance === 'no'));

      const diet = document.createElement('div');
      diet.className = 'diet';
      diet.hidden = guest.attendance !== 'si';
      const dietLabel = document.createElement('label');
      dietLabel.className = 'small-caps';
      dietLabel.htmlFor = `diet_${index}`;
      dietLabel.textContent = 'Restricción alimentaria (si tenés)';
      const dietInput = document.createElement('input');
      dietInput.type = 'text';
      dietInput.id = `diet_${index}`;
      dietInput.maxLength = 200;
      dietInput.placeholder = 'Ej.: celíaco/a, vegetariano/a, alergia…';
      dietInput.value = guest.diet || '';
      diet.append(dietLabel, dietInput);
      answers.addEventListener('change', () => {
        const yes = item.querySelector('input[value="si"]').checked;
        diet.hidden = !yes;
      });

      item.appendChild(name);
      item.appendChild(answers);
      item.appendChild(diet);
      guestList.appendChild(item);
    });

    document.getElementById('rsvpMessage').value = data.message || '';
    fillBank(data.bank);
    applyVariant(!!data.paysCard); // Privado: jamás se muestra si paga o no paga.
  }

  function makeOption(index, value, text, checked) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const span = document.createElement('span');
    input.type = 'radio';
    input.name = `guest_${index}`;
    input.value = value;
    input.checked = checked;
    span.textContent = text;
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  // Cuenta regresiva A LA BODA (10/04/2027 18:00 Argentina = 21:00 UTC)
  const parsedWedding = Date.parse(CFG.weddingDate || '');
  const weddingTime = Number.isFinite(parsedWedding) ? parsedWedding : Date.parse('2027-04-10T21:00:00Z');
  const timer = {
    d: document.getElementById('days'), h: document.getElementById('hours'),
    m: document.getElementById('minutes'), s: document.getElementById('seconds')
  };
  function updateWeddingCountdown() {
    let diff = Math.max(0, weddingTime - Date.now());
    const d = Math.floor(diff / 86400000); diff %= 86400000;
    const h = Math.floor(diff / 3600000); diff %= 3600000;
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    timer.d.textContent = String(d);
    timer.h.textContent = String(h).padStart(2, '0');
    timer.m.textContent = String(m).padStart(2, '0');
    timer.s.textContent = String(s).padStart(2, '0');
  }
  updateWeddingCountdown();
  setInterval(updateWeddingCountdown, 1000);

  // Mostrar / ocultar datos bancarios
  giftToggle.addEventListener('click', () => {
    const open = bankData.hidden;
    bankData.hidden = !open;
    refreshGiftToggle();
    giftToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      bankData.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'ease-out' });
    }
  });

  // Copiar al portapapeles (con segundo camino si el navegador bloquea la API moderna)
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* sigue al plan B */ }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }

  function selectNode(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  bankData.addEventListener('click', async event => {
    const btn = event.target.closest('.copy-btn');
    if (!btn) return;
    const what = btn.dataset.what || 'Dato';
    const ok = await copyText(btn.dataset.copy || '');

    if (!btn.dataset.orig) btn.dataset.orig = btn.textContent;
    btn.classList.toggle('copied', ok);
    btn.classList.toggle('failed', !ok);
    btn.textContent = ok ? 'Copiado ✓' : 'Copialo a mano';
    copyStatus.textContent = ok
      ? `${what} copiado`
      : 'No se pudo copiar automáticamente. Mantené presionado el dato seleccionado para copiarlo.';

    if (!ok) {
      const value = btn.closest('.bank-row').querySelector('.bank-value');
      if (value) selectNode(value);
    }
    clearTimeout(btn._resetTimer);
    btn._resetTimer = setTimeout(() => {
      btn.textContent = btn.dataset.orig;
      btn.classList.remove('copied', 'failed');
    }, 2200);
  });

  // Confirmación
  const confirmButton = document.getElementById('confirmButton');
  const result = document.getElementById('rsvpResult');

  confirmButton.addEventListener('click', () => {
    if (!currentInvitation) return;

    const guestElements = [...document.querySelectorAll('#guestList .guest')];
    const guests = [];
    let incomplete = false;

    guestElements.forEach((el, index) => {
      const checked = el.querySelector(`input[name="guest_${index}"]:checked`);
      if (!checked) { incomplete = true; return; }
      guests.push({ id: el.dataset.personId, name: el.dataset.personName, attends: checked.value === 'si',
        diet: checked.value === 'si' ? (el.querySelector('.diet input').value || '').trim() : '' });
    });

    if (incomplete) {
      result.textContent = 'Elegí una opción para cada persona antes de confirmar.';
      return;
    }

    // En modo prueba no se llama a ninguna base.
    if (DEMO_MODE) {
      const yes = guests.filter(g => g.attends).length;
      result.textContent = `¡Listo! ♡ ${yes} de ${guests.length} confirmaron asistencia en esta prueba.`;
      return;
    }

    confirmButton.disabled = true;
    confirmButton.textContent = 'Guardando…';
    result.textContent = '';

    rpc('save_rsvp', {
      p_pin: currentCode,
      p_answers: guests.map(g => ({ id: g.id, attends: g.attends, diet: g.diet })),
      p_message: document.getElementById('rsvpMessage').value
    })
      .then(response => {
        result.textContent = response && response.ok
          ? '¡Listo! ♡ La confirmación quedó registrada.'
          : ((response && response.message) || 'No pudimos guardar la confirmación.');
      })
      .catch(error => {
        console.error('Error al guardar:', error);
        result.textContent = error && error.name === 'AbortError'
          ? 'La confirmación tardó demasiado. Intentá nuevamente.'
          : 'No pudimos guardar la confirmación. Intentá nuevamente.';
      })
      .finally(() => {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Confirmar asistencia';
      });
  });
})();
