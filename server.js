const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ¡ESTA ES LA LÍNEA CLAVE! Le dice a Node que sirva los HTML de esta carpeta
app.use(express.static(__dirname));

// Tu clave de Groq queda guardada acá, segura en el servidor de Render
const API_KEY = process.env.GROQ_API_KEY;

app.post('/tirada', async (req, res) => {
    // Recibimos los datos del frontend (ahora sumamos "pregunta" si viene)
    const { tema, a, b, c, d, estilo = 'filosofico', pregunta } = req.body;

    try {
        // Validación de seguridad para que no intente consultar a Groq con datos vacíos
        if (!a || !b || !c || !d) {
            return res.status(400).json({ error: "Faltan cartas para realizar la tirada." });
        }

        // Importación dinámica para evitar problemas de compatibilidad
        const { default: fetch } = await import('node-fetch');
        
        // Juntamos el prompt completo en una sola variable limpia
        let promptSistema = "";

        // ==========================================
        // ADAPTACIÓN DE PROMPTS SEGÚN EL ESTILO
        // ==========================================
        if (estilo === 'manual') {
            // El Modo Manual entrega una lectura analítica, técnica y separada por duplas
            promptSistema = `Actúa como un diccionario técnico, objetivo y neutral de Tarot.
Tu tarea exclusiva es analizar las dos duplas de cartas que te presenta el usuario:
- Dupla 1: ${a} y ${b}
- Dupla 2: ${c} y ${d}

Para cada dupla, debes proporcionar de 3 a 4 posibles interpretaciones o significados prácticos y objetivos de su combinación (palabras clave, conceptos o direcciones de interpretación).
Reglas estrictas que debes cumplir:
1. No redactes párrafos largos de narrativa poética o mística.
2. No des consejos directos al consultante ("te recomiendo que...", "deberías...").
3. Mantén un tono neutro, analítico e instructivo.
4. ESTÁ TERMINANTEMENTE PROHIBIDO relacionar la Dupla 1 con la Dupla 2. Analízalas por separado.

Devuelve la respuesta estructurada ESTRICTAMENTE en formato HTML de la siguiente manera (comienza directamente con el HTML, sin saludos ni introducciones):

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
            // Prompts para estilos normales ('filosofico', 'magico' o 'morgana')
            let instruccionesPersonalidad = "";

            if (estilo === 'morgana' || estilo === 'magico') {
                instruccionesPersonalidad = "Eres Morgana, una experta, asertiva y ancestral lectora de Tarot Rider-Waite, especializada en un método predictivo de lectura por duplas. Tu tono debe ser místico, seguro, directo, terrenal y al grano, sin rodeos filosóficos o abstractos. Ofreces consejos sumamente prácticos y predictivos para la vida cotidiana de tu consultante en base a lo que dictan las cartas. Evita introducciones largas o saludos; ve directo al hueso de la interpretación de forma firme y asertiva.";
            } else {
                // Estilo Filosófico por defecto
                instruccionesPersonalidad = "Eres un terapeuta y experto lector de Tarot Rider-Waite enfocado en el Tarot Terapéutico, Psicológico y Evolutivo, especializado en un método de lectura por duplas. Tu tono debe ser reflexivo, psicológico, empático, constructivo y reconfortante. No haces predicciones fatalistas ni simplistas; utilizas los arquetipos e imágenes de las cartas para guiar al consultante hacia el autoconocimiento, la reflexión interna profunda, la sabiduría espiritual y su crecimiento personal.";
            }

            // Estas son las reglas de formato que aplican para ambos estilos por igual
            const reglasFormato = `
Evita palabras demasiado rebuscadas para que la lectura sea fluida al ser leída en voz alta. NO uses listas, viñetas, guiones ni asteriscos (*).

Debes estructurar la interpretación siguiendo estrictamente estas reglas basadas en el método del consultante:
1. La primera dupla representa el ESTADO ACTUAL o el PASADO INMEDIATO de la situación.
2. La segunda dupla representa el FUTURO A CORTO O MEDIANO PLAZO (hacia dónde va la situación).
3. En base a este viaje en el tiempo, debes arriesgar 2 o 3 PREDICCIONES o REVELACIONES CONCRETAS y posibles para el consultante.

Devuelve la respuesta EXACTAMENTE en este formato HTML (comienza directamente con las etiquetas div, sin saludos ni introducciones):

<div class="reading-section">
    <h3>El Presente y Origen (` + a + ` + ` + b + `)</h3>
    <p>[Aquí interpreta la primera dupla explicando el estado actual o pasado inmediato de la situación en base al tema elegido]</p>
</div>

<div class="reading-section">
    <h3>El Camino hacia el Futuro (` + c + ` + ` + d + `)</h3>
    <p>[Aquí interpreta la segunda dupla revealing hacia dónde se dirige la situación a corto o mediano plazo]</p>
</div>

<div class="reading-section">
    <h3>Predicciones del Oráculo</h3>
    <p>[Aquí lanza esas revelaciones o predicciones concretas y directas que deduces de las cartas combinadas, redactadas en un párrafo de corrido sin usar guiones ni viñetas]</p>
</div>

<div class="reading-section">
    <h3>Consejo y Conclusión</h3>
    <p><span id="conclusion">[Aquí une todo en un cierre potente, una frase inspiradora y el consejo final para el consultante]</span></p>
</div>`;

            promptSistema = instruccionesPersonalidad + reglasFormato;
        }
        
        // --- ADAPTACIÓN PREMIUM: Cambiamos el prompt del usuario según si hizo pregunta o no ---
        let promptUsuario = "";
        if (tema === 'Pregunta Específica' && pregunta) {
            promptUsuario = "El consultante tiene una PREGUNTA ESPECÍFICA: \"" + pregunta + "\". Realiza la lectura de Tarot orientando TODO tu análisis a responder directamente a esa duda. Las cartas seleccionadas son: " + a + ", " + b + ", " + c + " y " + d + ".";
        } else {
            promptUsuario = "Realiza la lectura de Tarot sobre el tema general: " + tema + ". Las cartas seleccionadas son: " + a + ", " + b + ", " + c + " y " + d + ".";
        }

        // CONTROL DE VARIABLE CORREGIDO: "style" por "estilo" para evitar ReferenceError
        const cuerpoPeticion = {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: promptSistema },
                { role: "user", content: promptUsuario }
            ],
            temperature: estilo === 'manual' ? 0.3 : 0.7 
        };

        if (!API_KEY) {
            console.error("❌ ERROR: La variable de entorno GROQ_API_KEY no está configurada.");
            return res.status(500).json({ error: "No se encontró la configuración de clave de API en el servidor." });
        }

        // Hacemos el fetch de forma super limpia y tradicional
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(cuerpoPeticion)
        });

        const data = await response.json();
        
        // Verificación de que Groq devolvió datos válidos antes de procesarlos
        if (!data.choices || data.choices.length === 0) {
            console.error("Respuesta inválida de Groq API:", data);
            throw new Error("Respuesta incompleta de Groq");
        }

        let text = data.choices[0].message.content;
        text = text.replace(/```html/g, "").replace(/```/g, "").replace(/html/g, "");

        res.json({ lectura: text });

    } catch (error) {
        console.error("💥 Error en endpoint /tirada:", error);
        res.status(500).json({ error: "Error en el servidor místico", detalles: error.message });
    }
});

// === NUEVO ENDPOINT PREMIUM: RE-PREGUNTA SOBRE LA MISMA LECTURA ===
app.post('/repregunta', async (req, res) => {
    const { cartas, lecturaAnterior, repregunta, estilo = 'filosofico' } = req.body;

    if (!repregunta) {
        return res.status(400).json({ error: "Falta la re-pregunta del usuario." });
    }

    try {
        const { default: fetch } = await import('node-fetch');

        // Configuramos las mismas personalidades para mantener la coherencia en el chat
        let personalidadMistica = "";
        if (estilo === 'manual') {
            personalidadMistica = "Eres un oráculo analítico y técnico de Tarot. Tu tono en esta respuesta debe ser sumamente claro, estructurado, directo y didáctico para aclarar las dudas sobre las duplas analizadas, sin saludos ceremoniales.";
        } else if (estilo === 'morgana' || estilo === 'magico') {
            personalidadMistica = "Eres Morgana, la experta, asertiva y ancestral lectora de Tarot Rider-Waite. Tu tono en esta respuesta debe seguir siendo místico, directo, firme y al hueso, sin rodeos ni saludos.";
        } else {
            personalidadMistica = "Eres el terapeuta y experto lector de Tarot Evolutivo y Psicológico. Tu tono debe seguir siendo empático, reflexivo, espiritual y constructivo.";
        }

        // Ajustamos el prompt histórico para que coincida exactamente con las duplas originales del oráculo
        const promptSistemaRepregunta = personalidadMistica + `
El usuario acaba de leer una interpretación que le diste basándote en cuatro cartas (leídas en dos duplas) y ahora tiene una duda de seguimiento (una re-pregunta).

CONTEXTO HISTÓRICO DE LA SESIÓN:
- Dupla 1 (Presente/Origen): ${cartas.a} y ${cartas.b}
- Dupla 2 (Camino al Futuro): ${cartas.c} y ${cartas.d}
- Interpretación previa generada: "${lecturaAnterior}"

REGLAS DE RESPUESTA:
1. Responde a su nueva duda de forma concisa y enfocada, usando máximo 2 párrafos de corrido o viñetas muy puntuales si es Modo Manual.
2. NO uses asteriscos (*).
3. Conéctalo de manera fluida con el significado de las cartas que salieron originalmente y lo que ya le habías dicho. Ve directo al grano, sin dar introducciones vacías ni saludos.
4. Devuelve el texto limpio, usando solo etiquetas HTML <p> o <ul>/<li> básicas para estructurar el contenido.`;

        const cuerpoPeticion = {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: promptSistemaRepregunta },
                { role: "user", content: repregunta }
            ],
            temperature: 0.7
        };

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(cuerpoPeticion)
        });

        const data = await response.json();
        
        if (!data.choices || data.choices.length === 0) {
             throw new Error("Respuesta incompleta de Groq en repregunta");
        }

        let respuestaIA = data.choices[0].message.content;
        respuestaIA = respuestaIA.replace(/```html/g, "").replace(/```/g, "").replace(/html/g, "");

        // Se envía de vuelta en la propiedad "respuesta" tal cual lo espera tu js/app.js
        res.json({ respuesta: respuestaIA });

    } catch (error) {
        console.error("Error en endpoint /repregunta:", error);
        res.status(500).json({ error: "La conexión con el plano de las re-preguntas falló." });
    }
});

// Levantar el servidor en el puerto correcto para Render
const PORT = process.env.PORT || 3000;

// === ENDPOINT DE ADMINISTRACIÓN: LISTADO DE CLIENTES (SIMULADO) ===
app.get('/api/admin/clientes', (req, res) => {
    const clientesSimulados = [
        { id: 1, nombre: "Eduardo Marcelo", email: "eduardo@example.com", plan: "Premium", totalTiradas: 14, ultimaConexion: "2026-07-01" },
        { id: 2, nombre: "Ana Clara", email: "anaclara@gmail.com", plan: "Gratis", totalTiradas: 3, ultimaConexion: "2026-06-28" },
        { id: 3, nombre: "Juan Pérez", email: "juan.perez@hotmail.com", plan: "Premium", totalTiradas: 28, ultimaConexion: "2026-07-01" }
    ];
    
    res.json({ clientes: clientesSimulados });
});

app.listen(PORT, () => {
    console.log("SERVIDOR MÍSTICO ACTUALIZADO Y CORRIENDO EN PUERTO " + PORT);
});
