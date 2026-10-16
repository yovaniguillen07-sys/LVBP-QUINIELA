let currentUser = JSON.parse(localStorage.getItem('penka_current_user')) || null;
const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : window.location.origin + '/api';
let isRegisterMode = false;
let gruposListado = [];

document.addEventListener('DOMContentLoaded', () => {
    checkAuthUI();
    if (currentUser) {
        cargarGrupos();
        verificarEnlaceInvitacion();
    }
});

function checkAuthUI() {
    const overlay = document.getElementById('auth-overlay');
    const nameDisplay = document.getElementById('user-display-name');
    const avatarContainer = document.getElementById('user-avatar-container');
    const btnNuevoPartido = document.getElementById('btn-nuevo-partido');
    const btnAdminPanel = document.getElementById('btn-admin-panel');
    const btnAdminPuntos = document.getElementById('btn-admin-puntos');

    if (currentUser) {
        if (overlay) overlay.style.display = 'none';
        if (nameDisplay) nameDisplay.textContent = currentUser.username;
        if (avatarContainer) {
            const iniciales = currentUser.username.substring(0, 2).toUpperCase();
            avatarContainer.textContent = iniciales;
        }
        if (currentUser.id === 1) {
            if (btnNuevoPartido) btnNuevoPartido.style.display = 'inline-flex';
            if (btnAdminPanel) btnAdminPanel.style.display = 'inline-flex';
            if (btnAdminPuntos) btnAdminPuntos.style.display = 'inline-flex';
        }
    } else {
        if (overlay) overlay.style.display = 'flex';
    }
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').textContent = isRegisterMode ? 'Registro de Usuario' : 'Iniciar Sesión en Quiniela';
    document.getElementById('group-email').style.display = isRegisterMode ? 'flex' : 'none';
    document.getElementById('auth-btn').textContent = isRegisterMode ? 'Registrarse' : 'Ingresar';
    document.getElementById('auth-switch-text').textContent = isRegisterMode ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
}

async function handleAuth(e) {
    e.preventDefault();
    const username = document.getElementById('auth-user').value.trim();
    const password = document.getElementById('auth-pass').value.trim();
    const email = document.getElementById('auth-email').value.trim();

    const endpoint = isRegisterMode ? '/auth/registro' : '/auth/login';
    const payload = isRegisterMode ? { username, email, password } : { username, password };

    try {
        const response = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok) {
            currentUser = isRegisterMode ? { id: data.userId, username, email } : data.user;
            localStorage.setItem('penka_current_user', JSON.stringify(currentUser));
            checkAuthUI();
            cargarGrupos();
            verificarEnlaceInvitacion();
        } else {
            alert(data.error || 'Error de autenticación.');
        }
    } catch (err) {
        alert('No se pudo conectar al servidor.');
    }
}

function cerrarSesion() {
    localStorage.removeItem('penka_current_user');
    currentUser = null;
    window.location.reload();
}

function abrirModalPerfil() {
    if (!currentUser) return;
    document.getElementById('edit-username').value = currentUser.username;
    document.getElementById('edit-password').value = '';
    openModal('profile-modal');
}

async function handleActualizarPerfil(e) {
    e.preventDefault();
    const username = document.getElementById('edit-username').value.trim();
    const password = document.getElementById('edit-password').value.trim();

    const res = await fetch(API_URL + '/usuarios/' + currentUser.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
        currentUser = data.user;
        localStorage.setItem('penka_current_user', JSON.stringify(currentUser));
        checkAuthUI();
        closeModal('profile-modal');
        alert('Perfil actualizado.');
        loadLeaderboard();
        loadHistory();
    } else {
        alert(data.error || 'Error al actualizar.');
    }
}

async function abrirModalAdminUsuarios() {
    openModal('admin-users-modal');
    const res = await fetch(API_URL + '/admin/usuarios');
    if (res.ok) {
        const usuarios = await res.json();
        const tbody = document.getElementById('admin-users-tbody');
        tbody.innerHTML = '';
        usuarios.forEach(u => {
            tbody.innerHTML += `<tr><td>${u.username}</td><td>${u.email}</td><td><code>${u.password}</code></td><td>${u.id !== 1 ? '<button class="btn btn-danger" style="padding:0.25rem 0.5rem;font-size:0.8rem;" onclick="adminEliminarUsuario(' + u.id + ')">Eliminar</button>' : 'Admin'}</td></tr>`;
        });
    }
}

