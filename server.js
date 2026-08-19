// ==========================================
// SERVIDOR PRINCIPAL - TarotIA
// ==========================================

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// ==========================================
// CONFIGURACIÓN CORS
// ==========================================
const corsOptions = {
    origin: [
        'https://tarot-ia.netlify.app',
        'https://tarotia-app-psi.github.io',
        'http://localhost:3000',
        'http://127.0.0.1:5500',
        'http://localhost:5500',
        'http://localhost:8080',
        // Agregar URLs de producción
        'https://tu-app.netlify.app',
        'https://tu-app.vercel.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token'],
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// VARIABLES DE ENTORNO
// ==========================================
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://edu1826_db_user:GATO8objeto@cluster0.39xxpjk.mongodb.net/tarotApp?retryWrites=true&w=majority";
const MODEL_NAME = process.env.MODEL_NAME || 'openai/gpt-oss-20b';
const API_KEY = process.env.GROQ_API_KEY || process.env.API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'tarotia-secret-key-2026';
const PORT = process.env.PORT || 10000;
const MAX_MUESTRAS_FISICAS = 5;
const MAX_CONSULTAS_GRATIS_DIA = 3;

console.log('==========================================');
console.log('📊 CONFIGURACIÓN DEL SERVIDOR:');
console.log(`  MODEL_NAME: ${MODEL_NAME}`);
console.log(`  API_KEY existe: ${!!API_KEY}`);
console.log(`  ADMIN_TOKEN existe: ${!!ADMIN_TOKEN}`);
console.log(`  MONGO_URI existe: ${!!MONGO_URI}`);
console.log(`  JWT_SECRET existe: ${!!JWT_SECRET}`);
console.log(`  PUERTO: ${PORT}`);
console.log('==========================================');

// ==========================================
// MODELOS DE MONGOOSE
// ==========================================

// Esquema de Usuario
const UsuarioSchema = new mongoose.Schema({
    nombre: { 
        type: String, 
        required: true,
        default: 'Consultante'
    },
    email: { 
        type: String, 
        required: true, 
        unique: true, 
        lowercase: true, 
        trim: true 
    },
    plan: { 
        type: String, 
        enum: ['Gratis', 'Premium'], 
        default: 'Gratis' 
    },
    totalTiradas: { 
        type: Number, 
        default: 0 
    },
    muestrasFisicasUsadas: { 
        type: Number, 
        default: 0 
    },
    consultasGratisHoy: { 
        type: Number, 
        default: 0 
    },
    ultimaConsultaGratis: { 
        type: String, 
        default: null 
    },
    ultimaConexion: { 
        type: String, 
        default: () => new Date().toISOString().split('T')[0] 
    },
    codigoPremiumUsado: { 
        type: String, 
        default: null 
    },
    fechaRegistro: { 
        type: Date, 
        default: Date.now 
    }
}, { timestamps: true });

const Usuario = mongoose.models.Usuario || mongoose.model('Usuario', UsuarioSchema);

// Esquema de Códigos Premium
const CodigoPremiumSchema = new mongoose.Schema({
    codigo: { 
        type: String, 
        required: true, 
        unique: true, 
        uppercase: true 
    },
    usado: { 
        type: Boolean, 
        default: false 
    },
    usadoPor: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Usuario', 
        default: null 
    },
    fechaUso: { 
        type: Date, 
        default: null 
    },
    creadoPor: { 
        type: String, 
        default: 'admin' 
    }
}, { timestamps: true });

const CodigoPremium = mongoose.models.CodigoPremium || mongoose.model('CodigoPremium', CodigoPremiumSchema);

// Esquema de Duplas (para el modo estructural)
const DuplaSchema = new mongoose.Schema({
    claveBuscador: { 
        type: String, 
        required: true 
    },
    cartaA: { 
        type: String, 
        required: true 
    },
    cartaB: { 
        type: String, 
        required: true 
    },
    significado: { 
        type: String, 
        required: true 
    },
    keywords: [{ 
        type: String 
    }]
}, { timestamps: true, collection: 'duplas' });

