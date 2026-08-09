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
// FUNCION AUXILIAR: EXTRAER RESPUESTA REAL
// ==========================================
// qwen genera thinking process antes de la respuesta. Esta funcion lo corta.
function extraerRespuestaReal(texto) {
    if (!texto) return '';

    let original = texto;

    // ---------- PASO 1: Quitar tags XML de razonamiento ----------
    const tags = [
        ['<think>', '</think>'],
        ['<thinking>', '</thinking>'],
        ['<reasoning>', '</reasoning>']
    ];

    for (const [apertura, cierre] of tags) {
        while (true) {
            const idxApertura = original.indexOf(apertura);
            if (idxApertura === -1) break;
            const idxCierre = original.indexOf(cierre, idxApertura);
            if (idxCierre === -1) {
                // No hay cierre, cortar desde apertura hasta el final
                original = original.substring(0, idxApertura).trim();
                break;
            }
            original = (original.substring(0, idxApertura) + original.substring(idxCierre + cierre.length)).trim();
        }
    }

    // ---------- PASO 2: Quitar markdown de codigo ----------
    original = original.replace(/```html/gi, '').replace(/```/g, '');

    // ---------- PASO 3: Detectar thinking process en texto plano ----------
    // Buscar marcadores de inicio de razonamiento
    const thinkingMarkers = [
        "Here's a thinking process:",
        "Thinking Process:",
        "Thinking:",
        "Razonamiento:",
        "Proceso de pensamiento:",
        "Step-by-step thinking:",
        "Let me think through this:"
    ];

    let textoLimpio = original;
    let thinkingEncontrado = false;

    for (const marker of thinkingMarkers) {
        const idxMarker = textoLimpio.indexOf(marker);
        if (idxMarker !== -1) {
            thinkingEncontrado = true;
            console.log('  Thinking detectado:', marker);

            // Buscar si DESPUES del thinking hay una respuesta real util
            const despuesMarker = textoLimpio.substring(idxMarker + marker.length);

            // Estrategia A: Buscar <div despues del marker
            const idxDiv = despuesMarker.indexOf('<div');
            if (idxDiv !== -1) {
                const parteUtil = despuesMarker.substring(idxDiv).trim();
                if (parteUtil.length > 30) {
                    console.log('  Respuesta real encontrada despues del thinking (HTML)');
                    textoLimpio = parteUtil;
                    break;
                }
            }

            // Estrategia B: Buscar doble salto de linea que separe thinking de respuesta
            const idxDobleSalto = despuesMarker.indexOf('\n\n');
            if (idxDobleSalto !== -1 && idxDobleSalto > 100) {
                const parteUtil = despuesMarker.substring(idxDobleSalto).trim();
                if (parteUtil.length > 30 && !parteUtil.includes('Analyze') && !parteUtil.includes('Interpret')) {
                    console.log('  Respuesta real encontrada despues del thinking (salto doble)');
                    textoLimpio = parteUtil;
                    break;
                }
            }

            // Estrategia C: Buscar "Conclusion" o "Prediccion" o "Dupla" despues del marker
            const palabrasClave = ['Conclusion', 'Prediccion', 'Dupla', 'Presente', 'Futuro', 'El camino', 'Debes', 'La situacion', 'Las cartas'];
            for (const palabra of palabrasClave) {
                const idxPalabra = despuesMarker.indexOf(palabra);
                if (idxPalabra !== -1 && idxPalabra > 50) {
                    const parteUtil = despuesMarker.substring(idxPalabra).trim();
                    if (parteUtil.length > 30) {
                        console.log('  Respuesta real encontrada despues del thinking (palabra clave:', palabra + ')');
                        textoLimpio = parteUtil;
                        break;
                    }
                }
            }
            if (textoLimpio !== original) break; // Ya encontramos respuesta

            // Estrategia D: No hay respuesta util despues, cortar todo el thinking
            console.log('  No se encontro respuesta util despues del thinking, cortando...');
            textoLimpio = textoLimpio.substring(0, idxMarker).trim();
        }
    }

    // ---------- PASO 4: Si no se encontro thinking pero el texto parece basura, filtrar ----------
    if (!thinkingEncontrado) {
        const lineas = textoLimpio.split('\n');
        const resultado = [];
        let enRespuesta = false;

        for (const linea of lineas) {
            const trim = linea.trim();
            if (!trim) continue;

            // Detectar inicio de respuesta real
            if (trim.startsWith('<div') || trim.startsWith('<h3') || trim.startsWith('<p') ||
                trim.startsWith('Conclusion') || trim.startsWith('Prediccion') ||
                trim.startsWith('Dupla') || trim.startsWith('Debes') ||
                trim.startsWith('El camino') || trim.startsWith('La situacion') ||
                trim.startsWith('Las cartas') ||
                (trim.length > 40 && !trim.match(/^\d+\./) && !trim.startsWith('-') && !trim.startsWith('*') && !trim.startsWith('**') && !trim.includes('Analyze') && !trim.includes('Interpret'))) {
                enRespuesta = true;
            }

            if (enRespuesta) {
                resultado.push(linea);
            }
        }

        if (resultado.length > 0) {
            textoLimpio = resultado.join('\n').trim();
        }
    }

    return textoLimpio;
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
        console.log('Faltan cartas');
        return res.status(400).json({ error: 'Faltan cartas. Envia a,b,c,d o cartas[].' });
    }

    if (!API_KEY) {
        console.log('API Key no configurada');
        return res.status(500).json({ error: 'API Key de Groq no configurada.' });
    }

    try {
        const preguntaLimpia = (pregunta && typeof pregunta === 'string') ? pregunta.trim().slice(0, 300) : '';
        const esPreguntaEspecifica = (tema === 'Pregunta Especifica' || tema === 'Pregunta Especifica') && preguntaLimpia.length > 0;
        const esModoGratis = modo === 'gratis';

        let promptSistema = '';
        let promptUsuario = '';

        // ========== MODO GRATIS ==========
        if (esModoGratis) {
            promptSistema = `Eres Morgana, lectora de Tarot. Tono mistico y directo.
Responde SOLO con 2 secciones HTML. Nada mas.
NO saludes. NO expliques tu razonamiento.
Cada dupla se lee como UNIDAD INDIVISIBLE.`;

            promptUsuario = `PREGUNTA: "${preguntaLimpia || 'Consulta general'}"

Dupla 1 (Presente): ${a} y ${b}
Dupla 2 (Futuro): ${c} y ${d}

Responde en espanol con HTML usando class="reading-section". Maximo 150 palabras.`;

        // ========== MODO MANUAL ==========
        } else if (estilo === 'manual') {
            promptSistema = `Diccionario tecnico de Tarot. Tono neutro y analitico.
Interpreta por DUPLAS, nunca carta por carta.
Devuelve SOLO HTML con class="reading-section".
NO expliques tu razonamiento.`;

            if (esPreguntaEspecifica) {
                promptUsuario = `PREGUNTA: "${preguntaLimpia}"

Dupla 1 (Presente): ${a} y ${b} -> Significado conjunto sobre la situacion actual RELACIONADA CON LA PREGUNTA.
Dupla 2 (Futuro): ${c} y ${d} -> Significado conjunto sobre la evolucion RELACIONADA CON LA PREGUNTA.

Responde DIRECTAMENTE a la pregunta. Solo HTML.`;
            } else {
                promptUsuario = `Tema: ${tema}

Dupla 1 (Presente): ${a} y ${b} -> Significado conjunto.
Dupla 2 (Futuro): ${c} y ${d} -> Significado conjunto.

Solo HTML. NO carta por carta.`;
            }

        // ========== MODO NORMAL ==========
        } else {
            const instruccionesPersonalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, lectora de Tarot. Tono mistico, directo y predictivo. Respuestas concretas, no genericas.'
                : 'Eres terapeuta de Tarot Evolutivo. Tono reflexivo y empatico. Interpretaciones profundas pero concretas.';

            promptSistema = `${instruccionesPersonalidad}
ESTRUCTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = interpretacion conjunta del PRESENTE.
- Dupla 2 (${c} + ${d}) = interpretacion conjunta del FUTURO.
NO cartas aisladas. Cada dupla es UNICA.
Devuelve SOLO HTML con class="reading-section".
NO uses asteriscos, guiones ni vinetas.
NO expliques tu razonamiento.`;

            if (esPreguntaEspecifica) {
                promptUsuario = `PREGUNTA: "${preguntaLimpia}"

Dupla 1 (Presente): ${a} y ${b} -> Mensaje conjunto sobre la situacion ACTUAL en relacion a la pregunta.
Dupla 2 (Futuro): ${c} y ${d} -> Mensaje conjunto sobre la EVOLUCION en relacion a la pregunta.

Responde DIRECTAMENTE a la pregunta. Conecta cada dupla con la duda especifica. Solo HTML.`;
            } else {
                promptUsuario = `Tema: ${tema}

Dupla 1 (Presente): ${a} y ${b} -> Interpretacion conjunta de la situacion actual.
Dupla 2 (Futuro): ${c} y ${d} -> Interpretacion conjunta de la evolucion.

Solo HTML. NO carta por carta.`;
            }
        }

        console.log('Llamando a Groq API... Modelo:', MODEL_NAME);

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
                temperature: esModoGratis ? 0.7 : (estilo === 'manual' ? 0.2 : 0.6),
                max_tokens: esModoGratis ? 800 : 2000
            })
        });

        const data = await response.json();

        console.log('Status Groq:', response.status);
        if (data.error) console.log('Error Groq:', data.error.message);

        if (!response.ok || !data.choices || data.choices.length === 0) {
            console.error('Groq error:', data.error?.message || 'Sin choices');
            return res.status(500).json({
                error: 'Respuesta incompleta del proveedor de IA.',
                detalle: data.error?.message || `HTTP ${response.status}`,
                groq_status: response.status,
                groq_code: data.error?.code || null
            });
        }

        const rawContent = data.choices[0].message?.content || '';
        console.log('Raw content length:', rawContent.length);
        console.log('Raw content preview:', rawContent.substring(0, 150).replace(/\n/g, ' '));

        let text = extraerRespuestaReal(rawContent);
        console.log('Limpio length:', text.length);
        console.log('Limpio preview:', text.substring(0, 150).replace(/\n/g, ' '));

        if (!text || text.length < 30) {
            console.warn('Texto vacio o muy corto despues de limpiar, usando fallback');
            text = esModoGratis 
                ? `<div class="reading-section"><h3>Conclusion</h3><p>Las cartas ${a} y ${b} indican que la situacion actual requiere atencion.</p></div><div class="reading-section"><h3>Prediccion</h3><p>La Dupla ${c} y ${d} revela un cambio en el horizonte.</p></div>`
                : `<div class="reading-section"><h3>Dupla 1: Presente (${a} + ${b})</h3><p>Estas dos cartas juntas revelan la energia actual.</p></div><div class="reading-section"><h3>Dupla 2: Futuro (${c} + ${d})</h3><p>Estas dos cartas juntas indican la evolucion que se avecina.</p></div>`;
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

    if (!API_KEY) {
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

        const promptSistema = `${personalidad}
NUEVA PREGUNTA sobre la misma tirada.
Cartas (por duplas): Dupla 1: ${a} y ${b}. Dupla 2: ${c} y ${d}.
Responde DIRECTAMENTE a la nueva pregunta. Maximo 2 parrafos.
Solo HTML basico. NO asteriscos. NO expliques tu razonamiento.`;

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
                    { role: 'user', content: repregunta.trim().slice(0, 300) }
                ],
                temperature: 0.5,
                max_tokens: 800
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(500).json({ error: 'Error en la API de IA', detalle: data.error?.message });
        }

        let respuestaIA = extraerRespuestaReal(data.choices[0].message?.content || '');
        if (!respuestaIA || respuestaIA.length < 20) {
            respuestaIA = '<p>Las cartas sugieren reflexionar con calma sobre este aspecto.</p>';
        }

        return res.json({ respuesta: respuestaIA });

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
