const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '/')));

// Configuración de PostgreSQL (Render provee DATABASE_URL automáticamente)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Inicializar tablas en PostgreSQL de forma persistente
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS grupos (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, codigo_acceso TEXT UNIQUE NOT NULL, tipo TEXT DEFAULT 'PUBLICA', password TEXT DEFAULT '', estado TEXT DEFAULT 'CONFIGURACION', creador_id INTEGER REFERENCES usuarios(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS miembros_grupo (grupo_id INTEGER REFERENCES grupos(id), usuario_id INTEGER REFERENCES usuarios(id), puntos_acumulados INTEGER DEFAULT 0, PRIMARY KEY (grupo_id, usuario_id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS partidos (id SERIAL PRIMARY KEY, external_id TEXT UNIQUE, equipo_visitante TEXT NOT NULL, equipo_local TEXT NOT NULL, fecha_juego TEXT NOT NULL, hora TEXT NOT NULL, estadio TEXT, estado TEXT DEFAULT 'PENDIENTE', carreras_visitante INTEGER DEFAULT NULL, carreras_local INTEGER DEFAULT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS pronosticos (id SERIAL PRIMARY KEY, grupo_id INTEGER REFERENCES grupos(id), usuario_id INTEGER REFERENCES usuarios(id), partido_id INTEGER REFERENCES partidos(id), carreras_vis_pred INTEGER NOT NULL, carreras_loc_pred INTEGER NOT NULL, puntos_obtenidos INTEGER DEFAULT 0, UNIQUE(grupo_id, usuario_id, partido_id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS campeonatos (id SERIAL PRIMARY KEY, grupo_id INTEGER REFERENCES grupos(id), usuario_id INTEGER REFERENCES usuarios(id), puesto INTEGER NOT NULL, fecha_finalizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        console.log('Base de datos PostgreSQL conectada y sincronizada correctamente.');
    } catch (err) {
        console.error('Error al inicializar la base de datos:', err.message);
    }
}
initDB();

// --- USUARIOS Y ADMIN ---
app.post('/api/auth/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO usuarios (username, email, password) VALUES (\$1, \$2, \$3) RETURNING id',
            [username, email, password]
        );
        res.json({ status: 'ok', userId: result.rows[0].id, username });
    } catch (err) {
        res.status(400).json({ error: 'El usuario o correo ya existe.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE username = \$1 AND password = \$2', [username, password]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas.' });
        const row = result.rows[0];
        res.json({ status: 'ok', user: { id: row.id, username: row.username, email: row.email } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/usuarios/:id', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query('UPDATE usuarios SET username = \$1, password = \$2 WHERE id = \$3', [username, password, req.params.id]);
        const userRes = await pool.query('SELECT id, username, email FROM usuarios WHERE id = \$1', [req.params.id]);
        res.json({ status: 'ok', user: userRes.rows[0] });
    } catch (err) {
        res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
    }
});

app.get('/api/admin/usuarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, password, fecha_registro FROM usuarios');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/usuarios', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const result = await pool.query('INSERT INTO usuarios (username, email, password) VALUES (\$1, \$2, \$3) RETURNING id', [username, email, password]);
        res.json({ status: 'ok', userId: result.rows[0].id });
    } catch (err) {
        res.status(400).json({ error: 'No se pudo crear el usuario.' });
    }
});

app.delete('/api/admin/usuarios/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        await pool.query('DELETE FROM pronosticos WHERE usuario_id = \$1', [userId]);
        await pool.query('DELETE FROM miembros_grupo WHERE usuario_id = \$1', [userId]);
        await pool.query('DELETE FROM campeonatos WHERE usuario_id = \$1', [userId]);
        await pool.query('DELETE FROM usuarios WHERE id = \$1', [userId]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GRUPOS / LIGAS ---
app.get('/api/grupos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM grupos');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grupos/crear', async (req, res) => {
    const { nombre, tipo, password, creador_id } = req.body;
    const codigo = 'LVBP-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    try {
        const result = await pool.query(
            'INSERT INTO grupos (nombre, codigo_acceso, tipo, password, estado, creador_id) VALUES (\$1, \$2, \$3, \$4, \$5, \$6) RETURNING id',
            [nombre, codigo, tipo || 'PUBLICA', password || '', 'CONFIGURACION', creador_id]
        );
        const grupoId = result.rows[0].id;
        await pool.query('INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES (\$1, \$2, 0)', [grupoId, creador_id]);
        res.json({ status: 'ok', grupoId, codigo });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/grupos/:id', async (req, res) => {
    const { nombre, tipo, password } = req.body;
    try {
        await pool.query('UPDATE grupos SET nombre = \$1, tipo = \$2, password = \$3 WHERE id = \$4', [nombre, tipo, password, req.params.id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grupos/comenzar', async (req, res) => {
    const { grupo_id } = req.body;
    try {
        await pool.query('UPDATE grupos SET estado = \$1 WHERE id = \$2', ['EN_PROGRESO', grupo_id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grupos/finalizar', async (req, res) => {
    const { grupo_id } = req.body;
    try {
        const ranking = await pool.query(
            `SELECT usuario_id FROM miembros_grupo WHERE grupo_id = $1 ORDER BY puntos_acumulados DESC`,
            [grupo_id]
        );
        
        await pool.query('DELETE FROM campeonatos WHERE grupo_id = \$1', [grupo_id]);
        for (let i = 0; i < ranking.rows.length; i++) {
            if (i < 3) {
                const puesto = i + 1;
                await pool.query(
                    'INSERT INTO campeonatos (grupo_id, usuario_id, puesto) VALUES (\$1, \$2, \$3)',
                    [grupo_id, ranking.rows[i].usuario_id, puesto]
                );
            }
        }

        await pool.query('UPDATE grupos SET estado = \$1 WHERE id = \$2', ['FINALIZADA', grupo_id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grupos/unirse', async (req, res) => {
    const { codigo_acceso, password, usuario_id } = req.body;
    try {
        const grupoRes = await pool.query('SELECT * FROM grupos WHERE codigo_acceso = \$1', [codigo_acceso]);
        if (grupoRes.rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada con ese código.' });
        const grupo = grupoRes.rows[0];

        if (grupo.tipo === 'PRIVADA' && grupo.password !== password) {
            return res.status(401).json({ error: 'Contraseña incorrecta para esta liga privada.' });
        }
        await pool.query(
            'INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES (\$1, \$2, 0) ON CONFLICT (grupo_id, usuario_id) DO NOTHING',
            [grupo.id, usuario_id]
        );
        res.json({ status: 'ok', grupoId: grupo.id, nombre: grupo.nombre });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/grupos/:id/miembros', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id as usuario_id, u.username, u.email FROM miembros_grupo mg JOIN usuarios u ON mg.usuario_id = u.id WHERE mg.grupo_id = $1`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/grupos/:grupoId/miembros/:usuarioId', async (req, res) => {
    const { grupoId, usuarioId } = req.params;
    try {
        const grupoRes = await pool.query('SELECT estado FROM grupos WHERE id = \$1', [grupoId]);
        if (grupoRes.rows.length === 0) return res.status(404).json({ error: 'Grupo no encontrado.' });
        if (grupoRes.rows[0].estado !== 'CONFIGURACION') return res.status(400).json({ error: 'La liga ya comenzó; no se pueden expulsar jugadores.' });

        await pool.query('DELETE FROM pronosticos WHERE grupo_id = \$1 AND usuario_id = \$2', [grupoId, usuarioId]);
        await pool.query('DELETE FROM miembros_grupo WHERE grupo_id = \$1 AND usuario_id = \$2', [grupoId, usuarioId]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/grupos/:id', async (req, res) => {
    const grupoId = req.params.id;
    try {
        await pool.query('DELETE FROM pronosticos WHERE grupo_id = \$1', [grupoId]);
        await pool.query('DELETE FROM miembros_grupo WHERE grupo_id = \$1', [grupoId]);
        await pool.query('DELETE FROM campeonatos WHERE grupo_id = \$1', [grupoId]);
        await pool.query('DELETE FROM grupos WHERE id = \$1', [grupoId]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grupos/resetear', async (req, res) => {
    const { grupo_id } = req.body;
    try {
        await pool.query('DELETE FROM pronosticos WHERE grupo_id = \$1', [grupo_id]);
        await pool.query('DELETE FROM campeonatos WHERE grupo_id = \$1', [grupo_id]);
        await pool.query('UPDATE miembros_grupo SET puntos_acumulados = 0 WHERE grupo_id = \$1', [grupo_id]);
        await pool.query('UPDATE grupos SET estado = \$1 WHERE id = \$2', ['CONFIGURACION', grupo_id]);
        res.json({ status: 'ok', mensaje: 'Liga reseteada por completo.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PARTIDOS ---
app.get('/api/partidos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM partidos ORDER BY fecha_juego ASC, id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partidos/crear', async (req, res) => {
    const { equipo_visitante, equipo_local, fecha_juego, hora, estadio } = req.body;
    const externalId = `man_${Date.now()}`;
    try {
        const result = await pool.query(
            'INSERT INTO partidos (external_id, equipo_visitante, equipo_local, fecha_juego, hora, estadio, estado) VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7) RETURNING id',
            [externalId, equipo_visitante, equipo_local, fecha_juego, hora, estadio, 'PENDIENTE']
        );
        res.json({ status: 'ok', partidoId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/partidos/:id', async (req, res) => {
    const { equipo_visitante, equipo_local, fecha_juego, hora, estadio } = req.body;
    try {
        await pool.query(
            'UPDATE partidos SET equipo_visitante = \$1, equipo_local = \$2, fecha_juego = \$3, hora = \$4, estadio = \$5 WHERE id = \$6',
            [equipo_visitante, equipo_local, fecha_juego, hora, estadio, req.params.id]
        );
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/partidos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pronosticos WHERE partido_id = \$1', [req.params.id]);
        await pool.query('DELETE FROM partidos WHERE id = \$1', [req.params.id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partidos/estado', async (req, res) => {
    const { partido_id, estado } = req.body;
    try {
        await pool.query('UPDATE partidos SET estado = \$1 WHERE id = \$2', [estado, partido_id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PRONÓSTICOS Y CÁLCULO ---
app.get('/api/pronosticos/:grupoId/:usuarioId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pronosticos WHERE grupo_id = \$1 AND usuario_id = \$2', [req.params.grupoId, req.params.usuarioId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/pronosticos/:grupoId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.username, p.equipo_visitante, p.equipo_local, pr.carreras_vis_pred, pr.carreras_loc_pred, p.fecha_juego
             FROM pronosticos pr
             JOIN usuarios u ON pr.usuario_id = u.id
             JOIN partidos p ON pr.partido_id = p.id
             WHERE pr.grupo_id = $1
             ORDER BY p.fecha_juego DESC, u.username ASC`,
            [req.params.grupoId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pronosticos', async (req, res) => {
    const { grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred } = req.body;
    try {
        const partidoRes = await pool.query('SELECT * FROM partidos WHERE id = \$1', [partido_id]);
        if (partidoRes.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
        if (partidoRes.rows[0].estado !== 'PENDIENTE') return res.status(400).json({ error: 'El partido está cerrado o finalizado.' });

        await pool.query(
            `INSERT INTO pronosticos (grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred) 
             VALUES ($1, $2, $3, $4, $5) 
             ON CONFLICT (grupo_id, usuario_id, partido_id) DO UPDATE SET 
             carreras_vis_pred = EXCLUDED.carreras_vis_pred, 
             carreras_loc_pred = EXCLUDED.carreras_loc_pred`,
            [grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred]
        );
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partidos/resultado', async (req, res) => {
    const { partido_id, carreras_visitante, carreras_local } = req.body;
    try {
        await pool.query('UPDATE partidos SET estado = \$1, carreras_visitante = \$2, carreras_local = \$3 WHERE id = \$4', ['FINALIZADO', carreras_visitante, carreras_local, partido_id]);

        const pronosticosRes = await pool.query('SELECT * FROM pronosticos WHERE partido_id = \$1', [partido_id]);
        const pronosticos = pronosticosRes.rows;

        for (let p of pronosticos) {
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

            await pool.query('UPDATE pronosticos SET puntos_obtenidos = \$1 WHERE id = \$2', [puntos, p.id]);
        }

        const totalesRes = await pool.query('SELECT grupo_id, usuario_id, SUM(puntos_obtenidos) as total FROM pronosticos GROUP BY grupo_id, usuario_id');
        for (let r of totalesRes.rows) {
            await pool.query('UPDATE miembros_grupo SET puntos_acumulados = \$1 WHERE grupo_id = \$2 AND usuario_id = \$3', [r.total, r.grupo_id, r.usuario_id]);
        }

        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/puntos', async (req, res) => {
    const { grupo_id, usuario_id, nuevos_puntos } = req.body;
    try {
        await pool.query(
            `INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES ($1, $2, $3) 
             ON CONFLICT (grupo_id, usuario_id) DO UPDATE SET puntos_acumulados = $3`,
            [grupo_id, usuario_id, nuevos_puntos]
        );
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint corregido con GROUP BY para evitar duplicados en la tabla de posiciones
app.get('/api/leaderboard/:grupoId', async (req, res) => {
    const grupoId = req.params.grupoId;
    const query = `
        SELECT u.id as usuario_id, u.username, 
               MAX(COALESCE(mg.puntos_acumulados, 0)) as puntos_acumulados,
               CASE WHEN MAX(g.creador_id) = u.id THEN 'CREADOR' ELSE 'MIEMBRO' END as rol 
        FROM miembros_grupo mg 
        JOIN usuarios u ON mg.usuario_id = u.id 
        JOIN grupos g ON g.id = mg.grupo_id
        WHERE mg.grupo_id = $1 
        GROUP BY u.id, u.username
        ORDER BY puntos_acumulados DESC, u.username ASC;
    `;
    try {
        const result = await pool.query(query, [grupoId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/historial/:grupoId', async (req, res) => {
    const query = `
        SELECT u.username, p.equipo_visitante, p.equipo_local, p.fecha_juego, 
               pr.carreras_vis_pred, pr.carreras_loc_pred, 
               p.carreras_visitante as real_vis, p.carreras_local as real_loc, 
               pr.puntos_obtenidos, p.estado
        FROM pronosticos pr
        JOIN usuarios u ON pr.usuario_id = u.id
        JOIN partidos p ON pr.partido_id = p.id
        WHERE pr.grupo_id = $1 AND p.estado = 'FINALIZADO'
        ORDER BY p.fecha_juego DESC, u.username ASC
    `;
    try {
        const result = await pool.query(query, [req.params.grupoId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/campeonatos/:grupoId', async (req, res) => {
    const query = `
        SELECT c.puesto, u.username, c.fecha_finalizacion
        FROM campeonatos c
        JOIN usuarios u ON c.usuario_id = u.id
        WHERE c.grupo_id = $1
        ORDER BY c.puesto ASC
    `;
    try {
        const result = await pool.query(query, [req.params.grupoId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Servidor Quiniela LVBP en http://localhost:' + PORT);
});