// api/index.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require("express");
const { Pool } = require("pg");             
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { put } = require('@vercel/blob');
const { attachDatabasePool } = require('@vercel/functions');

const app = express();
const SECRET_KEY = process.env.JWT_SECRET || "mi_clave_secreta_jwt";

// ---------- POOL DE CONEXIONES (PostgreSQL / Neon) ----------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,                       
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
});

attachDatabasePool(pool);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- MULTER: memoria (el archivo se sube a Vercel Blob) ----------
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 } // 4 MB
});

// ---------- MIDDLEWARE JWT ----------
const verificarToken = (req, res, next) => {
    const token = req.headers["authorization"];
    if (!token) return res.status(403).json({ mensaje: "Token no proporcionado" });

    jwt.verify(token.replace("Bearer ", ""), SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ mensaje: "Token inválido o expirado" });
        req.usuario = decoded;
        next();
    });
};

// ========== AUTENTICACIÓN Y PERFIL ==========

app.post("/registro", async (req, res) => {
    try {
        const { nombre, email, password, rol } = req.body;
        const hash = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)";
        await pool.query(sql, [nombre, email, hash, rol || "Usuario"]);
        res.json({ mensaje: "Usuario registrado con éxito" });
    } catch (error) {
        console.error("Error en /registro:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const { rows } = await pool.query(
            "SELECT * FROM usuarios WHERE email = $1",
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        const usuario = rows[0];
        const passwordValida = await bcrypt.compare(password, usuario.password);

        if (!passwordValida) {
            return res.status(401).json({ mensaje: "Contraseña incorrecta" });
        }

        const token = jwt.sign(
            { id: usuario.id, rol: usuario.rol },
            SECRET_KEY,
            { expiresIn: "8h" }
        );

        res.json({
            mensaje: "Inicio de sesión exitoso",
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol
            }
        });
    } catch (error) {
        console.error("Error en /login:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/perfil", verificarToken, async (req, res) => {
    try {
        const usuarioId = req.usuario.id;
        const { rows } = await pool.query(
            "SELECT id, nombre, email, rol FROM usuarios WHERE id = $1",
            [usuarioId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("Error en /perfil:", error);
        res.status(500).json({ error: error.message });
    }
});

// ========== CATEGORÍAS ==========

app.get("/categorias", async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM categorias ORDER BY id");
        res.json(rows);
    } catch (error) {
        console.error("Error en /categorias:", error);
        res.status(500).json({ error: error.message });
    }
});

// ========== INCIDENCIAS ==========

app.get("/incidencias", async (req, res) => {
    try {
        const { buscar, categoria_id, estado } = req.query;
        let sql = `
            SELECT i.id, i.descripcion, i.estado, i.fecha, i.imagen, c.nombre AS categoria
            FROM incidencias i
            JOIN categorias c ON i.categoria_id = c.id
            WHERE 1=1
        `;
        const parametros = [];
        let idx = 1;

        if (buscar) {
            sql += ` AND i.descripcion ILIKE $${idx++}`;
            parametros.push(`%${buscar}%`);
        }
        if (categoria_id) {
            sql += ` AND i.categoria_id = $${idx++}`;
            parametros.push(categoria_id);
        }
        if (estado) {
            sql += ` AND i.estado = $${idx++}`;
            parametros.push(estado);
        }
        sql += " ORDER BY i.fecha DESC";

        const { rows } = await pool.query(sql, parametros);
        res.json(rows);
    } catch (error) {
        console.error("Error en GET /incidencias:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/incidencias/exportar", async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        let sql = `
            SELECT i.id, i.descripcion, i.estado, i.fecha, c.nombre AS categoria
            FROM incidencias i
            JOIN categorias c ON i.categoria_id = c.id
            WHERE 1=1
        `;
        const parametros = [];

        if (fecha_inicio && fecha_fin) {
            sql += " AND i.fecha::date BETWEEN $1::date AND $2::date";
            parametros.push(fecha_inicio, fecha_fin);
        }
        sql += " ORDER BY i.fecha DESC";

        const { rows } = await pool.query(sql, parametros);
        res.json(rows);
    } catch (error) {
        console.error("Error en /incidencias/exportar:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/incidencias/resueltas", async (req, res) => {
    try {
        const sql = `
            SELECT i.id, i.descripcion, i.estado, i.fecha, i.imagen, c.nombre AS categoria
            FROM incidencias i
            JOIN categorias c ON i.categoria_id = c.id
            WHERE i.estado = 'Resuelto'
            ORDER BY i.fecha DESC
        `;
        const { rows } = await pool.query(sql);
        res.json(rows);
    } catch (error) {
        console.error("Error en /incidencias/resueltas:", error);
        res.status(500).json({ error: error.message });
    }
});

// ========== POST /incidencias con Vercel Blob ==========
app.post("/incidencias", upload.single("imagen"), async (req, res) => {
    try {
        // Diagnóstico temporal para Vercel Logs
        console.log("¿Token de Blob detectado?:", process.env.BLOB_READ_WRITE_TOKEN ? "SÍ" : "NO");

        const { categoria_id, descripcion, usuario_id } = req.body;
        let imagenUrl = null;

        if (req.file) {
            const nombreArchivo = `incidencias/${Date.now()}-${req.file.originalname}`;

            // 👇 AQUI ESTÁ LA CORRECCIÓN: Pasamos el token explícitamente
            const blob = await put(nombreArchivo, req.file.buffer, {
                access: 'public',
                contentType: req.file.mimetype,
                token: process.env.BLOB_READ_WRITE_TOKEN
            });

            imagenUrl = blob.url;
        }

        const sql = `
            INSERT INTO incidencias (usuario_id, categoria_id, descripcion, imagen)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `;
        const { rows } = await pool.query(sql, [
            usuario_id || null,
            categoria_id,
            descripcion,
            imagenUrl
        ]);

        res.json({
            mensaje: "Incidencia registrada correctamente",
            id: rows[0].id,
            imagen: imagenUrl
        });
    } catch (error) {
        console.error("Error en POST /incidencias:", error);
        res.status(500).json({ error: error.message });
    }
});

app.put("/incidencias/:id/estado", verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        await pool.query(
            "UPDATE incidencias SET estado = $1 WHERE id = $2",
            [estado, id]
        );
        res.json({ mensaje: "Estado actualizado correctamente" });
    } catch (error) {
        console.error("Error en PUT /incidencias/:id/estado:", error);
        res.status(500).json({ error: error.message });
    }
});

app.delete("/incidencias/:id", verificarToken, async (req, res) => {
    try {
        if (req.usuario.rol !== "Admin") {
            return res.status(403).json({ mensaje: "Acceso denegado: Requiere rol Admin" });
        }
        const { id } = req.params;
        await pool.query("DELETE FROM incidencias WHERE id = $1", [id]);
        res.json({ mensaje: "Incidencia eliminada correctamente" });
    } catch (error) {
        console.error("Error en DELETE /incidencias/:id:", error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ESTADÍSTICAS ==========

app.get("/estadisticas/categorias", async (req, res) => {
    try {
        const sql = `
            SELECT c.nombre AS categoria, COUNT(i.id)::int AS total
            FROM categorias c
            LEFT JOIN incidencias i ON c.id = i.categoria_id
            GROUP BY c.id, c.nombre
            ORDER BY c.id
        `;
        const { rows } = await pool.query(sql);
        res.json(rows);
    } catch (error) {
        console.error("Error en /estadisticas/categorias:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/estadisticas/estados", async (req, res) => {
    try {
        const sql = `
            SELECT estado, COUNT(id)::int AS total
            FROM incidencias
            GROUP BY estado
        `;
        const { rows } = await pool.query(sql);
        res.json(rows);
    } catch (error) {
        console.error("Error en /estadisticas/estados:", error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- NO usar app.listen en Vercel ----------
module.exports = app;