let currentUser = JSON.parse(localStorage.getItem('penka_current_user')) || null;
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : window.location.origin + '/api';
let isRegisterMode = false;
let gruposListado = [];
let misLigasIds = new Set();
let historialCache = [];

document.addEventListener('DOMContentLoaded', () => {
    verificarEstadoServidor();
    checkAuthUI();
    loadStandings();

    // Fecha por defecto en el día actual según hora de Venezuela
    const filtroFecha = document.getElementById('filter-games-date');
    if (filtroFecha) {
        const fechaVzla = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
        filtroFecha.value = fechaVzla;
    }

    if (currentUser) {
        cargarGrupos();
        verificarEnlaceInvitacion();
    }

    // Auto-actualización en segundo plano (Polling cada 30 segundos)
    // Verifica que el usuario no esté escribiendo activamente para no interrumpirlo
    setInterval(() => {
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab) return;

        if (activeTab.id === 'games-tab') {
            const activeEl = document.activeElement;
            const isTyping = activeEl && activeEl.classList.contains('score-input');
            if (!isTyping) {
                renderGames();
            }
        } else if (activeTab.id === 'leaderboard-tab') {
            loadLeaderboard();
        } else if (activeTab.id === 'standings-tab') {
            loadStandings();
        }
    }, 30000);
});

async function verificarEstadoServidor() {
    const banner = document.getElementById('server-status-banner');
    if (!banner) return;
    const timer = setTimeout(() => { banner.style.display = 'block'; document.body.style.setProperty('--banner-margin', '32px'); }, 1500);
    try {
        await fetch(API_URL + '/grupos');
        clearTimeout(timer); banner.style.display = 'none'; document.body.style.setProperty('--banner-margin', '0px');
    } catch (e) {
        clearTimeout(timer); banner.style.display = 'none'; document.body.style.setProperty('--banner-margin', '0px');
    }
}

function checkAuthUI() {
    const overlay = document.getElementById('auth-overlay');
    const nameDisplay = document.getElementById('user-display-name');
    const avatarContainer = document.getElementById('user-avatar-container');
    if (currentUser) {
        if (overlay) overlay.style.display = 'none';
        if (nameDisplay) nameDisplay.textContent = currentUser.username;
        if (avatarContainer) avatarContainer.textContent = currentUser.username.substring(0, 2).toUpperCase();
        if (currentUser.id === 1) {
            ['btn-nuevo-partido', 'btn-admin-panel', 'btn-admin-puntos', 'btn-admin-standings', 'btn-admin-crear-carta'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'inline-flex';
            });
        }
    } else if (overlay) overlay.style.display = 'flex';
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
    const ep = isRegisterMode ? '/auth/registro' : '/auth/login';
    const payload = isRegisterMode ? { username, email, password } : { username, password };

    try {
        const response = await fetch(API_URL + ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (response.ok) {
            currentUser = isRegisterMode ? { id: data.userId, username, email } : data.user;
            localStorage.setItem('penka_current_user', JSON.stringify(currentUser));
            checkAuthUI(); cargarGrupos(); verificarEnlaceInvitacion();
        } else alert(data.error || 'Error de autenticación.');
    } catch (err) { alert('No se pudo conectar al servidor.'); }
}

function cerrarSesion() { localStorage.removeItem('penka_current_user'); currentUser = null; window.location.reload(); }

function abrirModalPerfil() {
    if (!currentUser) return;
    document.getElementById('edit-username').value = currentUser.username;
    document.getElementById('edit-password').value = '';
    const container = document.getElementById('user-profile-cards-grid');
    if (container) container.innerHTML = '';
    openModal('profile-modal');
}

async function handleActualizarPerfil(e) {
    e.preventDefault();
    const username = document.getElementById('edit-username').value.trim();
    const password = document.getElementById('edit-password').value.trim();
    const res = await fetch(API_URL + '/usuarios/' + currentUser.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (res.ok) {
        currentUser = data.user;
        localStorage.setItem('penka_current_user', JSON.stringify(currentUser));
        checkAuthUI(); closeModal('profile-modal'); alert('Perfil actualizado.');
    } else alert(data.error || 'Error al actualizar.');
}

async function abrirVitrinaCartasPerfil() {
    const grid = document.getElementById('user-profile-cards-grid');
    if (!grid) return;
    grid.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; grid-column:1/-1;">Cargando tu vitrina...</p>';
    try {
        const res = await fetch(API_URL + '/cartas/usuario/' + currentUser.id);
        const cartas = await res.json();
        grid.innerHTML = '';
        if (cartas.length === 0) {
            grid.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); text-align:center; grid-column:1/-1;">No tienes cartas en tu colección todavía.</p>`;
            return;
        }
        cartas.forEach(c => {
            let imagenHtml = c.imagen_url ? `<img src="${c.imagen_url}" style="width:100%; height:90px; object-fit:cover; border-radius:4px; margin-bottom:0.35rem;">` : '';
            grid.innerHTML += `
                <div style="background:var(--bg-color); border:1px solid var(--accent); border-radius:6px; padding:0.5rem; text-align:center;">
                    ${imagenHtml}
                    <div style="font-size:0.8rem; font-weight:bold; color:var(--text);">${c.nombre_carta}</div>
                </div>
            `;
        });
    } catch (e) { grid.innerHTML = '<p style="font-size:0.85rem; color:var(--danger); text-align:center; grid-column:1/-1;">Error al cargar la vitrina.</p>'; }
}

