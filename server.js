const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');

const app = express();
app.use(express.json({ limit: '10mb' })); 
app.use(cors());
app.use(express.static(path.join(__dirname, '/')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Configuración VAPID para Web Push
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nxh8uQ';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || '1234567890abcdef1234567890abcdef1234567890a';

try {
    webpush.setVapidDetails('mailto:soporte@quinielalvbp.com', publicVapidKey, privateVapidKey);
} catch (e) {
    console.log('Aviso VAPID:', e.message);
}

const EQUIPOS_LVBP_OFICIALES = [
    "Caribes de Anzoátegui",
    "Tigres de Aragua",
    "Cardenales de Lara",
    "Bravos de Margarita",
    "Águilas del Zulia",
    "Tiburones de La Guaira",
    "Leones del Caracas",
    "Navegantes del Magallanes"
];

function normalizarNombreEquipo(nombre) {
    if (!nombre) return '';
    const n = nombre.trim().toLowerCase();
    if (n.includes('caribes')) return "Caribes de Anzoátegui";
    if (n.includes('tigres')) return "Tigres de Aragua";
    if (n.includes('cardenales')) return "Cardenales de Lara";
    if (n.includes('bravos')) return "Bravos de Margarita";
    if (n.includes('águilas') || n.includes('aguilas')) return "Águilas del Zulia";
    if (n.includes('tiburones')) return "Tiburones de La Guaira";
    if (n.includes('leones')) return "Leones del Caracas";
    if (n.includes('magallanes') || n.includes('navegantes')) return "Navegantes del Magallanes";
    return nombre.trim();
}

async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS grupos (id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, codigo_acceso TEXT UNIQUE NOT NULL, tipo TEXT DEFAULT 'PUBLICA', password TEXT DEFAULT '', estado TEXT DEFAULT 'CONFIGURACION', creador_id INTEGER REFERENCES usuarios(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS miembros_grupo (grupo_id INTEGER REFERENCES grupos(id), usuario_id INTEGER REFERENCES usuarios(id), puntos_acumulados INTEGER DEFAULT 0)`);
        
        await pool.query(`
            DELETE FROM miembros_grupo a USING miembros_grupo b
            WHERE a.ctid < b.ctid 
              AND a.grupo_id = b.grupo_id 
              AND a.usuario_id = b.usuario_id;
        `);

        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'miembros_grupo_pkey'
                ) THEN
                    ALTER TABLE miembros_grupo ADD PRIMARY KEY (grupo_id, usuario_id);
                END IF;
            END $$;
        `);

        await pool.query(`CREATE TABLE IF NOT EXISTS partidos (id SERIAL PRIMARY KEY, external_id TEXT UNIQUE, equipo_visitante TEXT NOT NULL, equipo_local TEXT NOT NULL, fecha_juego TEXT NOT NULL, hora TEXT NOT NULL, estadio TEXT, estado TEXT DEFAULT 'PENDIENTE', carreras_visitante INTEGER DEFAULT NULL, carreras_local INTEGER DEFAULT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS pronosticos (id SERIAL PRIMARY KEY, grupo_id INTEGER REFERENCES grupos(id), usuario_id INTEGER REFERENCES usuarios(id), partido_id INTEGER REFERENCES partidos(id), carreras_vis_pred INTEGER NOT NULL, carreras_loc_pred INTEGER NOT NULL, puntos_obtenidos INTEGER DEFAULT 0, UNIQUE(grupo_id, usuario_id, partido_id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS campeonatos (id SERIAL PRIMARY KEY, grupo_id INTEGER REFERENCES grupos(id), usuario_id INTEGER REFERENCES usuarios(id), puesto INTEGER NOT NULL, fecha_finalizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS standings_base (equipo TEXT PRIMARY KEY, jg_base INTEGER DEFAULT 0, jp_base INTEGER DEFAULT 0, ca_base INTEGER DEFAULT 0, cp_base INTEGER DEFAULT 0)`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS cartas_coleccionables (
            id SERIAL PRIMARY KEY,
            grupo_id INTEGER REFERENCES grupos(id),
            nombre_carta TEXT NOT NULL,
            ganador_original_id INTEGER REFERENCES usuarios(id),
            propietario_actual_id INTEGER REFERENCES usuarios(id),
            revelada BOOLEAN DEFAULT FALSE,
            imagen_url TEXT DEFAULT '',
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            usuario_id INTEGER REFERENCES usuarios(id),
            subscription TEXT NOT NULL,
            UNIQUE(usuario_id)
        )`);

        for (const eq of EQUIPOS_LVBP_OFICIALES) {
            await pool.query(`INSERT INTO standings_base (equipo, jg_base, jp_base, ca_base, cp_base) VALUES ($1, 0, 0, 0, 0) ON CONFLICT (equipo) DO NOTHING`, [eq]);
        }

        console.log('Base de datos sincronizada y blindada.');
    } catch (err) {
        console.error('Error initDB:', err.message);
    }
}
initDB();

// TAREA AUTOMÁTICA: Cierra partidos cuando faltan 30 minutos o menos (Zona Venezuela UTC-4)
setInterval(async () => {
    try {
        const ahoraEpoch = Date.now();
        const partidosRes = await pool.query("SELECT * FROM partidos WHERE estado = 'PENDIENTE'");
        
        for (const p of partidosRes.rows) {
            if (!p.fecha_juego || !p.hora) continue;

            let [anio, mes, dia] = p.fecha_juego.split('-').map(Number);
            let hora24 = p.hora;
            if (p.hora.includes('PM') || p.hora.includes('AM')) {
                const [time, modifier] = p.hora.split(' ');
                let [hours, minutes] = time.split(':').map(Number);
                if (modifier === 'PM' && hours < 12) hours += 12;
                if (modifier === 'AM' && hours === 12) hours = 0;
                hora24 = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            }

            const [matchHours, matchMinutes] = hora24.split(':').map(Number);
            const partidoEpoch = Date.UTC(anio, mes - 1, dia, matchHours + 4, matchMinutes, 0);
            const diferenciaMinutos = (partidoEpoch - ahoraEpoch) / (1000 * 60);

            if (diferenciaMinutos <= 30 && diferenciaMinutos >= -300) {
                await pool.query("UPDATE partidos SET estado = 'CERRADO' WHERE id = \$1", [p.id]);
                console.log(`[AUTOCIERRE] El partido ${p.equipo_visitante} vs ${p.equipo_local} pasó a estado CERRADO automáticamente.`);
            }
        }
    } catch (err) {
        console.error('Error en tarea automática de cierre:', err.message);
    }
}, 60 * 1000);

// TAREA AUTOMÁTICA: Notificaciones Push (2 horas antes)
setInterval(async () => {
    try {
        const ahoraEpoch = Date.now();
        const partidosRes = await pool.query("SELECT * FROM partidos WHERE estado = 'PENDIENTE'");
        
        for (const p of partidosRes.rows) {
            if (!p.fecha_juego || !p.hora) continue;
            let [anio, mes, dia] = p.fecha_juego.split('-').map(Number);
            let hora24 = p.hora;
            if (p.hora.includes('PM') || p.hora.includes('AM')) {
                const [time, modifier] = p.hora.split(' ');
                let [hours, minutes] = time.split(':').map(Number);
                if (modifier === 'PM' && hours < 12) hours += 12;
                if (modifier === 'AM' && hours === 12) hours = 0;
                hora24 = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            }
            const [matchHours, matchMinutes] = hora24.split(':').map(Number);
            const partidoEpoch = Date.UTC(anio, mes - 1, dia, matchHours + 4, matchMinutes, 0);
            const diferenciaMinutos = (partidoEpoch - ahoraEpoch) / (1000 * 60);

            if (diferenciaMinutos >= 115 && diferenciaMinutos <= 125) {
                const subsRes = await pool.query("SELECT subscription FROM push_subscriptions");
                const payload = JSON.stringify({
                    title: `⚾ ¡Recordatorio Quiniela LVBP! 🏟️`,
                    body: `Faltan 2 horas para el juego ${p.equipo_visitante} vs ${p.equipo_local}. ¡Haz tu pronóstico!`
                });

                for (const subRow of subsRes.rows) {
                    try {
                        await webpush.sendNotification(JSON.parse(subRow.subscription), payload);
                    } catch (err) {
                        console.error('Error enviando push:', err.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error en tarea push:', err.message);
    }
}, 60 * 1000);

// ENDPOINTS WEB PUSH
app.get('/api/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: publicVapidKey });
});

app.post('/api/push/subscribe', async (req, res) => {
    const { usuario_id, subscription } = req.body;
    try {
        await pool.query(
            `INSERT INTO push_subscriptions (usuario_id, subscription) VALUES ($1, $2) 
             ON CONFLICT (usuario_id) DO UPDATE SET subscription = $2`,
            [usuario_id, JSON.stringify(subscription)]
        );
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RUTAS DE RESPALDO Y RESTAURACIÓN
app.get('/api/admin/respaldo', async (req, res) => {
    try {
        const usuarios = await pool.query('SELECT * FROM usuarios');
        const grupos = await pool.query('SELECT * FROM grupos');
        const miembros = await pool.query('SELECT * FROM miembros_grupo');
        const partidos = await pool.query('SELECT * FROM partidos');
        const pronosticos = await pool.query('SELECT * FROM pronosticos');
        const campeonatos = await pool.query('SELECT * FROM campeonatos');
        const standingsBase = await pool.query('SELECT * FROM standings_base');
        const cartas = await pool.query('SELECT * FROM cartas_coleccionables');
        const subs = await pool.query('SELECT * FROM push_subscriptions');

        const respaldo = {
            fecha: new Date().toISOString(),
            usuarios: usuarios.rows,
            grupos: grupos.rows,
            miembros_grupo: miembros.rows,
            partidos: partidos.rows,
            pronosticos: pronosticos.rows,
            campeonatos: campeonatos.rows,
            standings_base: standingsBase.rows,
            cartas_coleccionables: cartas.rows,
            push_subscriptions: subs.rows
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=respaldo_quiniela_${Date.now()}.json`);
        res.status(200).send(JSON.stringify(respaldo, null, 2));
    } catch (err) {
        res.status(500).json({ error: 'Error al generar el respaldo: ' + err.message });
    }
});

