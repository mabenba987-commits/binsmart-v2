const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname)));

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

    const SYSTEM = `Eres BinSmart — experto en arbitraje para bin stores y liquidación en Miami/sur de Florida.

IDENTIFICACIÓN (prioridad): FNSKU > ASIN > UPC > EAN > OCR > visual > funcional

REGLAS:
- confianza < 70%: REVISAR o PASAR, nunca COMPRAR
- NUNCA inventes precios sin identificación confiable
- OEM puede dar 600% margen — nunca descartes
- Evalúa SIEMPRE uso personal además de reventa
- imagen_query: 4-6 palabras INGLÉS, producto ARMADO o EN USO, nunca "box" ni "packaging"
- uso_casos: 3 casos con emoji
- specs: 3-4 especificaciones clave

VEREDICTOS:
COMPRAR: identidad clara + margen >40% O gran valor personal
REVISAR: riesgo moderado, confianza media, incompleto  
PASAR: roto, sin margen, no identificable

RESPONDE SOLO CON JSON — sin texto, sin markdown:
{"nombre":"nombre exacto","marca":"Marca o Genérico/OEM","modelo":null,"categoria":"Hogar|Herramientas|Electrónica|Juguetes|Deportes|Cocina|Jardín|Vehículo|Hobby|Industrial|Otro","sirve":"para qué sirve en 2 oraciones","uso_casos":["🏠 caso 1","💼 caso 2","⚙️ caso 3"],"specs":["Spec 1","Spec 2","Spec 3"],"imagen_query":"product assembled in use","valor_amazon":"$XX","valor_walmart":null,"valor_ebay":null,"precio_reventa":"$XX","ganancia_estimada":"$XX-$XX","demanda_local":"Alta|Media|Baja","canal_principal":"Facebook Marketplace","canal_secundario":"OfferUp","uso_personal":"1 oración directa","condicion_detectada":"Sellado|Open Box|Usado|Dañado|Sin determinar","checklist":["item 1","item 2","item 3"],"confianza":85,"veredicto":"COMPRAR|REVISAR|PASAR","razon":"razón en 1 oración"}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key":       KEY,
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-5",
        max_tokens: 1200,
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