DuplaSchema.index({ claveBuscador: 1 }, { unique: true });
DuplaSchema.index({ cartaA: 1, cartaB: 1 });

const Dupla = mongoose.models.Dupla || mongoose.model('Dupla', DuplaSchema);

// ==========================================
// CONEXIÓN A MONGODB
// ==========================================
if (MONGO_URI) {
    mongoose.connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(async () => {
        console.log("✅ Conectado a MongoDB Atlas con éxito.");
        
        try {
            // Verificar colecciones
            const db = mongoose.connection.db;
            const colecciones = await db.listCollections().toArray();
            console.log("📚 Colecciones disponibles:");
            colecciones.forEach(c => console.log(`   - ${c.name}`));
            
            // Verificar duplas
            const countDuplas = await Dupla.countDocuments();
            console.log(`📊 Duplas en base de datos: ${countDuplas}`);
            
            if (countDuplas > 0) {
                const sample = await Dupla.findOne({});
                console.log("📄 Ejemplo de dupla:", JSON.stringify(sample, null, 2));
            }
        } catch (e) {
            console.error("❌ Error en diagnóstico:", e);
        }
    })
    .catch(err => console.error('❌ Error MongoDB:', err.message));
} else {
    console.warn('⚠️ MONGO_URI no configurada. Modo offline.');
}

// ==========================================
// FUNCIONES DE MIDDLEWARE
// ==========================================

// Verificar token de administrador
function verificarAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!ADMIN_TOKEN) {
        return res.status(500).json({ error: 'Configuración incompleta.' });
    }
    if (!token || token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Acceso denegado. Token de admin inválido.' });
    }
    next();
}

// Verificar autenticación de usuario (JWT)
function verificarAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token requerido. Inicia sesión.' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(403).json({ error: 'Token expirado. Inicia sesión nuevamente.' });
        }
        return res.status(403).json({ error: 'Token inválido.' });
    }
}

// ==========================================
// RUTAS DE AUTENTICACIÓN
// ==========================================

// Registrar usuario (o login si ya existe)
app.post('/api/auth/registrar', async (req, res) => {
    const { nombre, email } = req.body;
    
    if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'Email inválido.' });
    }
    
    const nombreLimpio = (nombre && typeof nombre === 'string') ? nombre.trim() : 'Consultante';
    const emailLimpio = email.toLowerCase().trim();

    try {
        let usuario = await Usuario.findOne({ email: emailLimpio });
        
        if (usuario) {
            // Usuario existente - actualizar última conexión
            usuario.ultimaConexion = new Date().toISOString().split('T')[0];
            usuario.nombre = nombreLimpio;
            await usuario.save();
            console.log(`[auth] Usuario existente: ${emailLimpio}`);
        } else {
            // Nuevo usuario
            usuario = new Usuario({
                nombre: nombreLimpio,
                email: emailLimpio,
                plan: 'Gratis',
                totalTiradas: 0,
                muestrasFisicasUsadas: 0,
                consultasGratisHoy: 0,
                ultimaConsultaGratis: null
            });
            await usuario.save();
            console.log(`[auth] Nuevo usuario registrado: ${emailLimpio}`);
        }

        const token = jwt.sign(
            { 
                userId: usuario._id, 
                email: usuario.email, 
                plan: usuario.plan 
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            mensaje: 'Usuario autenticado correctamente.',
            token,
            usuario: {
                id: usuario._id,
                nombre: usuario.nombre,
                email: usuario.email,
                plan: usuario.plan,
                totalTiradas: usuario.totalTiradas,
                muestrasFisicasUsadas: usuario.muestrasFisicasUsadas,
                muestrasFisicasRestantes: Math.max(0, MAX_MUESTRAS_FISICAS - usuario.muestrasFisicasUsadas),
                consultasGratisHoy: usuario.consultasGratisHoy,
                ultimaConexion: usuario.ultimaConexion
            }
        });
    } catch (error) {
        console.error('[auth] Error en registro:', error);
        res.status(500).json({ error: 'Error al autenticar usuario.' });
    }
});