async function abrirModalAdminUsuarios() {
    openModal('admin-users-modal');
    const res = await fetch(API_URL + '/admin/usuarios');
    if (res.ok) {
        const usuarios = await res.json();
        const tbody = document.getElementById('admin-users-tbody');
        tbody.innerHTML = '';
        usuarios.forEach(u => {
            let accionHtml = '';
            if (u.id === 1) {
                accionHtml = '<span style="color:var(--accent); font-weight:bold;">Admin</span>';
            } else {
                accionHtml = `
                    <div style="display:flex; gap:0.25rem;">
                        <button class="btn btn-primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="adminActualizarUsuario(${u.id})" title="Guardar cambios"><i class="fa-solid fa-floppy-disk"></i></button>
                        <button class="btn btn-danger" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="adminEliminarUsuario(${u.id})" title="Eliminar usuario"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
            }

            tbody.innerHTML += `
                <tr>
                    <td><input type="text" id="adm-edit-user-${u.id}" value="${u.username}" style="padding:0.25rem; background:var(--bg-color); border:1px solid var(--border); color:var(--text); border-radius:4px; width:110px;" ${u.id === 1 ? 'disabled' : ''}></td>
                    <td style="font-size:0.85rem;">${u.email}</td>
                    <td><input type="text" id="adm-edit-pass-${u.id}" value="${u.password}" style="padding:0.25rem; background:var(--bg-color); border:1px solid var(--border); color:var(--text); border-radius:4px; width:100px;" ${u.id === 1 ? 'disabled' : ''}></td>
                    <td>${accionHtml}</td>
                </tr>
            `;
        });
    }
}

async function adminActualizarUsuario(id) {
    const username = document.getElementById(`adm-edit-user-${id}`).value.trim();
    const password = document.getElementById(`adm-edit-pass-${id}`).value.trim();
    if (!username || !password) return alert('Los campos no pueden estar vacíos.');

    const res = await fetch(API_URL + '/admin/usuarios/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
        alert('¡Usuario actualizado con éxito!');
        abrirModalAdminUsuarios();
    } else {
        alert(data.error || 'Error al actualizar el usuario.');
    }
}

async function handleAdminCrearUsuario(e) {
    e.preventDefault();
    const username = document.getElementById('adm-user').value.trim();
    const email = document.getElementById('adm-email').value.trim();
    const password = document.getElementById('adm-pass').value.trim();
    const res = await fetch(API_URL + '/admin/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
    if (res.ok) {
        alert('Usuario creado.');
        document.getElementById('adm-user').value = ''; document.getElementById('adm-email').value = ''; document.getElementById('adm-pass').value = '';
        abrirModalAdminUsuarios();
    } else alert('Error al crear usuario.');
}

async function adminEliminarUsuario(id) {
    if (!confirm('¿Eliminar usuario?')) return;
    const res = await fetch(API_URL + '/admin/usuarios/' + id, { method: 'DELETE' });
    if (res.ok) abrirModalAdminUsuarios();
}

function descargarRespaldoServidor() { window.location.href = API_URL + '/admin/respaldo'; }

async function restaurarRespaldoServidor(e) {
    e.preventDefault();
    const fileInput = document.getElementById('restore-file-input');
    if (!fileInput.files || fileInput.files.length === 0) return alert('Selecciona un archivo .json');
    if (!confirm('¡ATENCIÓN! Esto sobrescribirá los datos actuales.')) return;
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const res = await fetch(API_URL + '/admin/restaurar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(JSON.parse(event.target.result)) });
            if (res.ok) { alert('¡Restaurado con éxito!'); window.location.reload(); }
            else alert('Error al restaurar.');
        } catch (err) { alert('JSON no válido.'); }
    };
    reader.readAsText(fileInput.files[0]);
}

async function abrirModalAdminPuntos() {
    const grupoId = document.getElementById('group-filter')?.value;
    if (!grupoId) return alert('Selecciona una liga.');
    const res = await fetch(API_URL + '/leaderboard/' + grupoId);
    if (res.ok) {
        const miembros = await res.json();
        const sel = document.getElementById('adm-puntos-user');
        sel.innerHTML = '';
        miembros.forEach(m => { sel.innerHTML += `<option value="${m.usuario_id}">${m.username} (${m.puntos_acumulados} pts)</option>`; });
        openModal('admin-puntos-modal');
    }
}

async function handleAdminGuardarPuntos(e) {
    e.preventDefault();
    const grupo_id = parseInt(document.getElementById('group-filter').value);
    const usuario_id = parseInt(document.getElementById('adm-puntos-user').value);
    const nuevos_puntos = parseInt(document.getElementById('adm-puntos-val').value);
    const res = await fetch(API_URL + '/admin/puntos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grupo_id, usuario_id, nuevos_puntos }) });
    if (res.ok) { alert('Puntos modificados.'); closeModal('admin-puntos-modal'); loadLeaderboard(); loadHistory(); }
}

async function cargarCartasColeccionables() {
    const select = document.getElementById('group-filter-cards');
    const grid = document.getElementById('cards-grid');
    if (!select || !grid) return;

    if (select.options.length === 0 && gruposListado.length > 0) {
        select.innerHTML = '';
        gruposListado.forEach(g => { select.innerHTML += `<option value="${g.id}">${g.nombre}</option>`; });
    }
    const grupoId = select.value;
    if (!grupoId) { grid.innerHTML = `<p style="text-align:center; color:var(--text-muted);">Selecciona una liga.</p>`; return; }

    grid.innerHTML = 'Cargando cartas...';
    try {
        const res = await fetch(API_URL + '/cartas/' + grupoId);
        const cartas = await res.json();
        grid.innerHTML = '';
        if (cartas.length === 0) {
            grid.innerHTML = `<p style="text-align:center; color:var(--text-muted); grid-column:1/-1;">No hay cartas únicas creadas en esta liga.</p>`;
            return;
        }

        cartas.forEach(c => {
            const esMia = c.propietario_actual_id === currentUser.id;
            const esAdmin = currentUser.id === 1;

            let adminControls = '';
            if (esAdmin) {
                adminControls = `
                    <div style="margin-top:0.75rem; display:flex; gap:0.35rem; justify-content:center; flex-wrap:wrap;">
                        <button class="btn btn-secondary" style="font-size:0.75rem; padding:0.25rem 0.5rem; background:var(--danger); color:#fff;" onclick="eliminarCarta(${c.id})" title="Eliminar carta"><i class="fa-solid fa-trash"></i></button>
                        <button class="btn btn-secondary" style="font-size:0.75rem; padding:0.25rem 0.5rem;" onclick="toggleRevelarCarta(${c.id}, ${c.revelada})" title="${c.revelada ? 'Volver a Ocultar' : 'Revelar'}"><i class="fa-solid fa-${c.revelada ? 'eye-slash' : 'eye'}"></i> ${c.revelada ? 'Ocultar' : 'Revelar'}</button>
                    </div>
                `;
            }

            if (!c.revelada) {
                grid.innerHTML += `
                    <div style="background:linear-gradient(135deg, #1e293b, #0f172a); border:2px dashed var(--accent); border-radius:8px; padding:1.25rem; text-align:center; display:flex; flex-direction:column; justify-content:center; align-items:center; min-height:180px;">
                        <i class="fa-solid fa-lock" style="font-size:2rem; color:var(--accent); margin-bottom:0.5rem;"></i>
                        <div style="font-weight:bold; color:var(--accent); font-size:0.95rem;">Carta Secreta</div>
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">Se revelará al finalizar la semana</div>
                        ${adminControls}
                    </div>
                `;
            } else {
                let transferBtn = esMia ? `<button class="btn btn-secondary" style="font-size:0.75rem; padding:0.25rem 0.5rem; margin-top:0.5rem;" onclick="abrirModalTransferirCarta(${c.id}, '${c.nombre_carta}')"><i class="fa-solid fa-right-left"></i> Transferir</button>` : '';
                let imagenHtml = c.imagen_url ? `<img src="${c.imagen_url}" style="width:100%; height:120px; object-fit:cover; border-radius:6px; margin-bottom:0.5rem;">` : '';

                grid.innerHTML += `
                    <div style="background:var(--card-bg); border:2px solid var(--success); border-radius:8px; padding:1rem; display:flex; flex-direction:column; justify-content:space-between;">
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                                <span class="badge" style="background:var(--success); color:#fff;">Única</span>
                                <i class="fa-solid fa-award" style="color:var(--gold);"></i>
                            </div>
                            ${imagenHtml}
                            <h4 style="font-size:1rem; margin-bottom:0.25rem; color:var(--text);">${c.nombre_carta}</h4>
                            <p style="font-size:0.8rem; color:var(--text-muted);">Poseedor: <strong style="color:var(--accent);">${c.propietario_nombre || 'N/A'}</strong></p>
                        </div>
                        <div style="margin-top:0.75rem; text-align:center;">
                            ${transferBtn}
                            ${adminControls}
                        </div>
                    </div>
                `;
            }
        });
    } catch (e) { grid.innerHTML = 'Error al cargar cartas.'; }
}

async function abrirModalCrearCarta() {
    const grupoId = document.getElementById('group-filter-cards').value;
    if (!grupoId) return alert('Selecciona una liga.');
    openModal('create-card-modal');
    const res = await fetch(API_URL + '/grupos/' + grupoId + '/miembros');
    const miembros = await res.json();
    const sel = document.getElementById('card-winner-user');
    sel.innerHTML = '';
    miembros.forEach(m => { sel.innerHTML += `<option value="${m.usuario_id}">${m.username}</option>`; });
}

async function handleCrearCarta(e) {
    e.preventDefault();
    const grupo_id = document.getElementById('group-filter-cards').value;
    const nombre_carta = document.getElementById('card-name').value.trim();
    const ganador_original_id = parseInt(document.getElementById('card-winner-user').value);
    const imagen_url = document.getElementById('card-image-url').value.trim();

    const res = await fetch(API_URL + '/cartas/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo_id, nombre_carta, ganador_original_id, imagen_url })
    });
    if (res.ok) {
        alert('¡Carta creada exitosamente!');
        closeModal('create-card-modal');
        document.getElementById('card-name').value = '';
        document.getElementById('card-image-url').value = '';
        cargarCartasColeccionables();
    } else alert('Error al crear carta.');
}

async function toggleRevelarCarta(cartaId, estadoActual) {
    const nuevoEstado = !estadoActual;
    const res = await fetch(API_URL + '/cartas/revelar', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ carta_id: cartaId, revelada: nuevoEstado }) 
    });
    if (res.ok) cargarCartasColeccionables();
}

async function eliminarCarta(cartaId) {
    if (!confirm('¿Estás seguro de eliminar esta carta coleccionable?')) return;
    const res = await fetch(API_URL + '/cartas/' + cartaId, { method: 'DELETE' });
    if (res.ok) cargarCartasColeccionables();
}

async function abrirModalTransferirCarta(cartaId, cartaNombre) {
    document.getElementById('transfer-card-id').value = cartaId;
    document.getElementById('transfer-card-title').textContent = cartaNombre;
    openModal('transfer-card-modal');
    const grupoId = document.getElementById('group-filter-cards').value;
    const res = await fetch(API_URL + '/grupos/' + grupoId + '/miembros');
    const miembros = await res.json();
    const sel = document.getElementById('transfer-user-target');
    sel.innerHTML = '';
    miembros.forEach(m => {
        if (m.usuario_id !== currentUser.id) sel.innerHTML += `<option value="${m.usuario_id}">${m.username}</option>`;
    });
}

async function handleTransferirCarta(e) {
    e.preventDefault();
    const carta_id = document.getElementById('transfer-card-id').value;
    const nuevo_propietario_id = parseInt(document.getElementById('transfer-user-target').value);

    const res = await fetch(API_URL + '/cartas/transferir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carta_id, nuevo_propietario_id, usuario_actual_id: currentUser.id })
    });
    if (res.ok) {
        alert('¡Carta transferida con éxito!');
        closeModal('transfer-card-modal');
        cargarCartasColeccionables();
    } else {
        const d = await res.json();
        alert(d.error || 'Error al transferir.');
    }
}

async function loadStandings() {
    const tbody = document.getElementById('standings-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">Cargando posiciones...</td></tr>`;
    try {
        const res = await fetch(API_URL + '/standings');
        if (res.ok) {
            const data = await res.json();
            tbody.innerHTML = '';
            data.forEach((eq, index) => {
                const diffC = eq.ca - eq.cp;
                tbody.innerHTML += `<tr><td style="text-align: left; font-weight: bold;">${index + 1}. ${eq.equipo}</td><td>${eq.jj}</td><td>${eq.jg}</td><td>${eq.jp}</td><td><strong>${Number(eq.ave).toFixed(3).replace('0.', '.')}</strong></td><td>${eq.dif}</td><td>${eq.ca}</td><td>${eq.cp}</td><td>${diffC > 0 ? '+' + diffC : diffC}</td></tr>`;
            });
        }
    } catch (e) { tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--danger);">Error.</td></tr>`; }
}

async function abrirModalAdminStandings() {
    openModal('admin-standings-modal');
    const container = document.getElementById('admin-standings-inputs');
    container.innerHTML = 'Cargando...';
    try {
        const res = await fetch(API_URL + '/standings/base');
        if (res.ok) {
            const data = await res.json();
            container.innerHTML = '';
            data.forEach(item => {
                container.innerHTML += `<div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 0.75rem; border-radius: 6px;"><strong style="color: var(--accent);">${item.equipo}</strong><div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-top:0.5rem;"><div><label style="font-size:0.75rem;">JG</label><input type="number" id="base_jg_${item.equipo}" value="${item.jg_base}" min="0" style="width:100%; padding:0.2rem; background:var(--bg-color); border:1px solid var(--border); color:var(--text); border-radius:4px;"></div><div><label style="font-size:0.75rem;">JP</label><input type="number" id="base_jp_${item.equipo}" value="${item.jp_base}" min="0" style="width:100%; padding:0.2rem; background:var(--bg-color); border:1px solid var(--border); color:var(--text); border-radius:4px;"></div><div><label style="font-size:0.75rem;">CA</label><input type="number" id="base_ca_${item.equipo}" value="${item.ca_base}" min="0" style="width:100%; padding:0.2rem; background:var(--bg-color); border:1px solid var(--border); color:var(--text); border-radius:4px;"></div><div><label style="font-size:0.75rem;">CP</label><input type="number" id="base_cp_${item.equipo}" value="${item.cp_base}" min="0" style="width:100%; padding:0.2rem; background:var(--bg-color); border:1px solid var(--border); color:var(--text); border-radius:4px;"></div></div></div>`;
            });
        }
    } catch (e) { container.innerHTML = 'Error.'; }
}

async function handleGuardarStandingsBase(e) {
    e.preventDefault();
    const equipos = ["Caribes de Anzoátegui", "Tigres de Aragua", "Cardenales de Lara", "Bravos de Margarita", "Águilas del Zulia", "Tiburones de La Guaira", "Leones del Caracas", "Navegantes del Magallanes"];
    const ajustes = equipos.map(eq => ({ equipo: eq, jg_base: parseInt(document.getElementById(`base_jg_${eq}`).value) || 0, jp_base: parseInt(document.getElementById(`base_jp_${eq}`).value) || 0, ca_base: parseInt(document.getElementById(`base_ca_${eq}`).value) || 0, cp_base: parseInt(document.getElementById(`base_cp_${eq}`).value) || 0 }));
    const res = await fetch(API_URL + '/standings/base', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ajustes }) });
    if (res.ok) { closeModal('admin-standings-modal'); loadStandings(); alert('Standings actualizados.'); }
}

async function cargarGrupos() {
    try {
        const resGrupos = await fetch(API_URL + '/grupos');
        if (resGrupos.ok) {
            gruposListado = await resGrupos.json();
            misLigasIds.clear();
            for (const g of gruposListado) {
                const resMem = await fetch(API_URL + '/grupos/' + g.id + '/miembros');
                if (resMem.ok) {
                    const miembros = await resMem.json();
                    if (miembros.some(m => m.usuario_id === currentUser.id)) misLigasIds.add(g.id);
                }
            }
            renderGroups(); populateGroupSelects(); renderGames(); loadLeaderboard(); loadHistory(); loadChampionships(); cargarCartasColeccionables();
        }
    } catch (err) {}
}

async function verificarEnlaceInvitacion() {
    const params = new URLSearchParams(window.location.search);
    const codigoJoin = params.get('join');
    if (!codigoJoin || !currentUser) return;
    window.history.replaceState({}, document.title, window.location.pathname);
    let password = '';
    let res = await fetch(API_URL + '/grupos/unirse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo_acceso: codigoJoin, password: '', usuario_id: currentUser.id }) });
    let data = await res.json();
    if (!res.ok && data.error && data.error.includes('Contraseña')) {
        password = prompt('Liga privada. Ingresa la contraseña:') || '';
        if (password) {
            res = await fetch(API_URL + '/grupos/unirse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo_acceso: codigoJoin, password, usuario_id: currentUser.id }) });
            data = await res.json();
        }
    }
    if (res.ok) { alert('Te has unido exitosamente.'); cargarGrupos(); }
}

// NUEVO: Funciones para navegar directamente al hacer clic en el nombre de la liga
function activarPestana(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');

    document.querySelectorAll('.sidebar .nav-btn').forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(tabId)) {
            btn.classList.add('active');
        }
    });
}

