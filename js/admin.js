(() => {
  const CFG = window.BODA || {};
  const $ = id => document.getElementById(id);
  let key = '';
  let data = null;
  let filter = 'all';

  if (!CFG.supabaseUrl || !CFG.supabaseKey) $('demoNote').hidden = false;

  async function rpc(name, body) {
    const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseKey };
    if (/^eyJ/.test(CFG.supabaseKey)) headers.Authorization = 'Bearer ' + CFG.supabaseKey;
    const res = await fetch(CFG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function load() {
    const r = await rpc('admin_summary', { p_key: key });
    if (!r.ok) throw new Error(r.message || 'No se pudo entrar.');
    data = r;
    render();
  }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!CFG.supabaseUrl || !CFG.supabaseKey) { $('loginErr').textContent = 'Falta conectar la base (js/config.js).'; return; }
    key = $('adminKey').value;
    $('loginBtn').disabled = true;
    $('loginErr').textContent = '';
    try {
      await load();
      $('login').hidden = true;
      $('panel').hidden = false;
    } catch (err) {
      $('loginErr').textContent = err.message.startsWith('HTTP') ? 'No pudimos conectar con la base.' : err.message;
    } finally {
      $('loginBtn').disabled = false;
    }
  });

  $('reload').addEventListener('click', () => load().catch(err => { $('updated').textContent = 'No se pudo actualizar: ' + err.message; }));
  $('search').addEventListener('input', render);
  $('chips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    render();
  });

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const label = a => a === 'si' ? 'Asiste' : a === 'no' ? 'No asiste' : 'Sin responder';

  function matches(inv) {
    const q = norm($('search').value.trim());
    if (q) {
      const hay = norm(inv.pin + ' ' + inv.group + ' ' + (inv.category || '') + ' ' + inv.guests.map(g => g.name).join(' '));
      if (!hay.includes(q)) return false;
    }
    if (filter === 'si') return inv.guests.some(g => g.attendance === 'si');
    if (filter === 'no') return inv.guests.some(g => g.attendance === 'no');
    if (filter === 'pend') return inv.guests.some(g => !g.attendance);
    if (filter === 'unpaid') return inv.paysCard && !inv.paid;
    if (filter === 'norc') return inv.paysCard && !(inv.receipts && inv.receipts.length);
    return true;
  }

  function stat(num, text, main) {
    const d = document.createElement('div');
    d.className = 'stat' + (main ? ' main' : '');
    const b = document.createElement('b'); b.textContent = num;
    const s = document.createElement('span'); s.textContent = text;
    d.append(b, s);
    return d;
  }

  function render() {
    const t = data.totals;
    const stats = $('stats');
    stats.replaceChildren(
      stat(t.yes, 'Confirmaron que asisten', true),
      stat(t.no, 'No podrán asistir'),
      stat(t.pending, 'Sin responder'),
      stat(t.people, 'Personas en la lista'),
      stat(t.yesPay, 'Asisten · pagan tarjeta'),
      stat(t.yesDirect, 'Asisten · no pagan tarjeta'),
      stat((t.paidInvites || 0) + ' de ' + (t.payInvites || 0), 'Tarjetas pagadas')
    );

    const rows = $('rows');
    rows.replaceChildren();
    data.invitations.filter(matches).forEach(inv => {
      const tr = document.createElement('tr');
      const c1 = document.createElement('td'); c1.className = 'pin'; c1.textContent = inv.pin;
      const c2 = document.createElement('td'); c2.textContent = inv.group;
      if (inv.category && inv.category !== inv.group) { const cs = document.createElement('span'); cs.className = 'cat'; cs.textContent = inv.category; c2.appendChild(cs); }
      const c3 = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = 'tag' + (inv.paysCard ? ' pay' : '');
      tag.textContent = inv.paysCard ? 'Paga' : 'No paga';
      c3.appendChild(tag);
      if (inv.paysCard) {
        const pb = document.createElement('button');
        pb.type = 'button';
        pb.className = 'pay-btn' + (inv.paid ? ' paid' : '');
        pb.textContent = inv.paid ? 'Pagó ✓' : 'Marcar como pagada';
        pb.addEventListener('click', () => setPaid(inv, !inv.paid, pb));
        c3.appendChild(pb);
        c3.appendChild(receiptsCell(inv));
      }
      const c4 = document.createElement('td');
      inv.guests.forEach(g => {
        const line = document.createElement('span');
        line.className = 'guestline';
        const st = document.createElement('span');
        st.className = 'st ' + (g.attendance || '');
        st.textContent = g.name + ' — ' + label(g.attendance);
        line.appendChild(st);
        c4.appendChild(line);
        if (g.diet) {
          const d = document.createElement('span');
          d.className = 'diet-line';
          d.textContent = 'Alimentación: ' + g.diet;
          c4.appendChild(d);
        }
      });
      if (inv.message) {
        const m = document.createElement('span');
        m.className = 'msg';
        m.textContent = '“' + inv.message + '”';
        c4.appendChild(m);
      }
      const c5 = document.createElement('td');
      c5.appendChild(sendCell(inv));
      tr.append(c1, c2, c3, c4, c5);
      rows.appendChild(tr);
    });
    if (!rows.children.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No hay resultados.';
      tr.appendChild(td); rows.appendChild(tr);
    }
    $('updated').textContent = 'Actualizado a las ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  // ---- Enviar por WhatsApp ----
  const baseUrl = new URL('./', location.href).href;
  function linkFor(inv) { return baseUrl + '?c=' + inv.pin; }
  function waNumber(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10) d = '549' + d; // Argentina: característica + número, sin 0 ni 15
    return d;
  }
  function sendCell(inv) {
    const wrap = document.createElement('div');
    const num = waNumber(inv.phone);
    if (num) {
      const first = (inv.guests[0] ? inv.guests[0].name : inv.group).split(' ')[0];
      const text = 'Hola ' + first + '! Con mucho cariño te compartimos nuestra invitación de casamiento 💍\n' + linkFor(inv) + '\nTu código es ' + inv.pin + '.\nNatalia y Emanuel';
      const a = document.createElement('a');
      a.className = 'wa';
      a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = 'WhatsApp';
      wrap.appendChild(a);
    } else {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'phone-btn'; b.textContent = 'Cargar teléfono';
      b.addEventListener('click', async () => {
        const v = window.prompt ? window.prompt('Teléfono con característica (sin 0 ni 15):') : '';
        if (!v) return;
        try {
          const r = await rpc('admin_set_phone', { p_key: key, p_pin: inv.pin, p_phone: v });
          if (r.ok) { inv.phone = v; render(); }
        } catch (e) { $('updated').textContent = 'No se pudo guardar el teléfono.'; }
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  // ---- Comprobantes de pago (los mandan por WhatsApp y se cargan acá) ----
  function receiptsCell(inv) {
    const box = document.createElement('div');
    box.className = 'receipts';
    (inv.receipts || []).forEach(r => {
      const row = document.createElement('div');
      row.className = 'rc-row';
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'rc-open'; open.textContent = r.name; open.title = r.name;
      open.addEventListener('click', () => openReceipt(r, open));
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'rc-del'; del.textContent = 'Quitar';
      del.setAttribute('aria-label', 'Quitar el comprobante ' + r.name);
      del.addEventListener('click', () => deleteReceipt(r, del));
      row.append(open, del);
      box.appendChild(row);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'rc-add'; add.textContent = '＋ Adjuntar comprobante';
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*,application/pdf'; file.hidden = true;
    file.setAttribute('aria-label', 'Elegir comprobante de ' + inv.group);
    add.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) addReceipt(inv, file.files[0], add); });
    box.append(add, file);
    return box;
  }

  const toBase64 = blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    fr.readAsDataURL(blob);
  });

  // Las fotos se achican (máx. 1600 px, JPEG) para que pesen poco; los PDF van tal cual (hasta 1,5 MB).
  async function prepareFile(file) {
    if (file.type === 'application/pdf') {
      if (file.size > 1500000) throw new Error('El PDF pesa más de 1,5 MB. Sacale una captura y adjuntá la foto.');
      return { mime: 'application/pdf', name: file.name, data: await toBase64(file) };
    }
    if (!/^image\//.test(file.type)) throw new Error('Adjuntá una foto o un PDF.');
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('No pude leer esa imagen. Probá con una captura de pantalla (JPG o PNG).'); }
    let side = 1600, quality = 0.82, blob = null;
    for (let i = 0; i < 4; i++) {
      const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.drawImage(bmp, 0, 0, cv.width, cv.height);
      blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
      if (blob && blob.size <= 900000) break;
      side = Math.round(side * 0.75); quality = Math.max(0.55, quality - 0.1);
    }
    if (!blob || blob.size > 1500000) throw new Error('La imagen sigue pesando mucho. Probá con otra captura.');
    return { mime: 'image/jpeg', name: String(file.name || 'comprobante').replace(/\.[^.]+$/, '') + '.jpg', data: await toBase64(blob) };
  }

  async function addReceipt(inv, file, btn) {
    btn.disabled = true;
    $('updated').textContent = 'Subiendo comprobante…';
    try {
      const f = await prepareFile(file);
      const r = await rpc('admin_add_receipt', { p_key: key, p_pin: inv.pin, p_name: f.name, p_mime: f.mime, p_data: f.data });
      if (!r.ok) throw new Error(r.message || 'error');
      await load();
      $('updated').textContent = 'Comprobante guardado ✓';
    } catch (e) {
      btn.disabled = false;
      $('updated').textContent = 'No se pudo guardar el comprobante: ' + e.message;
    }
  }

  async function openReceipt(r, btn) {
    btn.disabled = true;
    try {
      const x = await rpc('admin_get_receipt', { p_key: key, p_id: r.id });
      if (!x.ok) throw new Error(x.message || 'error');
      const bin = atob(x.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: x.mime }));
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      $('updated').textContent = 'No se pudo abrir el comprobante: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteReceipt(r, btn) {
    if (window.confirm && !window.confirm('¿Quitar este comprobante?')) return;
    btn.disabled = true;
    try {
      const x = await rpc('admin_delete_receipt', { p_key: key, p_id: r.id });
      if (!x.ok) throw new Error(x.message || 'error');
      await load();
    } catch (e) {
      btn.disabled = false;
      $('updated').textContent = 'No se pudo quitar el comprobante: ' + e.message;
    }
  }

  async function setPaid(inv, value, btn) {
    btn.disabled = true;
    try {
      const r = await rpc('admin_set_paid', { p_key: key, p_pin: inv.pin, p_paid: value });
      if (!r.ok) throw new Error(r.message || 'error');
      await load();
    } catch (e) {
      btn.disabled = false;
      $('updated').textContent = 'No se pudo cambiar el pago: ' + e.message;
    }
  }

  // Descarga CSV (con BOM para que Excel respete los acentos)
  $('csv').addEventListener('click', () => {
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Código', 'Grupo', 'Categoría', 'Tarjeta', 'Pago', 'Teléfono', 'Invitado', 'Asistencia', 'Restricción alimentaria', 'Mensaje', 'Respondió', 'Comprobantes'].map(esc).join(';')];
    data.invitations.forEach(inv => inv.guests.forEach(g => {
      lines.push([inv.pin, inv.group, inv.category, inv.paysCard ? 'PAGA' : 'DIRECTO', inv.paysCard ? (inv.paid ? 'Pagó' : 'Falta pagar') : '', inv.phone, g.name, label(g.attendance), g.diet, inv.message, g.at || '', inv.paysCard ? (inv.receipts || []).length : ''].map(esc).join(';'));
    }));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'confirmaciones-boda.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
})();