async function handleAdminCrearUsuario(e) {
    e.preventDefault();
    const username = document.getElementById('adm-user').value.trim();
    const email = document.getElementById('adm-email').value.trim();
    const password = document.getElementById('adm-pass').value.trim();

    const res = await fetch(API_URL + '/admin/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
    });
    if (res.ok) {
        alert('Usuario creado.');
        document.getElementById('adm-user').value = '';
        document.getElementById('adm-email').value = '';
        document.getElementById('adm-pass').value = '';
        abrirModalAdminUsuarios();
    } else {
        alert('Error al crear usuario.');
    }
}

async function adminEliminarUsuario(id) {
    if (!confirm('¿Eliminar este usuario del sistema?')) return;
    const res = await fetch(API_URL + '/admin/usuarios/' + id, { method: 'DELETE' });
    if (res.ok) abrirModalAdminUsuarios();
}

async function abrirModalAdminPuntos() {
    const grupoId = document.getElementById('group-filter')?.value;
    if (!grupoId) return alert('Selecciona una liga primero.');
    const res = await fetch(API_URL + '/leaderboard/' + grupoId);
    if (res.ok) {
        const miembros = await res.json();
        const select = document.getElementById('adm-puntos-user');
        select.innerHTML = '';
        miembros.forEach(m => {
            select.innerHTML += `<option value="${m.usuario_id}">${m.username} (${m.puntos_acumulados} pts)</option>`;
        });
        openModal('admin-puntos-modal');
    }
}

async function handleAdminGuardarPuntos(e) {
    e.preventDefault();
    const grupo_id = parseInt(document.getElementById('group-filter').value);
    const usuario_id = parseInt(document.getElementById('adm-puntos-user').value);
    const nuevos_puntos = parseInt(document.getElementById('adm-puntos-val').value);

    const res = await fetch(API_URL + '/admin/puntos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id, usuario_id, nuevos_puntos })
    });
    if (res.ok) {
        alert('Puntos modificados.');
        closeModal('admin-puntos-modal');
        loadLeaderboard();
        loadHistory();
    }
}

async function cargarGrupos() {
    const res = await fetch(API_URL + '/grupos');
    if (res.ok) {
        gruposListado = await res.json();
        renderGroups();
        populateGroupSelects();
        renderGames();
        
        const selectFilter = document.getElementById('group-filter');
        if (selectFilter && selectFilter.options.length > 0 && !selectFilter.value) {
            selectFilter.selectedIndex = 0;
        }

        loadLeaderboard();
        loadHistory();
        loadChampionships();
    }
}

async function verificarEnlaceInvitacion() {
    const params = new URLSearchParams(window.location.search);
    const codigoJoin = params.get('join');
    if (!codigoJoin || !currentUser) return;

    let password = '';
    let res = await fetch(API_URL + '/grupos/unirse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_acceso: codigoJoin, password: '', usuario_id: currentUser.id })
    });
    let data = await res.json();

    if (!res.ok && data.error && data.error.includes('Contraseña')) {
        password = prompt('Esta liga es privada. Ingresa la contraseña:') || '';
        if (password) {
            res = await fetch(API_URL + '/grupos/unirse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigo_acceso: codigoJoin, password, usuario_id: currentUser.id })
            });
            data = await res.json();
        }
    }

    if (res.ok) {
        alert('¡Te has unido exitosamente a la liga: ' + data.nombre + '!');
        window.history.replaceState({}, document.title, window.location.pathname);
        cargarGrupos();
    } else {
        if (password !== null) alert(data.error || 'No se pudo unir a la liga.');
    }
}

