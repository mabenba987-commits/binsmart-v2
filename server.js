const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));
app.use(express.static('.'));

app.get('/', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicPath)) {
    res.sendFile(publicPath);
  } else if (fs.existsSync(rootPath)) {
    res.sendFile(rootPath);
  } else {
    res.send('<h1>BinSmart API running</h1>');
  }
});

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
- NUNCA inventes precios. Siempre identifica el producto exacto con marca+modelo+color+talla antes de dar precio.
- Si hay ASIN en la etiqueta, ese es el producto exacto — úsalo.
- Las etiquetas naranja, amarilla (RTV), verde del bin store son internas del distribuidor — NO tienen precio útil.
- Solo la etiqueta blanca Amazon tiene ASIN válido.
- Productos de Home Depot (Glacier Bay, PerforMAX, Zenna Home) no aparecen en Amazon — buscar por marca+modelo.
- Si no puedes confirmar el precio, da veredicto provisional y pide al usuario que verifique.

CANALES DE REVENTA EN MIAMI:
1. Facebook Marketplace Miami
2. OfferUp
3. Flea Market
4. Bundles
5. eBay

PRECIOS DEL BIN: $1 / $2 / $4 / $6 / $8 / $12 / $16

FÓRMULA ROI:
- Ganancia neta = precio venta - precio bin - 15% fees
- ROI = (ganancia neta / precio bin) × 100
- COMPRA: ROI > 150%
- REVISA: ROI 80-150%
- PASA: ROI < 80%

RESPONDE SOLO CON ESTE JSON EXACTO:
{
  "producto": "Nombre exacto del producto",
  "categoria": "Categoría",
  "descripcion": "Qué es en 1 oración",
  "para_que_sirve": "Para qué sirve en 1-2 oraciones",
  "quien_lo_usa": "A quién va dirigido",
  "uso_personal": "Vale para uso propio o regalo",
  "valor_mercado": "Precio en Amazon o mercado",
  "precio_reventa_miami": "Precio en Facebook Marketplace Miami",
  "mejor_canal": "Dónde venderlo en Miami",
  "roi_estimado": número o null,
  "veredicto": "COMPRA" o "REVISA" o "PASA",
  "emoji_veredicto": "🟢" o "🟡" o "🔴",
  "razon_veredicto": "Razón en 1 oración",
  "tip_rapido": "Un tip práctico",
  "confianza": número del 0 al 100,
  "imagen_busqueda": "3-5 palabras en inglés para buscar imagen"
}`;

    const userPrompt = `Analiza este producto. ${priceContext} ${extraContext}

Identifica usando este orden:
1. Etiqueta Amazon con ASIN → úsala directamente
2. Texto en la caja → léelo
3. Marca y modelo → úsalos
4. Solo imagen → identifica visualmente

Responde SOLO con el JSON.`;

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
      return res.status(500).json({ error: 'Error de API', detail: data });
    }

    const rawText = data.content?.[0]?.text || '';
    const cleanText = rawText.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(cleanText);
    } catch (e) {
      return res.status(500).json({ error: 'Error al parsear respuesta', raw: rawText });
    }

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: 'Error interno', detail: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0' }));

app.listen(PORT, () => console.log(`BinSmart server running on port ${PORT}`));
