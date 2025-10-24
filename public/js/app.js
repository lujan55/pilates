document.addEventListener('DOMContentLoaded', () => {
  const formAlumna = document.getElementById('formAlumna');
  const formPago = document.getElementById('formPago');
  const lista = document.getElementById('listaAlumnas');
  const inputBuscar = document.getElementById('buscarAlumno');
  const bodyCalendario = document.getElementById('bodyCalendario');
  const alumnaIdSeleccionada = document.getElementById('alumnaIdSeleccionada');

  let alumnos = [];

  const horarios = ["08:00","09:00","10:00","11:00","15:00","16:00","17:00","18:00","19:00","20:00"];
  const dias = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const MAX_POR_TURNO = 7;

  // ===== Helpers =====
  const norm = (s) =>
    (s ?? "").toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const normalizeHour = (h) => {
    if (!h) return null;
    let s = h.toString().trim().toLowerCase();
    s = s.replace(/\s*hs?$/i, ''); // quita "hs"/"h"
    s = s.replace(/\./g, ':');     // 8.00 -> 8:00
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) s = s.slice(0, 5);
    const m = s.match(/^(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return null;
    const hh = m[1].padStart(2, '0');
    const mm = m[2] ? m[2] : '00';
    return `${hh}:${mm}`;
  };

  const canonDia = (d) => {
    const nd = norm(d);
    const i = dias.findIndex(label => norm(label) === nd);
    return i >= 0 ? dias[i] : null; // siempre capitalizado como en el array
  };

  const canonClase = (dia, hora) => {
    const D = canonDia(dia);
    const H = normalizeHour(hora);
    if (!D || !H) return null;
    return `${D} ${H}`;
  };

  // Convierte un string de dias_horarios a array CANÓNICO ["Lunes 08:00", ...]
  const splitClasesCanon = (dias_horarios) => {
    if (!dias_horarios) return [];
    return dias_horarios
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)
      .map(c => {
        const [d, ...rest] = c.split(' ');
        const dia = d;
        const hora = rest.join(' ');
        return canonClase(dia, hora);
      })
      .filter(Boolean);
  };

  // Une array canónico a string
  const joinClasesCanon = (arr) => arr.filter(Boolean).join(',');

  const diaIndex = (d) => {
    const nd = norm(d);
    return dias.findIndex(label => norm(label) === nd);
  };

  const findRowByHour = (h) => {
    const H = normalizeHour(h);
    if (!H) return null;
    return [...bodyCalendario.children].find(tr => tr.firstChild.textContent === H);
  };

  // ===== Calendario =====
  const generarCalendario = () => {
    bodyCalendario.innerHTML = '';
    horarios.forEach(hora => {
      const fila = document.createElement('tr');
      const celdaHora = document.createElement('td');
      celdaHora.textContent = hora;
      fila.appendChild(celdaHora);

      dias.forEach(() => {
        const celda = document.createElement('td');
        celda.innerHTML = "-";
        fila.appendChild(celda);
      });

      bodyCalendario.appendChild(fila);
    });
  };

  const actualizarHorariosBD = async (alumna) => {
    try {
      // Siempre persistimos en formato CANÓNICO
      const canon = joinClasesCanon(splitClasesCanon(alumna.dias_horarios));
      await fetch(`/api/alumnas/${alumna.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias_horarios: canon })
      });
      alumna.dias_horarios = canon; // mantener en memoria el mismo formato
    } catch (err) {
      console.error('Error al actualizar horarios:', err);
    }
  };

  const crearBadge = (alumna, dia, hora, divAlumnas) => {
    const span = document.createElement('span');
    span.dataset.id = alumna.id;
    span.className = "badge bg-primary m-1 d-inline-flex align-items-center";
    span.innerHTML = `
      ${alumna.nombre}
      <button class="btn-close btn-close-white btn-sm ms-2" aria-label="Eliminar"></button>
    `;

    // Eliminar (siempre con comparación CANÓNICA)
    span.querySelector('button').onclick = async () => {
      span.remove();
      const target = canonClase(dia, hora);
      const arr = splitClasesCanon(alumna.dias_horarios).filter(c => c !== target);
      alumna.dias_horarios = joinClasesCanon(arr);
      await actualizarHorariosBD(alumna);
    };

    // Respetar cupo
    if (divAlumnas.querySelectorAll('span.badge').length < MAX_POR_TURNO) {
      divAlumnas.appendChild(span);
    }
  };

  const pintarClases = () => {
    alumnos.forEach(alumna => {
      const clases = splitClasesCanon(alumna.dias_horarios); // <- canónico
      if (!clases.length) return;

      clases.forEach(clase => {
        const [dia, hora] = clase.split(' ');
        const fila = findRowByHour(hora);
        const idx = diaIndex(dia);
        if (!fila || idx < 0) return;

        const celda = fila.children[idx + 1];
        if (!celda.querySelector('.alumnas')) {
          celda.innerHTML = `
            <div class="alumnas d-flex flex-wrap justify-content-start"></div>
            <button class="btn btn-sm btn-success mt-1">➕</button>
          `;
          celda.querySelector('button').onclick = () => abrirBuscador(celda, dia, hora);
        }

        const divAlumnas = celda.querySelector('.alumnas');
        if ([...divAlumnas.children].some(el => el.dataset && el.dataset.id == alumna.id)) return;

        crearBadge(alumna, dia, hora, divAlumnas);
      });
    });
  };

  const abrirBuscador = (celda, dia, hora) => {
    if (celda.querySelector('.buscador')) return;

    const input = document.createElement('input');
    input.type = "text";
    input.placeholder = "Buscar alumna...";
    input.className = "form-control form-control-sm mt-2 buscador";

    const listaResultados = document.createElement('div');
    listaResultados.className = "list-group mt-1";

    celda.appendChild(input);
    celda.appendChild(listaResultados);

    input.addEventListener('input', () => {
      const texto = input.value.toLowerCase().trim();
      listaResultados.innerHTML = '';
      if (texto === '') return;

      const resultados = alumnos.filter(a =>
        a.nombre.toLowerCase().includes(texto) || (a.dni ?? '').toString().includes(texto)
      );

      resultados.forEach(a => {
        const item = document.createElement('button');
        item.type = "button";
        item.className = "list-group-item list-group-item-action";
        item.textContent = `${a.nombre} (DNI: ${a.dni})`;

        item.onclick = async () => {
          const divAlumnas = celda.querySelector('.alumnas');
          if (divAlumnas.querySelectorAll('span.badge').length >= MAX_POR_TURNO) {
            alert(`Máximo ${MAX_POR_TURNO} alumnas por clase`);
            return;
          }

          const alumna = alumnos.find(al => al.id == a.id);
          const nueva = canonClase(dia, hora);
          const arr = splitClasesCanon(alumna.dias_horarios);
          if (!arr.includes(nueva)) {
            arr.push(nueva);
            alumna.dias_horarios = joinClasesCanon(arr);
            await actualizarHorariosBD(alumna);
          }

          crearBadge(alumna, dia, hora, divAlumnas);
          input.value = '';
          listaResultados.innerHTML = '';
        };

        listaResultados.appendChild(item);
      });
    });
  };

  const cargarTodo = async () => {
    const resAlumnas = await fetch('/api/alumnas');
    alumnos = await resAlumnas.json();

    // No mutamos DB aquí, solo pintamos usando vista canónica
    generarCalendario();
    pintarClases();

    // Anuncio cumpleaños (usamos los datos cargados)
    mostrarBannerCumples(alumnos);
  };

  // ===== Buscador de alumnas (para pagos) =====
  inputBuscar.addEventListener('input', (e) => {
    const texto = e.target.value.toLowerCase().trim();
    lista.innerHTML = '';
    if (texto === '') return;
    const filtrados = alumnos.filter(a =>
      a.nombre.toLowerCase().includes(texto) || (a.dni ?? '').toString().toLowerCase().includes(texto)
    );
    filtrados.forEach(a => {
      const li = document.createElement('li');
      li.className = 'list-group-item list-group-item-action';
      li.textContent = `${a.nombre} | DNI: ${a.dni}`;
      li.onclick = () => {
        alumnaIdSeleccionada.value = a.id;
        inputBuscar.value = `${a.nombre} (DNI: ${a.dni})`;
        lista.innerHTML = '';
      };
      lista.appendChild(li);
    });
  });

  // ===== Form: nueva alumna =====
  formAlumna.addEventListener('submit', async (e) => {
    e.preventDefault();
    const obj = Object.fromEntries(new FormData(formAlumna).entries());
    await fetch('/api/alumnas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
    formAlumna.reset();
    cargarTodo();
  });

  // ===== Form: registrar pago =====
  formPago.addEventListener('submit', async (e) => {
    e.preventDefault();
    const obj = Object.fromEntries(new FormData(formPago).entries());
    const resp = await fetch('/api/pagos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });

    if (!resp.ok) {
      alert('No se pudo registrar el pago');
      return;
    }

    formPago.reset();
    alumnaIdSeleccionada.value = '';
    alert("Pago registrado correctamente");

    if (typeof window.actualizarTablaPagos === 'function') window.actualizarTablaPagos();
    if (typeof window.cargarCaja === 'function') window.cargarCaja();
  });

  // Init
  generarCalendario();
  cargarTodo();
});

// ===== TABLA DE PAGOS REALIZADOS (auto limpia por mes) =====
(() => {
  const tablaPagosBody = document.getElementById('tablaPagosBody');
  if (!tablaPagosBody) return;

  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  let lastMonthKey = monthKey();

  const cargarPagos = async () => {
    try {
      const res = await fetch('/api/pagos/listado');
      const data = await res.json();
      tablaPagosBody.innerHTML = '';
      data.forEach(row => {
        const tr = document.createElement('tr');
tr.innerHTML = `
  <td>${row.nombre}</td>
  <td>${new Date(row.fecha).toLocaleDateString('es-AR')}</td>
  <td>${row.metodo_pago || '-'}</td>
  <td class="text-end">${money(row.monto)}</td>
`;

        tablaPagosBody.appendChild(tr);
      });
    } catch (err) {
      console.error('Error al cargar pagos:', err);
    }
  };

  cargarPagos();

  // Reinicio automático mensual
  setInterval(() => {
    const nowKey = monthKey();
    if (nowKey !== lastMonthKey) {
      lastMonthKey = nowKey;
      tablaPagosBody.innerHTML = '';
      cargarPagos();
      if (typeof window.cargarCaja === 'function') window.cargarCaja();
    }
  }, 60 * 60 * 1000);

  window.actualizarTablaPagos = cargarPagos;
})();


// ===== MODULO CIERRE DE CAJA MENSUAL (con nueva estética, emojis y reinicio visible) =====
(() => {
  const tablaBody = document.getElementById('tablaCajaBody');
  const tablaHead = document.querySelector('#tablaCaja thead tr');
  const totalIngresosEl = document.getElementById('totalIngresos');
  const totalEgresosEl  = document.getElementById('totalEgresos');
  const totalNetoEl     = document.getElementById('totalNeto');
  const btnAgregarEgreso = document.getElementById('btnAgregarEgreso');
  const btnCierreCaja    = document.getElementById('btnCierreCaja');
  const contenedorBotones = btnCierreCaja?.parentElement || document.querySelector('.accionesCaja');

  // ✅ Asegurar que la cabecera tenga "Acción"
  if (tablaHead && !tablaHead.querySelector('.col-accion')) {
    const thAccion = document.createElement('th');
    thAccion.className = 'bg-dark text-white text-center col-accion';
    thAccion.textContent = 'Acción';
    tablaHead.appendChild(thAccion);
  }

  // 🔁 Botón de Reiniciar Caja (si no existe)
  let btnReiniciarCaja = document.getElementById('btnReiniciarCaja');
  if (!btnReiniciarCaja) {
    btnReiniciarCaja = document.createElement('button');
    btnReiniciarCaja.id = 'btnReiniciarCaja';
    btnReiniciarCaja.className = 'btn btn-warning mt-2 ms-2 fw-bold';
    btnReiniciarCaja.innerHTML = '🔄 Reiniciar Caja';
    contenedorBotones?.appendChild(btnReiniciarCaja);
  }

  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const currentMonthKey = monthKey();
  let cajaCerrada = localStorage.getItem('cajaCerrada') === currentMonthKey;

  const limpiarVistaCaja = () => {
    if (!tablaBody) return;
    tablaBody.innerHTML = '';
    totalIngresosEl.textContent = '$0.00';
    totalEgresosEl.textContent  = '$0.00';
    totalNetoEl.textContent     = '$0.00';
  };

  const renderCaja = (ingresos = [], egresos = []) => {
    if (cajaCerrada) return limpiarVistaCaja();
    tablaBody.innerHTML = '';
    let totalIng = 0, totalEgr = 0;

    const agregarFila = (mov, tipo) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${mov.fecha}</td>
        <td class="${tipo === 'Ingreso' ? 'text-success fw-semibold' : 'text-danger fw-semibold'}">${tipo}</td>
<td>${mov.detalle}</td>
<td>${mov.metodo_pago || '-'}</td>
<td class="text-end">${money(mov.monto)}</td>

        <td class="text-center align-middle">
          <button class="btn btn-sm btn-primary me-2 px-3 py-2 fw-bold" title="Editar">
            ✏️
          </button>
          <button class="btn btn-sm btn-danger px-3 py-2 fw-bold" title="Eliminar">
            🗑️
          </button>
        </td>
      `;

      // === EDITAR ===
      tr.querySelector('.btn-primary').addEventListener('click', async () => {
        const nuevoDetalle = prompt('Editar detalle:', mov.detalle);
        if (nuevoDetalle === null) return;
        const nuevoMonto = prompt('Editar monto:', mov.monto);
        if (nuevoMonto === null || isNaN(nuevoMonto)) return alert('Monto inválido.');

        const endpoint = tipo === 'Ingreso' ? '/api/pagos/' : '/api/egresos/';
        const res = await fetch(endpoint + mov.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ detalle: nuevoDetalle, monto: nuevoMonto })
        });

        if (res.ok) {
          alert(`${tipo} actualizado correctamente.`);
          cargarCaja();
        } else {
          alert(`Error al actualizar el ${tipo.toLowerCase()}.`);
        }
      });

      // === ELIMINAR ===
      tr.querySelector('.btn-danger').addEventListener('click', async () => {
        if (!confirm(`¿Seguro que deseas eliminar este ${tipo.toLowerCase()}?`)) return;
        const endpoint = tipo === 'Ingreso' ? '/api/pagos/' : '/api/egresos/';
        const res = await fetch(endpoint + mov.id, { method: 'DELETE' });
        if (res.ok) {
          alert(`${tipo} eliminado correctamente.`);
          cargarCaja();
        } else {
          alert(`Error al eliminar el ${tipo.toLowerCase()}.`);
        }
      });

      tablaBody.appendChild(tr);
    };

    ingresos.forEach(i => { totalIng += Number(i.monto || 0); agregarFila(i, 'Ingreso'); });
    egresos.forEach(e => { totalEgr += Number(e.monto || 0); agregarFila(e, 'Egreso'); });

    totalIngresosEl.textContent = money(totalIng);
    totalEgresosEl.textContent  = money(totalEgr);
    totalNetoEl.textContent     = money(totalIng - totalEgr);
  };

  const cargarCaja = async () => {
    try {
      if (cajaCerrada) return limpiarVistaCaja();
      const hoy = new Date();
      const res = await fetch(`/api/caja?year=${hoy.getFullYear()}&month=${hoy.getMonth()+1}`);
      const data = await res.json();
      renderCaja(data.ingresos || [], data.egresos || []);
    } catch (err) {
      console.error('Error al cargar caja mensual:', err);
      limpiarVistaCaja();
    }
  };

  // 🔁 REINICIAR CAJA
  btnReiniciarCaja?.addEventListener('click', async () => {
    if (!cajaCerrada) {
      alert('La caja ya está abierta.');
      return;
    }
    if (confirm('¿Reiniciar y volver a mostrar los movimientos del mes actual?')) {
      localStorage.removeItem('cajaCerrada');
      cajaCerrada = false;
      await cargarCaja();
      alert('Caja reiniciada correctamente ✅');
    }
  });
