// api/index.js
const express = require("express");
const mysql = require("mysql2/promise"); // Usamos la versión con Promesas
const cors = require("cors");
const { attachDatabasePool } = require('@vercel/functions');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Creamos un "Pool" de conexiones en lugar de una conexión única.
//    Esto permite reutilizar conexiones y es la clave para el rendimiento en serverless.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    waitForConnections: true,
    // 2. Ajustamos el límite para no exceder el máximo de Clever Cloud.
    //    Con un límite de 2, nos aseguramos de no superar las 5 conexiones
    //    incluso si Vercel escala a múltiples instancias.
    connectionLimit: 2, 
    queueLimit: 0,
    // Es una buena práctica cerrar las conexiones inactivas rápidamente.
    idleTimeout: 5000 
});

// 3. Adjuntamos el pool al helper de Vercel.
//    Esto permite que Vercel gestione el ciclo de vida de las conexiones
//    de forma eficiente, evitando fugas de conexiones en un entorno serverless.
attachDatabasePool(pool);

// --- Rutas de la API ---
// Se utiliza async/await para un código más limpio y manejo de errores.
app.get("/categorias", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM categorias");
        res.json(rows);
    } catch (error) {
        console.error("Error al obtener categorías:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post("/incidencias", async (req, res) => {
    const { categoria_id, descripcion } = req.body;
    const sql = "INSERT INTO incidencias(categoria_id, descripcion) VALUES (?, ?)";
    try {
        await pool.query(sql, [categoria_id, descripcion]);
        res.json({ mensaje: "Incidencia registrada correctamente" });
    } catch (error) {
        console.error("Error al registrar incidencia:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// 4. Exportamos la app para que Vercel la use como Serverless Function.
//    Es crucial NO usar app.listen() en este entorno.
module.exports = app;