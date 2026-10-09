// api/index.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { put } = require('@vercel/blob'); // 👈 Vercel Blob
const { attachDatabasePool } = require('@vercel/functions');

const app = express();
const SECRET_KEY = process.env.JWT_SECRET || "mi_clave_secreta_jwt";

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- POOL DE CONEXIONES (compatible con Vercel) ----------
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
    idleTimeout: 60000
});

attachDatabasePool(pool);

const db = pool.promise();

// ---------- MULTER: memoria (el archivo se sube a Vercel Blob) ----------
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 } // 4 MB (límite de Vercel Functions es 4.5 MB)
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
        const sql = "INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)";
        await db.query(sql, [nombre, email, hash, rol || "Usuario"]);
        res.json({ mensaje: "Usuario registrado con éxito" });
    } catch (error) {
        console.error("Error en /registro:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const [resultado] = await db.query("SELECT * FROM usuarios WHERE email = ?", [email]);

        if (resultado.length === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        const usuario = resultado[0];
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
        const [resultado] = await db.query(
            "SELECT id, nombre, email, rol FROM usuarios WHERE id = ?",
            [usuarioId]
        );

        if (resultado.length === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }
        res.json(resultado[0]);
    } catch (error) {
        console.error("Error en /perfil:", error);
        res.status(500).json({ error: error.message });
    }
});

// ========== CATEGORÍAS ==========

app.get("/categorias", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM categorias");
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

        if (buscar) {
            sql += " AND i.descripcion LIKE ?";
            parametros.push(`%${buscar}%`);
        }
        if (categoria_id) {
            sql += " AND i.categoria_id = ?";
            parametros.push(categoria_id);
        }
        if (estado) {
            sql += " AND i.estado = ?";
            parametros.push(estado);
        }
        sql += " ORDER BY i.fecha DESC";

        const [rows] = await db.query(sql, parametros);
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
            sql += " AND DATE(i.fecha) BETWEEN ? AND ?";
            parametros.push(fecha_inicio, fecha_fin);
        }
        sql += " ORDER BY i.fecha DESC";

        const [rows] = await db.query(sql, parametros);
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
        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (error) {
        console.error("Error en /incidencias/resueltas:", error);
        res.status(500).json({ error: error.message });
    }
});

// ========== POST /incidencias con Vercel Blob ==========
app.post("/incidencias", upload.single("imagen"), async (req, res) => {
    try {
        const { categoria_id, descripcion, usuario_id } = req.body;
        let imagenUrl = null;

        // Si se subió una imagen, la enviamos a Vercel Blob
        if (req.file) {
            const nombreArchivo = `incidencias/${Date.now()}-${req.file.originalname}`;

            const blob = await put(nombreArchivo, req.file.buffer, {
                access: 'public',
                contentType: req.file.mimetype
            });

            imagenUrl = blob.url; // URL pública en la CDN de Vercel
        }

        const sql = "INSERT INTO incidencias (usuario_id, categoria_id, descripcion, imagen) VALUES (?, ?, ?, ?)";
        const [resultado] = await db.query(sql, [
            usuario_id || null,
            categoria_id,
            descripcion,
            imagenUrl
        ]);

        res.json({
            mensaje: "Incidencia registrada correctamente",
            id: resultado.insertId,
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
        await db.query("UPDATE incidencias SET estado = ? WHERE id = ?", [estado, id]);
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
        await db.query("DELETE FROM incidencias WHERE id = ?", [id]);
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
            SELECT c.nombre AS categoria, COUNT(i.id) AS total
            FROM categorias c
            LEFT JOIN incidencias i ON c.id = i.categoria_id
            GROUP BY c.id, c.nombre
        `;
        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (error) {
        console.error("Error en /estadisticas/categorias:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/estadisticas/estados", async (req, res) => {
    try {
        const sql = `
            SELECT estado, COUNT(id) AS total
            FROM incidencias
            GROUP BY estado
        `;
        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (error) {
        console.error("Error en /estadisticas/estados:", error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- NO usar app.listen en Vercel ----------
module.exports = app;