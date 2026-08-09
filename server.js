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
// 1. CONEXION A MONGODB ATLAS
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

// ==========================================
// 3. CONFIGURACION GEMINI
// ==========================================
// Obtener API key gratis en: https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

console.log('CONFIG SERVIDOR:');
console.log('  IA: Google Gemini');
console.log('  Modelo:', GEMINI_MODEL);
console.log('  API_KEY existe:', !!GEMINI_API_KEY);
console.log('  API_KEY primeros 10:', GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 10) + '...' : 'NO');
console.log('  ADMIN_TOKEN existe:', !!ADMIN_TOKEN);

// ==========================================
// MIDDLEWARE DE ADMIN
// ==========================================
function verificarAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];

    if (!ADMIN_TOKEN) {
        console.error("ALERTA: ADMIN_TOKEN no definido.");
        return res.status(500).json({ error: 'Configuracion de servidor incompleta.' });
    }

    if (!token || token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Acceso denegado. Token invalido.' });
    }
    next();
}

// ==========================================
// FUNCION: LLAMAR A GEMINI
// ==========================================
async function llamarGemini(systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const body = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: systemPrompt + '\n\n' + userPrompt }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1500,
            topP: 0.95
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.error) {
        throw new Error(`Gemini error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    if (!data.candidates || data.candidates.length === 0) {
        throw new Error('Gemini: Sin candidates en la respuesta');
    }

    const texto = data.candidates[0].content?.parts?.[0]?.text || '';
    return texto;
}

// ==========================================
// ENDPOINT: TIRADA
// ==========================================
app.post('/tirada', async (req, res) => {
    console.log('\n=== NUEVA PETICION /tirada ===');
    console.log('Body:', JSON.stringify(req.body));

    let { tema, a, b, c, d, estilo = 'filosofico', pregunta, cartas, modo } = req.body;

    if (!a && cartas && Array.isArray(cartas) && cartas.length >= 4) {
        a = cartas[0]; b = cartas[1]; c = cartas[2]; d = cartas[3];
    }

    if (!a || !b || !c || !d) {
        return res.status(400).json({ error: 'Faltan cartas. Envia a,b,c,d o cartas[].' });
    }

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'API Key de Gemini no configurada.' });
    }

    try {
        const preguntaLimpia = (pregunta && typeof pregunta === 'string') ? pregunta.trim().slice(0, 300) : '';
        const esPreguntaEspecifica = (tema === 'Pregunta Especifica' || tema === 'Pregunta Especifica') && preguntaLimpia.length > 0;
        const esModoGratis = modo === 'gratis';

        let systemPrompt = '';
        let userPrompt = '';

        // ========== MODO GRATIS ==========
        if (esModoGratis) {
            systemPrompt = `Eres Morgana, experta lectora de Tarot. Tono mistico, directo y predictivo.
Responde SOLO con 2 secciones HTML. Nada mas.
NO saludes. NO introducciones.
Cada dupla se lee como UNIDAD INDIVISIBLE (no carta por carta).
Devuelve HTML con class="reading-section".
NO uses markdown, NO uses asteriscos.`;

            userPrompt = `PREGUNTA: "${preguntaLimpia || 'Consulta general'}"

Dupla 1 (Presente): ${a} y ${b}
Dupla 2 (Futuro): ${c} y ${d}

Responde en espanol con HTML. Maximo 150 palabras.`;

        // ========== MODO MANUAL ==========
        } else if (estilo === 'manual') {
            systemPrompt = `Actua como un diccionario tecnico de Tarot.
Interpreta por DUPLAS, nunca carta por carta.
Devuelve SOLO HTML con class="reading-section".
Tono neutro, analitico.`;

            if (esPreguntaEspecifica) {
                userPrompt = `PREGUNTA: "${preguntaLimpia}"

Dupla 1 (Presente): ${a} y ${b} -> Significado conjunto sobre la situacion actual RELACIONADA CON LA PREGUNTA.
Dupla 2 (Futuro): ${c} y ${d} -> Significado conjunto sobre la evolucion RELACIONADA CON LA PREGUNTA.

Responde DIRECTAMENTE a la pregunta. Solo HTML.`;
            } else {
                userPrompt = `Tema: ${tema}

Dupla 1 (Presente): ${a} y ${b} -> Significado conjunto.
Dupla 2 (Futuro): ${c} y ${d} -> Significado conjunto.

Solo HTML. NO carta por carta.`;
            }

        // ========== MODO NORMAL ==========
        } else {
            const instruccionesPersonalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, lectora de Tarot. Tono mistico, directo y predictivo. Respuestas concretas, no genericas.'
                : 'Eres terapeuta de Tarot Evolutivo. Tono reflexivo y empatico. Interpretaciones profundas pero concretas.';

            systemPrompt = `${instruccionesPersonalidad}
ESTRUCTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = interpretacion conjunta del PRESENTE.
- Dupla 2 (${c} + ${d}) = interpretacion conjunta del FUTURO.
NO cartas aisladas. Cada dupla es UNICA.
Devuelve SOLO HTML con class="reading-section".
NO uses asteriscos, guiones ni vinetas.`;

            if (esPreguntaEspecifica) {
                userPrompt = `PREGUNTA: "${preguntaLimpia}"

Dupla 1 (Presente): ${a} y ${b} -> Mensaje conjunto sobre la situacion ACTUAL en relacion a la pregunta.
Dupla 2 (Futuro): ${c} y ${d} -> Mensaje conjunto sobre la EVOLUCION en relacion a la pregunta.

Responde DIRECTAMENTE a la pregunta. Conecta cada dupla con la duda especifica. Solo HTML.`;
            } else {
                userPrompt = `Tema: ${tema}

Dupla 1 (Presente): ${a} y ${b} -> Interpretacion conjunta de la situacion actual.
Dupla 2 (Futuro): ${c} y ${d} -> Interpretacion conjunta de la evolucion.

Solo HTML. NO carta por carta.`;
            }
        }

        console.log('Llamando a Gemini... Modelo:', GEMINI_MODEL);

        const text = await llamarGemini(systemPrompt, userPrompt);

        console.log('Respuesta Gemini length:', text.length);
        console.log('Respuesta preview:', text.substring(0, 200).replace(/\n/g, ' '));

        if (!text || text.length < 30) {
            console.warn('Respuesta vacia o muy corta, usando fallback');
            const fallback = esModoGratis 
                ? `<div class="reading-section"><h3>Conclusion</h3><p>Las cartas ${a} y ${b} indican que la situacion actual requiere atencion.</p></div><div class="reading-section"><h3>Prediccion</h3><p>La Dupla ${c} y ${d} revela un cambio en el horizonte.</p></div>`
                : `<div class="reading-section"><h3>Dupla 1: Presente (${a} + ${b})</h3><p>Estas dos cartas juntas revelan la energia actual.</p></div><div class="reading-section"><h3>Dupla 2: Futuro (${c} + ${d})</h3><p>Estas dos cartas juntas indican la evolucion que se avecina.</p></div>`;
            return res.json({ lectura: fallback });
        }

        console.log('Respuesta enviada al cliente (', text.length, 'chars)');
        return res.json({ lectura: text });

    } catch (error) {
        console.error('ERROR en /tirada:', error.message);
        return res.status(500).json({ error: 'Error interno en el servidor', detalles: error.message });
    }
});

// ==========================================
// ENDPOINT: REPREGUNTA
// ==========================================
app.post('/repregunta', async (req, res) => {
    const { cartas, repregunta, estilo = 'filosofico' } = req.body;

    if (!repregunta || typeof repregunta !== 'string' || repregunta.trim().length === 0) {
        return res.status(400).json({ error: 'Falta la repregunta.' });
    }

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'API Key no configurada.' });
    }

    try {
        let personalidad = estilo === 'manual' ? 'Oraculo analitico de Tarot. Tono claro.'
            : (estilo === 'morgana' || estilo === 'magico') ? 'Morgana, lectora mistica. Tono directo.'
            : 'Terapeuta de Tarot Evolutivo. Tono empatico.';

        const a = cartas?.a || '';
        const b = cartas?.b || '';
        const c = cartas?.c || '';
        const d = cartas?.d || '';

        const systemPrompt = `${personalidad}
NUEVA PREGUNTA sobre la misma tirada.
Cartas (por duplas): Dupla 1: ${a} y ${b}. Dupla 2: ${c} y ${d}.
Responde DIRECTAMENTE a la nueva pregunta. Maximo 2 parrafos.
Solo HTML basico. NO asteriscos.`;

        const text = await llamarGemini(systemPrompt, repregunta.trim().slice(0, 300));

        if (!text || text.length < 20) {
            return res.json({ respuesta: '<p>Las cartas sugieren reflexionar con calma sobre este aspecto.</p>' });
        }

        return res.json({ respuesta: text });

    } catch (error) {
        console.error('Error en /repregunta:', error);
        return res.status(500).json({ error: 'La conexion con la repregunta fallo.' });
    }
});

// ==========================================
// ENDPOINT: REGISTRAR USUARIO
// ==========================================
app.post('/api/usuarios/registrar', async (req, res) => {
    const { nombre, email } = req.body;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'El email es requerido.' });

    try {
        const hoy = new Date().toISOString().split('T')[0];
        const emailLimpio = email.toLowerCase().trim();

        const usuario = await Usuario.findOneAndUpdate(
            { email: emailLimpio },
            {
                $inc: { totalTiradas: 1 },
                $set: { ultimaConexion: hoy },
                $setOnInsert: { nombre: (nombre && typeof nombre === 'string') ? nombre.trim() : 'Consultante', plan: 'Gratis' }
            },
            { new: true, upsert: true }
        );
        return res.json({ mensaje: 'Usuario registrado', usuario });
    } catch (error) {
        console.error('Error al registrar:', error.message);
        return res.status(500).json({ error: 'Error al procesar usuario.' });
    }
});

// ==========================================
// ENDPOINTS DE ADMIN
// ==========================================
app.get('/api/admin/clientes', verificarAdmin, async (req, res) => {
    try {
        const clientes = await Usuario.find({}, { __v: 0 }).sort({ createdAt: -1 }).limit(100);
        res.json({ clientes });
    } catch (error) {
        console.error('Error en /api/admin/clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

app.post('/api/admin/cambiar-plan', verificarAdmin, async (req, res) => {
    const { userId, nuevoPlan } = req.body;

    if (!userId || !nuevoPlan) {
        return res.status(400).json({ error: 'Faltan userId o nuevoPlan' });
    }
    if (!['Gratis', 'Premium'].includes(nuevoPlan)) {
        return res.status(400).json({ error: 'Plan invalido. Use Gratis o Premium' });
    }

    try {
        let filtro;
        const idString = String(userId).trim();

        if (mongoose.Types.ObjectId.isValid(idString)) {
            filtro = { _id: idString };
        } else {
            filtro = { email: idString.toLowerCase() };
        }

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
