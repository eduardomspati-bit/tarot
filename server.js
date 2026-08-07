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
        .then(() => console.log('Conectado a MongoDB Atlas'))
        .catch(err => console.error('Error MongoDB:', err.message));
} else {
    console.warn('MONGO_URI no configurada.');
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

const MODEL_NAME = process.env.MODEL_NAME || 'openai/gpt-oss-120b';
const API_KEY = process.env.GROQ_API_KEY || process.env.API_KEY;

// ADMIN_TOKEN debe configurarse en .env o Render. Sin default plano en código.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// ==========================================
// MIDDLEWARE DE ADMIN
// ==========================================
function verificarAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    
    if (!ADMIN_TOKEN) {
        console.error("⚠️ ALERTA: ADMIN_TOKEN no está definido en variables de entorno.");
        return res.status(500).json({ error: 'Configuración de servidor incompleta.' });
    }

    if (!token || token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Acceso denegado. Token inválido o ausente.' });
    }
    next();
}

// ==========================================
// FUNCIÓN AUXILIAR: LIMPIAR HTML
// ==========================================
function limpiarRazonamiento(texto) {
    if (!texto) return '';
    texto = texto.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    texto = texto.replace(/```html/gi, '').replace(/```/g, '');
    const idx = texto.indexOf('<div');
    if (idx !== -1) texto = texto.substring(idx);
    return texto.trim();
}

// ==========================================
// ENDPOINT: TIRADA
// ==========================================
app.post('/tirada', async (req, res) => {
    let { tema, a, b, c, d, estilo = 'filosofico', pregunta, cartas } = req.body;

    if (!a && cartas && Array.isArray(cartas) && cartas.length >= 4) {
        a = cartas[0]; b = cartas[1]; c = cartas[2]; d = cartas[3];
    }

    try {
        if (!a || !b || !c || !d) {
            return res.status(400).json({ error: 'Faltan cartas. Envía a,b,c,d o cartas[].' });
        }

        // FIX: detectar pregunta especifica con o sin tilde
        const esPreguntaEspecifica = (tema === 'Pregunta Especifica' || tema === 'Pregunta Específica') && pregunta && pregunta.trim().length > 0;

        let promptSistema = '';

        if (estilo === 'manual') {
            promptSistema = `Actua como un diccionario tecnico de Tarot.
Analiza las duplas:
- Dupla 1: ${a} y ${b}
- Dupla 2: ${c} y ${d}
Proporciona 3-4 interpretaciones practicas de cada combinacion.
Tono neutro, analitico. PROHIBIDO relacionar Dupla 1 con Dupla 2.
NO uses marcadores de posicion.
Devuelve HTML con class reading-section.`;
        } else {
            let instruccionesPersonalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, experta lectora de Tarot. Tono mistico, seguro, directo y predictivo.'
                : 'Eres un terapeuta y experto lector de Tarot Evolutivo. Tono reflexivo, psicologico, empatico.';

            promptSistema = instruccionesPersonalidad + `
REGLAS CRITICAS:
1. Interpretacion REAL basada en ${a}, ${b}, ${c}, ${d}.
2. PROHIBIDO marcadores de posicion como [texto].
3. NO uses asteriscos, guiones ni vinetas.
4. Devuelve HTML con class reading-section.`;
        }

        let promptUsuario = '';

        if (esPreguntaEspecifica) {
            // FIX: prompt ultra-directivo para preguntas especificas
            promptUsuario = `INSTRUCCION OBLIGATORIA: El consultante hizo una pregunta CONCRETA. Tu UNICA mision es responder a esa pregunta usando las cartas como guia.

PREGUNTA DEL CONSULTANTE: "${pregunta.trim()}"

CARTAS TIRADAS:
- Dupla 1 (Presente/Pasado): ${a} y ${b}
- Dupla 2 (Futuro/Resultado): ${c} y ${d}

REGLAS ESTRICTAS:
1. Responde DIRECTAMENTE a la pregunta. NO des una lectura generica.
2. Cada interpretacion de carta debe conectarse EXPLICITAMENTE con la pregunta.
3. Si la pregunta es sobre amor, habla de amor. Si es trabajo, habla de trabajo. Si es si/no, responde claramente.
4. NO uses frases como "las cartas sugieren" sin conectarlo a la pregunta.
5. Devuelve HTML con class reading-section.`;
        } else {
            promptUsuario = `Tema: ${tema}. Cartas: ${a}, ${b}, ${c}, ${d}. Realiza la lectura.`;
        }

        if (!API_KEY) {
            return res.status(500).json({ error: 'API Key no configurada.' });
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: 'system', content: promptSistema },
                    { role: 'user', content: promptUsuario }
                ],
                temperature: estilo === 'manual' ? 0.2 : 0.7,
                max_tokens: 1500
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(response.status || 500).json({
                error: 'Respuesta incompleta de Groq',
                detalle: data.error?.message || 'Respuesta inválida'
            });
        }

        let text = limpiarRazonamiento(data.choices[0].message.content || '');

        if (!text) {
            text = `<div class="reading-section"><h3>Predicciones del Oráculo</h3><p>Las cartas ${a}, ${b}, ${c} y ${d} revelan un periodo de movimiento profundo.</p></div><div class="reading-section"><h3>Consejo y Conclusión</h3><p>Confía en tu discernimiento.</p></div>`;
        }

        res.json({ lectura: text });

    } catch (error) {
        console.error('Error en /tirada:', error);
        res.status(500).json({ error: 'Error en el servidor', detalles: error.message });
    }
});

