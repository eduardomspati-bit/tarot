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
// FUNCION AUXILIAR: LIMPIAR RESPUESTA DE LA IA
// ==========================================
// El modelo qwen a veces devuelve razonamiento dentro de <think>...</think>
// o como texto plano "Thinking Process:" antes de la respuesta real.
function limpiarRazonamiento(texto) {
    if (!texto) return '';

    // ========== PASO 1: Cortar tags <think>, <thinking>, <reasoning> ==========
    // Usamos indexOf en vez de regex para mayor robustez
    const tags = ['<think>', '<thinking>', '<reasoning>'];
    const cierres = ['</think>', '</thinking>', '</reasoning>'];

    for (let i = 0; i < tags.length; i++) {
        const idxApertura = texto.indexOf(tags[i]);
        if (idxApertura !== -1) {
            const idxCierre = texto.indexOf(cierres[i], idxApertura);
            if (idxCierre !== -1) {
                // Cortar TODO desde el tag de apertura hasta el de cierre (inclusive)
                const antes = texto.substring(0, idxApertura);
                const despues = texto.substring(idxCierre + cierres[i].length);
                texto = (antes + despues).trim();
                console.log('  Tag', tags[i], 'cortado. Antes:', antes.length, 'Despues:', despues.length);
            }
        }
    }

    // ========== PASO 2: Borrar markdown de codigo ==========
    texto = texto.replace(/```html/gi, '').replace(/```/g, '');

    // ========== PASO 3: Cortar razonamiento en texto plano ==========
    // Buscar patrones como "Thinking Process:" y cortar hasta la respuesta real
    const patronesRazonamiento = [
        'Thinking Process:',
        'Here\'s a thinking process:',
        'Thinking:',
        'Razonamiento:',
        'Proceso de pensamiento:'
    ];

    for (const patron of patronesRazonamiento) {
        const idx = texto.indexOf(patron);
        if (idx !== -1) {
            // Buscar donde empieza la respuesta real (primer <div o primer parrafo sustancial)
            const desdePatron = texto.substring(idx);
            const idxDiv = desdePatron.indexOf('<div');
            const idxSaltoDoble = desdePatron.indexOf('\n\n');

            let corte = -1;
            if (idxDiv !== -1) corte = idx + idxDiv;
            else if (idxSaltoDoble !== -1 && idxSaltoDoble > patron.length + 50) corte = idx + idxSaltoDoble;

            if (corte !== -1) {
                const antes = texto.substring(0, idx).trim();
                const despues = texto.substring(corte).trim();
                if (despues.length > 20) {
                    texto = (antes + '\n' + despues).trim();
                    console.log('  Patron "' + patron + '" cortado. Respuesta real encontrada.');
                    break;
                }
            }
        }
    }

    // ========== PASO 4: Limpiar lineas de razonamiento sueltas ==========
    const lineas = texto.split('\n');
    const lineasLimpias = [];
    let empezoRespuesta = false;

    for (const linea of lineas) {
        const trim = linea.trim();

        // Si ya empezo la respuesta real, guardar todo
        if (empezoRespuesta) {
            lineasLimpias.push(linea);
            continue;
        }

        // Detectar inicio de respuesta real
        if (trim.startsWith('<div') || 
            trim.startsWith('<h3') ||
            trim.startsWith('<p') ||
            trim.startsWith('Conclusi') ||
            trim.startsWith('Predicci') ||
            trim.startsWith('Dupla') ||
            trim.startsWith('Debes') ||
            trim.startsWith('El camino') ||
            trim.startsWith('La situaci') ||
            trim.startsWith('Las cartas') ||
            (trim.length > 30 && !trim.match(/^\d+\./) && !trim.startsWith('-') && !trim.startsWith('*'))) {
            empezoRespuesta = true;
            lineasLimpias.push(linea);
        }
    }

    if (lineasLimpias.length > 0) {
        texto = lineasLimpias.join('\n').trim();
    }

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
            promptSistema = `Eres Morgana, experta lectora de Tarot. Tono mistico, directo y predictivo.
ESTRUCTURA OBLIGATORIA - Devuelve SOLO 2 secciones HTML, sin nada mas:
1. CONCLUSION (responde DIRECTAMENTE a la pregunta del consultante, basada en la Dupla 1)
2. PREDICCION (sobre el futuro, basada en la Dupla 2)

REGLAS ESTRICTAS:
- Maximo 150 palabras en total.
- NO saludos. NO introducciones. NO "las cartas dicen" generico.
- Responde DIRECTAMENTE a la pregunta del consultante.
- Cada dupla se lee como UNIDAD INDIVISIBLE (no carta por carta).
- Devuelve HTML simple con class reading-section.
- NO uses markdown, NO uses asteriscos, NO escribas tu proceso de pensamiento.
- Responde UNICAMENTE con el HTML, sin explicar como llegaste a la conclusion.`;

            promptUsuario = `PREGUNTA DEL CONSULTANTE: "${preguntaLimpia || 'Consulta general'}"

CARTAS TIRADAS (por duplas):
- Dupla 1 (PRESENTE/SITUACION ACTUAL): ${a} y ${b}
- Dupla 2 (FUTURO/EVOLUCION): ${c} y ${d}

INSTRUCCION: Interpreta cada dupla como UNA SOLA UNIDAD. La Dupla 1 responde a la pregunta del consultante sobre su situacion actual. La Dupla 2 predice que va a pasar. NO des significados de cartas individuales. Responde AHORA en espanol, directo al grano, SOLO con el HTML.`;

        // ========== MODO MANUAL ==========
        } else if (estilo === 'manual') {
            promptSistema = `Actua como un diccionario tecnico de Tarot.
ESTRUCTURA DE LECTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = UNA sola interpretacion conjunta del PRESENTE.
- Dupla 2 (${c} + ${d}) = UNA sola interpretacion conjunta del FUTURO/EVOLUCION.
NO interpretes cartas aisladas. Cada dupla tiene un significado UNICO como conjunto.
Tono neutro, analitico. PROHIBIDO relacionar Dupla 1 con Dupla 2.
NO uses marcadores de posicion como [texto].
Devuelve HTML con class reading-section.
NO uses markdown, NO uses asteriscos, NO escribas tu proceso de pensamiento.`;

            if (esPreguntaEspecifica) {
                promptUsuario = `PREGUNTA ESPECIFICA DEL CONSULTANTE: "${preguntaLimpia}"

LECTURA POR DUPLAS:
- Dupla 1 (PRESENTE): ${a} y ${b} -> Interpreta estas DOS cartas JUNTAS como una sola unidad. Que dicen juntas sobre la situacion actual RELACIONADA CON LA PREGUNTA?
- Dupla 2 (FUTURO/EVOLUCION): ${c} y ${d} -> Interpreta estas DOS cartas JUNTAS como una sola unidad. Hacia donde evoluciona la situacion RELACIONADA CON LA PREGUNTA?

REGLAS:
1. Responde DIRECTAMENTE a la pregunta usando las duplas como unidades.
2. NO des significados de cartas individuales. Solo el significado conjunto de cada dupla.
3. Cada parrafo debe conectar explicitamente con la pregunta del consultante.
4. Si la pregunta es concreta, conecta cada dupla con su duda especifica.
5. Responde SOLO con el HTML, sin explicar tu razonamiento.`;
            } else {
                promptUsuario = `Tema: ${tema}. Realiza la lectura por duplas:
- Dupla 1 (PRESENTE): ${a} y ${b} -> Significado conjunto de estas dos cartas juntas.
- Dupla 2 (FUTURO): ${c} y ${d} -> Significado conjunto de estas dos cartas juntas.

NO interpretes carta por carta. Cada dupla es una unidad con un solo mensaje.`;
            }

        // ========== MODO NORMAL (magico/filosofico) ==========
        } else {
            const instruccionesPersonalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, experta lectora de Tarot. Tono mistico, seguro, directo y predictivo. NO uses frases genericas como "las cartas te invitan a reflexionar". Da respuestas concretas.'
                : 'Eres un terapeuta y experto lector de Tarot Evolutivo. Tono reflexivo, psicologico, empatico. Da interpretaciones profundas pero concretas, no vaguedades.';

            promptSistema = `${instruccionesPersonalidad}
ESTRUCTURA DE LECTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = UNA sola interpretacion conjunta del PRESENTE/ESTADO ACTUAL.
- Dupla 2 (${c} + ${d}) = UNA sola interpretacion conjunta del FUTURO/EVOLUCION.
NO interpretes cartas aisladas. Cada dupla tiene un significado UNICO como conjunto.
PROHIBIDO marcadores de posicion como [texto].
NO uses asteriscos, guiones ni vinetas.
Devuelve HTML con class reading-section.
NO uses markdown, NO escribas tu proceso de pensamiento.`;

            if (esPreguntaEspecifica) {
                promptUsuario = `PREGUNTA ESPECIFICA DEL CONSULTANTE: "${preguntaLimpia}"

LECTURA POR DUPLAS:
- Dupla 1 (PRESENTE): ${a} y ${b} -> Que mensaje conjunto entregan estas dos cartas sobre la situacion ACTUAL del consultante EN RELACION A SU PREGUNTA?
- Dupla 2 (FUTURO/EVOLUCION): ${c} y ${d} -> Que mensaje conjunto entregan estas dos cartas sobre hacia donde EVOLUCIONA la situacion EN RELACION A SU PREGUNTA?

REGLAS ESTRICTAS:
1. Responde DIRECTAMENTE a la pregunta del consultante. NO te desvies.
2. NO des significados individuales de ${a}, ${b}, ${c}, ${d}. Solo el significado CONJUNTO de cada dupla.
3. Cada dupla es una unidad indivisible con un solo mensaje.
4. Conecta CADA dupla explicitamente con la pregunta especifica del consultante.
5. Si la pregunta es sobre amor, habla de amor. Si es sobre trabajo, habla de trabajo. Si es sobre dinero, habla de dinero. NO seas generico.
6. Responde SOLO con el HTML, sin explicar tu razonamiento.`;
            } else {
                promptUsuario = `Tema: ${tema}. Realiza la lectura por duplas:

- Dupla 1 (PRESENTE): ${a} y ${b} -> Interpreta estas dos cartas JUNTAS como una sola unidad. Que dicen juntas sobre la situacion actual?
- Dupla 2 (FUTURO/EVOLUCION): ${c} y ${d} -> Interpreta estas dos cartas JUNTAS como una sola unidad. Hacia donde evoluciona la situacion?

REGLA: NO interpretes carta por carta. Cada dupla tiene un significado unico como conjunto.`;
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
                temperature: esModoGratis ? 0.8 : (estilo === 'manual' ? 0.2 : 0.7),
                max_tokens: esModoGratis ? 500 : 1500
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
        console.log('Raw content primeros 200 chars:', rawContent.substring(0, 200));

        let text = limpiarRazonamiento(rawContent);
        console.log('Limpio length:', text.length);
        console.log('Limpio primeros 200 chars:', text.substring(0, 200));

        if (!text) {
            console.warn('Texto vacio despues de limpiar, usando fallback');
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
        let personalidad = estilo === 'manual' ? 'Oraculo analitico de Tarot. Tono claro y didactico.'
            : (estilo === 'morgana' || estilo === 'magico') ? 'Morgana, lectora mistica. Tono directo y firme.'
            : 'Terapeuta de Tarot Evolutivo. Tono empatico y reflexivo.';

        const a = cartas?.a || '';
        const b = cartas?.b || '';
        const c = cartas?.c || '';
        const d = cartas?.d || '';

        const promptSistema = `${personalidad}
El usuario hace una NUEVA PREGUNTA DE SEGUIMIENTO sobre la misma tirada.

CARTAS ORIGINALES (interpretadas por DUPLAS, no individuales):
- Dupla 1 (PRESENTE): ${a} y ${b} -> Significado conjunto de estas dos cartas juntas.
- Dupla 2 (FUTURO): ${c} y ${d} -> Significado conjunto de estas dos cartas juntas.

REGLAS ESTRICTAS:
1. Responde DIRECTAMENTE a la NUEVA PREGUNTA usando el significado CONJUNTO de cada dupla.
2. NO interpretes cartas aisladas. Cada dupla es una unidad indivisible.
3. NO repitas la lectura anterior.
4. Conecta tu respuesta explicitamente con la nueva pregunta del usuario.
5. Maximo 2 parrafos. NO asteriscos. Solo HTML basico.
6. NO escribas tu proceso de pensamiento. Responde SOLO con el HTML.`;

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
                temperature: 0.6,
                max_tokens: 600
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(500).json({ error: 'Error en la API de IA', detalle: data.error?.message });
        }

        let respuestaIA = limpiarRazonamiento(data.choices[0].message?.content || '');
        if (!respuestaIA) respuestaIA = '<p>Las cartas sugieren reflexionar con calma sobre este aspecto.</p>';

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
