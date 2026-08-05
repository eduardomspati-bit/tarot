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
            promptSistema = `Actúa como un diccionario técnico, objetivo y neutral de Tarot.
Tu tarea exclusiva es analizar las dos duplas de cartas que te presenta el usuario:
- Dupla 1: ${a} y ${b}
- Dupla 2: ${c} y ${d}

Para cada dupla, debes proporcionar de 3 a 4 posibles interpretaciones o significados prácticos y objetivos de su combinación.
Reglas estrictas que debes cumplir:
1. No redactes párrafos largos de narrativa poética o mística.
2. No des consejos directos al consultante.
3. Mantén un tono neutro, analítico e instructivo.
4. ESTÁ TERMINANTEMENTE PROHIBIDO relacionar la Dupla 1 con la Dupla 2. Analízalas por separado.

Devuelve la respuesta estructurada ESTRICTAMENTE en formato HTML de la siguiente manera:

<div class="reading-section">
    <h3>🌿 Dupla 1: ${a} + ${b}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado práctico y objetivo breve]</li>
        <li><strong>Significado 2:</strong> [Significado práctico y objetivo breve]</li>
        <li><strong>Significado 3:</strong> [Significado práctico y objetivo breve]</li>
    </ul>
</div>

<div class="reading-section">
    <h3>🌿 Dupla 2: ${c} + ${d}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado práctico y objetivo breve]</li>
        <li><strong>Significado 2:</strong> [Significado práctico y objetivo breve]</li>
        <li><strong>Significado 3:</strong> [Significado práctico y objetivo breve]</li>
    </ul>
</div>`;
        } else {
            let instruccionesPersonalidad = (estilo === 'morgana' || estilo === 'magico')
                ? "Eres Morgana, una experta, asertiva y ancestral lectora de Tarot Rider-Waite, especializada en un método predictivo de lectura por duplas. Tu tono debe ser místico, seguro, directo, terrenal y al grano. Ofreces consejos prácticos y predictivos."
                : "Eres un terapeuta y experto lector de Tarot Rider-Waite enfocado en el Tarot Terapéutico, Psicológico y Evolutivo. Tu tono debe ser reflexivo, psicológico, empático, constructivo y reconfortante.";

            const reglasFormato = `
Evita palabras demasiado rebuscadas. NO uses listas, viñetas, guiones ni asteriscos (*).

Estructura siguiendo estas reglas:
1. La primera dupla representa el ESTADO ACTUAL o el PASADO INMEDIATO.
2. La segunda dupla representa el FUTURO A CORTO O MEDIANO PLAZO.
3. En base a este viaje, arriesga 2 o 3 PREDICCIONES o REVELACIONES CONCRETAS.

Devuelve la respuesta EXACTAMENTE en este formato HTML:

<div class="reading-section">
    <h3>El Presente y Origen (${a} + ${b})</h3>
    <p>[Interpretación de la primera dupla en base al tema]</p>
</div>

<div class="reading-section">
    <h3>El Camino hacia el Futuro (${c} + ${d})</h3>
    <p>[Interpretación de la segunda dupla]</p>
</div>

<div class="reading-section">
    <h3>Predicciones del Oráculo</h3>
    <p>[Revelaciones o predicciones concretas en un párrafo corrido]</p>
</div>

<div class="reading-section">
    <h3>Consejo y Conclusión</h3>
    <p><span id="conclusion">[Frase inspiradora y consejo final]</span></p>
</div>`;

            promptSistema = instruccionesPersonalidad + reglasFormato;
        }
        
        const promptUsuario = (tema === 'Pregunta Específica' && pregunta)
            ? `El consultante tiene una PREGUNTA ESPECÍFICA: "${pregunta}". Orientá tu análisis a responder directamente a esa duda. Las cartas seleccionadas son: ${a}, ${b}, ${c} y ${d}.`
            : `Realiza la lectura sobre el tema general: ${tema}. Las cartas seleccionadas son: ${a}, ${b}, ${c} y ${d}.`;

        if (!API_KEY) {
            console.error("❌ ERROR: Variable de entorno de API Key no configurada.");
            return res.status(500).json({ error: "No se encontró la configuración de clave de API en el servidor." });
        }

        // Uso de fetch nativo de Node.js
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: "system", content: promptSistema },
                    { role: "user", content: promptUsuario }
                ],
                temperature: estilo === 'manual' ? 0.3 : 0.7,
                reasoning_format: "hidden"
            })
        });

        const data = await response.json();
        
        if (!response.ok || !data.choices || data.choices.length === 0) {
            console.error("❌ Error devuelto por Groq API:", data);
            return res.status(response.status || 500).json({ 
                error: "Respuesta incompleta de Groq", 
                detalle: data.error?.message || "Respuesta inválida" 
            });
        }

        let text = limpiarRazonamiento(data.choices[0].message.content || "");
        res.json({ lectura: text });

    } catch (error) {
        console.error("💥 Error en endpoint /tirada:", error);
        res.status(500).json({ error: "Error en el servidor místico", detalles: error.message });
    }
});

// ==========================================
// 4. ENDPOINT PARA RE-PREGUNTAS
// ==========================================
app.post('/repregunta', async (req, res) => {
    const { cartas, lecturaAnterior, repregunta, estilo = 'filosofico' } = req.body;

    if (!repregunta) {
        return res.status(400).json({ error: "Falta la re-pregunta del usuario." });
    }

    try {
        let personalidadMistica = "";
        if (estilo === 'manual') {
            personalidadMistica = "Eres un oráculo analítico y técnico de Tarot. Responde de forma clara, directa y didáctica.";
        } else if (estilo === 'morgana' || estilo === 'magico') {
            personalidadMistica = "Eres Morgana, la experta y asertiva lectora de Tarot. Mantén un tono místico, directo y firme.";
        } else {
            personalidadMistica = "Eres un terapeuta y experto lector de Tarot Evolutivo. Mantén un tono empático, reflexivo y constructivo.";
        }

        const promptSistemaRepregunta = `${personalidadMistica}
El usuario tiene una duda de seguimiento sobre su tirada previo.

CONTEXTO:
- Dupla 1: ${cartas?.a || ''} y ${cartas?.b || ''}
- Dupla 2: ${cartas?.c || ''} y ${cartas?.d || ''}
- Interpretación previa: "${lecturaAnterior}"

REGLAS:
1. Responde de forma concisa (máximo 2 párrafos).
2. NO uses asteriscos (*).
3. Devuelve únicamente HTML básico (<p> o <ul>/<li>).`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: "system", content: promptSistemaRepregunta },
                    { role: "user", content: repregunta }
                ],
                temperature: 0.7,
                reasoning_format: "hidden"
            })
        });

        const data = await response.json();
        
        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(response.status || 500).json({ 
                error: "Respuesta incompleta de Groq en repregunta", 
                detalle: data.error?.message || "Respuesta inválida" 
            });
        }

        let respuestaIA = limpiarRazonamiento(data.choices[0].message.content || "");
        res.json({ respuesta: respuestaIA });

    } catch (error) {
        console.error("Error en endpoint /repregunta:", error);
        res.status(500).json({ error: "La conexión con la re-pregunta falló." });
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