// Login (obtener datos del usuario)
app.post('/api/auth/login', async (req, res) => {
    const { email } = req.body;
    
    if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'Email inválido.' });
    }
    
    const emailLimpio = email.toLowerCase().trim();

    try {
        const usuario = await Usuario.findOne({ email: emailLimpio });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado. Registrate primero.' });
        }

        usuario.ultimaConexion = new Date().toISOString().split('T')[0];
        await usuario.save();

        const token = jwt.sign(
            { 
                userId: usuario._id, 
                email: usuario.email, 
                plan: usuario.plan 
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            mensaje: 'Login exitoso',
            token,
            usuario: {
                id: usuario._id,
                nombre: usuario.nombre,
                email: usuario.email,
                plan: usuario.plan,
                totalTiradas: usuario.totalTiradas,
                muestrasFisicasUsadas: usuario.muestrasFisicasUsadas,
                muestrasFisicasRestantes: Math.max(0, MAX_MUESTRAS_FISICAS - usuario.muestrasFisicasUsadas),
                consultasGratisHoy: usuario.consultasGratisHoy
            }
        });
    } catch (error) {
        console.error('[auth] Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión.' });
    }
});

// Obtener perfil del usuario
app.get('/api/auth/perfil', verificarAuth, async (req, res) => {
    try {
        const usuario = await Usuario.findById(req.usuario.userId);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        res.json({
            usuario: {
                id: usuario._id,
                nombre: usuario.nombre,
                email: usuario.email,
                plan: usuario.plan,
                totalTiradas: usuario.totalTiradas,
                muestrasFisicasUsadas: usuario.muestrasFisicasUsadas,
                muestrasFisicasRestantes: Math.max(0, MAX_MUESTRAS_FISICAS - usuario.muestrasFisicasUsadas),
                consultasGratisHoy: usuario.consultasGratisHoy,
                ultimaConexion: usuario.ultimaConexion
            }
        });
    } catch (error) {
        console.error('[auth] Error al obtener perfil:', error);
        res.status(500).json({ error: 'Error al obtener perfil.' });
    }
});

// ==========================================
// RUTAS DE SUSCRIPCIÓN / CÓDIGOS PREMIUM
// ==========================================

// Canjear código premium
app.post('/api/auth/canjear-codigo', verificarAuth, async (req, res) => {
    const { codigo } = req.body;
    if (!codigo) {
        return res.status(400).json({ error: 'Código requerido.' });
    }

    const codigoLimpio = codigo.trim().toUpperCase();

    try {
        // Códigos especiales del sistema (válidos siempre)
        const codigosAdmin = ['ADMIN2026', 'PASEMISTICO', 'TAROTGRATIS'];

        if (codigosAdmin.includes(codigoLimpio)) {
            const usuario = await Usuario.findById(req.usuario.userId);
            usuario.plan = 'Premium';
            usuario.codigoPremiumUsado = codigoLimpio;
            await usuario.save();

            const nuevoToken = jwt.sign(
                { 
                    userId: usuario._id, 
                    email: usuario.email, 
                    plan: usuario.plan 
                },
                JWT_SECRET,
                { expiresIn: '30d' }
            );

            return res.json({
                mensaje: '¡Código premium activado con éxito!',
                token: nuevoToken,
                usuario: {
                    id: usuario._id,
                    nombre: usuario.nombre,
                    email: usuario.email,
                    plan: usuario.plan,
                    totalTiradas: usuario.totalTiradas,
                    muestrasFisicasRestantes: 999 // Premium = ilimitado
                }
            });
        }

        // Buscar en la base de datos
        const codigoDB = await CodigoPremium.findOne({ codigo: codigoLimpio });
        if (!codigoDB) {
            return res.status(400).json({ error: 'Código inválido.' });
        }
        if (codigoDB.usado) {
            return res.status(400).json({ error: 'Código ya utilizado.' });
        }

        const usuario = await Usuario.findById(req.usuario.userId);
        usuario.plan = 'Premium';
        usuario.codigoPremiumUsado = codigoLimpio;
        await usuario.save();

        codigoDB.usado = true;
        codigoDB.usadoPor = usuario._id;
        codigoDB.fechaUso = new Date();
        await codigoDB.save();

        const nuevoToken = jwt.sign(
            { 
                userId: usuario._id, 
                email: usuario.email, 
                plan: usuario.plan 
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            mensaje: '¡Código premium activado con éxito!',
            token: nuevoToken,
            usuario: {
                id: usuario._id,
                nombre: usuario.nombre,
                email: usuario.email,
                plan: usuario.plan,
                totalTiradas: usuario.totalTiradas,
                muestrasFisicasRestantes: 999
            }
        });
    } catch (error) {
        console.error('[auth] Error al canjear código:', error);
        res.status(500).json({ error: 'Error al procesar el código.' });
    }
});

