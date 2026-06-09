const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Tu clave de Groq queda guardada acá, segura en el servidor de Render
const API_KEY = process.env.GROQ_API_KEY;

app.post('/tirada', async (req, res) => {
    const { tema, a, b, c, d } = req.body;

    try {
        // Importación dinámica para evitar problemas de compatibilidad
        const { default: fetch } = await import('node-fetch');
        
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    {
                        role: "system",
                        content: `Eres un experto y ancestral lector de Tarot Rider-Waite, especializado en un método predictivo de lectura por duplas.
Tu tono debe ser místico, seguro, empático y directo. Evita palabras rebuscadas para que la lectura sea fluida al ser leída en voz alta. NO uses listas, viñetas, guiones ni asteriscos (*).

Debes estructurar la interpretación siguiendo estrictamente estas reglas basadas en el método del consultante:
1. La primera dupla representa el ESTADO ACTUAL o el PASADO INMEDIATO de la situación.
2. La segunda dupla representa el FUTURO A CORTO O MEDIANO PLAZO (hacia dónde va la situación).
3. En base a este viaje en el tiempo, debes arriesgar 2 o 3 PREDICCIONES CONCRETAS y posibles para el consultante.

Devuelve la respuesta EXACTAMENTE en este formato HTML (comienza directamente con las etiquetas div, sin saludos ni introducciones):

<div class="reading-section">
    <h3>El Presente y Origen (${a} + ${b})</h3>
    <p>[Aquí interpreta la primera dupla explicando el estado actual o pasado inmediato de la situación en base al tema elegido]</p>
</div>

<div class="reading-section">
    <h3>El Camino hacia el Futuro (${c} + ${d})</h3>
    <p>[Aquí interpreta la segunda dupla revelando hacia dónde se dirige la situación a corto o mediano plazo]</p>
</div>

<div class="reading-section">
    <h3>Predicciones del Oráculo</h3>
    <p>[Aquí lanza esas predicciones concretas, directas y posibles que deduces de las cartas combinadas, redactadas en un párrafo de corrido sin usar guiones ni viñetas]</p>
</div>

<div class="reading-section">
    <h3>Consejo y Conclusión</h3>
    <p><span id="conclusion">[Aquí une todo en un cierre potente, una frase inspiradora y el consejo final para el consultante]</span></p>
</div>`
                    },
                    {
                        role: "user",
                        content: `Realiza la lectura de Tarot sobre el tema: ${tema}. Las cartas seleccionadas son: ${a}, ${b}, ${c} y ${d}.`
                    }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();
        let text = data.choices[0].message.content;
        text = text.replace(/```html/g, "").replace(/
```/g, "").replace(/html/g, "");

        res.json({ lectura: text });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error en el servidor místico" });
    }
});

// Levantar el servidor en el puerto correcto para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor místico corriendo en el puerto ${PORT}`);
});
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
