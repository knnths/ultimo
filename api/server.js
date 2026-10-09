// api/index.js
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require("express");
const mysql = require("mysql2"); // ✅ Usamos 'mysql2', no 'mysql2/promise'
const cors = require("cors");
const { attachDatabasePool } = require('@vercel/functions');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Creamos el pool con 'mysql2' estándar
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    waitForConnections: true,
    connectionLimit: 2, // Mantenemos el límite bajo para Clever Cloud
    queueLimit: 0,
    idleTimeout: 60000 // El valor por defecto para MySQL2 según Vercel
});

// 2. Adjuntamos el pool de 'mysql2' a Vercel. ¡Ahora sí funcionará!
attachDatabasePool(pool);

// --- Rutas de la API (usando async/await con el pool de callbacks) ---

app.get("/categorias", async (req, res) => {
    try {
        // Obtenemos una conexión del pool
        const connection = await pool.promise().getConnection();
        try {
            const [rows] = await connection.query("SELECT * FROM categorias");
            res.json(rows);
        } finally {
            // ¡Importante! Siempre liberar la conexión
            connection.release();
        }
    } catch (error) {
        console.error("Error al obtener categorías:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post("/incidencias", async (req, res) => {
    const { categoria_id, descripcion } = req.body;
    const sql = "INSERT INTO incidencias(categoria_id, descripcion) VALUES (?, ?)";
    try {
        const connection = await pool.promise().getConnection();
        try {
            await connection.query(sql, [categoria_id, descripcion]);
            res.json({ mensaje: "Incidencia registrada correctamente" });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("Error al registrar incidencia:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = app;