// ==========================================
// RUTAS DE TIRADAS Y MUESTRAS
// ==========================================

// Usar una muestra física
app.post('/api/tiradas/usar-muestra', verificarAuth, async (req, res) => {
    try {
        const usuario = await Usuario.findById(req.usuario.userId);

        // Premium tiene muestras ilimitadas
        if (usuario.plan === 'Premium') {
            return res.json({ 
                premium: true, 
                muestrasRestantes: 999 
            });
        }

        // Verificar muestras restantes
        const restantes = Math.max(0, MAX_MUESTRAS_FISICAS - usuario.muestrasFisicasUsadas);
        if (restantes <= 0) {
            return res.status(403).json({ 
                error: 'Muestras agotadas. Actualiza a Premium.', 
                muestrasRestantes: 0,
                premium: false 
            });
        }

        usuario.muestrasFisicasUsadas += 1;
        await usuario.save();

        res.json({
            premium: false,
            muestrasRestantes: Math.max(0, MAX_MUESTRAS_FISICAS - usuario.muestrasFisicasUsadas)
        });
    } catch (error) {
        console.error('[tiradas] Error al usar muestra:', error);
        res.status(500).json({ error: 'Error al registrar muestra.' });
    }
});

// Consultar muestras restantes
app.get('/api/tiradas/muestras', verificarAuth, async (req, res) => {
    try {
        const usuario = await Usuario.findById(req.usuario.userId);
        res.json({
            premium: usuario.plan === 'Premium',
            muestrasRestantes: usuario.plan === 'Premium' 
                ? 999 
                : Math.max(0, MAX_MUESTRAS_FISICAS - usuario.muestrasFisicasUsadas)
        });
    } catch (error) {
        console.error('[tiradas] Error al consultar muestras:', error);
        res.status(500).json({ error: 'Error al consultar muestras.' });
    }
});

// Registrar una tirada
app.post('/api/tiradas/registrar', verificarAuth, async (req, res) => {
    try {
        const usuario = await Usuario.findById(req.usuario.userId);
        usuario.totalTiradas += 1;
        usuario.ultimaConexion = new Date().toISOString().split('T')[0];
        await usuario.save();
        res.json({ 
            totalTiradas: usuario.totalTiradas 
        });
    } catch (error) {
        console.error('[tiradas] Error al registrar tirada:', error);
        res.status(500).json({ error: 'Error al registrar tirada.' });
    }
});

// ==========================================
// RUTAS DE DUPLAS (MODO ESTRUCTURAL)
// ==========================================

