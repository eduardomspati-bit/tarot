const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

const corsOptions = {
    origin: [
        'https://tarot-ia.netlify.app',
        'https://tarotia-app-psi.github.io',
        'http://localhost:3000',
        'http://127.0.0.1:5500'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
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
const MODEL_NAME = process.env.MODEL_NAME || 'openai/gpt-oss-20b';
const API_KEY = process.env.GROQ_API_KEY || process.env.API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

console.log('CONFIG SERVIDOR:');
console.log('  MODEL_NAME:', MODEL_NAME);
console.log('  API_KEY existe:', !!API_KEY);
console.log('  ADMIN_TOKEN existe:', !!ADMIN_TOKEN);

// ==========================================
// MIDDLEWARE DE ADMIN
// ==========================================
function verificarAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!ADMIN_TOKEN) {
        return res.status(500).json({ error: 'Configuracion incompleta.' });
    }
    if (!token || token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Acceso denegado.' });
    }
    next();
}

// ==========================================
// FUNCION: EXTRAER RESPUESTA REAL
// ==========================================
function extraerRespuesta(texto) {
    if (!texto) return '';

    const idxCierre = texto.lastIndexOf('</thinking>');
    if (idxCierre !== -1) {
        const despues = texto.substring(idxCierre + 11).trim();
        if (despues.length > 20) {
            console.log('  Respuesta extraida despues de </thinking> (', despues.length, 'chars)');
            return despues;
        }
    }

    const idxApertura = texto.indexOf('<thinking>');
    if (idxApertura !== -1) {
        const antes = texto.substring(0, idxApertura).trim();
        const despuesDelTag = texto.substring(idxApertura + 10);
        const idxCierre2 = despuesDelTag.indexOf('</thinking>');
        if (idxCierre2 !== -1) {
            const despues = despuesDelTag.substring(idxCierre2 + 11).trim();
            if (despues.length > 20) {
                console.log('  Respuesta extraida despues de </thinking> v2 (', despues.length, 'chars)');
                return despues;
            }
        }
        if (antes.length > 20) {
            console.log('  Solo contenido antes de <thinking> (', antes.length, 'chars)');
            return antes;
        }
    }

    const idxDiv = texto.indexOf('<div');
    if (idxDiv !== -1) {
        return texto.substring(idxDiv);
    }

    const palabrasClave = ['Conclusion', 'Prediccion', 'Dupla', 'Presente', 'Futuro', 'El camino', 'Debes', 'La situacion', 'Las cartas', 'Significado'];
    for (const palabra of palabrasClave) {
        const idx = texto.indexOf(palabra);
        if (idx !== -1 && idx < texto.length - 30) {
            return texto.substring(idx);
        }
    }

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
        const esPreguntaEspecifica = (tema === 'Pregunta Especifica' || tema === 'Pregunta Específica') && preguntaLimpia.length > 0;
        const esModoGratis = modo === 'gratis';

        let systemPrompt = '';
        let userPrompt = '';
        let temp = 0.7;

        if (esModoGratis) {
            systemPrompt = `Eres Morgana, experta lectora de Tarot. Tono mistico, directo y predictivo.
Responde SOLO con 2 secciones HTML con class="reading-section".
Cada seccion debe tener al menos 3 oraciones completas.
NO saludes. NO uses asteriscos ni markdown.`;

            userPrompt = `Pregunta: "${preguntaLimpia || 'Consulta general'}"
Dupla 1 (Presente): ${a} y ${b}
Dupla 2 (Futuro): ${c} y ${d}

Responde en espanol. Seccion 1 = CONCLUSION sobre la pregunta. Seccion 2 = PREDICCION.`;

        } else if (estilo === 'manual') {
            // ==========================================
            // MAZO FISICO TECNICO / ESTRUCTURAL
            // VERSION QUE FUNCIONABA: template HTML completo en system prompt
            // ==========================================
            temp = 0.3;

            systemPrompt = `Actua como un diccionario tecnico, objetivo y neutral de Tarot.
Tu tarea exclusiva es analizar las dos duplas de cartas que te presenta el usuario:
- Dupla 1: ${a} y ${b}
- Dupla 2: ${c} y ${d}

Devuelve la respuesta estructurada ESTRICTAMENTE en formato HTML de la siguiente manera:

<div class="reading-section">
    <h3>Dupla 1: ${a} + ${b}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado practico]</li>
        <li><strong>Significado 2:</strong> [Significado practico]</li>
        <li><strong>Significado 3:</strong> [Significado practico]</li>
    </ul>
</div>

<div class="reading-section">
    <h3>Dupla 2: ${c} + ${d}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado practico]</li>
        <li><strong>Significado 2:</strong> [Significado practico]</li>
        <li><strong>Significado 3:</strong> [Significado practico]</li>
    </ul>
</div>

NO uses asteriscos ni markdown. NO agregues texto fuera del HTML. Solo reemplaza los placeholders [Significado practico] por definiciones reales.`;

            userPrompt = (esPreguntaEspecifica)
                ? `Pregunta especifica: "${preguntaLimpia}". Cartas: ${a}, ${b}, ${c} y ${d}.`
                : `Tema general: ${tema}. Cartas: ${a}, ${b}, ${c} y ${d}.`;

        } else {
            const personalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, una experta y asertiva lectora de Tarot Rider-Waite. Tu tono es directo, mistico y predictivo. Respuestas concretas, no genericas.'
                : 'Eres un terapeuta y experto lector de Tarot Evolutivo. Tu tono es empatico, reflexivo y psicologico. Interpretaciones profundas pero concretas.';

            const reglasFormato = `
NO uses listas, viñetas, guiones ni asteriscos (*).

Devuelve la respuesta EXACTAMENTE en este formato HTML (comienza directamente con el primer div):

<div class="reading-section">
    <h3>El Presente y Origen (${a} + ${b})</h3>
    <p>[Interpretacion estado actual]</p>
</div>

<div class="reading-section">
    <h3>El Camino hacia el Futuro (${c} + ${d})</h3>
    <p>[Interpretacion futuro a corto plazo]</p>
</div>

<div class="reading-section">
    <h3>Predicciones del Oraculo</h3>
    <p>[2 o 3 predicciones concretas en un solo parrafo]</p>
</div>

<div class="reading-section">
    <h3>Consejo y Conclusion</h3>
    <p><span id="conclusion">[Frase de cierre y consejo final]</span></p>
</div>`;

            systemPrompt = personalidad + reglasFormato;

            userPrompt = (esPreguntaEspecifica)
                ? `Pregunta especifica: "${preguntaLimpia}". Cartas: ${a}, ${b}, ${c} y ${d}.`
                : `Tema general: ${tema}. Cartas: ${a}, ${b}, ${c} y ${d}.`;
        }

        console.log('Llamando a Groq... Modelo:', MODEL_NAME, 'Temp:', temp);

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: temp,
                max_tokens: 2500
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
        console.log('Raw primeros 200:', raw.substring(0, 200).replace(/\n/g, ' '));

        let text = extraerRespuesta(raw);
        console.log('Limpio length:', text.length);
        console.log('Limpio primeros 200:', text.substring(0, 200).replace(/\n/g, ' '));

        if (!text || text.length < 30) {
            console.warn('Fallback activado');
            if (esModoGratis) {
                text = `<div class="reading-section"><h3>Conclusion</h3><p>La dupla ${a} y ${b} indica que la situacion actual requiere atencion y reflexion profunda. Hay energias presentes que piden ser comprendidas antes de tomar cualquier decision importante.</p></div><div class="reading-section"><h3>Prediccion</h3><p>La dupla ${c} y ${d} revela un cambio significativo en el horizonte que traera nuevas oportunidades de crecimiento y transformacion.</p></div>`;
            } else if (estilo === 'manual') {
                text = `<div class="reading-section"><h3>Dupla 1: ${a} + ${b}</h3><ul><li><strong>Significado 1:</strong> Energia presente que marca la dinamica actual de la situacion.</li><li><strong>Significado 2:</strong> Indicador de fuerzas en juego que condicionan el desarrollo inmediato.</li><li><strong>Significado 3:</strong> Representacion de los factores dominantes en este momento.</li></ul></div><div class="reading-section"><h3>Dupla 2: ${c} + ${d}</h3><ul><li><strong>Significado 1:</strong> Proyeccion de tendencias que se manifestaran en el futuro cercano.</li><li><strong>Significado 2:</strong> Indicador de posibles cambios o evoluciones en el camino.</li><li><strong>Significado 3:</strong> Representacion de las energias que estan por activarse.</li></ul></div>`;
            } else {
                text = `<div class="reading-section"><h3>El Presente y Origen (${a} + ${b})</h3><p>La combinacion de ${a} y ${b} revela una energia actual intensa que pide ser comprendida en su conjunto. Hay dinamicas ocultas que influyen en la situacion y requieren atencion.</p></div><div class="reading-section"><h3>El Camino hacia el Futuro (${c} + ${d})</h3><p>La dupla ${c} y ${d} indica una evolucion importante que transformara la situacion de manera significativa, abriendo nuevos caminos.</p></div><div class="reading-section"><h3>Predicciones del Oraculo</h3><p>Se avecinan cambios profundos que redefiniran tu perspectiva. La paciencia sera clave para aprovechar las oportunidades que se presentaran en los proximos dias.</p></div><div class="reading-section"><h3>Consejo y Conclusion</h3><p><span id="conclusion">Confia en tu intuicion y manten la mente abierta ante lo nuevo.</span></p></div>`;
            }
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
        const personalidad = estilo === 'manual' 
            ? 'Diccionario tecnico de Tarot. Tono neutro y descriptivo. Responde con significados sin interpretar ni relacionar duplas. Referite directamente a la pregunta del usuario.'
            : (estilo === 'morgana' || estilo === 'magico') ? 'Morgana, lectora mistica. Respuestas concretas referidas a la pregunta del usuario.'
            : 'Terapeuta de Tarot Evolutivo. Respuestas profundas referidas a la pregunta del usuario.';

        const a = cartas?.a || '';
        const b = cartas?.b || '';
        const c = cartas?.c || '';
        const d = cartas?.d || '';

        const systemPrompt = `${personalidad}
Responde con HTML simple. Al menos 3 oraciones completas.
NO uses asteriscos ni markdown.
La respuesta debe referirse directamente a la pregunta del usuario, no algo generico.`;

        const userPrompt = `Cartas de la tirada: ${a} y ${b} (presente), ${c} y ${d} (futuro).
Nueva pregunta del usuario: ${repregunta.trim().slice(0, 300)}

Responde directo a la pregunta del usuario. NO respondas algo generico.`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 2048
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(500).json({ error: 'Error en la API de IA' });
        }

        let respuesta = extraerRespuesta(data.choices[0].message?.content || '');
        if (!respuesta || respuesta.length < 20) {
            respuesta = '<p>Las cartas sugieren reflexionar profundamente sobre este aspecto antes de tomar una decision.</p>';
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
