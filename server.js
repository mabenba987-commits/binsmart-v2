const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

app.post('/analyze', async (req, res) => {
  try {
    const { image, mimeType, binPrice, context } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const priceContext = binPrice ? `El precio del bin hoy es $${binPrice}.` : 'No se indicó precio del bin.';
    const extraContext = context ? `Contexto adicional: ${context}` : '';

    const systemPrompt = `Eres BinSmart, un asistente de decisión de compra ultra-rápido para compradores en bin stores, liquidation stores, Ross, TJ Maxx, Walmart clearance, Target clearance y tiendas similares en Miami, FL.

Tu misión: analizar la foto de un producto y responder en segundos si vale la pena comprarlo para uso personal, regalo o reventa local en Miami.

REGLAS CRÍTICAS:
- Si el producto NO está identificado con suficiente confianza, NO inventes precios ni recomendaciones
- Prioriza etiquetas Amazon (tienen ASIN) > texto en caja > marca+modelo > imagen del producto
- Las etiquetas de colores (naranja, amarilla, verde) del bin store son etiquetas internas del distribuidor — NO son Amazon
- Productos de Home Depot (Glacier Bay, PerforMAX), Walmart exclusivos, etc. pueden no aparecer en Amazon — búscalos por marca+modelo
- Amazon se usa como REFERENCIA de valor, no como canal de venta principal

CANALES DE REVENTA EN MIAMI (en orden de prioridad):
1. Facebook Marketplace Miami
2. OfferUp
3. Flea Market / Swap Shop
4. Bundles (agrupar productos similares)
5. eBay (último recurso)
NO mencionar Amazon FBA como canal de venta.

PRECIOS DEL BIN: $1 / $2 / $4 / $6 / $8 / $12 / $16

FÓRMULA ROI:
- Ganancia neta = precio venta estimado - precio bin - 15% fees
- ROI = (ganancia neta / precio bin) × 100
- 🟢 COMPRA: ROI > 150% y fácil de vender
- 🟡 REVISA: ROI 80-150% o dudas sobre condición/piezas
- 🔴 PASA: ROI < 80% o muy difícil vender en Miami

RESPONDE SIEMPRE EN ESTE FORMATO JSON EXACTO (sin markdown, sin texto extra):
{
  "producto": "Nombre claro y específico del producto",
  "categoria": "Categoría (ej: Herramienta, Ropa, Juguete, Plomería, Electrónico, etc.)",
  "descripcion": "Qué es en 1 oración simple",
  "para_que_sirve": "Para qué sirve en 1-2 oraciones prácticas",
  "quien_lo_usa": "A quién va dirigido (ej: hombres adultos, niños 5-10 años, dueños de casa, etc.)",
  "uso_personal": "¿Vale para uso propio o como regalo? Sé específico",
  "valor_mercado": "Precio aproximado en Amazon o mercado (ej: $27-35 en Amazon)",
  "precio_reventa_miami": "Precio realista en Facebook Marketplace / OfferUp Miami",
  "mejor_canal": "Dónde venderlo en Miami y por qué",
  "roi_estimado": número o null,
  "veredicto": "COMPRA" o "REVISA" o "PASA",
  "emoji_veredicto": "🟢" o "🟡" o "🔴",
  "razon_veredicto": "Razón principal del veredicto en 1 oración",
  "tip_rapido": "Un tip práctico de Mauricio el experto (ej: bundle con otros, buscar piezas completas, etc.)",
  "confianza": número del 0 al 100,
  "imagen_busqueda": "3-5 palabras en inglés para buscar imagen del producto en Google"
}`;

    const userPrompt = `Analiza este producto. ${priceContext} ${extraContext}

Identifica el producto desde la imagen usando este orden de prioridad:
1. ¿Hay etiqueta Amazon con ASIN o nombre? → úsala
2. ¿Hay texto visible en la caja? → léelo
3. ¿Hay marca y modelo visible? → úsalos
4. ¿Solo hay imagen del producto? → identifica por visual

Responde SOLO con el JSON, sin texto adicional.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType || 'image/jpeg',
                data: image
              }
            },
            { type: 'text', text: userPrompt }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(500).json({ error: 'Error de API', detail: data });
    }

    const rawText = data.content?.[0]?.text || '';

    // Clean and parse JSON
    const cleanText = rawText.replace(/```json|```/g, '').trim();
    let result;
    try {
      result = JSON.parse(cleanText);
    } catch (e) {
      console.error('JSON parse error:', e, 'Raw:', rawText);
      return res.status(500).json({ error: 'Error al parsear respuesta', raw: rawText });
    }

    res.json(result);

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Error interno del servidor', detail: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0' }));

app.listen(PORT, () => console.log(`BinSmart server running on port ${PORT}`));