// ===== BOTÓN AGREGAR EGRESO =====
(() => {
  const btnAgregarEgreso = document.getElementById('btnAgregarEgreso');
  const inputMonto = document.getElementById('montoEgreso');
  const inputDetalle = document.getElementById('detalleEgreso');

  if (!btnAgregarEgreso) return;

  btnAgregarEgreso.addEventListener('click', async () => {
    const monto = parseFloat(inputMonto.value);
    const detalle = inputDetalle.value.trim();

    if (!monto || !detalle) {
      alert('Completa el monto y detalle del egreso');
      return;
    }

    try {
      const res = await fetch('/api/egresos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto, detalle })
      });

      const data = await res.json();
      if (!res.ok || !data) return;

      // ✅ limpiar inputs inmediatamente
      inputMonto.value = '';
      inputDetalle.value = '';

      // ✅ agregar el nuevo egreso directamente a la tabla sin recargar
      const tablaBody = document.getElementById('tablaCajaBody');
      if (tablaBody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${data.fecha || new Date().toISOString().slice(0,10)}</td>
          <td class="text-danger fw-semibold">Egreso</td>
          <td>${data.detalle}</td>
          <td class="text-end">$${Number(data.monto).toFixed(2)}</td>
          <td class="text-center align-middle">
            <button class="btn btn-sm btn-primary me-2 px-3 py-2 fw-bold" title="Editar">✏️</button>
            <button class="btn btn-sm btn-danger px-3 py-2 fw-bold" title="Eliminar">🗑️</button>
          </td>
        `;
        tablaBody.prepend(tr);
      }

      // ✅ actualizar totales
      if (typeof window.cargarCaja === 'function') await window.cargarCaja();

    } catch (err) {
      console.error('Error al guardar egreso:', err);
    }
  });
})();

  // 🔒 CERRAR CAJA
  btnCierreCaja?.addEventListener('click', () => {
    if (confirm('¿Cerrar la caja mensual y limpiar la vista? Esta acción no borra datos de la base.')) {
      limpiarVistaCaja();
      cajaCerrada = true;
      localStorage.setItem('cajaCerrada', currentMonthKey);
      alert('✅ Caja mensual cerrada. Los datos quedarán ocultos hasta que la reinicies.');
    }
  });

  window.cargarCaja = cargarCaja;
  cargarCaja();
})();
// Banner de cumpleaños usando el endpoint dedicado (más robusto)
(async () => {
  try {
    const res = await fetch('/api/cumples/hoy');
    if (!res.ok) return;
    const cumpleanieras = await res.json();
    if (!Array.isArray(cumpleanieras) || cumpleanieras.length === 0) return;

    const nombres = cumpleanieras.map(c => c.nombre).join(', ');
    const mensaje =
      cumpleanieras.length === 1
        ? `🎉 ¡Feliz cumpleaños ${nombres}! 🎂`
        : `🎉 ¡Feliz cumpleaños a nuestras alumnas ${nombres}! 🎂`;

    if (!document.getElementById('bannerCumple')) {
      const banner = document.createElement('div');
      banner.id = 'bannerCumple';
      banner.className = 'text-center p-3 fw-bold';
      banner.style.background = 'linear-gradient(90deg, #0b3a25ff, #28875dff)';
      banner.style.color = 'white';
      banner.style.fontSize = '1.5rem';
      banner.style.position = 'sticky';
      banner.style.top = '0';
      banner.style.zIndex = '9999';
      banner.textContent = mensaje;
      document.body.prepend(banner);
    }
  } catch {}
})();