async function seleccionarLigaYVerPartidos(grupoId) {
    const g = gruposListado.find(x => x.id === grupoId);
    if (!g) return;

    const esMiembro = misLigasIds.has(grupoId);

    if (esMiembro) {
        activarPestana('games-tab');
        const selectGame = document.getElementById('group-select-game');
        if (selectGame) {
            selectGame.value = grupoId;
            renderGames();
        }
    } else {
        if (g.estado === 'EN_PROGRESO' || g.estado === 'FINALIZADA') {
            alert(`⚠️ La liga "${g.nombre}" ya está ${g.estado === 'EN_PROGRESO' ? 'en curso' : 'finalizada'}. No es posible unirse en este momento.`);
        } else {
            alert(`🔒 No estás registrado en la liga "${g.nombre}". Debes unirte primero utilizando el botón "Unirse" o el enlace de invitación.`);
        }
    }
}

function renderGroups() {
    const container = document.getElementById('groups-list');
    if (!container) return;
    container.innerHTML = '';
    if (gruposListado.length === 0) { container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No hay ligas.</p>`; return; }

    gruposListado.forEach(g => {
        const enProgreso = g.estado === 'EN_PROGRESO';
        const finalizada = g.estado === 'FINALIZADA';
        const yaUnido = misLigasIds.has(g.id);
        const linkInvitacion = window.location.origin + window.location.pathname + '?join=' + g.codigo_acceso;

        let badgeStyle = 'background:var(--border); color:var(--accent);';
        if (enProgreso) badgeStyle = 'background:var(--success); color:#fff;';
        if (finalizada) badgeStyle = 'background:var(--accent); color:#000;';

        let html = `<div class="group-card">
            <div class="group-card-header">
                <h3 style="cursor: pointer; color: var(--accent); transition: color 0.2s;" onclick="seleccionarLigaYVerPartidos(${g.id})" title="Haz clic para ir a los pronósticos de esta liga">${g.nombre}</h3>
                <span class="badge" style="${badgeStyle}">${g.estado}</span>
            </div>
            <p style="color: var(--text-muted); font-size: 0.85rem;">Tipo: <strong>${g.tipo}</strong> | Código: <strong>${g.codigo_acceso}</strong></p>
            <div class="group-card-actions">`;

        if (yaUnido) html += `<button class="btn" style="background:var(--success); color:#fff; cursor:default;" disabled><i class="fa-solid fa-check"></i> Unido</button>`;
        else if (!enProgreso && !finalizada) html += `<a href="${linkInvitacion}" class="btn btn-primary" style="text-decoration:none;" target="_blank"><i class="fa-solid fa-user-plus"></i> Unirse</a>`;

        html += `<button class="btn btn-secondary" onclick="abrirModalMiembros(${g.id}, '${g.nombre}')"><i class="fa-solid fa-users"></i> Miembros</button>
                <button class="btn btn-secondary" onclick="openShareModal(${g.id})"><i class="fa-solid fa-share-nodes"></i> QR</button>`;

        if (currentUser.id === 1 || currentUser.id === g.creador_id) {
            if (g.estado === 'CONFIGURACION') {
                html += `<button class="btn btn-secondary" style="background:var(--success); color:#fff;" onclick="cambiarEstadoGrupo(${g.id}, 'EN_PROGRESO')" title="Iniciar Liga"><i class="fa-solid fa-play"></i> Iniciar</button>`;
            } else if (g.estado === 'EN_PROGRESO') {
                html += `<button class="btn btn-secondary" style="background:var(--accent); color:#000;" onclick="cambiarEstadoGrupo(${g.id}, 'FINALIZADA')" title="Finalizar Liga"><i class="fa-solid fa-flag-checkered"></i> Finalizar</button>`;
            } else if (g.estado === 'FINALIZADA') {
                html += `<button class="btn btn-secondary" style="background:var(--border); color:var(--text);" onclick="cambiarEstadoGrupo(${g.id}, 'EN_PROGRESO')" title="Reabrir Liga"><i class="fa-solid fa-rotate-left"></i> Reabrir</button>`;
            }
            html += `<button class="btn btn-danger" onclick="eliminarGrupo(${g.id})"><i class="fa-solid fa-trash"></i></button>`;
        }
        html += `</div></div>`;
        container.innerHTML += html;
    });
}

async function cambiarEstadoGrupo(grupoId, nuevoEstado) {
    if (!confirm(`¿Estás seguro de cambiar el estado de la liga a ${nuevoEstado}?`)) return;
    try {
        const res = await fetch(API_URL + '/grupos/estado', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grupo_id: grupoId, estado: nuevoEstado })
        });
        if (res.ok) {
            alert('Estado de la liga actualizado con éxito.');
            cargarGrupos();
        } else {
            const data = await res.json();
            alert(data.error || 'Error al actualizar el estado.');
        }
    } catch (err) {
        alert('Error de conexión con el servidor.');
    }
}

function populateGroupSelects() {
    ['group-filter', 'group-select-game', 'group-filter-history', 'group-filter-championships', 'group-filter-cards'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const valActual = select.value;
        select.innerHTML = '';
        gruposListado.forEach(g => { select.innerHTML += `<option value="${g.id}">${g.nombre} (${g.codigo_acceso})</option>`; });
        if (valActual) select.value = valActual;
    });
    loadLeaderboard(); loadHistory(); loadChampionships();
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

function toggleGroupPassword() {
    const tipo = document.getElementById('group-type').value;
    document.getElementById('group-pass-container').style.display = (tipo === 'PRIVADA') ? 'flex' : 'none';
}

async function handleGuardarGrupo(e) {
    e.preventDefault();
    const nombre = document.getElementById('group-name').value.trim();
    const tipo = document.getElementById('group-type').value;
    const password = document.getElementById('group-password').value.trim();
    const res = await fetch(API_URL + '/grupos/crear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, tipo, password, creador_id: currentUser.id }) });
    if (res.ok) { closeModal('create-group-modal'); cargarGrupos(); alert('Liga creada.'); }
}

function abrirModalUnirseLiga() { openModal('join-group-modal'); }

async function handleUnirseLiga(e) {
    e.preventDefault();
    const codigo_acceso = document.getElementById('join-codigo').value.trim();
    const password = document.getElementById('join-password').value.trim();
    const res = await fetch(API_URL + '/grupos/unirse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo_acceso, password, usuario_id: currentUser.id }) });
    const data = await res.json();
    if (res.ok) { closeModal('join-group-modal'); cargarGrupos(); alert('Te has unido exitosamente.'); }
    else { alert(data.error || 'Error.'); if (data.error && data.error.includes('Contraseña')) document.getElementById('join-pass-group').style.display = 'flex'; }
}

async function abrirModalMiembros(grupoId, grupoNombre) {
    document.getElementById('members-modal-title').textContent = 'Miembros de: ' + grupoNombre;
    openModal('members-modal');
    const res = await fetch(API_URL + '/grupos/' + grupoId + '/miembros');
    if (res.ok) {
        const miembros = await res.json();
        const tbody = document.getElementById('members-tbody');
        tbody.innerHTML = '';
        miembros.forEach(m => { tbody.innerHTML += `<tr><td>${m.username}</td><td>${m.email}</td><td></td></tr>`; });
    }
}

async function eliminarGrupo(grupoId) {
    if (!confirm('¿Deseas eliminar esta liga?')) return;
    const res = await fetch(API_URL + '/grupos/' + grupoId, { method: 'DELETE' });
    if (res.ok) cargarGrupos();
}

function abrirModalCrearPartido() { 
    document.getElementById('edit-game-id').value = '';
    document.getElementById('new-vis').value = '';
    document.getElementById('new-loc').value = '';
    
    const fechaVzla = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
    document.getElementById('new-fecha').value = fechaVzla;
    
    document.getElementById('new-hora-val').value = '19:00';
    document.getElementById('new-hora-ampm').value = 'PM';
    document.getElementById('new-estadio').value = '';

    openModal('create-game-modal'); 
}

// NUEVO: Función para abrir la modal de partidos en modo Edición
function abrirModalEditarPartido(id, vis, loc, fecha, hora, estadio) {
    document.getElementById('edit-game-id').value = id;
    document.getElementById('new-vis').value = vis;
    document.getElementById('new-loc').value = loc;
    document.getElementById('new-fecha').value = fecha;
    
    if (hora) {
        const partes = hora.split(' ');
        if (partes.length >= 2) {
            document.getElementById('new-hora-val').value = partes[0];
            document.getElementById('new-hora-ampm').value = partes[1];
        } else {
            document.getElementById('new-hora-val').value = hora;
        }
    }
    document.getElementById('new-estadio').value = estadio || '';
    openModal('create-game-modal');
}

// NUEVO: Manejador unificado para crear o actualizar partidos
async function handleGuardarPartido(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-game-id').value;
    const horaVal = document.getElementById('new-hora-val').value;
    const ampmVal = document.getElementById('new-hora-ampm').value;
    const partido = {
        equipo_visitante: document.getElementById('new-vis').value.trim(),
        equipo_local: document.getElementById('new-loc').value.trim(),
        fecha_juego: document.getElementById('new-fecha').value.trim(),
        hora: `${horaVal} ${ampmVal}`,
        estadio: document.getElementById('new-estadio').value.trim()
    };

    const endpoint = editId ? `${API_URL}/partidos/${editId}` : `${API_URL}/partidos/crear`;
    const method = editId ? 'PUT' : 'POST';

    try {
        const res = await fetch(endpoint, { 
            method: method, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(partido) 
        });

        if (res.ok) { 
            closeModal('create-game-modal'); 
            renderGames(); 
            loadStandings(); 
            alert(editId ? '¡Partido actualizado con éxito!' : '¡Partido creado con éxito!');
        } else {
            const data = await res.json();
            alert(data.error || 'Error al guardar el partido.');
        }
    } catch (err) {
        alert('Error de conexión con el servidor.');
    }
}

async function eliminarPartido(id) {
    if (!confirm('¿Eliminar partido?')) return;
    const res = await fetch(API_URL + '/partidos/' + id, { method: 'DELETE' });
    if (res.ok) { renderGames(); loadStandings(); }
}

async function cambiarEstadoPartido(id, est) {
    const res = await fetch(API_URL + '/partidos/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partido_id: id, estado: est }) });
    if (res.ok) { renderGames(); loadStandings(); }
}

async function renderGames() {
    if (!currentUser) return;
    const selectGame = document.getElementById('group-select-game');
    if (selectGame && !selectGame.value && selectGame.options.length > 0) selectGame.selectedIndex = 0;
    const grupoId = parseInt(selectGame?.value);
    const container = document.getElementById('games-container');
    const fechaFiltro = document.getElementById('filter-games-date')?.value;
    if (!container || !grupoId) return;

    // Identificar si la liga actual está finalizada
    const grupoActual = gruposListado.find(x => x.id === grupoId);
    const esLigaFinalizada = grupoActual && grupoActual.estado === 'FINALIZADA';

    let partidos = [], pronosticos = [];
    try {
        const [resP, resPr] = await Promise.all([
            fetch(API_URL + '/partidos'),
            fetch(API_URL + '/pronosticos/' + grupoId + '/' + currentUser.id)
        ]);
        if (resP.ok) partidos = await resP.json();
        if (resPr.ok) pronosticos = await resPr.json();
    } catch (e) {}

    if (fechaFiltro) {
        partidos = partidos.filter(p => p.fecha_juego === fechaFiltro);
    }

    container.innerHTML = '';
    if (partidos.length === 0) { 
        container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 2rem;">No hay partidos programados para esta fecha.</p>`; 
        return; 
    }

    partidos.forEach(p => {
        const pred = pronosticos.find(x => x.partido_id === p.id) || { carreras_vis_pred: '', carreras_loc_pred: '', puntos_obtenidos: 0 };
        const tienePred = pred.carreras_vis_pred !== '' && pred.carreras_vis_pred !== null;
        let estadoBadge = `<span class="badge">${p.estado}</span>`;
        if (p.estado === 'FINALIZADO') estadoBadge = `<span class="badge badge-finished">FINALIZADO (${p.carreras_visitante} - ${p.carreras_local})</span>`;

        let html = `<div class="game-card">
            <div class="game-info">
                <div>${estadoBadge} <span style="color: var(--accent); font-weight: bold; font-size: 0.85rem; margin-left: 0.5rem;"><i class="fa-regular fa-calendar"></i> ${p.fecha_juego}</span> <span style="color: var(--text-muted); font-size: 0.85rem; margin-left: 0.5rem;">${p.hora}</span></div>
                <div class="team-matchup" style="margin-top: 0.5rem;"><span>${p.equipo_visitante}</span> vs <span>${p.equipo_local}</span></div>
                <div class="stadium"><i class="fa-solid fa-location-dot"></i> ${p.estadio}</div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <input type="number" class="score-input" id="pred-vis-${p.id}" value="${pred.carreras_vis_pred}" ${p.estado !== 'PENDIENTE' || esLigaFinalizada ? 'disabled' : ''}>
                <span>-</span>
                <input type="number" class="score-input" id="pred-loc-${p.id}" value="${pred.carreras_loc_pred}" ${p.estado !== 'PENDIENTE' || esLigaFinalizada ? 'disabled' : ''}>`;

        if (p.estado === 'PENDIENTE' && !esLigaFinalizada) {
            html += `<button class="btn" style="background: #eab308; color: #000; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 600;" onclick="guardarPronostico(${p.id}, ${grupoId}, ${tienePred})"><i class="fa-solid fa-${tienePred ? 'pen-to-square' : 'floppy-disk'}"></i> ${tienePred ? 'Editar' : 'Guardar'}</button>`;
        } else {
            if (esLigaFinalizada) {
                html += `<span class="badge" style="background:var(--accent); color:#000;">Liga Finalizada</span>`;
            } else {
                html += `<button class="btn btn-secondary" style="background: #0284c7; color: #fff;" onclick="abrirModalVerPronosticosPartidos(${p.id}, '${p.equipo_visitante}', '${p.equipo_local}')"><i class="fa-solid fa-eye"></i> Ver</button>`;
            }
            if (p.estado === 'FINALIZADO') {
                const pts = pred.puntos_obtenidos !== undefined ? pred.puntos_obtenidos : 0;
                const badgeStyle = pts === 0 ? 'background:rgba(239,68,68,0.2); border:1px solid var(--danger); color:var(--danger);' : 'background:rgba(16,185,129,0.2); border:1px solid var(--success); color:var(--success);';
                html += `<span class="points-earned-badge" style="${badgeStyle}">+${pts} pts obtenidos</span>`;
            }
        }

        if (currentUser.id === 1) {
            html += `<button class="btn btn-secondary" style="background:#0284c7; color:#fff;" onclick="abrirModalEditarPartido(${p.id}, '${p.equipo_visitante}', '${p.equipo_local}', '${p.fecha_juego}', '${p.hora}', '${p.estadio}')" title="Editar partido"><i class="fa-solid fa-pen"></i></button>`;

            if (p.estado === 'PENDIENTE') {
                html += `<button class="btn btn-secondary" style="background:#eab308; color:#000;" onclick="cambiarEstadoPartido(${p.id}, 'CERRADO')">Cerrar</button>`;
            } else if (p.estado === 'CERRADO') {
                html += `<button class="btn btn-secondary" style="background:#64748b; color:#fff;" onclick="cambiarEstadoPartido(${p.id}, 'PENDIENTE')" title="Reabrir partido"><i class="fa-solid fa-rotate-left"></i> Reabrir</button>`;
                html += `<button class="btn btn-secondary" onclick="abrirModalResultado(${p.id}, '${p.equipo_visitante}', '${p.equipo_local}')">Resultado</button>`;
            } else if (p.estado === 'FINALIZADO') {
                html += `<button class="btn btn-secondary" style="background:#64748b; color:#fff;" onclick="cambiarEstadoPartido(${p.id}, 'PENDIENTE')" title="Reabrir y corregir resultado"><i class="fa-solid fa-rotate-left"></i> Reabrir</button>`;
            }
            html += `<button class="btn btn-danger" onclick="eliminarPartido(${p.id})"><i class="fa-solid fa-trash"></i></button>`;
        }
        html += `</div></div>`;
        container.innerHTML += html;
    });
}

