(function () {
  'use strict';
  var token = null, usuario = null, timer = null;
  var $ = function (id) { return document.getElementById(id); };
  var NOMBRES = { temperatura: 'Temperatura', humedad: 'Humedad', nivel_agua: 'Nivel de agua' };
  try { token = sessionStorage.getItem('aq_token'); } catch (e) {}

  function api(ruta, opciones) {
    opciones = opciones || {};
    opciones.headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {});
    return fetch('/api' + ruta, opciones).then(function (r) {
      if (r.status === 401 && ruta.indexOf('/auth/login') < 0) { salir(); throw new Error('Sesión expirada'); }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Error'); return d; });
    });
  }
  function el(tag, texto, clase) { var e = document.createElement(tag); if (texto !== undefined) e.textContent = texto; if (clase) e.className = clase; return e; }
  function fecha(s) { return new Date(s).toLocaleString('es-CL'); }

  function mostrar(sesion) {
    $('login').hidden = sesion; $('panel').hidden = !sesion; $('sesion').hidden = !sesion;
  }
  function salir() {
    token = null; usuario = null; clearInterval(timer);
    try { sessionStorage.removeItem('aq_token'); } catch (e) {}
    mostrar(false);
  }
  function iniciar() {
    api('/auth/yo').then(function (d) {
      usuario = d.usuario; $('quien').textContent = usuario.nombre + ' (' + usuario.rol + ')';
      mostrar(true); refrescar(); timer = setInterval(refrescar, 10000);
    }).catch(function () { salir(); });
  }
  function refrescar() { medidas(); alertas(); cultivos(); historico(); }

  function medidas() {
    api('/mediciones/ultimas').then(function (filas) {
      var c = $('medidas'); c.textContent = '';
      if (!filas.length) c.appendChild(el('p', 'Sin mediciones todavía.', 'vacio'));
      filas.forEach(function (f) {
        var d = el('div', undefined, 'medida');
        d.appendChild(el('span', NOMBRES[f.tipo_variable] || f.tipo_variable));
        d.appendChild(el('b', Number(f.valor).toFixed(1) + ' ' + f.unidad));
        d.appendChild(el('span', fecha(f.timestamp)));
        c.appendChild(d);
      });
      $('actualizado').textContent = 'actualizado ' + new Date().toLocaleTimeString('es-CL');
    }).catch(function () {});
  }
  function alertas() {
    api('/alertas').then(function (filas) {
      var t = $('alertas'); t.textContent = '';
      $('sinAlertas').hidden = filas.length > 0;
      filas.slice(0, 20).forEach(function (a) {
        var tr = el('tr');
        tr.appendChild(el('td', fecha(a.fecha_generada)));
        tr.appendChild(el('td', a.nivel_criticidad, a.nivel_criticidad));
        tr.appendChild(el('td', a.cultivo || ''));
        tr.appendChild(el('td', NOMBRES[a.variable] || a.variable));
        tr.appendChild(el('td', Number(a.valor).toFixed(1) + ' ' + a.unidad));
        tr.appendChild(el('td', a.estado_revision));
        var td = el('td');
        if (a.estado_revision === 'pendiente' && (usuario.rol === 'encargado' || usuario.rol === 'administrador')) {
          var b = el('button', 'Marcar revisada'); b.className = 'sec';
          b.addEventListener('click', function () { api('/alertas/' + a.id_alerta + '/revisar', { method: 'PATCH' }).then(alertas); });
          td.appendChild(b);
        }
        tr.appendChild(td); t.appendChild(tr);
      });
    }).catch(function () {});
  }
  function cultivos() {
    var puede = usuario && (usuario.rol === 'encargado' || usuario.rol === 'administrador');
    api('/cultivos').then(function (filas) {
      var c = $('listaCultivos'); if (c.contains(document.activeElement)) return; c.textContent = '';
      filas.forEach(function (cu) {
        var d = el('div', undefined, 'cultivo');
        d.appendChild(el('b', cu.nombre));
        var s = el('select'); s.disabled = !puede;
        ['RUCULA', 'LECHUGA', 'PAPA'].forEach(function (p) { var o = el('option', p); o.value = p; if (p === cu.preset) o.selected = true; s.appendChild(o); });
        if (cu.preset === 'MANUAL') { var o = el('option', 'MANUAL'); o.value = 'MANUAL'; o.selected = true; s.appendChild(o); }
        s.addEventListener('change', function () {
          api('/cultivos/' + cu.id_cultivo + '/preset', { method: 'PATCH', body: JSON.stringify({ preset: s.value }) }).then(cultivos).catch(function (e) { alert(e.message); });
        });
        d.appendChild(s);
        d.appendChild(el('small', 'Día: riego ' + cu.tr_dia_s + ' s / descanso ' + cu.td_dia_s + ' s · Noche: ' + cu.tr_noche_s + ' s / ' + cu.td_noche_s + ' s'));
        c.appendChild(d);
      });
    }).catch(function () {});
  }
  function historico() {
    var v = $('variable').value;
    api('/mediciones?variable=' + v + '&limite=100').then(function (filas) {
      var g = $('grafico'); g.textContent = ''; $('sinHist').hidden = filas.length > 0;
      if (!filas.length) return;
      filas = filas.slice().reverse();
      var vals = filas.map(function (f) { return Number(f.valor); });
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals); if (min === max) { min -= 1; max += 1; }
      var NS = 'http://www.w3.org/2000/svg', pts = [];
      filas.forEach(function (f, i) { pts.push((40 + i * (550 / Math.max(filas.length - 1, 1))).toFixed(1) + ',' + (160 - (vals[i] - min) / (max - min) * 140).toFixed(1)); });
      [[min, 160], [max, 20]].forEach(function (p) {
        var l = document.createElementNS(NS, 'line'); l.setAttribute('x1', 40); l.setAttribute('x2', 590); l.setAttribute('y1', p[1]); l.setAttribute('y2', p[1]); l.setAttribute('class', 'g'); g.appendChild(l);
        var t = document.createElementNS(NS, 'text'); t.setAttribute('x', 2); t.setAttribute('y', p[1] + 3); t.textContent = p[0].toFixed(1); g.appendChild(t);
      });
      var pl = document.createElementNS(NS, 'polyline'); pl.setAttribute('points', pts.join(' ')); pl.setAttribute('class', 'l'); g.appendChild(pl);
    }).catch(function () {});
  }

  $('formLogin').addEventListener('submit', function (e) {
    e.preventDefault(); $('errLogin').textContent = '';
    api('/auth/login', { method: 'POST', body: JSON.stringify({ correo: $('correo').value, password: $('password').value }) })
      .then(function (d) { token = d.token; try { sessionStorage.setItem('aq_token', token); } catch (e) {} $('password').value = ''; iniciar(); })
      .catch(function (err) { $('errLogin').textContent = err.message; });
  });
  $('salir').addEventListener('click', salir);
  $('variable').addEventListener('change', historico);
  if (token) iniciar(); else mostrar(false);
})();
