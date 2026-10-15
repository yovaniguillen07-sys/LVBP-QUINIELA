const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '/')));

const db = new sqlite3.Database('./quiniela_lvbp.db', (err) => {
    if (err) console.error('Error al conectar a SQLite:', err.message);
    else console.log('Base de datos SQLite conectada correctamente.');
});

db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP)');
    db.run('CREATE TABLE IF NOT EXISTS grupos (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, codigo_acceso TEXT UNIQUE NOT NULL, tipo TEXT DEFAULT "PUBLICA", password TEXT DEFAULT "", estado TEXT DEFAULT "CONFIGURACION", creador_id INTEGER, FOREIGN KEY(creador_id) REFERENCES usuarios(id))');
    db.run('CREATE TABLE IF NOT EXISTS miembros_grupo (grupo_id INTEGER, usuario_id INTEGER, puntos_acumulados INTEGER DEFAULT 0, PRIMARY KEY (grupo_id, usuario_id), FOREIGN KEY(grupo_id) REFERENCES grupos(id), FOREIGN KEY(usuario_id) REFERENCES usuarios(id))');
    db.run('CREATE TABLE IF NOT EXISTS partidos (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT UNIQUE, equipo_visitante TEXT NOT NULL, equipo_local TEXT NOT NULL, fecha_juego TEXT NOT NULL, hora TEXT NOT NULL, estadio TEXT, estado TEXT DEFAULT "PENDIENTE", carreras_visitante INTEGER DEFAULT NULL, carreras_local INTEGER DEFAULT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS pronosticos (id INTEGER PRIMARY KEY AUTOINCREMENT, grupo_id INTEGER, usuario_id INTEGER, partido_id INTEGER, carreras_vis_pred INTEGER NOT NULL, carreras_loc_pred INTEGER NOT NULL, puntos_obtenidos INTEGER DEFAULT 0, UNIQUE(grupo_id, usuario_id, partido_id), FOREIGN KEY(grupo_id) REFERENCES grupos(id), FOREIGN KEY(usuario_id) REFERENCES usuarios(id), FOREIGN KEY(partido_id) REFERENCES partidos(id))');
});

// --- USUARIOS Y ADMIN ---
app.post('/api/auth/registro', (req, res) => {
    const { username, email, password } = req.body;
    const query = 'INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)';
    db.run(query, [username, email, password], function(err) {
        if (err) return res.status(400).json({ error: 'El usuario o correo ya existe.' });
        res.json({ status: 'ok', userId: this.lastID, username });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM usuarios WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err || !row) return res.status(401).json({ error: 'Credenciales inválidas.' });
        res.json({ status: 'ok', user: { id: row.id, username: row.username } });
    });
});

app.put('/api/usuarios/:id', (req, res) => {
    const { username, password } = req.body;
    db.run('UPDATE usuarios SET username = ?, password = ? WHERE id = ?', [username, password, req.params.id], function(err) {
        if (err) return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
        res.json({ status: 'ok', user: { id: req.params.id, username } });
    });
});

app.get('/api/admin/usuarios', (req, res) => {
    db.all('SELECT id, username, email, password, fecha_registro FROM usuarios', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/usuarios', (req, res) => {
    const { username, email, password } = req.body;
    db.run('INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)', [username, email, password], function(err) {
        if (err) return res.status(400).json({ error: 'No se pudo crear el usuario.' });
        res.json({ status: 'ok', userId: this.lastID });
    });
});

app.delete('/api/admin/usuarios/:id', (req, res) => {
    const userId = req.params.id;
    db.run('DELETE FROM pronosticos WHERE usuario_id = ?', [userId], () => {
        db.run('DELETE FROM miembros_grupo WHERE usuario_id = ?', [userId], () => {
            db.run('DELETE FROM usuarios WHERE id = ?', [userId], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ status: 'ok' });
            });
        });
    });
});

// --- GRUPOS / LIGAS ---
app.get('/api/grupos', (req, res) => {
    db.all('SELECT * FROM grupos', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/grupos/crear', (req, res) => {
    const { nombre, tipo, password, creador_id } = req.body;
    const codigo = 'LVBP-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const query = 'INSERT INTO grupos (nombre, codigo_acceso, tipo, password, estado, creador_id) VALUES (?, ?, ?, ?, "CONFIGURACION", ?)';
    db.run(query, [nombre, codigo, tipo || 'PUBLICA', password || '', creador_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const grupoId = this.lastID;
        db.run('INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES (?, ?, 0)', [grupoId, creador_id], () => {
            res.json({ status: 'ok', grupoId, codigo });
        });
    });
});

app.put('/api/grupos/:id', (req, res) => {
    const { nombre, tipo, password } = req.body;
    db.run('UPDATE grupos SET nombre = ?, tipo = ?, password = ? WHERE id = ?', [nombre, tipo, password, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok' });
    });
});

app.post('/api/grupos/comenzar', (req, res) => {
    const { grupo_id } = req.body;
    db.run('UPDATE grupos SET estado = "EN_PROGRESO" WHERE id = ?', [grupo_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok' });
    });
});

app.post('/api/grupos/unirse', (req, res) => {
    const { codigo_acceso, password, usuario_id } = req.body;
    db.get('SELECT * FROM grupos WHERE codigo_acceso = ?', [codigo_acceso], (err, grupo) => {
        if (err || !grupo) return res.status(404).json({ error: 'Liga no encontrada con ese código.' });
        if (grupo.tipo === 'PRIVADA' && grupo.password !== password) {
            return res.status(401).json({ error: 'Contraseña incorrecta para esta liga privada.' });
        }
        db.run('INSERT OR IGNORE INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES (?, ?, 0)', [grupo.id, usuario_id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: 'ok', grupoId: grupo.id, nombre: grupo.nombre });
        });
    });
});