function enviarRecordatorioWhatsApp() {
    const grupoId = document.getElementById('group-select-game')?.value;
    if (!grupoId) return alert('Selecciona una liga.');
    const g = gruposListado.find(x => x.id == grupoId);
    const link = window.location.origin + window.location.pathname + '?join=' + (g ? g.codigo_acceso : '');
    const nombreLiga = g ? g.nombre : '';
    const mensaje = `⚾🔥 ¡Pronósticos abiertos en la Quiniela *${nombreLiga}*! Entra ya: ${link}`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`, '_blank');
}

async function abrirModalVerPronosticosPartidos(partidoId, vis, loc) {
    const grupoId = document.getElementById('group-select-game')?.value;
    if (!grupoId) return;
    document.getElementById('ver-pred-match-title').textContent = `${vis} vs ${loc}`;
    openModal('ver-pronosticos-modal');
    const tbody = document.getElementById('ver-pred-tbody');
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Cargando...</td></tr>`;
    try {
        const res = await fetch(`${API_URL}/pronosticos/partido/${grupoId}/${partidoId}`);
        const data = await res.json();
        tbody.innerHTML = '';
        data.forEach(p => {
            tbody.innerHTML += `<tr><td><strong>${p.username}</strong></td><td><code>${p.carreras_vis_pred !== null ? p.carreras_vis_pred + ' - ' + p.carreras_loc_pred : 'Sin pronóstico'}</code></td><td><strong>+${p.puntos_obtenidos || 0} pts</strong></td></tr>`;
        });
    } catch (e) { tbody.innerHTML = `<tr><td colspan="3">Error.</td></tr>`; }
}

