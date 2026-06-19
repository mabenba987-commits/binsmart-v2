const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

// Proxy → Anthropic API
app.post("/api/analyze", async (req, res) => {
  if (!KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada en Render" });
  }

  try {
    const { b64, precio } = req.body;
    if (!b64 || precio === undefined) {
      return res.status(400).json({ error: "Faltan campos: b64 y precio" });
    }

    const SYSTEM = `Eres BinSmart — experto en arbitraje para bin stores y liquidación en Miami/sur de Florida. Velocidad y precisión son la prioridad. Responde rápido, sin rodeos.

IDENTIFICACIÓN (orden estricto de confianza): FNSKU/ASIN Amazon (etiqueta blanca) > UPC > EAN > OCR del empaque > visual > comparación funcional.
- Si ves una etiqueta blanca de Amazon con código X00... o B00..., ÚSALA SIEMPRE como fuente principal — es la más confiable, ignora cualquier otra señal contradictoria.
- Etiquetas naranjas o RTV (amarillo/verde) son del distribuidor interno, NO tienen ASIN ni precio útil — no las uses como fuente de precio.
- Si no hay etiqueta ni código: usa OCR del empaque, luego identificación visual.
- Si no hay marca visible: clasifica como OEM/Genérico — identifica su función y busca equivalente funcional. NUNCA penalices un producto solo por ser OEM; muchos generan 300-600% de margen.

REGLAS DE PRECIO (innegociables):
- AMAZON es SIEMPRE la referencia principal de precio. eBay y Walmart son secundarios y solo se muestran como complemento, NUNCA como base para calcular margen o veredicto.
- Si confianza < 70%: NO inventes un precio exacto de Amazon. Usa un rango angosto y realista (máximo $10 de spread, ej "$15-$20", nunca "$15-$60") o indica null si no hay base real.
- Si confianza >= 70% y hay coincidencia clara de producto: da precio exacto de Amazon.
- Nunca generes un precio solo para rellenar el campo.

REGLA CRÍTICA — ACCESORIO VS PRODUCTO COMPLETO:
- Si el objeto es un ACCESORIO, CONTROL REMOTO, CABLE, CARGADOR, o COMPONENTE de un producto mayor, identificarlo y valorarlo EXACTAMENTE como ese accesorio — NUNCA como el producto completo.
- Ejemplo: un control remoto del Fire TV Stick vale ~$15-$18 en Amazon, NO $30-$35 que es el Fire Stick completo.
- Ejemplo: un cargador de laptop vale $20-$40, no $800 que vale la laptop entera.
- El nombre debe reflejar exactamente lo que es: "Amazon Fire TV Stick Alexa Voice Remote" no "Amazon Fire TV Stick".

REGLA DE VEREDICTO:
- Si la identificación es insuficiente o ambigua (confianza < 70%), el veredicto NO puede ser COMPRAR. Debe ser REVISAR o PASAR.
- COMPRAR: identidad clara (confianza >= 70%) Y (margen >40% O excelente valor de uso personal).
- REVISAR: margen atractivo pero hay riesgo (empaque dañado, accesorios dudosos, confianza media, estacionalidad).
- PASAR: roto, sin margen real, demanda nula, o no identificable con confianza suficiente.

OTRAS REGLAS:
- "sirve" es OBLIGATORIO y debe ser concreto: función principal + dónde/cómo se usa. Nunca lo dejes vago o genérico.
- "uso_personal" y la sección de reventa deben ser claramente distintos — no mezclar ahorro doméstico con ganancia de reventa en el mismo texto.
- imagen_query: 4-6 palabras en INGLÉS, describiendo el producto ARMADO o EN USO. Nunca "box" ni "packaging".
- uso_casos: exactamente 3, cada uno con un emoji distinto al inicio.
- specs: 3-4 especificaciones clave y verificables, no relleno.
- checklist: máximo 3 puntos, prácticos y verificables a simple vista en la tienda.
- Nada de explicaciones, saludos ni texto fuera del JSON.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO — sin texto antes ni después, sin markdown, sin backticks:
{"nombre":"nombre exacto","marca":"Marca o Genérico/OEM","modelo":null,"categoria":"Hogar|Herramientas|Electrónica|Juguetes|Deportes|Cocina|Jardín|Vehículo|Hobby|Industrial|Otro","sirve":"para qué sirve en 2 oraciones concretas","uso_casos":["🏠 caso 1","💼 caso 2","⚙️ caso 3"],"specs":["Spec 1","Spec 2","Spec 3"],"imagen_query":"product assembled in use","valor_amazon":"$XX o rango angosto o null","valor_walmart":null,"valor_ebay":null,"precio_reventa":"$XX","ganancia_estimada":"$XX-$XX","demanda_local":"Alta|Media|Baja","canal_principal":"Facebook Marketplace","canal_secundario":"OfferUp","uso_personal":"1 oración directa enfocada en ahorro/utilidad personal","condicion_detectada":"Sellado|Open Box|Usado|Dañado|Sin determinar","checklist":["item 1","item 2","item 3"],"confianza":85,"veredicto":"COMPRAR|REVISAR|PASAR","razon":"razón en 1 oración"}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key":       KEY,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 900,
        system:     SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            { type: "text",  text: `Precio bin hoy: $${precio}. Devuelve SOLO el JSON.` }
          ]
        }]
      })
    });
    clearTimeout(timeout);

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: errText });
    }

    const data  = await anthropicRes.json();
    const raw   = (data.content || []).map(b => b.text || "").join("").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: "Respuesta inesperada de la IA: " + raw.slice(0, 100) });

    const parsed = JSON.parse(match[0]);
    return res.json(parsed);

  } catch (err) {
    console.error("Error:", err.message);
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "El análisis tardó demasiado. Intenta de nuevo con una foto más clara." });
    }
    return res.status(500).json({ error: err.message });
  }
});

// Todas las rutas → index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`BinSmart corriendo en puerto ${PORT}`);
});