// Buscar dupla
app.get('/api/duplas/buscar', async (req, res) => {
    const { a, b } = req.query;
    if (!a || !b) {
        return res.status(400).json({ error: 'Faltan cartas.' });
    }

    try {
        const cartaA = a.trim();
        const cartaB = b.trim();
        
        // Buscar en ambos órdenes posibles
        const claves = [
            `"${cartaA}"|"${cartaB}"`,
            `${cartaA}|${cartaB}`,
            `"${cartaB}"|"${cartaA}"`,
            `${cartaB}|${cartaA}`
        ];
        
        console.log(`🔍 Buscando dupla: ${cartaA} + ${cartaB}`);

        let dupla = await Dupla.findOne({
            $or: claves.map(clave => ({ claveBuscador: clave }))
        });

        if (!dupla) {
            return res.json({ 
                encontrada: false, 
                mensaje: `Dupla "${cartaA} | ${cartaB}" no encontrada.` 
            });
        }

        res.json({
            encontrada: true,
            significado: dupla.significado,
            keywords: dupla.keywords || [],
            orden: 'directo'
        });
    } catch (error) {
        console.error('❌ Error al buscar dupla:', error);
        res.status(500).json({ error: 'Error al buscar dupla.' });
    }
});

// ==========================================
// RUTAS DE ADMINISTRACIÓN
// ==========================================

// Obtener todos los clientes
app.get('/api/admin/clientes', verificarAdmin, async (req, res) => {
    try {
        const clientes = await Usuario.find({}, { __v: 0 })
            .sort({ createdAt: -1 })
            .limit(100);
        res.json({ clientes });
    } catch (error) {
        console.error('[admin] Error al obtener clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes.' });
    }
});

// Cambiar plan de un usuario
app.post('/api/admin/cambiar-plan', verificarAdmin, async (req, res) => {
    const { userId, nuevoPlan } = req.body;
    
    if (!userId || !nuevoPlan || !['Gratis', 'Premium'].includes(nuevoPlan)) {
        return res.status(400).json({ error: 'Datos inválidos o plan incorrecto.' });
    }
    
    try {
        const idString = String(userId).trim();
        const filtro = mongoose.Types.ObjectId.isValid(idString) 
            ? { _id: idString } 
            : { email: idString.toLowerCase() };
        
        const usuario = await Usuario.findOneAndUpdate(
            filtro, 
            { $set: { plan: nuevoPlan } }, 
            { new: true }
        );
        
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        
        console.log(`[admin] Plan actualizado: ${usuario.email} → ${nuevoPlan}`);
        res.json({ 
            mensaje: `Plan actualizado a ${nuevoPlan}`, 
            usuario 
        });
    } catch (error) {
        console.error('[admin] Error al cambiar plan:', error);
        res.status(500).json({ error: 'Error al cambiar plan.' });
    }
});

