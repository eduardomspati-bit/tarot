// ==========================================
// ENDPOINT: TIRADA REFACTORIZADO
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

        // Detección de Modos
        const esModoGratis = modo === 'gratis';
        const esFisicoTecnico = estilo === 'fisico_tecnico' || estilo === 'tecnico' || estilo === 'manual';
        const esFisicoPredictivo = estilo === 'fisico_predictivo' || estilo === 'predictivo';
        const esMagico = estilo === 'magico' || estilo === 'morgana';

        let systemPrompt = '';
        let userPrompt = '';

        // 1. MODO GRATUITO (Respuesta mística, concisa)
        if (esModoGratis) {
            systemPrompt = `Eres Morgana, experta lectora de Tarot. Tono místico, directo y predictivo.
Responde SOLO con 2 secciones HTML con class="reading-section".
Cada sección debe ser concisa y al grano.
NO saludes. NO uses asteriscos ni markdown. Usa HTML puro.`;

            userPrompt = `Pregunta: "${preguntaLimpia || 'Consulta general'}"
Dupla 1 (Presente): ${a} y ${b}
Dupla 2 (Futuro): ${c} y ${d}

Responde en español. 
Sección 1 (<h3>Conclusión</h3>) = Breve conclusión del presente.
Sección 2 (<h3>Predicción</h3>) = Breve predicción del futuro.`;

        // 2. MÓDULO PROFESIONAL - MAZO FÍSICO TÉCNICO
        } else if (esFisicoTecnico) {
            systemPrompt = `Actúas como Diccionario Técnico de Tarot para profesionales. Tono neutral, analítico y directo.
Responde SOLO con 2 secciones HTML con class="reading-section".
NO relaciones las cartas entre sí en la sección individual para que la síntesis la haga el usuario.
NO saludes. NO uses asteriscos ni markdown. Usa HTML puro (<h3>, <ul>, <li>, <p>).`;

            userPrompt = `Tirada de Mazo Físico (Técnica):
${preguntaLimpia ? `Pregunta: "${preguntaLimpia}"` : `Tema: ${tema || 'General'}`}
Carta A: ${a} | Carta B: ${b} | Carta C: ${c} | Carta D: ${d}

Sigue ESTRICTAMENTE esta estructura HTML:

<div class="reading-section">
  <h3>Significados Directos por Dupla</h3>
  <p><strong>Dupla 1 (${a} + ${b}):</strong></p>
  <ul>
    <li>[Significado directo 1 de la combinación]</li>
    <li>[Significado directo 2 de la combinación]</li>
    <li>[Significado directo 3 de la combinación]</li>
  </ul>
  <p><strong>Dupla 2 (${c} + ${d}):</strong></p>
  <ul>
    <li>[Significado directo 1 de la combinación]</li>
    <li>[Significado directo 2 de la combinación]</li>
    <li>[Significado directo 3 de la combinación]</li>
  </ul>
</div>

<div class="reading-section">
  <h3>Significados Individuales (Aislados)</h3>
  <p><strong>${a}:</strong> 2 o 3 palabras clave del arcano aislado.</p>
  <p><strong>${b}:</strong> 2 o 3 palabras clave del arcano aislado.</p>
  <p><strong>${c}:</strong> 2 o 3 palabras clave del arcano aislado.</p>
  <p><strong>${d}:</strong> 2 o 3 palabras clave del arcano aislado.</p>
</div>`;

        // 3. MÓDULO PROFESIONAL - MAZO FÍSICO PREDICTIVO
        } else if (esFisicoPredictivo) {
            systemPrompt = `Eres un Tarotista Profesional. Tono místico, fluido, predictivo y detallado.
Responde SOLO con 2 secciones HTML con class="reading-section".
Proporciona una lectura rica, amplia y bien desarrollada por duplas (más extensa que una tirada rápida).
NO saludes. NO uses asteriscos ni markdown. Usa HTML puro.`;

            userPrompt = `Consulta Profesional (Mazo Físico Predictivo)
${preguntaLimpia ? `Pregunta: "${preguntaLimpia}"` : `Tema: ${tema || 'General'}`}
Dupla 1 (Presente / Origen): ${a} y ${b}
Dupla 2 (Futuro / Desenlace): ${c} y ${d}

Sección 1 (<h3>Análisis del Presente</h3>) = Interpretación mística detallada y fluida de la Dupla 1.
Sección 2 (<h3>Predicción y Desenlace</h3>) = Revelación predictiva extendida y consejo para el futuro basado en la Dupla 2.`;

        // 4. ESTILO MÁGICO (Lectura Digital)
        } else if (esMagico) {
            systemPrompt = `Eres Morgana, lectora de Tarot. Tono místico, intuitivo y directo.
Responde SOLO con 2 secciones HTML con class="reading-section".
NO saludes. NO uses asteriscos ni markdown. Usa HTML puro.`;

            userPrompt = `Tema/Pregunta: "${preguntaLimpia || tema || 'General'}"
Dupla 1 (Presente): ${a} y ${b} -> Interpretación mística conjunta.
Dupla 2 (Futuro): ${c} y ${d} -> Interpretación mística conjunta.`;

        // 5. ESTILO FILOSÓFICO (Lectura Digital Por Defecto)
        } else {
            systemPrompt = `Eres un Terapeuta de Tarot Evolutivo. Tono reflexivo, empático e integrador.
Responde SOLO con 2 secciones HTML con class="reading-section".
NO saludes. NO uses asteriscos ni markdown. Usa HTML puro.`;

            userPrompt = `Tema/Pregunta: "${preguntaLimpia || tema || 'General'}"
Dupla 1 (Espejo del Presente): ${a} y ${b} -> Análisis evolutivo conjunto.
Dupla 2 (Camino de Aprendizaje): ${c} y ${d} -> Análisis evolutivo conjunto.`;
        }

        console.log('Llamando a Groq... Modelo:', MODEL_NAME);

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
                max_tokens: 4096
            })
        });

        const data = await response.json();

        if (!response.ok || !data.choices || data.choices.length === 0) {
            return res.status(500).json({
                error: 'Error del proveedor de IA.',
                detalle: data.error?.message || `HTTP ${response.status}`
            });
        }

        const raw = data.choices[0].message?.content || '';
        let text = extraerRespuesta(raw);

        // Fallback dinámico según el modo
        if (!text || text.length < 30) {
            if (esFisicoTecnico) {
                text = `<div class="reading-section"><h3>Significados Directos</h3><p><strong>Dupla 1 (${a} + ${b}):</strong> Bloqueos actuales, necesidad de análisis, transformación paulatina.</p><p><strong>Dupla 2 (${c} + ${d}):</strong> Nuevas oportunidades, resolución favorable, decisiones importantes.</p></div><div class="reading-section"><h3>Significados Individuales</h3><p><strong>${a}:</strong> Inicio, voluntad, potencial.</p><p><strong>${b}:</strong> Intuición, misterio, paciencia.</p><p><strong>${c}:</strong> Cambio, transición, movimiento.</p><p><strong>${d}:</strong> Éxito, claridad, realización.</p></div>`;
            } else {
                text = `<div class="reading-section"><h3>Presente</h3><p>La dupla ${a} y ${b} indica que la situación actual requiere atención y reflexión sobre los aspectos fundamentales.</p></div><div class="reading-section"><h3>Futuro</h3><p>La dupla ${c} y ${d} revela una evolución significativa que aportará perspectiva y nuevos caminos.</p></div>`;
            }
        }

        return res.json({ lectura: text });

    } catch (error) {
        console.error('ERROR:', error.message);
        return res.status(500).json({ error: 'Error interno', detalles: error.message });
    }
});
