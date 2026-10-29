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
    const lines = [['Código', 'Grupo', 'Categoría', 'Tarjeta', 'Pago', 'Teléfono', 'Invitado', 'Asistencia', 'Restricción alimentaria', 'Mensaje', 'Respondió'].map(esc).join(';')];
    data.invitations.forEach(inv => inv.guests.forEach(g => {
      lines.push([inv.pin, inv.group, inv.category, inv.paysCard ? 'PAGA' : 'DIRECTO', inv.paysCard ? (inv.paid ? 'Pagó' : 'Falta pagar') : '', inv.phone, g.name, label(g.attendance), g.diet, inv.message, g.at || ''].map(esc).join(';'));
    }));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'confirmaciones-boda.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
})();