function renderGroups() {
    const container = document.getElementById('groups-list');
    if (!container) return;
    container.innerHTML = '';

    if (gruposListado.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center; padding: 2rem;">No hay ligas creadas todavía.</p>`;
        return;
    }

    gruposListado.forEach(g => {
        const enProgreso = g.estado === 'EN_PROGRESO';
        const finalizada = g.estado === 'FINALIZADA';
        const esAdmin = (currentUser.id === 1);
        const esCreador = (currentUser.id === g.creador_id);
        const linkInvitacion = window.location.origin + window.location.pathname + '?join=' + g.codigo_acceso;

        let badgeStyle = 'background:var(--border); color:var(--accent);';
        if (enProgreso) badgeStyle = 'background:var(--success); color:#fff;';
        if (finalizada) badgeStyle = 'background:var(--accent); color:#000;';

        let html = `<div class="group-card">
            <div class="group-card-header"><h3>${g.nombre}</h3><span class="badge" style="${badgeStyle}">${g.estado}</span></div>
            <p style="color: var(--text-muted); font-size: 0.85rem;">Tipo: <strong>${g.tipo}</strong> | Código: <strong>${g.codigo_acceso}</strong></p>
            <div class="group-card-actions">
                <a href="${linkInvitacion}" class="btn btn-primary" style="text-decoration:none;" target="_blank"><i class="fa-solid fa-user-plus"></i> Unirse</a>
                <button class="btn btn-secondary" onclick="abrirModalMiembros(${g.id}, '${g.nombre}')"><i class="fa-solid fa-users"></i> Miembros</button>
                <button class="btn btn-secondary" onclick="openShareModal(${g.id})"><i class="fa-solid fa-share-nodes"></i> QR</button>
                <button class="btn btn-secondary" style="background:#0284c7;" onclick="abrirModalAdminPronosticos(${g.id}, '${g.nombre}')"><i class="fa-solid fa-eye"></i> Pronósticos</button>`;

        if (esCreador && g.estado === 'CONFIGURACION') {
            html += `<button class="btn btn-primary" onclick="comenzarLiga(${g.id})">Comenzar</button>`;
        }
        if ((esCreador || esAdmin) && enProgreso) {
            html += `<button class="btn btn-primary" style="background:var(--success);" onclick="finalizarLiga(${g.id})"><i class="fa-solid fa-flag-checkered"></i> Finalizar</button>`;
        }
        if (esCreador && !finalizada) {
            html += `<button class="btn btn-secondary" onclick="abrirModalEditarGrupo(${g.id}, '${g.nombre}', '${g.tipo}', '${g.password || ''}')"><i class="fa-solid fa-pen"></i></button>`;
        }
        if (esAdmin) {
            html += `<button class="btn btn-secondary" style="background: #ca8a04;" onclick="resetearLiga(${g.id})">Resetear</button>`;
        }
        if (esCreador || esAdmin) {
            html += `<button class="btn btn-danger" onclick="eliminarGrupo(${g.id})"><i class="fa-solid fa-trash"></i></button>`;
        }

        html += `</div></div>`;
        container.innerHTML += html;
    });
}

function populateGroupSelects() {
    const selectFilter = document.getElementById('group-filter');
    const selectGame = document.getElementById('group-select-game');
    const selectHistory = document.getElementById('group-filter-history');
    const selectChampionships = document.getElementById('group-filter-championships');
    
    [selectFilter, selectGame, selectHistory, selectChampionships].forEach(select => {
        if (!select) return;
        const valActual = select.value;
        select.innerHTML = '';
        if (gruposListado.length === 0) {
            select.innerHTML = `<option value="">Sin ligas disponibles</option>`;
            return;
        }
        gruposListado.forEach(g => {
            select.innerHTML += `<option value="${g.id}">${g.nombre} (${g.codigo_acceso})</option>`;
        });
        if (valActual) select.value = valActual;
    });
    loadLeaderboard();
    loadHistory();
    loadChampionships();
}

function abrirModalCrearGrupo() {
    document.getElementById('group-modal-title').textContent = 'Crear Nueva Liga';
    document.getElementById('edit-group-id').value = '';
    document.getElementById('group-name').value = '';
    document.getElementById('group-type').value = 'PUBLICA';
    document.getElementById('group-password').value = '';
    document.getElementById('group-pass-container').style.display = 'none';
    openModal('create-group-modal');
}

function abrirModalEditarGrupo(id, nombre, tipo, password) {
    document.getElementById('group-modal-title').textContent = 'Editar Liga';
    document.getElementById('edit-group-id').value = id;
    document.getElementById('group-name').value = nombre;
    document.getElementById('group-type').value = tipo;
    document.getElementById('group-password').value = password;
    document.getElementById('group-pass-container').style.display = (tipo === 'PRIVADA') ? 'flex' : 'none';
    openModal('create-group-modal');
}

function toggleGroupPassword() {
    const tipo = document.getElementById('group-type').value;
    document.getElementById('group-pass-container').style.display = (tipo === 'PRIVADA') ? 'flex' : 'none';
}

