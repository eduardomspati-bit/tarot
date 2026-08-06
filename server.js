const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

const corsOptions = {
    origin: [
        'https://tarotia-app-psi.github.io',
        'http://localhost:3000',
        'http://127.0.0.1:5500'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// 1. CONEXIÓN A MONGODB ATLAS
// ==========================================
const MONGO_URI = process.env.MONGO_URI;

if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('🔮 Conectado exitosamente a MongoDB Atlas'))
        .catch(err => console.error('❌ Error de conexión a MongoDB:', err.message));
} else {
    console.warn('⚠️ MONGO_URI no está configurada en las variables de entorno.');
}

// ==========================================
// 2. MODELO DE DATOS
// ==========================================
const UsuarioSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    plan: { type: String, enum: ['Gratis', 'Premium'], default: 'Gratis' },
    totalTiradas: { type: Number, default: 0 },
    ultimaConexion: { type: String, default: () => new Date().toISOString().split('T')[0] }
}, { timestamps: true });

const Usuario = mongoose.models.Usuario || mongoose.model('Usuario', UsuarioSchema);

const MODEL_NAME = "qwen/qwen3.6-27b";
const API_KEY = process.env.GROQ_API_KEY || process.env.API_KEY;

// ==========================================
// FUNCIÓN AUXILIAR: LIMPIAR RAZONAMIENTO
// ==========================================
function limpiarRazonamiento(texto) {
    if (!texto) return "";
    
    // Corregido: Limpieza de etiquetas de pensamiento o bloques
    texto = texto.replace(/`thinking`[\s\S]*?`/gi, "");
    texto = texto.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
    texto = texto.replace(/Here['']s a thinking process:[\s\S]*?(?=<div|<p|<ul|<h)/gi, "");
    texto = texto.replace(/```html/gi, "").replace(/```/g, "").replace(/^html\s*/i, "").trim();
    
    return texto;
}

// ==========================================
// 3. ENDPOINT PRINCIPAL DE TIRADAS DE TAROT
// ==========================================
app.post('/tirada', async (req, res) => {
    const { tema, a, b, c, d, estilo = 'filosofico', pregunta } = req.body;

    try {
        if (!a || !b || !c || !d) {
            return res.status(400).json({ error: "Faltan cartas para realizar la tirada." });
        }

        let promptSistema = "";

        if (estilo === 'manual') {
            promptSistema = `Actúa como un diccionario técnico de Tarot. Responde ÚNICAMENTE con el código HTML solicitado. Prohibido incluir notas, explicaciones previas o razonamientos.

Estructura HTML obligatoria:
<div class="reading-section">
    <h3>🌿 Dupla 1: ${a} + ${b}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado práctico]</li>
        <li><strong>Significado 2:</strong> [Significado práctico]</li>
        <li><strong>Significado 3:</strong> [Significado práctico]</li>
    </ul>
</div>
<div class="reading-section">
    <h3>🌿 Dupla 2: ${c} + ${d}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado práctico]</li>
        <li><strong>Significado 2:</strong> [Significado práctico]</li>
        <li><strong>Significado 3:</strong> [Significado práctico]</li>
    </ul>
</div>`;
        } else {
            let personalidad = (estilo === 'morgana' || estilo === 'magico')
                ? "Eres Morgana, una experta y asertiva lectora de Tarot Rider-Waite. Tu tono es directo, místico y predictivo."
                : "Eres un terapeuta y experto lector de Tarot Evolutivo. Tu tono es empático, reflexivo y psicológico.";

            promptSistema = `${personalidad}
Tu objetivo es analizar la combinación de la Dupla 1 (${a} y ${b}) junto a la Dupla 2 (${c} y ${d}) para ofrecer las predicciones y la conclusión final.

REGLAS CRÍTICAS: 
1. NO redactes secciones de pasado ni presente.
2. NO uses listas, viñetas, guiones ni asteriscos (*).
3. Responde DIRECTA Y EXCLUSIVAMENTE en este formato HTML, comenzando en <div class="reading-section">:

<div class="reading-section">
    <h3>🔮 Predicciones del Oráculo</h3>
    <p>[Redacta de 2 a 3 predicciones concretas y directas basadas en las 4 cartas en un solo párrafo fluido.]</p>
</div>

<div class="reading-section">
    <h3>✨ Consejo y Conclusión</h3>
    <p><span id="conclusion">[Frase clara de cierre y consejo práctico para el consultante.]</span></p>
</div>`;
        }

        const promptUsuario = (tema === 'Pregunta Específica' && pregunta)
            ? `Pregunta específica: "${pregunta}". Cartas en mesa: ${a}, ${b}, ${c} y ${d}.`
            : `Tema general: ${tema}. Cartas en mesa: ${a}, ${b}, ${c} y ${d}.`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: "system", content: promptSistema },
                    { role: "user", content: promptUsuario }
                ],
                temperature: estilo === 'manual' ? 0.2 : 0.6,
                max_tokens: 2000,
                reasoning_format: "hidden"
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            console.error("❌ Error de Groq API:", data);
            return res.status(500).json({ error: "Respuesta incompleta de Groq." });
        }

        let rawText = data.choices[0].message.content || "";

        // 🛡️ EXTRACCIÓN Y LIMPIEZA ROBUTA
        let htmlLimpio = "";
        
        // 1. Eliminar etiquetas de razonamiento
        rawText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "");
        rawText = rawText.replace(/`thinking`[\s\S]*?`/gi, "");

        // 2. Buscar si existe la estructura <div>
        const primerDiv = rawText.indexOf("<div");
        if (primerDiv !== -1) {
            htmlLimpio = rawText.substring(primerDiv);
        } else {
            htmlLimpio = rawText;
        }

        // 3. Limpiar etiquetas markdown de código
        htmlLimpio = htmlLimpio.replace(/```html/gi, "").replace(/```/g, "").trim();

        // 4. FALLBACK: Si por alguna razón la IA dejó el string vacío, devolvemos un mensaje de contingencia
        if (!htmlLimpio) {
            console.warn("⚠️ La respuesta procesada quedó vacía. Usando texto crudo de respaldo.");
            htmlLimpio = `<div class="reading-section"><h3>🔮 Predicción</h3><p>${rawText || "Las cartas se mantienen en silencio en este momento. Intenta formular tu pregunta nuevamente."}</p></div>`;
        }

        // Se garantiza responder con la propiedad 'lectura'
        res.json({ lectura: htmlLimpio });

    } catch (error) {
        console.error("💥 Error en /tirada:", error);
        res.status(500).json({ error: "Error en el servidor místico", detalles: error.message });
    }
});
// ==========================================
// 5. REGISTRO Y ACTUALIZACIÓN ATÓMICA DE USUARIO
// ==========================================
app.post('/api/usuarios/registrar', async (req, res) => {
    const { nombre, email } = req.body;
    if (!email) return res.status(400).json({ error: "El email es requerido." });

    try {
        const hoy = new Date().toISOString().split('T')[0];
        const usuario = await Usuario.findOneAndUpdate(
            { email },
            { 
                $inc: { totalTiradas: 1 },
                $set: { ultimaConexion: hoy },
                $setOnInsert: { nombre: nombre || 'Consultante Místico', plan: 'Gratis' }
            },
            { new: true, upsert: true }
        );

        return res.json({ mensaje: 'Usuario registrado/actualizado', usuario });
    } catch (error) {
        console.error("❌ Error al registrar usuario:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("🚀 SERVIDOR MÍSTICO CORRIENDO EN PUERTO " + PORT);
});