// Crear código premium (admin)
app.post('/api/admin/crear-codigo', verificarAdmin, async (req, res) => {
    const { codigo } = req.body;
    if (!codigo) {
        return res.status(400).json({ error: 'Código requerido.' });
    }
    
    try {
        const nuevo = new CodigoPremium({ 
            codigo: codigo.trim().toUpperCase() 
        });
        await nuevo.save();
        res.json({ 
            mensaje: 'Código creado con éxito.', 
            codigo: nuevo 
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Código ya existe.' });
        }
        console.error('[admin] Error al crear código:', error);
        res.status(500).json({ error: 'Error al crear código.' });
    }
});

// ==========================================
// FUNCIÓN PARA EXTRAER RESPUESTA
// ==========================================
function extraerRespuesta(texto) {
    if (!texto) return '';
    
    // Remover tags de thinking
    const idxCierre = texto.lastIndexOf('</thinking>');
    if (idxCierre !== -1) {
        const despues = texto.substring(idxCierre + 11).trim();
        if (despues.length > 20) return despues;
    }
    
    const idxApertura = texto.indexOf('<thinking>');
    if (idxApertura !== -1) {
        const antes = texto.substring(0, idxApertura).trim();
        const despuesDelTag = texto.substring(idxApertura + 10);
        const idxCierre2 = despuesDelTag.indexOf('</thinking>');
        if (idxCierre2 !== -1) {
            const despues = despuesDelTag.substring(idxCierre2 + 11).trim();
            if (despues.length > 20) return despues;
        }
        if (antes.length > 20) return antes;
    }
    
    return texto.trim();
}

// ==========================================
// RUTA PRINCIPAL - TIRADA DE TAROT
// ==========================================
app.post('/tirada', async (req, res) => {
    let { 
        tema, a, b, c, d, 
        estilo = 'filosofico', 
        pregunta, 
        cartas, 
        modo 
    } = req.body;

    // Soporte para formato de cartas
    if (!a && cartas && Array.isArray(cartas) && cartas.length >= 4) {
        a = cartas[0]; 
        b = cartas[1]; 
        c = cartas[2]; 
        d = cartas[3];
    }

    if (!a || !b || !c || !d) {
        return res.status(400).json({ error: 'Faltan cartas. Se necesitan 4.' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'API Key no configurada en el servidor.' });
    }

    try {
        const preguntaLimpia = (pregunta && typeof pregunta === 'string') 
            ? pregunta.trim().slice(0, 300) 
            : '';
        const esPreguntaEspecifica = (tema === 'Pregunta Específica' || tema === 'Pregunta Especifica') 
            && preguntaLimpia.length > 0;
        const esModoGratis = modo === 'gratis';

        let systemPrompt = '';
        let userPrompt = '';
        let temp = 0.7;

        if (esModoGratis) {
            systemPrompt = `Eres Morgana, experta lectora de Tarot. Tono místico, directo y predictivo.
Responde SOLO con 2 secciones HTML con class="reading-section".
Cada sección debe tener al menos 3 oraciones completas.
NO saludes. NO uses asteriscos ni markdown.`;
            
            userPrompt = `Pregunta: "${preguntaLimpia || 'Consulta general'}"
Dupla 1 (Presente): ${a} y ${b}
Dupla 2 (Futuro): ${c} y ${d}
Responde en español. Sección 1 = CONCLUSIÓN sobre la pregunta. Sección 2 = PREDICCIÓN.`;
            
        } else if (estilo === 'manual') {
            temp = 0.3;
            systemPrompt = `Actúa como un diccionario técnico, objetivo y neutral de Tarot.
Tu tarea exclusiva es analizar las dos duplas de cartas que te presenta el usuario:
- Dupla 1: ${a} y ${b}
- Dupla 2: ${c} y ${d}
Devuelve la respuesta estructurada ESTRICTAMENTE en formato HTML de la siguiente manera:
<div class="reading-section">
    <h3>🔮 Dupla 1: ${a} + ${b}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado práctico]</li>
        <li><strong>Significado 2:</strong> [Significado práctico]</li>
        <li><strong>Significado 3:</strong> [Significado práctico]</li>
    </ul>
</div>
<div class="reading-section">
    <h3>🔮 Dupla 2: ${c} + ${d}</h3>
    <ul>
        <li><strong>Significado 1:</strong> [Significado práctico]</li>
        <li><strong>Significado 2:</strong> [Significado práctico]</li>
        <li><strong>Significado 3:</strong> [Significado práctico]</li>
    </ul>
</div>
NO uses asteriscos ni markdown.`;
            
            userPrompt = esPreguntaEspecifica 
                ? `Pregunta específica: "${preguntaLimpia}". Cartas: ${a}, ${b}, ${c} y ${d}.` 
                : `Tema general: ${tema}. Cartas: ${a}, ${b}, ${c} y ${d}.`;
                
        } else {
            // Estilos Mágico y Filosófico
            const personalidad = (estilo === 'morgana' || estilo === 'magico')
                ? 'Eres Morgana, una experta y asertiva lectora de Tarot Rider-Waite. Tu tono es directo, místico y predictivo.'
                : 'Eres un terapeuta y experto lector de Tarot Evolutivo. Tu tono es empático, reflexivo y psicológico.';

            const reglasFormato = `
NO uses listas, viñetas, guiones ni asteriscos (*).
Devuelve la respuesta EXACTAMENTE en este formato HTML:
<div class="reading-section">
    <h3>✨ El Presente y Origen (${a} + ${b})</h3>
    <p>[Interpretación del estado actual]</p>
</div>
<div class="reading-section">
    <h3>✨ El Camino hacia el Futuro (${c} + ${d})</h3>
    <p>[Interpretación del futuro a corto plazo]</p>
</div>
<div class="reading-section">
    <h3>🔮 Predicciones del Oráculo</h3>
    <p>[2 o 3 predicciones concretas en un solo párrafo]</p>
</div>
<div class="reading-section">
    <h3>📌 Consejo y Conclusión</h3>
    <p><span id="conclusion">[Frase de cierre y consejo final]</span></p>
</div>`;

            systemPrompt = personalidad + reglasFormato;
            userPrompt = esPreguntaEspecifica 
                ? `Pregunta específica: "${preguntaLimpia}". Cartas: ${a}, ${b}, ${c} y ${d}.` 
                : `Tema general: ${tema}. Cartas: ${a}, ${b}, ${c} y ${d}.`;
        }

        console.log(`[tirada] Estilo: ${estilo}, Modo: ${modo || 'completo'}, Tema: ${tema}`);

        // Llamada a la API de Groq
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
        
        if (!response.ok || !data.choices || data.choices.length === 0) {
            console.error('[tirada] Error de API:', data);
            return res.status(500).json({ 
                error: 'Error del proveedor de IA.', 
                detalle: data.error?.message || `HTTP ${response.status}` 
            });
        }

        const raw = data.choices[0].message?.content || '';
        let text = extraerRespuesta(raw);

        // Fallback si la respuesta está vacía
        if (!text || text.length < 30) {
            text = `
<div class="reading-section">
    <h3>✨ El Presente y Origen (${a} + ${b})</h3>
    <p>La combinación de ${a} y ${b} indica que la situación actual requiere atención y reflexión profunda. Hay energías en movimiento que necesitan ser comprendidas.</p>
</div>
<div class="reading-section">
    <h3>✨ El Camino hacia el Futuro (${c} + ${d})</h3>
    <p>${c} y ${d} revelan un cambio significativo en el horizonte. Prepárate para transformaciones importantes.</p>
</div>
<div class="reading-section">
    <h3>🔮 Predicciones del Oráculo</h3>
    <p>El universo te guía hacia nuevas oportunidades. Confía en tu intuición y en el proceso.</p>
</div>
<div class="reading-section">
    <h3>📌 Consejo y Conclusión</h3>
    <p><span id="conclusion">El momento es ahora para actuar con sabiduría y confianza.</span></p>
</div>`;
        }

        return res.json({ lectura: text });

    } catch (error) {
        console.error('[tirada] ERROR:', error.message);
        return res.status(500).json({ 
            error: 'Error interno del servidor.', 
            detalles: error.message 
        });
    }
});

// ==========================================
// RUTA DE ESTADO PARA VERIFICAR CONEXIÓN
// ==========================================
app.get('/api/auth/status', async (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        res.json({
            status: 'online',
            timestamp: new Date().toISOString(),
            database: dbStatus,
            version: '2.0'
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            error: error.message 
        });
    }
});

// ==========================================
// INICIO DEL SERVIDOR
// ==========================================
app.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`🔄 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`==========================================`);
});

// ==========================================
// MANEJO DE ERRORES GLOBAL
// ==========================================
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada sin manejar:', reason);
});