async function handleGuardarGrupo(e) {
    e.preventDefault();
    const id = document.getElementById('edit-group-id').value;
    const nombre = document.getElementById('group-name').value.trim();
    const tipo = document.getElementById('group-type').value;
    const password = document.getElementById('group-password').value.trim();

    const endpoint = id ? ('/grupos/' + id) : '/grupos/crear';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(API_URL + endpoint, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, tipo, password, creador_id: currentUser.id })
    });
    if (res.ok) {
        alert(id ? 'Liga actualizada.' : 'Liga creada.');
        closeModal('create-group-modal');
        cargarGrupos();
    }
}

function abrirModalUnirseLiga() {
    document.getElementById('join-codigo').value = '';
    document.getElementById('join-password').value = '';
    document.getElementById('join-pass-group').style.display = 'none';
    openModal('join-group-modal');
}

async function handleUnirseLiga(e) {
    e.preventDefault();
    const codigo_acceso = document.getElementById('join-codigo').value.trim();
    const password = document.getElementById('join-password').value.trim();

    const res = await fetch(API_URL + '/grupos/unirse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_acceso, password, usuario_id: currentUser.id })
    });
    const data = await res.json();
    if (res.ok) {
        alert('Te has unido exitosamente a la liga: ' + data.nombre);
        closeModal('join-group-modal');
        cargarGrupos();
    } else {
        alert(data.error || 'No se pudo unir a la liga.');
        if (data.error && data.error.includes('Contraseña')) {
            document.getElementById('join-pass-group').style.display = 'flex';
        }
    }
}

async function abrirModalMiembros(grupoId, grupoNombre) {
    document.getElementById('members-modal-title').textContent = 'Miembros de: ' + grupoNombre;
    openModal('members-modal');
    const res = await fetch(API_URL + '/grupos/' + grupoId + '/miembros');
    if (res.ok) {
        const miembros = await res.json();
        const grupo = gruposListado.find(g => g.id === grupoId);
        const enConfig = grupo && grupo.estado === 'CONFIGURACION';
        const esAdminOrCreador = (currentUser.id === 1 || (grupo && currentUser.id === grupo.creador_id));

        const thEmail = document.getElementById('th-email-header');
        if (esAdminOrCreador) {
            thEmail.style.display = 'table-cell';
        } else {
            thEmail.style.display = 'none';
        }

        const tbody = document.getElementById('members-tbody');
        tbody.innerHTML = '';
        miembros.forEach(m => {
            let accionBtn = '';
            if (esAdminOrCreador && enConfig && m.usuario_id !== currentUser.id) {
                accionBtn = `<button class="btn btn-danger" style="padding:0.25rem 0.5rem;font-size:0.8rem;" onclick="expulsarMiembro(${grupoId}, ${m.usuario_id})">Expulsar</button>`;
            }
            let emailTd = esAdminOrCreador ? `<td>${m.email}</td>` : '';
            tbody.innerHTML += `<tr><td>${m.username}</td>${emailTd}<td>${accionBtn}</td></tr>`;
        });
    }
}