app.get('/api/grupos/:id/miembros', (req, res) => {
    const query = `SELECT u.id as usuario_id, u.username, u.email FROM miembros_grupo mg JOIN usuarios u ON mg.usuario_id = u.id WHERE mg.grupo_id = ?`;
    db.all(query, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.delete('/api/grupos/:grupoId/miembros/:usuarioId', (req, res) => {
    const { grupoId, usuarioId } = req.params;
    db.get('SELECT estado FROM grupos WHERE id = ?', [grupoId], (err, grupo) => {
        if (err || !grupo) return res.status(404).json({ error: 'Grupo no encontrado.' });
        if (grupo.estado === 'EN_PROGRESO') return res.status(400).json({ error: 'La liga está en progreso; no se pueden expulsar jugadores.' });
        db.run('DELETE FROM pronosticos WHERE grupo_id = ? AND usuario_id = ?', [grupoId, usuarioId], () => {
            db.run('DELETE FROM miembros_grupo WHERE grupo_id = ? AND usuario_id = ?', [grupoId, usuarioId], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ status: 'ok' });
            });
        });
    });
});

app.delete('/api/grupos/:id', (req, res) => {
    const grupoId = req.params.id;
    db.run('DELETE FROM pronosticos WHERE grupo_id = ?', [grupoId], () => {
        db.run('DELETE FROM miembros_grupo WHERE grupo_id = ?', [grupoId], () => {
            db.run('DELETE FROM grupos WHERE id = ?', [grupoId], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ status: 'ok' });
            });
        });
    });
});

app.post('/api/grupos/resetear', (req, res) => {
    const { grupo_id } = req.body;
    db.run('DELETE FROM pronosticos WHERE grupo_id = ?', [grupo_id], () => {
        db.run('UPDATE miembros_grupo SET puntos_acumulados = 0 WHERE grupo_id = ?', [grupo_id], () => {
            res.json({ status: 'ok', mensaje: 'Liga reseteada por completo.' });
        });
    });
});

// --- PARTIDOS ---
app.get('/api/partidos', (req, res) => {
    db.all('SELECT * FROM partidos ORDER BY fecha_juego ASC, id ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/partidos/crear', (req, res) => {
    const { equipo_visitante, equipo_local, fecha_juego, hora, estadio } = req.body;
    const externalId = `man_${Date.now()}`;
    db.run('INSERT INTO partidos (external_id, equipo_visitante, equipo_local, fecha_juego, hora, estadio, estado) VALUES (?, ?, ?, ?, ?, ?, "PENDIENTE")', 
    [externalId, equipo_visitante, equipo_local, fecha_juego, hora, estadio], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok', partidoId: this.lastID });
    });
});

app.put('/api/partidos/:id', (req, res) => {
    const { equipo_visitante, equipo_local, fecha_juego, hora, estadio } = req.body;
    db.run('UPDATE partidos SET equipo_visitante = ?, equipo_local = ?, fecha_juego = ?, hora = ?, estadio = ? WHERE id = ?', 
    [equipo_visitante, equipo_local, fecha_juego, hora, estadio, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok' });
    });
});

app.delete('/api/partidos/:id', (req, res) => {
    db.run('DELETE FROM pronosticos WHERE partido_id = ?', [req.params.id], () => {
        db.run('DELETE FROM partidos WHERE id = ?', [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: 'ok' });
        });
    });
});

app.post('/api/partidos/estado', (req, res) => {
    const { partido_id, estado } = req.body;
    db.run('UPDATE partidos SET estado = ? WHERE id = ?', [estado, partido_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok' });
    });
});

