const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Tu clave de Groq queda guardada acá, segura en el servidor de Render
const API_KEY = process.env.GROQ_API_KEY;

app.post('/tirada', async (req, res) => {
    const { tema, a, b, c, d } = req.body;

    const promptContenido = `
    Actúa como un experto lector de Tarot Rider-Waite. Realiza una lectura interpretando estrictamente bajo este sistema.
    Variables del tema: ${tema}. Cartas: ${a}, ${b}, ${c}, ${d}.
    Debes estructurar tu respuesta EXACTAMENTE con este formato HTML (no uses markdown como '**' o '###' o '\`\`\`, usa etiquetas HTML directamente):

    <div class="reading-section">
        <h3>${a} + ${b}</h3>
        <p>Aquí tu interpretación profunda de la combinación de la primera dupla (A y B) enfocada en el tema ${tema}.</p>
    </div>
    
    <div class="reading-section">
        <h3>${c} + ${d}</h3>
        <p>Aquí tu interpretación profunda de la combinación de la segunda dupla (C y D) enfocada en el tema ${tema}.</p>
    </div>
    
    <div class="reading-section">
        <h3>Síntesis General</h3>
        <p>Aquí tu conclusión o consejo final que unifique el mensaje de ambas duplas para el consultante.</p>
    </div>`;

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
                messages: [{ role: "user", content: promptContenido }],
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));