async function guardarPronostico(partidoId, grupoId, ya) {
    const vis = document.getElementById('pred-vis-' + partidoId).value;
    const loc = document.getElementById('pred-loc-' + partidoId).value;
    if (vis === '' || loc === '') return alert('Ingresa las carreras.');
    const res = await fetch(API_URL + '/pronosticos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grupo_id: grupoId, usuario_id: currentUser.id, partido_id: partidoId, carreras_vis_pred: parseInt(vis), carreras_loc_pred: parseInt(loc) }) });
    if (res.ok) { alert('Pronóstico guardado.'); renderGames(); } else alert((await res.json()).error || 'Error.');
}

function abrirModalResultado(partidoId, vis, loc) {
    document.getElementById('result-match-id').value = partidoId;
    document.getElementById('result-match-title').textContent = vis + ' vs ' + loc;
    
    // Limpiar los inputs para que no arrastren el resultado anterior
    document.getElementById('res-vis').value = '';
    document.getElementById('res-loc').value = '';
    
    openModal('result-modal');
}

async function handleGuardarResultado(e) {
    e.preventDefault();
    const partido_id = document.getElementById('result-match-id').value;
    const res = await fetch(API_URL + '/partidos/resultado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partido_id, carreras_visitante: parseInt(document.getElementById('res-vis').value), carreras_local: parseInt(document.getElementById('res-loc').value) }) });
    if (res.ok) { closeModal('result-modal'); renderGames(); loadLeaderboard(); loadHistory(); loadStandings(); alert('Resultado procesado.'); }
}

async function loadLeaderboard() {
    const grupoId = document.getElementById('group-filter')?.value;
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody || !grupoId) return;
    const res = await fetch(API_URL + '/leaderboard/' + grupoId);
    if (res.ok) {
        const data = await res.json();
        tbody.innerHTML = '';
        data.forEach((m, idx) => {
            let t = idx === 0 ? ' 🥇' : (idx === 1 ? ' 🥈' : (idx === 2 ? ' 🥉' : ''));
            tbody.innerHTML += `<tr><td>#${idx + 1}</td><td><strong>${m.username}</strong>${t}</td><td><span class="badge">${m.rol}</span></td><td><strong>${m.puntos_acumulados} pts</strong></td></tr>`;
        });
    }
}

async function loadHistory() {
    const grupoId = document.getElementById('group-filter-history')?.value;
    const tbody = document.getElementById('history-body');
    const selJugador = document.getElementById('filter-history-jugador');
    if (!tbody || !grupoId) return;

    try {
        const res = await fetch(API_URL + '/historial/' + grupoId);
        if (res.ok) {
            historialCache = await res.json();
            const jugadores = [...new Set(historialCache.map(h => h.username))];
            selJugador.innerHTML = `<option value="">Todos los Jugadores</option>`;
            jugadores.forEach(j => { selJugador.innerHTML += `<option value="${j}">${j}</option>`; });
            aplicarFiltrosHistorial();
        }
    } catch (e) {}
}

function aplicarFiltrosHistorial() {
    const tbody = document.getElementById('history-body');
    const dateFrom = document.getElementById('filter-date-from').value;
    const dateTo = document.getElementById('filter-date-to').value;
    const jugadorVal = document.getElementById('filter-history-jugador').value;
    if (!tbody) return;

    let filtrados = historialCache.filter(h => {
        let matchFecha = true;
        if (dateFrom && h.fecha_juego < dateFrom) matchFecha = false;
        if (dateTo && h.fecha_juego > dateTo) matchFecha = false;
        let matchJugador = !jugadorVal || h.username === jugadorVal;
        return matchFecha && matchJugador;
    });

    tbody.innerHTML = '';
    if (filtrados.length === 0) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No hay registros en este rango de fechas.</td></tr>`; return; }

    filtrados.forEach(h => {
        let color = h.puntos_obtenidos === 6 ? 'var(--success)' : (h.puntos_obtenidos >= 2 ? 'var(--accent)' : 'var(--danger)');
        tbody.innerHTML += `<tr><td><strong>${h.username}</strong></td><td>${h.equipo_visitante} vs ${h.equipo_local}</td><td>${h.fecha_juego}</td><td><code>${h.carreras_vis_pred} - ${h.carreras_loc_pred}</code></td><td><code>${h.real_vis} - ${h.real_loc}</code></td><td><span class="badge" style="background:${color}; color:#fff;">+${h.puntos_obtenidos} pts</span></td></tr>`;
    });
}

function limpiarFiltrosHistorial() {
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    document.getElementById('filter-history-jugador').value = '';
    aplicarFiltrosHistorial();
}

async function loadChampionships() {
    const grupoId = document.getElementById('group-filter-championships')?.value;
    const container = document.getElementById('championships-container');
    if (!container || !grupoId) return;
    const res = await fetch(API_URL + '/campeonatos/' + grupoId);
    if (res.ok) {
        const camp = await res.json();
        if (camp.length === 0) { container.innerHTML = `<p style="text-align:center; color:var(--text-muted);">Sin campeones aún.</p>`; return; }
        let html = `<div class="table-container"><table class="leaderboard-table"><thead><tr><th>Premio</th><th>Jugador</th><th>Fecha</th></tr></thead><tbody>`;
        camp.forEach(c => {
            let med = c.puesto === 1 ? '🥇 1er Lugar' : (c.puesto === 2 ? '🥈 2do Lugar' : '🥉 3er Lugar');
            html += `<tr><td><strong>${med}</strong></td><td><strong>${c.username}</strong></td><td>${new Date(c.fecha_finalizacion).toLocaleDateString()}</td></tr>`;
        });
        html += `</tbody></table></div>`;
        container.innerHTML = html;
    }
}

// WEB PUSH SUBSCRIPTION
async function suscribirNotificacionesPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return alert('Tu navegador no soporta Web Push.');
    try {
        const reg = await navigator.serviceWorker.ready;
        const keyRes = await fetch(API_URL + '/push/vapid-public-key');
        const { publicKey } = await keyRes.json();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        await fetch(API_URL + '/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario_id: currentUser.id, subscription: sub }) });
        alert('¡Notificaciones Push activadas con éxito! ⚾🔔');
    } catch (e) { alert('Error al activar notificaciones.'); }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

function switchTab(id) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function openShareModal(grupoId) {
    const g = gruposListado.find(x => x.id === grupoId);
    if (!g) return;
    document.getElementById('share-group-name').textContent = g.nombre;
    const url = window.location.origin + window.location.pathname + '?join=' + g.codigo_acceso;
    document.getElementById('share-url-input').value = url;
    document.getElementById('qrcode').innerHTML = ''; 
    new QRCode(document.getElementById('qrcode'), { text: url, width: 160, height: 160 });
    openModal('share-modal');
}
function copyInviteLink() { document.getElementById('share-url-input').select(); document.execCommand('copy'); alert('Copiado.'); }

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}