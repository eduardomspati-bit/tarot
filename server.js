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

const MODEL_NAME = process.env.MODEL_NAME || 'qwen/qwen3.6-27b';
const API_KEY = process.env.GROQ_API_KEY || process.env.API_KEY;
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
    let { tema, a, b, c, d, estilo = 'filosofico', pregunta, cartas, modo } = req.body;

    if (!a && cartas && Array.isArray(cartas) && cartas.length >= 4) {
        a = cartas[0]; b = cartas[1]; c = cartas[2]; d = cartas[3];
    }

    try {
        if (!a || !b || !c || !d) {
            return res.status(400).json({ error: 'Faltan cartas. Envía a,b,c,d o cartas[].' });
        }

        const esPreguntaEspecifica = (tema === 'Pregunta Especifica' || tema === 'Pregunta Específica') && pregunta && pregunta.trim().length > 0;
        const esModoGratis = modo === 'gratis';

        let promptSistema = '';
        let promptUsuario = '';

        // ========== MODO GRATIS: Solo Conclusión + Predicción ==========
        if (esModoGratis) {
            promptSistema = `Eres Morgana, experta lectora de Tarot. Tono místico, directo y predictivo.
ESTRUCTURA OBLIGATORIA - Solo 2 secciones:
1. CONCLUSIÓN (sobre la pregunta del consultante, basada en la Dupla 1)
2. PREDICCIÓN (sobre el futuro, basada en la Dupla 2)

REGLAS ESTRICTAS:
- Máximo 120 palabras en total.
- NO saludos. NO introducciones. NO "las cartas dicen" genérico.
- Responde DIRECTAMENTE a la pregunta del consultante.
- Cada dupla se lee como UNIDAD INDIVISIBLE (no carta por carta).
- Devuelve HTML simple con class reading-section.`;

            promptUsuario = `PREGUNTA: "${pregunta || 'Consulta general'}"

DUPLAS:
- Dupla 1 (PRESENTE/SITUACIÓN ACTUAL): ${a} y ${b} → Una frase de conclusión directa sobre la pregunta.
- Dupla 2 (FUTURO/EVOLUCIÓN): ${c} y ${d} → Una frase de predicción sobre qué va a pasar.

Responde AHORA en español, directo al grano.`;

        // ========== MODO MANUAL ==========
        } else if (estilo === 'manual') {
            promptSistema = `Actua como un diccionario tecnico de Tarot.
ESTRUCTURA DE LECTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = UNA sola interpretacion conjunta del PRESENTE.
- Dupla 2 (${c} + ${d}) = UNA sola interpretacion conjunta del FUTURO/EVOLUCION.
NO interpretes cartas aisladas. Cada dupla tiene un significado UNICO como conjunto.
Tono neutro, analitico. PROHIBIDO relacionar Dupla 1 con Dupla 2.
NO uses marcadores de posicion.
Devuelve HTML con class reading-section.`;

            if (esPreguntaEspecifica) {
                promptUsuario = `PREGUNTA DEL CONSULTANTE: "${pregunta.trim()}"

LECTURA POR DUPLAS:
- Dupla 1 (PRESENTE): ${a} y ${b} → Interpreta estas DOS cartas JUNTAS como una sola unidad. ¿Qué dicen juntas sobre la situacion actual?
- Dupla 2 (FUTURO/EVOLUCION): ${c} y ${d} → Interpreta estas DOS cartas JUNTAS como una sola unidad. ¿Hacia donde evoluciona la situacion?

REGLAS:
1. Responde DIRECTAMENTE a la pregunta usando las duplas como unidades.
2. NO des significados de cartas individuales. Solo el significado conjunto de cada dupla.
3. Si la pregunta es concreta, conecta cada dupla con su duda especifica.`;
            } else {
                promptUsuario = `Tema: ${tema}. Realiza la lectura por duplas:
- Dupla 1 (PRESENTE): ${a} y ${b} → Significado conjunto de estas dos cartas juntas.
- Dupla 2 (FUTURO): ${c} y ${d} → Significado conjunto de estas dos cartas juntas.

NO interpretes carta por carta. Cada dupla es una unidad con un solo mensaje.`;
            }

        // ========== MODO NORMAL (magico/filosofico) ==========
        } else {
            let instruccionesPersonalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, experta lectora de Tarot. Tono mistico, seguro, directo y predictivo.'
                : 'Eres un terapeuta y experto lector de Tarot Evolutivo. Tono reflexivo, psicologico, empatico.';

            promptSistema = instruccionesPersonalidad + `
ESTRUCTURA DE LECTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = UNA sola interpretacion conjunta del PRESENTE/ESTADO ACTUAL.
- Dupla 2 (${c} + ${d}) = UNA sola interpretacion conjunta del FUTURO/EVOLUCION.
NO interpretes cartas aisladas. Cada dupla tiene un significado UNICO como conjunto.
PROHIBIDO marcadores de posicion como [texto].
NO uses asteriscos, guiones ni vinetas.
Devuelve HTML con class reading-section.`;

            if (esPreguntaEspecifica) {
                promptUsuario = `PREGUNTA DEL CONSULTANTE: "${pregunta.trim()}"

LECTURA POR DUPLAS:
- Dupla 1 (PRESENTE): ${a} y ${b} → ¿Qué mensaje conjunto entregan estas dos cartas sobre la situacion ACTUAL del consultante?
- Dupla 2 (FUTURO/EVOLUCION): ${c} y ${d} → ¿Qué mensaje conjunto entregan estas dos cartas sobre hacia donde EVOLUCIONA la situacion?

REGLAS ESTRICTAS:
1. Responde DIRECTAMENTE a la pregunta del consultante.
2. NO des significados individuales de ${a}, ${b}, ${c}, ${d}. Solo el significado CONJUNTO de cada dupla.
3. Cada dupla es una unidad indivisible con un solo mensaje.
4. Conecta cada dupla con la pregunta especifica del consultante.`;
            } else {
                promptUsuario = `Tema: ${tema}. Realiza la lectura por duplas:

- Dupla 1 (PRESENTE): ${a} y ${b} → Interpreta estas dos cartas JUNTAS como una sola unidad. ¿Qué dicen juntas sobre la situacion actual?
- Dupla 2 (FUTURO/EVOLUCION): ${c} y ${d} → Interpreta estas dos cartas JUNTAS como una sola unidad. ¿Hacia donde evoluciona la situacion?

REGLA: NO interpretes carta por carta. Cada dupla tiene un significado unico como conjunto.`;
            }
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
                temperature: esModoGratis ? 0.8 : (estilo === 'manual' ? 0.2 : 0.7),
                max_tokens: esModoGratis ? 300 : 1500
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
            if (esModoGratis) {
                text = `<div class="reading-section"><h3>✨ Conclusión</h3><p>Las cartas ${a} y ${b} indican que la situación actual requiere atención.</p></div><div class="reading-section"><h3>🔮 Predicción</h3><p>La Dupla ${c} y ${d} revela un cambio positivo en el horizonte.</p></div>`;
            } else {
                text = `<div class="reading-section"><h3>Dupla 1: Presente (${a} + ${b})</h3><p>Estas dos cartas juntas revelan la energia actual de la situacion.</p></div><div class="reading-section"><h3>Dupla 2: Futuro (${c} + ${d})</h3><p>Estas dos cartas juntas indican la evolucion que se avecina.</p></div>`;
            }
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

        const a = cartas?.a || '';
        const b = cartas?.b || '';
        const c = cartas?.c || '';
        const d = cartas?.d || '';

        const promptSistema = `${personalidad}

El usuario hace una NUEVA pregunta de seguimiento sobre la misma tirada.

CARTAS ORIGINALES (interpretadas por DUPLAS, no individuales):
- Dupla 1 (PRESENTE): ${a} y ${b} → Significado conjunto de estas dos cartas juntas.
- Dupla 2 (FUTURO): ${c} y ${d} → Significado conjunto de estas dos cartas juntas.

REGLAS ESTRICTAS:
1. Responde DIRECTAMENTE a la NUEVA PREGUNTA usando el significado CONJUNTO de cada dupla.
2. NO interpretes cartas aisladas. Cada dupla es una unidad indivisible.
3. NO repitas la lectura anterior.
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
        return res.status(400).json({ error: 'Plan inválido. Use Gratis o Premium' });
    }

    try {
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
    }

    if (!token || token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Acceso denegado. Token inválido o ausente.' });
    }
    next();
}

// ==========================================
// FUNCIÓN AUXILIAR: LIMPIAR HTML/THINKING
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
    let { tema, a, b, c, d, estilo = 'filosofico', pregunta, cartas, modo } = req.body;

    if (!a && cartas && Array.isArray(cartas) && cartas.length >= 4) {
        a = cartas[0]; b = cartas[1]; c = cartas[2]; d = cartas[3];
    }

    if (!a || !b || !c || !d) {
        return res.status(400).json({ error: 'Faltan cartas. Envía a,b,c,d o cartas[].' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'API Key de Groq no configurada.' });
    }

    try {
        const preguntaLimpia = (pregunta && typeof pregunta === 'string') ? pregunta.trim().slice(0, 300) : '';
        const esPreguntaEspecifica = (tema === 'Pregunta Especifica' || tema === 'Pregunta Específica') && preguntaLimpia.length > 0;
        const esModoGratis = modo === 'gratis';

        let promptSistema = '';
        let promptUsuario = '';

        if (esModoGratis) {
            promptSistema = `Eres Morgana, experta lectora de Tarot. Tono místico, directo y predictivo.
ESTRUCTURA OBLIGATORIA - Solo 2 secciones:
1. CONCLUSIÓN (sobre la pregunta del consultante, basada en la Dupla 1)
2. PREDICCIÓN (sobre el futuro, basada en la Dupla 2)

REGLAS ESTRICTAS:
- Máximo 120 palabras en total.
- NO saludos. NO introducciones.
- Cada dupla se lee como UNIDAD INDIVISIBLE.
- Devuelve HTML simple con class reading-section.`;

            promptUsuario = `PREGUNTA: "${preguntaLimpia || 'Consulta general'}"

DUPLAS:
- Dupla 1 (PRESENTE/SITUACIÓN ACTUAL): ${a} y ${b}
- Dupla 2 (FUTURO/EVOLUCIÓN): ${c} y ${d}

Responde AHORA en español, directo al grano.`;

        } else if (estilo === 'manual') {
            promptSistema = `Actúa como un diccionario técnico de Tarot.
ESTRUCTURA DE LECTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = UNA sola interpretación conjunta del PRESENTE.
- Dupla 2 (${c} + ${d}) = UNA sola interpretación conjunta del FUTURO/EVOLUCIÓN.
NO interpretes cartas aisladas.
Tono neutro, analítico. Devuelve HTML con class reading-section.`;

            promptUsuario = esPreguntaEspecifica 
                ? `PREGUNTA DEL CONSULTANTE: "${preguntaLimpia}"\n\nDUPLAS:\n- Dupla 1 (PRESENTE): ${a} y ${b}\n- Dupla 2 (FUTURO/EVOLUCIÓN): ${c} y ${d}`
                : `Tema: ${tema}.\n\nDUPLAS:\n- Dupla 1 (PRESENTE): ${a} y ${b}\n- Dupla 2 (FUTURO): ${c} y ${d}`;

        } else {
            const instruccionesPersonalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, experta lectora de Tarot. Tono místico, seguro, directo y predictivo.'
                : 'Eres un terapeuta y experto lector de Tarot Evolutivo. Tono reflexivo, psicológico, empático.';

            promptSistema = `${instruccionesPersonalidad}
ESTRUCTURA DE LECTURA POR DUPLAS (OBLIGATORIA):
- Dupla 1 (${a} + ${b}) = UNA sola interpretación conjunta del PRESENTE/ESTADO ACTUAL.
- Dupla 2 (${c} + ${d}) = UNA sola interpretación conjunta del FUTURO/EVOLUCIÓN.
NO interpretes cartas aisladas. Cada dupla tiene un significado ÚNICO como conjunto.
Devuelve HTML con class reading-section.`;

            promptUsuario = esPreguntaEspecifica
                ? `PREGUNTA DEL CONSULTANTE: "${preguntaLimpia}"\n\nDUPLAS:\n- Dupla 1 (PRESENTE): ${a} y ${b}\n- Dupla 2 (FUTURO/EVOLUCIÓN): ${c} y ${d}`
                : `Tema: ${tema}.\n\nDUPLAS:\n- Dupla 1 (PRESENTE): ${a} y ${b}\n- Dupla 2 (FUTURO): ${c} y ${d}`;
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
                temperature: esModoGratis ? 0.8 : (estilo === 'manual' ? 0.2 : 0.7),
                max_tokens: esModoGratis ? 300 : 1500
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            console.error('Error Groq API:', data);
            return res.status(response.status || 500).json({
                error: 'Respuesta incompleta del proveedor de IA.',
                detalle: data.error?.message || 'Error desconocido'
            });
        }

        let text = limpiarRazonamiento(data.choices[0].message?.content || '');

        if (!text) {
            text = esModoGratis 
                ? `<div class="reading-section"><h3>✨ Conclusión</h3><p>Las cartas ${a} y ${b} indican que la situación actual requiere atención.</p></div><div class="reading-section"><h3>🔮 Predicción</h3><p>La Dupla ${c} y ${d} revela un cambio en el horizonte.</p></div>`
                : `<div class="reading-section"><h3>Dupla 1: Presente (${a} + ${b})</h3><p>Estas dos cartas juntas revelan la energía actual.</p></div><div class="reading-section"><h3>Dupla 2: Futuro (${c} + ${d})</h3><p>Estas dos cartas juntas indican la evolución que se avecina.</p></div>`;
        }

        return res.json({ lectura: text });

    } catch (error) {
        console.error('Error en /tirada:', error);
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
        let personalidad = estilo === 'manual' ? 'Oráculo analítico de Tarot. Tono claro y didáctico.'
            : (estilo === 'morgana' || estilo === 'magico') ? 'Morgana, lectora mística. Tono directo y firme.'
            : 'Terapeuta de Tarot Evolutivo. Tono empático y reflexivo.';

        const a = cartas?.a || '';
        const b = cartas?.b || '';
        const c = cartas?.c || '';
        const d = cartas?.d || '';

        const promptSistema = `${personalidad}
NUEVA PREGUNTA DE SEGUIMIENTO sobre la misma tirada.
CARTAS (interpretadas por DUPLAS):
- Dupla 1: ${a} y ${b}
- Dupla 2: ${c} y ${d}

REGLAS: Responde DIRECTAMENTE en máximo 2 párrafos. Solo HTML básico. Sin asteriscos.`;

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
            return res.status(response.status || 500).json({ error: 'Error en la API de IA' });
        }

        let respuestaIA = limpiarRazonamiento(data.choices[0].message?.content || '');
        if (!respuestaIA) respuestaIA = '<p>Las cartas sugieren reflexionar con calma sobre este aspecto.</p>';

        return res.json({ respuesta: respuestaIA });

    } catch (error) {
        console.error('Error en /repregunta:', error);
        return res.status(500).json({ error: 'La conexión con la repregunta falló.' });
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
        return res.status(400).json({ error: 'Plan inválido. Use Gratis o Premium' });
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