// --- PRONÓSTICOS Y CÁLCULO ---
app.get('/api/pronosticos/:grupoId/:usuarioId', (req, res) => {
    db.all('SELECT * FROM pronosticos WHERE grupo_id = ? AND usuario_id = ?', [req.params.grupoId, req.params.usuarioId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/pronosticos', (req, res) => {
    const { grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred } = req.body;
    db.get('SELECT * FROM partidos WHERE id = ?', [partido_id], (err, partido) => {
        if (err || !partido) return res.status(404).json({ error: 'Partido no encontrado.' });
        if (partido.estado !== 'PENDIENTE') return res.status(400).json({ error: 'El partido está cerrado o finalizado.' });

        const query = `INSERT INTO pronosticos (grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred) 
                       VALUES (?, ?, ?, ?, ?) 
                       ON CONFLICT(grupo_id, usuario_id, partido_id) DO UPDATE SET 
                       carreras_vis_pred = excluded.carreras_vis_pred, 
                       carreras_loc_pred = excluded.carreras_loc_pred`;
        db.run(query, [grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: 'ok' });
        });
    });
});

app.post('/api/partidos/resultado', (req, res) => {
    const { partido_id, carreras_visitante, carreras_local } = req.body;
    db.run('UPDATE partidos SET estado = "FINALIZADO", carreras_visitante = ?, carreras_local = ? WHERE id = ?', 
    [carreras_visitante, carreras_local], function(err) {
        if (err) return res.status(500).json({ error: err.message });

        db.all('SELECT * FROM pronosticos WHERE partido_id = ?', [partido_id], (err, pronosticos) => {
            if (err) return res.status(500).json({ error: err.message });

            let pendientes = pronosticos.length;
            if (pendientes === 0) return res.json({ status: 'ok' });

            pronosticos.forEach(p => {
                let puntos = 0;
                const visP = p.carreras_vis_pred;
                const locP = p.carreras_loc_pred;

                if (visP === carreras_visitante && locP === carreras_local) {
                    puntos = 6;
                } else {
                    const ganadorPred = visP > locP ? 'VIS' : (visP < locP ? 'LOC' : 'EMP');
                    const ganadorReal = carreras_visitante > carreras_local ? 'VIS' : (carreras_visitante < carreras_local ? 'LOC' : 'EMP');

                    if (ganadorPred === ganadorReal) {
                        puntos = 3;
                    } else if ((visP + locP) === (carreras_visitante + carreras_local)) {
                        puntos = 2;
                    }
                }

                db.run('UPDATE pronosticos SET puntos_obtenidos = ? WHERE id = ?', [puntos, p.id], () => {
                    pendientes--;
                    if (pendientes === 0) {
                        db.all('SELECT grupo_id, usuario_id, SUM(puntos_obtenidos) as total FROM pronosticos GROUP BY grupo_id, usuario_id', [], (err, rows) => {
                            if (!err && rows) {
                                let mPendientes = rows.length;
                                if (mPendientes === 0) return res.json({ status: 'ok' });
                                rows.forEach(r => {
                                    db.run('UPDATE miembros_grupo SET puntos_acumulados = ? WHERE grupo_id = ? AND usuario_id = ?', [r.total, r.grupo_id, r.usuario_id], () => {
                                        mPendientes--;
                                        if (mPendientes === 0) res.json({ status: 'ok' });
                                    });
                                });
                            } else {
                                res.json({ status: 'ok' });
                            }
                        });
                    }
                });
            });
        });
    });
});

app.post('/api/admin/puntos', (req, res) => {
    const { grupo_id, usuario_id, nuevos_puntos } = req.body;
    db.run('INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES (?, ?, ?) ON CONFLICT(grupo_id, usuario_id) DO UPDATE SET puntos_acumulados = ?', 
    [grupo_id, usuario_id, nuevos_puntos, nuevos_puntos], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok' });
    });
});

app.get('/api/leaderboard/:grupoId', (req, res) => {
    const query = `SELECT u.id as usuario_id, u.username, 
                   COALESCE(mg.puntos_acumulados, 0) as puntos_acumulados, 
                   CASE WHEN g.creador_id = u.id THEN "CREADOR" ELSE "MIEMBRO" END as rol 
                   FROM miembros_grupo mg 
                   JOIN usuarios u ON mg.usuario_id = u.id 
                   JOIN grupos g ON mg.grupo_id = g.id 
                   WHERE mg.grupo_id = ? 
                   ORDER BY puntos_acumulados DESC`;
    db.all(query, [req.params.grupoId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- HISTORIAL DETALLADO DE PUNTOS POR LIGA ---
app.get('/api/historial/:grupoId', (req, res) => {
    const grupoId = req.params.grupoId;
    const query = `
        SELECT u.username, p.equipo_visitante, p.equipo_local, p.fecha_juego, 
               pr.carreras_vis_pred, pr.carreras_loc_pred, 
               p.carreras_visitante as real_vis, p.carreras_local as real_loc, 
               pr.puntos_obtenidos, p.estado
        FROM pronosticos pr
        JOIN usuarios u ON pr.usuario_id = u.id
        JOIN partidos p ON pr.partido_id = p.id
        WHERE pr.grupo_id = ? AND p.estado = 'FINALIZADO'
        ORDER BY p.fecha_juego DESC, u.username ASC
    `;
    db.all(query, [grupoId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Servidor Quiniela LVBP en http://localhost:' + PORT);
});