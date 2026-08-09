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
// 3. CONFIGURACION GROQ
// ==========================================
const MODEL_NAME = process.env.MODEL_NAME || 'qwen/qwen3.6-27b';
const API_KEY = process.env.GROQ_API_KEY || process.env.API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

console.log('CONFIG SERVIDOR:');
console.log('  MODEL_NAME:', MODEL_NAME);
console.log('  API_KEY existe:', !!API_KEY);
console.log('  API_KEY primeros 10:', API_KEY ? API_KEY.substring(0, 10) + '...' : 'NO');
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
// FUNCION: LIMPIAR RESPUESTA
// ==========================================
function limpiarRespuesta(texto) {
    if (!texto) return '';

    // Quitar tags de thinking
    const tags = [['<think>', '</think>'], ['<thinking>', '</thinking>'], ['<reasoning>', '</reasoning>']];
    for (const [a, c] of tags) {
        while (true) {
            const ia = texto.indexOf(a);
            if (ia === -1) break;
            const ic = texto.indexOf(c, ia);
            if (ic === -1) {
                texto = texto.substring(0, ia).trim();
                break;
            }
            texto = (texto.substring(0, ia) + texto.substring(ic + c.length)).trim();
        }
    }

    // Quitar markdown
    texto = texto.replace(/```html/gi, '').replace(/```/g, '');

    // Quitar thinking process en texto plano
    const markers = [
        "Here's a thinking process:",
        "Thinking Process:",
        "Thinking:",
        "Razonamiento:",
        "Proceso de pensamiento:",
        "Step-by-step thinking:",
        "Let me think through this:"
    ];

    for (const marker of markers) {
        const idx = texto.indexOf(marker);
        if (idx !== -1) {
            const despues = texto.substring(idx + marker.length);
            const idxDiv = despues.indexOf('<div');
            const idxConclusion = despues.search(/Conclusi|Predicci|Dupla|Presente|Futuro|El camino|Debes|La situaci|Las cartas/i);

            let corte = -1;
            if (idxDiv !== -1) corte = idx + marker.length + idxDiv;
            else if (idxConclusion !== -1 && idxConclusion > 50) corte = idx + marker.length + idxConclusion;

            if (corte !== -1) {
                const util = texto.substring(corte).trim();
                if (util.length > 30) {
                    texto = util;
                    break;
                }
            }
            texto = texto.substring(0, idx).trim();
        }
    }

    // Buscar primer <div
    const idxDiv = texto.indexOf('<div');
    if (idxDiv !== -1) return texto.substring(idxDiv);

    return texto.trim();
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
        return res.status(400).json({ error: 'Faltan cartas.' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'API Key no configurada.' });
    }

    try {
        const preguntaLimpia = (pregunta && typeof pregunta === 'string') ? pregunta.trim().slice(0, 300) : '';
        const esPreguntaEspecifica = (tema === 'Pregunta Especifica' || tema === 'Pregunta Especifica') && preguntaLimpia.length > 0;
        const esModoGratis = modo === 'gratis';

        // ========== CONSTRUIR PROMPT ULTRA SIMPLE ==========
        // La clave: menos texto en el prompt = menos razonamiento del modelo
        let mensaje = '';

        if (esModoGratis) {
            mensaje = `Eres Morgana, lectora de Tarot. Responde con 2 divs HTML con class reading-section.

Pregunta: ${preguntaLimpia || 'Consulta general'}
Cartas: ${a} y ${b} (presente), ${c} y ${d} (futuro).

Responde directo en espanol. Maximo 150 palabras.`;
        } else if (estilo === 'manual') {
            if (esPreguntaEspecifica) {
                mensaje = `Actua como diccionario tecnico de Tarot. Tono neutro.

Pregunta: ${preguntaLimpia}
Cartas presente: ${a} y ${b} (significado conjunto).
Cartas futuro: ${c} y ${d} (significado conjunto).

Responde con HTML class reading-section. Solo significados conjuntos, no carta por carta.`;
            } else {
                mensaje = `Diccionario tecnico de Tarot. Tono neutro.

Tema: ${tema}
Cartas presente: ${a} y ${b} (significado conjunto).
Cartas futuro: ${c} y ${d} (significado conjunto).

HTML class reading-section. Solo significados conjuntos.`;
            }
        } else {
            const personalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, lectora de Tarot. Tono mistico, directo y predictivo.'
                : 'Eres terapeuta de Tarot Evolutivo. Tono reflexivo y empatico.';

            if (esPreguntaEspecifica) {
                mensaje = `${personalidad}

Pregunta: ${preguntaLimpia}
Cartas presente: ${a} y ${b} (interpretacion conjunta sobre la pregunta).
Cartas futuro: ${c} y ${d} (interpretacion conjunta sobre la pregunta).

Responde directo a la pregunta. HTML class reading-section. No carta por carta.`;
            } else {
                mensaje = `${personalidad}

Tema: ${tema}
Cartas presente: ${a} y ${b} (interpretacion conjunta).
Cartas futuro: ${c} y ${d} (interpretacion conjunta).

HTML class reading-section. No carta por carta.`;
            }
        }

        console.log('Llamando a Groq... Modelo:', MODEL_NAME);
        console.log('Prompt length:', mensaje.length);

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: 'user', content: mensaje }
                ],
                temperature: 0.3,
                max_tokens: 800
            })
        });

        const data = await response.json();

        console.log('Status Groq:', response.status);
        if (data.error) console.log('Error Groq:', data.error.message);

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(500).json({
                error: 'Error del proveedor de IA.',
                detalle: data.error?.message || `HTTP ${response.status}`
            });
        }

        const raw = data.choices[0].message?.content || '';
        console.log('Raw length:', raw.length);
        console.log('Raw preview:', raw.substring(0, 150).replace(/\n/g, ' '));

        let text = limpiarRespuesta(raw);
        console.log('Limpio length:', text.length);
        console.log('Limpio preview:', text.substring(0, 150).replace(/\n/g, ' '));

        if (!text || text.length < 30) {
            console.warn('Fallback activado');
            text = esModoGratis 
                ? `<div class="reading-section"><h3>Conclusion</h3><p>${a} y ${b} indican que la situacion actual requiere atencion.</p></div><div class="reading-section"><h3>Prediccion</h3><p>${c} y ${d} revelan un cambio en el horizonte.</p></div>`
                : `<div class="reading-section"><h3>Dupla 1: Presente</h3><p>${a} y ${b} revelan la energia actual.</p></div><div class="reading-section"><h3>Dupla 2: Futuro</h3><p>${c} y ${d} indican la evolucion.</p></div>`;
        }

        return res.json({ lectura: text });

    } catch (error) {
        console.error('ERROR:', error.message);
        return res.status(500).json({ error: 'Error interno', detalles: error.message });
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

    if (!API_KEY) {
        return res.status(500).json({ error: 'API Key no configurada.' });
    }

    try {
        const personalidad = estilo === 'manual' ? 'Oraculo analitico de Tarot.'
            : (estilo === 'morgana' || estilo === 'magico') ? 'Morgana, lectora mistica.'
            : 'Terapeuta de Tarot Evolutivo.';

        const a = cartas?.a || '';
        const b = cartas?.b || '';
        const c = cartas?.c || '';
        const d = cartas?.d || '';

        const mensaje = `${personalidad}

Cartas de la tirada: ${a} y ${b} (presente), ${c} y ${d} (futuro).
Nueva pregunta: ${repregunta.trim().slice(0, 300)}

Responde directo. Maximo 2 parrafos. HTML simple.`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [{ role: 'user', content: mensaje }],
                temperature: 0.3,
                max_tokens: 600
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(500).json({ error: 'Error en la API de IA' });
        }

        let respuesta = limpiarRespuesta(data.choices[0].message?.content || '');
        if (!respuesta || respuesta.length < 20) {
            respuesta = '<p>Las cartas sugieren reflexionar sobre este aspecto.</p>';
        }

        return res.json({ respuesta });

    } catch (error) {
        console.error('Error repregunta:', error);
        return res.status(500).json({ error: 'Error en repregunta.' });
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
