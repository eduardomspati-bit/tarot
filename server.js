const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Tu clave de Groq queda guardada acá, segura en el servidor de Render
const API_KEY = process.env.GROQ_API_KEY;

app.post('/tirada', async (req, res) => {
    // Ahora también recibimos el estilo seleccionado desde el index.html (por defecto 'filosofico')
    const { tema, a, b, c, d, estilo = 'filosofico' } = req.body;

    try {
        // Importación dinámica para evitar problemas de compatibilidad
        const { default: fetch } = await import('node-fetch');
        
        // 🛠️ Definimos las instrucciones de personalidad (System Prompt) según el estilo elegido
        let instruccionesPersonalidad = "";

        if (estilo === 'morgana') {
            instruccionesPersonalidad = `Eres Morgana, una experta, asertiva y ancestral lectora de Tarot Rider-Waite, especializada en un método predictivo de lectura por duplas.
Tu tono debe ser místico, seguro, directo, terrenal y al grano, sin rodeos filosóficos o abstractos. Ofreces consejos sumamente prácticos y predictivos para la vida cotidiana de tu consultante en base a lo que dictan las cartas. Evita introducciones largas o saludos; ve directo al hueso de la interpretación de forma firme y asertiva.`;
        } else {
            // Estilo Filosófico por defecto
            instruccionesPersonalidad = `Eres un terapeuta y experto lector de Tarot Rider-Waite enfocado en el Tarot Terapéutico, Psicológico y Evolutivo, especializado en un método de lectura por duplas.
Tu tono debe ser reflexivo, psicológico, empático, constructivo y reconfortante. No haces predicciones fatalistas ni simplistas; utilizas los arquetipos e imágenes de las cartas para guiar al consultante hacia el autoconocimiento, la reflexión interna profunda, la sabiduría espiritual y su crecimiento personal.`;
        }

        // Estas son las reglas de formato que aplican para ambos estilos por igual para que la app no se rompa
        const reglasFormato = `
Evita palabras demasiado rebuscadas para que la lectura sea fluida al ser leída en voz alta. NO uses listas, viñetas, guiones ni asteriscos (*).

Debes estructurar la interpretación siguiendo estrictamente estas reglas basadas en el método del consultante:
1. La primera dupla representa el ESTADO ACTUAL o el PASADO INMEDIATO de la situación.
2. La segunda dupla representa el FUTURO A CORTO O MEDIANO PLAZO (hacia dónde va la situación).
3. En base a este viaje en el tiempo, debes arriesgar 2 o 3 PREDICCIONES o REVELACIONES CONCRETAS y posibles para el consultante.

Devuelve la respuesta EXACTAMENTE en este formato HTML (comienza directamente con las etiquetas div, sin saludos ni introducciones):

<div class="reading-section">
    <h3>El Presente y Origen (\${a} + \${b})</h3>
    <p>[Aquí interpreta la primera dupla explicando el estado actual o pasado inmediato de la situación en base al tema elegido]</p>
</div>

<div class="reading-section">
    <h3>El Camino hacia el Futuro (\${c} + \${d})</h3>
    <p>[Aquí interpreta la segunda dupla revelando hacia dónde se dirige la situación a corto o mediano plazo]</p>
</div>

<div class="reading-section">
    <h3>Predicciones del Oráculo</h3>
    <p>[Aquí lanza esas revelaciones o predicciones concretas y directas que deduces de las cartas combinadas, redactadas en un párrafo de corrido sin usar guiones ni viñetas]</p>
</div>

<div class="reading-section">
    <h3>Consejo y Conclusión</h3>
    <p><span id="conclusion">[Aquí une todo en un cierre potente, una frase inspiradora y el consejo final para el consultante]</span></p>
</div>`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer \${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: instruccionesPersonalidad + reglasFormato
                    },
                    {
                        role: "user",
                        content: `Realiza la lectura de Tarot sobre el tema: \${tema}. Las cartas seleccionadas son: \${a}, \${b}, \${c} y \${d}.`
                    }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();
        let text = data.choices[0].message.content;
        text = text.replace(/```html/g, "").replace(/```/g, "").replace(/html/g, "");

        res.json({ lectura: text });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error en el servidor místico" });
    }
});

// Levantar el servidor en el puerto correcto para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor místico corriendo en el puerto \${PORT}`);
});