async function abrirModalAdminPronosticos(grupoId, grupoNombre) {
    document.getElementById('admin-pred-title').textContent = 'Pronósticos en: ' + grupoNombre;
    openModal('admin-predictions-modal');
    const res = await fetch(API_URL + '/admin/pronosticos/' + grupoId);
    if (res.ok) {
        const preds = await res.json();
        const tbody = document.getElementById('admin-pred-tbody');
        tbody.innerHTML = '';
        if (preds.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No hay pronósticos registrados todavía.</td></tr>`;
            return;
        }
        preds.forEach(p => {
            tbody.innerHTML += `<tr><td><strong>${p.username}</strong></td><td>${p.equipo_visitante} vs ${p.equipo_local} (${p.fecha_juego})</td><td><code>${p.carreras_vis_pred} - ${p.carreras_loc_pred}</code></td></tr>`;
        });
    }
}

async function expulsarMiembro(grupoId, usuarioId) {
    if (!confirm('¿Expulsar a este jugador de la liga?')) return;
    const res = await fetch(API_URL + '/grupos/' + grupoId + '/miembros/' + usuarioId, { method: 'DELETE' });
    if (res.ok) {
        alert('Jugador expulsado.');
        closeModal('members-modal');
        cargarGrupos();
    } else {
        const d = await res.json();
        alert(d.error || 'No se pudo expulsar.');
    }
}

async function comenzarLiga(grupoId) {
    if (!confirm('¿Comenzar liga? Una vez iniciada ya no se podrá modificar la configuración ni expulsar usuarios.')) return;
    const res = await fetch(API_URL + '/grupos/comenzar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id: grupoId })
    });
    if (res.ok) cargarGrupos();
}

async function finalizarLiga(grupoId) {
    if (!confirm('¿Finalizar liga? Se cerrará oficialmente el torneo y se asignarán los trofeos de Oro, Plata y Bronce según la tabla de posiciones.')) return;
    const res = await fetch(API_URL + '/grupos/finalizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id: grupoId })
    });
    if (res.ok) {
        alert('¡Liga finalizada con éxito! Revisa el Salón de Campeones.');
        cargarGrupos();
    }
}

async function eliminarGrupo(grupoId) {
    if (!confirm('¿Eliminar esta liga por completo?')) return;
    const res = await fetch(API_URL + '/grupos/' + grupoId, { method: 'DELETE' });
    if (res.ok) cargarGrupos();
}

async function resetearLiga(grupoId) {
    if (!confirm('¿Estás seguro de resetear la liga? Se borrarán todos los pronósticos, campeonatos y puntajes a cero.')) return;
    const res = await fetch(API_URL + '/grupos/resetear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id: grupoId })
    });
    if (res.ok) {
        alert('Liga reseteada.');
        cargarGrupos();
    }
}

function abrirModalCrearPartido() {
    document.getElementById('game-modal-title').textContent = 'Añadir Partido Manualmente';
    document.getElementById('edit-game-id').value = '';
    document.getElementById('new-vis').value = '';
    document.getElementById('new-loc').value = '';
    document.getElementById('new-fecha').value = '';
    document.getElementById('new-hora-val').value = '';
    document.getElementById('new-estadio').value = '';
    openModal('create-game-modal');
}

function abrirModalEditarPartido(id, vis, loc, fecha, horaCompleta, estadio) {
    document.getElementById('game-modal-title').textContent = 'Editar Partido';
    document.getElementById('edit-game-id').value = id;
    document.getElementById('new-vis').value = vis;
    document.getElementById('new-loc').value = loc;
    document.getElementById('new-fecha').value = fecha;
    
    const partesHora = horaCompleta.split(' ');
    if (partesHora.length === 2) {
        document.getElementById('new-hora-val').value = partesHora[0];
        document.getElementById('new-hora-ampm').value = partesHora[1];
    }
    document.getElementById('new-estadio').value = estadio;
    openModal('create-game-modal');
}

async function handleGuardarPartido(e) {
    e.preventDefault();
    const id = document.getElementById('edit-game-id').value;
    const horaVal = document.getElementById('new-hora-val').value;
    const ampmVal = document.getElementById('new-hora-ampm').value;
    const horaCompleta = `${horaVal} ${ampmVal}`;

    const partido = {
        equipo_visitante: document.getElementById('new-vis').value.trim(),
        equipo_local: document.getElementById('new-loc').value.trim(),
        fecha_juego: document.getElementById('new-fecha').value.trim(),
        hora: horaCompleta,
        estadio: document.getElementById('new-estadio').value.trim()
    };
    const endpoint = id ? ('/partidos/' + id) : '/partidos/crear';
    const res = await fetch(API_URL + endpoint, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partido)
    });
    if (res.ok) {
        closeModal('create-game-modal');
        renderGames();
    }
}

async function eliminarPartido(id) {
    if (!confirm('¿Eliminar partido?')) return;
    const res = await fetch(API_URL + '/partidos/' + id, { method: 'DELETE' });
    if (res.ok) renderGames();
}

async function cambiarEstadoPartido(partidoId, nuevoEstado) {
    const res = await fetch(API_URL + '/partidos/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partido_id: partidoId, estado: nuevoEstado })
    });
    if (res.ok) renderGames();
}

async function renderGames() {
    if (!currentUser) return;
    const selectGame = document.getElementById('group-select-game');
    
    if (selectGame && !selectGame.value && selectGame.options.length > 0 && selectGame.options[0].value) {
        selectGame.selectedIndex = 0;
    }

    const selectedGroupId = parseInt(selectGame?.value);
    const container = document.getElementById('games-container');
    if (!container) return;

    if (!selectedGroupId) {
        container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Selecciona o crea una liga primero en la pestaña "Ligas / Pools".</p>`;
        return;
    }

    let partidos = [];
    let pronosticos = [];

    try {
        const [resP, resPr] = await Promise.all([
            fetch(API_URL + '/partidos'),
            fetch(API_URL + '/pronosticos/' + selectedGroupId + '/' + currentUser.id)
        ]);
        if (resP.ok) partidos = await resP.json();
        if (resPr.ok) pronosticos = await resPr.json();
    } catch (e) {}

    container.innerHTML = '';
    if (partidos.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No hay partidos cargados en el sistema.</p>`;
        return;
    }

    let fechaActual = '';

    partidos.forEach(partido => {
        if (partido.fecha_juego !== fechaActual) {
            fechaActual = partido.fecha_juego;
            container.innerHTML += `<h3 style="color: var(--accent); margin: 1.5rem 0 0.5rem 0; font-size: 1.1rem;"><i class="fa-solid fa-calendar-day"></i> ${fechaActual}</h3>`;
        }

        const pred = pronosticos.find(p => p.partido_id === partido.id) || { carreras_vis_pred: '', carreras_loc_pred: '', puntos_obtenidos: 0 };
        const tienePronostico = pred.carreras_vis_pred !== '' && pred.carreras_vis_pred !== null && pred.carreras_vis_pred !== undefined;

        let estadoBadge = `<span class="badge">${partido.estado}</span>`;
        if (partido.estado === 'CERRADO') estadoBadge = `<span class="badge" style="background: #eab308; color: #000;">CERRADO</span>`;
        if (partido.estado === 'FINALIZADO') estadoBadge = `<span class="badge badge-finished">FINALIZADO (${partido.carreras_visitante} - ${partido.carreras_local})</span>`;

        let btnTexto = tienePronostico ? 'Editar' : 'Guardar';
        let btnClase = tienePronostico ? 'btn btn-secondary' : 'btn btn-primary';

        let html = `<div class="game-card">
            <div class="game-info">
                <div>${estadoBadge} <span style="color: var(--text-muted); font-size: 0.85rem; margin-left: 0.5rem;">${partido.hora}</span></div>
                <div class="team-matchup" style="margin-top: 0.5rem;"><span>${partido.equipo_visitante}</span> vs <span>${partido.equipo_local}</span></div>
                <div class="stadium"><i class="fa-solid fa-location-dot"></i> ${partido.estadio}</div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <input type="number" class="score-input" id="pred-vis-${partido.id}" value="${pred.carreras_vis_pred}" ${partido.estado !== 'PENDIENTE' ? 'disabled' : ''}>
                <span>-</span>
                <input type="number" class="score-input" id="pred-loc-${partido.id}" value="${pred.carreras_loc_pred}" ${partido.estado !== 'PENDIENTE' ? 'disabled' : ''}>`;

        if (partido.estado === 'PENDIENTE') {
            html += `<button class="${btnClase}" id="btn-pred-${partido.id}" onclick="guardarPronostico(${partido.id}, ${selectedGroupId}, ${tienePronostico})">${btnTexto}</button>`;
        } else if (partido.estado === 'FINALIZADO') {
            html += `<span class="points-earned-badge">+${pred.puntos_obtenidos !== undefined ? pred.puntos_obtenidos : 0} pts obtenidos</span>`;
        }

        if (currentUser.id === 1) {
            html += `<div style="display:flex; gap:0.25rem; margin-left: 0.5rem; flex-wrap:wrap;">`;
            if (partido.estado === 'PENDIENTE') {
                html += `<button class="btn btn-secondary" style="background:#eab308; color:#000;" onclick="cambiarEstadoPartido(${partido.id}, 'CERRADO')">Cerrar</button>`;
            } else if (partido.estado === 'CERRADO') {
                html += `<button class="btn btn-secondary" onclick="cambiarEstadoPartido(${partido.id}, 'PENDIENTE')">Abrir</button>
                         <button class="btn btn-secondary" onclick="abrirModalResultado(${partido.id}, '${partido.equipo_visitante}', '${partido.equipo_local}')">Resultado</button>`;
            }
            html += `<button class="btn btn-secondary" onclick="abrirModalEditarPartido(${partido.id}, '${partido.equipo_visitante}', '${partido.equipo_local}', '${partido.fecha_juego}', '${partido.hora}', '${partido.estadio}')"><i class="fa-solid fa-pen"></i></button>
                     <button class="btn btn-danger" onclick="eliminarPartido(${partido.id})"><i class="fa-solid fa-trash"></i></button></div>`;
        }

        html += `</div></div>`;
        container.innerHTML += html;
    });
}

async function guardarPronostico(partidoId, grupoId, yaExistia) {
    const vis = document.getElementById('pred-vis-' + partidoId).value;
    const loc = document.getElementById('pred-loc-' + partidoId).value;
    if (vis === '' || loc === '') return alert('Ingresa las carreras.');

    if (yaExistia) {
        const confirmar = confirm('¿Deseas modificar tu pronóstico ya guardado? Esto es una medida de seguridad contra errores de dedo.');
        if (!confirmar) return;
    }

    const res = await fetch(API_URL + '/pronosticos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id: grupoId, usuario_id: currentUser.id, partido_id: partidoId, carreras_vis_pred: parseInt(vis), carreras_loc_pred: parseInt(loc) })
    });
    if (res.ok) {
        alert('Pronóstico guardado exitosamente.');
        renderGames();
        loadLeaderboard();
        loadHistory();
    } else {
        const d = await res.json();
        alert(d.error || 'Error.');
    }
}

function abrirModalResultado(partidoId, vis, loc) {
    document.getElementById('result-match-id').value = partidoId;
    document.getElementById('result-match-title').textContent = vis + ' vs ' + loc;
    document.getElementById('res-vis').value = '';
    document.getElementById('res-loc').value = '';
    openModal('result-modal');
}

async function handleGuardarResultado(e) {
    e.preventDefault();
    const partido_id = document.getElementById('result-match-id').value;
    const carreras_visitante = parseInt(document.getElementById('res-vis').value);
    const carreras_local = parseInt(document.getElementById('res-loc').value);

    const res = await fetch(API_URL + '/partidos/resultado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partido_id, carreras_visitante, carreras_local })
    });
    if (res.ok) {
        alert('Resultado procesado y puntos calculados.');
        closeModal('result-modal');
        renderGames();
        loadLeaderboard();
        loadHistory();
    }
}

async function loadLeaderboard() {
    const selectFilter = document.getElementById('group-filter');
    const selectedGroupId = parseInt(selectFilter?.value);
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!selectedGroupId) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Selecciona una liga para ver la tabla de posiciones.</td></tr>`;
        return;
    }

    try {
        const res = await fetch(API_URL + '/leaderboard/' + selectedGroupId);
        if (res.ok) {
            let listado = await res.json();
            
            const listadoUnico = [];
            const idsVistos = new Set();
            for (const m of listado) {
                if (!idsVistos.has(m.usuario_id)) {
                    idsVistos.add(m.usuario_id);
                    listadoUnico.push(m);
                }
            }

            if (listadoUnico.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No hay miembros en esta liga todavía.</td></tr>`;
                return;
            }

            listadoUnico.forEach((m, index) => {
                let trofeoIcon = '';
                if (index === 0) trofeoIcon = ' <i class="fa-solid fa-trophy" style="color:var(--gold);" title="Oro"></i>';
                if (index === 1) trofeoIcon = ' <i class="fa-solid fa-trophy" style="color:var(--silver);" title="Plata"></i>';
                if (index === 2) trofeoIcon = ' <i class="fa-solid fa-trophy" style="color:var(--bronze);" title="Bronce"></i>';

                tbody.innerHTML += `<tr><td>#${index + 1}</td><td><strong>${m.username}</strong>${trofeoIcon}</td><td><span class="badge">${m.rol}</span></td><td><strong>${m.puntos_acumulados} pts</strong></td></tr>`;
            });
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger);">Error al cargar la tabla.</td></tr>`;
    }
}