// ==========================================
// ENDPOINT: REPREGUNTA
// ==========================================
app.post('/repregunta', async (req, res) => {
    const { cartas, lecturaAnterior, repregunta, estilo = 'filosofico' } = req.body;
    if (!repregunta || repregunta.trim().length === 0) {
        return res.status(400).json({ error: 'Falta la repregunta.' });
    }

    try {
        let personalidad = '';
        if (estilo === 'manual') personalidad = 'Oráculo analítico de Tarot. Tono claro y didáctico.';
        else if (estilo === 'morgana' || estilo === 'magico') personalidad = 'Morgana, lectora mística. Tono directo y firme.';
        else personalidad = 'Terapeuta de Tarot Evolutivo. Tono empático y reflexivo.';

        // FIX: prompt ultra-directivo para repreguntas
        const promptSistema = `${personalidad}

El usuario hace una NUEVA pregunta de seguimiento. Tu UNICA tarea es responder a esta nueva pregunta usando las mismas cartas como contexto.

NUEVA PREGUNTA: "${repregunta.trim()}"

CARTAS ORIGINALES DE LA TIRADA:
- Dupla 1: ${cartas?.a || ''} y ${cartas?.b || ''}
- Dupla 2: ${cartas?.c || ''} y ${cartas?.d || ''}

REGLAS ESTRICTAS:
1. Responde DIRECTAMENTE a la NUEVA PREGUNTA. No des una lectura general.
2. NO repitas la lectura anterior. NO resumas lo ya dicho.
3. Usa las cartas como evidencia para responder la nueva duda concreta.
4. Maximo 2 parrafos. NO asteriscos. Solo HTML basico.`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: 'system', content: promptSistema },
                    { role: 'user', content: repregunta.trim() }
                ],
                temperature: 0.6,
                max_tokens: 600
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(response.status || 500).json({
                error: 'Respuesta incompleta de Groq',
                detalle: data.error?.message || 'Inválida'
            });
        }

        let respuestaIA = limpiarRazonamiento(data.choices[0].message.content || '');
        if (!respuestaIA) respuestaIA = '<p>Las cartas sugieren reflexionar con calma.</p>';

        res.json({ respuesta: respuestaIA });

    } catch (error) {
        console.error('Error en /repregunta:', error);
        res.status(500).json({ error: 'La conexión con la repregunta falló.' });
    }
});

// ==========================================
// ENDPOINT: REGISTRAR USUARIO
// ==========================================
app.post('/api/usuarios/registrar', async (req, res) => {
    const { nombre, email } = req.body;
    if (!email) return res.status(400).json({ error: 'El email es requerido.' });

    try {
        const hoy = new Date().toISOString().split('T')[0];
        const usuario = await Usuario.findOneAndUpdate(
            { email: email.toLowerCase().trim() },
            {
                $inc: { totalTiradas: 1 },
                $set: { ultimaConexion: hoy },
                $setOnInsert: { nombre: nombre || 'Consultante', plan: 'Gratis' }
            },
            { new: true, upsert: true }
        );
        return res.json({ mensaje: 'Usuario registrado', usuario });
    } catch (error) {
        console.error('Error al registrar:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ENDPOINTS DE ADMIN
// ==========================================

// Listar todos los clientes
app.get('/api/admin/clientes', verificarAdmin, async (req, res) => {
    try {
        const clientes = await Usuario.find({}, { __v: 0 }).sort({ createdAt: -1 }).limit(100);
        res.json({ clientes });
    } catch (error) {
        console.error('Error en /api/admin/clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

// Cambiar plan de un usuario
app.post('/api/admin/cambiar-plan', verificarAdmin, async (req, res) => {
    const { userId, nuevoPlan } = req.body;

    if (!userId || !nuevoPlan) {
        return res.status(400).json({ error: 'Faltan userId o nuevoPlan' });
    }
    if (!['Gratis', 'Premium'].includes(nuevoPlan)) {
        return res.status(400).json({ error: 'Plan inválido. Use Gratis o Premium' });
    }

    try {
        // Construcción segura del filtro para evitar CastError con ObjectId
        const filtro = mongoose.Types.ObjectId.isValid(userId)
            ? { $or: [{ _id: userId }, { email: userId }] }
            : { email: userId.toLowerCase().trim() };

        const usuario = await Usuario.findOneAndUpdate(
            filtro,
            { $set: { plan: nuevoPlan } },
            { new: true }
        );

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json({ mensaje: `Plan actualizado a ${nuevoPlan}`, usuario });
    } catch (error) {
        console.error('Error en /api/admin/cambiar-plan:', error);
        res.status(500).json({ error: 'Error al cambiar plan' });
    }
});

// ==========================================
// SERVIDOR
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
