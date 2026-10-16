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
        
        // Forzar selección del primer grupo por defecto para evitar estados vacíos
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
            
            // Blindaje estricto en frontend con Set
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

// (El resto de funciones auxiliares se mantienen intactas: loadHistory, renderGames, etc.)