let historialCache = [];

async function loadHistory() {
    const selectedGroupId = parseInt(document.getElementById('group-filter-history')?.value);
    const tbody = document.getElementById('history-body');
    const selectFecha = document.getElementById('filter-history-fecha');
    const selectJugador = document.getElementById('filter-history-jugador');
    if (!tbody) return;

    if (!selectedGroupId) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Selecciona una liga para ver el historial.</td></tr>`;
        return;
    }

    try {
        const res = await fetch(API_URL + '/historial/' + selectedGroupId);
        if (res.ok) {
            historialCache = await res.json();
            
            const fechaSeleccionada = selectFecha.value;
            const jugadorSeleccionado = selectJugador.value;

            const fechasUnicas = [...new Set(historialCache.map(h => h.fecha_juego))];
            const jugadoresUnicos = [...new Set(historialCache.map(h => h.username))];

            selectFecha.innerHTML = `<option value="">Todas las Fechas</option>`;
            fechasUnicas.forEach(f => {
                selectFecha.innerHTML += `<option value="${f}">${f}</option>`;
            });
            selectFecha.value = fechaSeleccionada;

            selectJugador.innerHTML = `<option value="">Todos los Jugadores</option>`;
            jugadoresUnicos.forEach(j => {
                selectJugador.innerHTML += `<option value="${j}">${j}</option>`;
            });
            selectJugador.value = jugadorSeleccionado;

            aplicarFiltrosHistorial();
        }
    } catch (e) {}
}

function aplicarFiltrosHistorial() {
    const tbody = document.getElementById('history-body');
    const fechaVal = document.getElementById('filter-history-fecha').value;
    const jugadorVal = document.getElementById('filter-history-jugador').value;

    let filtrados = historialCache.filter(h => {
        let matchFecha = !fechaVal || h.fecha_juego === fechaVal;
        let matchJugador = !jugadorVal || h.username === jugadorVal;
        return matchFecha && matchJugador;
    });

    tbody.innerHTML = '';
    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No hay registros que coincidan con los filtros.</td></tr>`;
        return;
    }

    filtrados.forEach(h => {
        let badgeColor = h.puntos_obtenidos === 6 ? 'var(--success)' : (h.puntos_obtenidos >= 2 ? 'var(--accent)' : 'var(--border)');
        tbody.innerHTML += `
            <tr>
                <td><strong>${h.username}</strong></td>
                <td>${h.equipo_visitante} vs ${h.equipo_local}</td>
                <td>${h.fecha_juego}</td>
                <td><code style="font-size:0.95rem;">${h.carreras_vis_pred} - ${h.carreras_loc_pred}</code></td>
                <td><code style="font-size:0.95rem;">${h.real_vis} - ${h.real_loc}</code></td>
                <td><span class="badge" style="background:${badgeColor}; color:#000; font-weight:bold;">+${h.puntos_obtenidos} pts</span></td>
            </tr>
        `;
    });
}