app.post('/api/admin/restaurar', async (req, res) => {
    const data = req.body;
    if (!data || !data.usuarios || !data.partidos) {
        return res.status(400).json({ error: 'Archivo de respaldo inválido o incompleto.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query('DELETE FROM push_subscriptions');
        await client.query('DELETE FROM cartas_coleccionables');
        await client.query('DELETE FROM pronosticos');
        await client.query('DELETE FROM campeonatos');
        await client.query('DELETE FROM miembros_grupo');
        await client.query('DELETE FROM partidos');
        await client.query('DELETE FROM grupos');
        await client.query('DELETE FROM usuarios');
        await client.query('DELETE FROM standings_base');

        for (const u of data.usuarios) {
            await client.query(
                'INSERT INTO usuarios (id, username, email, password, fecha_registro) VALUES (\$1, \$2, \$3, \$4, \$5)',
                [u.id, u.username, u.email, u.password, u.fecha_registro]
            );
        }

        for (const g of data.grupos) {
            await client.query(
                'INSERT INTO grupos (id, nombre, codigo_acceso, tipo, password, estado, creador_id) VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7)',
                [g.id, g.nombre, g.codigo_acceso, g.tipo, g.password, g.estado, g.creador_id]
            );
        }

        for (const m of data.miembros_grupo) {
            await client.query(
                'INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES (\$1, \$2, \$3)',
                [m.grupo_id, m.usuario_id, m.puntos_acumulados]
            );
        }

        for (const p of data.partidos) {
            await client.query(
                'INSERT INTO partidos (id, external_id, equipo_visitante, equipo_local, fecha_juego, hora, estadio, estado, carreras_visitante, carreras_local) VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10)',
                [p.id, p.external_id, p.equipo_visitante, p.equipo_local, p.fecha_juego, p.hora, p.estadio, p.estado, p.carreras_visitante, p.carreras_local]
            );
        }

        for (const pr of data.pronosticos) {
            await client.query(
                'INSERT INTO pronosticos (id, grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred, puntos_obtenidos) VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7)',
                [pr.id, pr.grupo_id, pr.usuario_id, pr.partido_id, pr.carreras_vis_pred, pr.carreras_loc_pred, pr.puntos_obtenidos]
            );
        }

        if (data.campeonatos) {
            for (const c of data.campeonatos) {
                await client.query(
                    'INSERT INTO campeonatos (id, grupo_id, usuario_id, puesto, fecha_finalizacion) VALUES (\$1, \$2, \$3, \$4, \$5)',
                    [c.id, c.grupo_id, c.usuario_id, c.puesto, c.fecha_finalizacion]
                );
            }
        }

        if (data.standings_base) {
            for (const sb of data.standings_base) {
                await client.query(
                    'INSERT INTO standings_base (equipo, jg_base, jp_base, ca_base, cp_base) VALUES (\$1, \$2, \$3, \$4, \$5)',
                    [sb.equipo, sb.jg_base, sb.jp_base, sb.ca_base, sb.cp_base]
                );
            }
        }

        if (data.cartas_coleccionables) {
            for (const c of data.cartas_coleccionables) {
                await client.query(
                    'INSERT INTO cartas_coleccionables (id, grupo_id, nombre_carta, ganador_original_id, propietario_actual_id, revelada, imagen_url, fecha_creacion) VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8)',
                    [c.id, c.grupo_id, c.nombre_carta, c.ganador_original_id, c.propietario_actual_id, c.revelada, c.imagen_url || '', c.fecha_creacion]
                );
            }
        }

        if (data.push_subscriptions) {
            for (const s of data.push_subscriptions) {
                await client.query(
                    'INSERT INTO push_subscriptions (id, usuario_id, subscription) VALUES (\$1, \$2, \$3)',
                    [s.id, s.usuario_id, s.subscription]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ status: 'ok', message: 'Respaldo restaurado exitosamente.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Error al restaurar el respaldo: ' + err.message });
    } finally {
        client.release();
    }
});

// RUTAS DE CARTAS COLECCIONABLES SECRETAS
app.get('/api/cartas/:grupoId', async (req, res) => {
    try {
        const query = `
            SELECT c.*, u.username as propietario_nombre 
            FROM cartas_coleccionables c
            LEFT JOIN usuarios u ON c.propietario_actual_id = u.id
            WHERE c.grupo_id = $1
            ORDER BY c.id DESC
        `;
        const result = await pool.query(query, [req.params.grupoId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/cartas/usuario/:usuarioId', async (req, res) => {
    try {
        const query = `SELECT * FROM cartas_coleccionables WHERE propietario_actual_id = $1 AND revelada = TRUE`;
        const result = await pool.query(query, [req.params.usuarioId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cartas/crear', async (req, res) => {
    const { grupo_id, nombre_carta, ganador_original_id, imagen_url } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO cartas_coleccionables (grupo_id, nombre_carta, ganador_original_id, propietario_actual_id, revelada, imagen_url) 
             VALUES ($1, $2, $3, $3, FALSE, $4) RETURNING id`,
            [grupo_id, nombre_carta, ganador_original_id, imagen_url || '']
        );
        res.json({ status: 'ok', cartaId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cartas/revelar', async (req, res) => {
    const { carta_id, revelada } = req.body;
    try {
        await pool.query(`UPDATE cartas_coleccionables SET revelada = $1 WHERE id = $2`, [revelada, carta_id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/cartas/:id', async (req, res) => {
    try {
        await pool.query(`DELETE FROM cartas_coleccionables WHERE id = $1`, [req.params.id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cartas/transferir', async (req, res) => {
    const { carta_id, nuevo_propietario_id, usuario_actual_id } = req.body;
    try {
        const cartaRes = await pool.query(`SELECT * FROM cartas_coleccionables WHERE id = $1`, [carta_id]);
        if (cartaRes.rows.length === 0) return res.status(404).json({ error: 'Carta no encontrada.' });
        const carta = cartaRes.rows[0];

        if (carta.propietario_actual_id !== parseInt(usuario_actual_id)) {
            return res.status(403).json({ error: 'No eres el propietario actual de esta carta.' });
        }

        await pool.query(`UPDATE cartas_coleccionables SET propietario_actual_id = $1 WHERE id = $2`, [nuevo_propietario_id, carta_id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RUTAS STANDINGS: BASE MANUAL + CÁLCULO AUTOMÁTICO
app.get('/api/standings/base', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM standings_base ORDER BY equipo ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/standings/base', async (req, res) => {
    const { ajustes } = req.body;
    try {
        for (const item of ajustes) {
            const nombreOficial = normalizarNombreEquipo(item.equipo);
            await pool.query(
                `INSERT INTO standings_base (equipo, jg_base, jp_base, ca_base, cp_base) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (equipo) 
                 DO UPDATE SET jg_base = $2, jp_base = $3, ca_base = $4, cp_base = $5`,
                [nombreOficial, item.jg_base, item.jp_base, item.ca_base, item.cp_base]
            );
        }
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/standings', async (req, res) => {
    try {
        const partidosRes = await pool.query("SELECT * FROM partidos WHERE estado = 'FINALIZADO'");
        const partidos = partidosRes.rows;

        const baseRes = await pool.query('SELECT * FROM standings_base');
        const bases = baseRes.rows;

        const stats = {};

        EQUIPOS_LVBP_OFICIALES.forEach(eq => {
            stats[eq] = { equipo: eq, jg: 0, jp: 0, ca: 0, cp: 0 };
        });

        bases.forEach(b => {
            const eqNorm = normalizarNombreEquipo(b.equipo);
            if (stats[eqNorm]) {
                stats[eqNorm].jg = b.jg_base;
                stats[eqNorm].jp = b.jp_base;
                stats[eqNorm].ca = b.ca_base;
                stats[eqNorm].cp = b.cp_base;
            }
        });

        partidos.forEach(p => {
            const vis = normalizarNombreEquipo(p.equipo_visitante);
            const loc = normalizarNombreEquipo(p.equipo_local);
            const rVis = p.carreras_visitante;
            const rLoc = p.carreras_local;

            if (stats[vis]) { stats[vis].ca += rVis; stats[vis].cp += rLoc; }
            if (stats[loc]) { stats[loc].ca += rLoc; stats[loc].cp += rVis; }

            if (rVis > rLoc) {
                if (stats[vis]) stats[vis].jg += 1;
                if (stats[loc]) stats[loc].jp += 1;
            } else if (rLoc > rVis) {
                if (stats[loc]) stats[loc].jg += 1;
                if (stats[vis]) stats[vis].jp += 1;
            }
        });

        const listaFinal = Object.values(stats).map(s => {
            const jj = s.jg + s.jp;
            const ave = jj > 0 ? (s.jg / jj) : 0;
            return { equipo: s.equipo, jj, jg: s.jg, jp: s.jp, ave, ca: s.ca, cp: s.cp, dif: 0 };
        });

        listaFinal.sort((a, b) => {
            if (b.ave !== a.ave) return b.ave - a.ave;
            if (b.jg !== a.jg) return b.jg - a.jg;
            return (b.ca - b.cp) - (a.ca - a.cp);
        });

        if (listaFinal.length > 0) {
            const liderJg = listaFinal[0].jg;
            const liderJp = listaFinal[0].jp;
            listaFinal.forEach((eq, idx) => {
                if (idx === 0) {
                    eq.dif = '0';
                } else {
                    const difVal = ((liderJg - eq.jg) + (eq.jp - liderJp)) / 2;
                    eq.dif = difVal % 1 === 0 ? difVal : difVal.toFixed(1);
                }
            });
        }

        res.json(listaFinal);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RUTAS AUTH, GRUPOS, PARTIDOS, PRONÓSTICOS, ETC.
app.post('/api/auth/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const result = await pool.query('INSERT INTO usuarios (username, email, password) VALUES (\$1, \$2, \$3) RETURNING id', [username, email, password]);
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
app.put('/api/admin/usuarios/:id', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query('UPDATE usuarios SET username = $1, password = $2 WHERE id = $3', [username, password, req.params.id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(400).json({ error: 'El nombre de usuario ya está en uso o hubo un error.' });
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
        await pool.query('DELETE FROM push_subscriptions WHERE usuario_id = \$1', [userId]);
        await pool.query('DELETE FROM cartas_coleccionables WHERE ganador_original_id = \$1 OR propietario_actual_id = \$1', [userId]);
        await pool.query('DELETE FROM pronosticos WHERE usuario_id = \$1', [userId]);
        await pool.query('DELETE FROM miembros_grupo WHERE usuario_id = \$1', [userId]);
        await pool.query('DELETE FROM campeonatos WHERE usuario_id = \$1', [userId]);
        await pool.query('DELETE FROM usuarios WHERE id = \$1', [userId]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
        await pool.query('INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES (\$1, \$2, 0) ON CONFLICT (grupo_id, usuario_id) DO NOTHING', [grupoId, creador_id]);
        res.json({ status: 'ok', grupoId, codigo });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grupos/estado', async (req, res) => {
    const { grupo_id, estado } = req.body;
    try {
        await pool.query('UPDATE grupos SET estado = \$1 WHERE id = \$2', [estado, grupo_id]);
        
        if (estado === 'FINALIZADA') {
            const liderRes = await pool.query(`
                SELECT usuario_id FROM miembros_grupo 
                WHERE grupo_id = $1 
                ORDER BY puntos_acumulados DESC LIMIT 1
            `, [grupo_id]);
            
            if (liderRes.rows.length > 0) {
                const ganadorId = liderRes.rows[0].usuario_id;
                await pool.query(
                    `INSERT INTO campeonatos (grupo_id, usuario_id, puesto) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
                    [grupo_id, ganadorId]
                );
            }
        }

        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grupos/unirse', async (req, res) => {
    const { codigo_acceso, password, usuario_id } = req.body;
    try {
        const grupoRes = await pool.query('SELECT * FROM grupos WHERE codigo_acceso = $1', [codigo_acceso]);
        if (grupoRes.rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada con ese código.' });
        const grupo = grupoRes.rows[0];

        if (grupo.estado === 'EN_PROGRESO' || grupo.estado === 'FINALIZADA') {
            return res.status(400).json({ error: 'No te puedes unir a una liga que ya está en progreso o finalizada.' });
        }

        if (grupo.tipo === 'PRIVADA' && grupo.password !== password) {
            return res.status(401).json({ error: 'Contraseña incorrecta para esta liga privada.' });
        }
        await pool.query(
            'INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES ($1, \$2, 0) ON CONFLICT (grupo_id, usuario_id) DO NOTHING',
            [grupo.id, usuario_id]
        );
        res.json({ status: 'ok', grupoId: grupo.id, nombre: grupo.nombre });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/grupos/:id/miembros', async (req, res) => {
    try {
        const result = await pool.query(`SELECT u.id as usuario_id, u.username, u.email FROM miembros_grupo mg JOIN usuarios u ON mg.usuario_id = u.id WHERE mg.grupo_id = $1`, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/grupos/:grupoId/miembros/:usuarioId', async (req, res) => {
    const { grupoId, usuarioId } = req.params;
    try {
        await pool.query('DELETE FROM pronosticos WHERE grupo_id = $1 AND usuario_id = $2', [grupoId, usuarioId]);
        await pool.query('DELETE FROM miembros_grupo WHERE grupo_id = $1 AND usuario_id = $2', [grupoId, usuarioId]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/grupos/:id', async (req, res) => {
    const grupoId = req.params.id;
    try {
        await pool.query('DELETE FROM cartas_coleccionables WHERE grupo_id = $1', [grupoId]);
        await pool.query('DELETE FROM pronosticos WHERE grupo_id = $1', [grupoId]);
        await pool.query('DELETE FROM miembros_grupo WHERE grupo_id = $1', [grupoId]);
        await pool.query('DELETE FROM campeonatos WHERE grupo_id = $1', [grupoId]);
        await pool.query('DELETE FROM grupos WHERE id = $1', [grupoId]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/partidos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM partidos ORDER BY fecha_juego DESC, id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partidos/crear', async (req, res) => {
    const { equipo_visitante, equipo_local, fecha_juego, hora, estadio } = req.body;
    const externalId = `man_${Date.now()}`;
    try {
        const result = await pool.query('INSERT INTO partidos (external_id, equipo_visitante, equipo_local, fecha_juego, hora, estadio, estado) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [externalId, equipo_visitante, equipo_local, fecha_juego, hora, estadio, 'PENDIENTE']);
        res.json({ status: 'ok', partidoId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/partidos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pronosticos WHERE partido_id = $1', [req.params.id]);
        await pool.query('DELETE FROM partidos WHERE id = $1', [req.params.id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partidos/estado', async (req, res) => {
    const { partido_id, estado } = req.body;
    try {
        await pool.query('UPDATE partidos SET estado = $1 WHERE id = $2', [estado, partido_id]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pronosticos/:grupoId/:usuarioId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pronosticos WHERE grupo_id = $1 AND usuario_id = $2', [req.params.grupoId, req.params.usuarioId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pronosticos/partido/:grupoId/:partidoId', async (req, res) => {
    const { grupoId, partidoId } = req.params;
    try {
        const query = `
            SELECT u.username, pr.carreras_vis_pred, pr.carreras_loc_pred, pr.puntos_obtenidos
            FROM miembros_grupo mg
            JOIN usuarios u ON mg.usuario_id = u.id
            LEFT JOIN pronosticos pr ON pr.usuario_id = u.id AND pr.partido_id = $2 AND pr.grupo_id = $1
            WHERE mg.grupo_id = $1
            ORDER BY u.username ASC;
        `;
        const result = await pool.query(query, [grupoId, partidoId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pronosticos', async (req, res) => {
    const { grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred } = req.body;
    try {
        await pool.query(`INSERT INTO pronosticos (grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (grupo_id, usuario_id, partido_id) DO UPDATE SET carreras_vis_pred = EXCLUDED.carreras_vis_pred, carreras_loc_pred = EXCLUDED.carreras_loc_pred`, [grupo_id, usuario_id, partido_id, carreras_vis_pred, carreras_loc_pred]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/partidos/resultado', async (req, res) => {
    const { partido_id, carreras_visitante, carreras_local } = req.body;
    try {
        await pool.query('UPDATE partidos SET estado = $1, carreras_visitante = $2, carreras_local = $3 WHERE id = $4', ['FINALIZADO', carreras_visitante, carreras_local, partido_id]);
        
        const pronosticosRes = await pool.query('SELECT * FROM pronosticos WHERE partido_id = $1', [partido_id]);

        for (let p of pronosticosRes.rows) {
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
            await pool.query('UPDATE pronosticos SET puntos_obtenidos = $1 WHERE id = $2', [puntos, p.id]);
        }

        const totalesRes = await pool.query(`
            SELECT grupo_id, usuario_id, SUM(puntos_obtenidos) as total 
            FROM pronosticos 
            WHERE grupo_id IN (SELECT DISTINCT grupo_id FROM pronosticos WHERE partido_id = $1)
            GROUP BY grupo_id, usuario_id
        `, [partido_id]);

        for (let r of totalesRes.rows) {
            await pool.query(
                'UPDATE miembros_grupo SET puntos_acumulados = $1 WHERE grupo_id = $2 AND usuario_id = $3', 
                [r.total, r.grupo_id, r.usuario_id]
            );
        }

        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/puntos', async (req, res) => {
    const { grupo_id, usuario_id, nuevos_puntos } = req.body;
    try {
        await pool.query('INSERT INTO miembros_grupo (grupo_id, usuario_id, puntos_acumulados) VALUES ($1, $2, $3) ON CONFLICT (grupo_id, usuario_id) DO UPDATE SET puntos_acumulados = $3', [grupo_id, usuario_id, nuevos_puntos]);
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/leaderboard/:grupoId', async (req, res) => {
    const grupoId = req.params.grupoId;
    const query = `
        SELECT u.id as usuario_id, u.username, 
               COALESCE(mg.puntos_acumulados, 0) as puntos_acumulados,
               COUNT(CASE WHEN pr.puntos_obtenidos = 6 THEN 1 END) as aciertos_directos,
               CASE WHEN MAX(g.creador_id) = u.id THEN 'CREADOR' ELSE 'MIEMBRO' END as rol 
        FROM miembros_grupo mg 
        JOIN usuarios u ON mg.usuario_id = u.id 
        JOIN grupos g ON g.id = mg.grupo_id
        LEFT JOIN pronosticos pr ON pr.usuario_id = u.id AND pr.grupo_id = mg.grupo_id
        WHERE mg.grupo_id = $1 
        GROUP BY u.id, u.username, mg.puntos_acumulados
        ORDER BY puntos_acumulados DESC, aciertos_directos DESC, u.username ASC;
    `;
    try {
        const result = await pool.query(query, [grupoId]);
        const unicos = [];
        const idsVistos = new Set();
        for (const row of result.rows) {
            if (!idsVistos.has(row.usuario_id)) {
                idsVistos.add(row.usuario_id);
                unicos.push(row);
            }
        }
        res.json(unicos);
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
    console.log('Servidor en puerto ' + PORT);
});