async function loadChampionships() {
    const selectedGroupId = parseInt(document.getElementById('group-filter-championships')?.value);
    const container = document.getElementById('championships-container');
    if (!container) return;
    container.innerHTML = '';

    if (!selectedGroupId) {
        container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Selecciona una liga para ver el Salón de Campeones.</p>`;
        return;
    }

    const res = await fetch(API_URL + '/campeonatos/' + selectedGroupId);
    if (res.ok) {
        const camp = await res.json();
        if (camp.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Aún no se ha finalizado esta liga para otorgar trofeos.</p>`;
            return;
        }

        let html = `<div class="table-container"><table class="leaderboard-table"><thead><tr><th>Premio</th><th>Jugador</th><th>Fecha de Cierre</th></tr></thead><tbody>`;
        camp.forEach(c => {
            let medalla = '';
            let colorPremio = '';
            if (c.puesto === 1) { medalla = '<i class="fa-solid fa-trophy" style="color:var(--gold);"></i> 1er Lugar (Oro)'; colorPremio = 'var(--gold)'; }
            else if (c.puesto === 2) { medalla = '<i class="fa-solid fa-trophy" style="color:var(--silver);"></i> 2do Lugar (Plata)'; colorPremio = 'var(--silver)'; }
            else if (c.puesto === 3) { medalla = '<i class="fa-solid fa-trophy" style="color:var(--bronze);"></i> 3er Lugar (Bronce)'; colorPremio = 'var(--bronze)'; }

            html += `<tr><td><strong style="color:${colorPremio}">${medalla}</strong></td><td><strong>${c.username}</strong></td><td>${new Date(c.fecha_finalizacion).toLocaleDateString()}</td></tr>`;
        });
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function openShareModal(grupoId) {
    const grupo = gruposListado.find(g => g.id === grupoId);
    if (!grupo) return;
    document.getElementById('share-group-name').textContent = grupo.nombre;
    const url = window.location.origin + window.location.pathname + '?join=' + grupo.codigo_acceso;
    document.getElementById('share-url-input').value = url;
    document.getElementById('qrcode').innerHTML = '';
    new QRCode(document.getElementById('qrcode'), { text: url, width: 160, height: 160 });
    openModal('share-modal');
}
function copyInviteLink() {
    document.getElementById('share-url-input').select();
    document.execCommand('copy');
    alert('Link copiado.');
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registrado con éxito', reg))
            .catch(err => console.log('Error al registrar SW', err));
    });
}