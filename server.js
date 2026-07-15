const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
    }
  }
}));

// Busca una imagen real de referencia en Wikimedia Commons (sin API key, muy estable).
// Server-side para evitar el bloqueo de CORS que rompió la versión anterior con Unsplash.
// Nota: se cambió de Openverse a Wikimedia Commons porque Openverse tiene límites
// de uso anónimo muy estrictos que fallaban en producción (confirmado en pruebas de campo).
async function buscarImagen(query) {
  if (!query) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: query + " filetype:bitmap",
      gsrlimit: "1",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "600",
      format: "json"
    });
    const url = "https://commons.wikimedia.org/w/api.php?" + params.toString();
    const r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "BinSmart/1.0 (bin store arbitrage app)" } });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const data = await r.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const first = Object.values(pages)[0];
    const info = first?.imageinfo?.[0];
    return info ? (info.thumburl || info.url || null) : null;
  } catch {
    return null; // si falla o tarda, seguimos sin imagen — nunca bloquea el análisis
  }
}

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
- Si ves una etiqueta blanca de Amazon con código X00... o B00..., ÚSALA SIEMPRE como fuente principal.
- BUG-A — FNSKU INCONSISTENTE: si detectas MÁS DE UNA etiqueta FNSKU con códigos distintos en el mismo producto, o si el código FNSKU no coincide con lo que muestra la imagen visualmente, esto es una señal de riesgo (posible mezcla de productos o etiqueta reciclada). En ese caso el veredicto NUNCA puede ser COMPRAR — usa 🟡 REVISAR y dilo explícitamente en "razon".
- Etiquetas naranjas o RTV (amarillo/verde) son del distribuidor interno, NO tienen ASIN ni precio útil — no las uses NUNCA como fuente de precio, aunque tengan un código visible.
- Si no hay etiqueta ni código: usa OCR del empaque, luego identificación visual.
- Si no hay marca visible: clasifica como OEM/Genérico — identifica su función y busca equivalente funcional. NUNCA penalices un producto solo por ser OEM; muchos generan 300-600% de margen. Pero su precio SIEMPRE debe llevar el sufijo "(estimado)" — ver BUG-D abajo.

REGLAS DE PRECIO (innegociables) — BUG-I:
- AMAZON es SIEMPRE la referencia principal de precio. eBay y Walmart son secundarios y solo se muestran como complemento, NUNCA como base para calcular margen o veredicto.
- Precio EXACTO (sin rango, sin "(estimado)"): siempre que puedas LEER un código de barras legible en la foto — FNSKU, ASIN, UPC o EAN — porque ese código identifica un producto específico y su precio real en Amazon. Un código de barras claramente legible cuenta como identificación confirmada, NO como estimación visual.
- Rango "(estimado)" — SOLO cuando NO hay ningún código de barras legible en la foto y la identificación depende de reconocimiento visual, marca/modelo por texto suelto, o comparación funcional:
  - Confianza >= 85% (identificación visual/OCR fuerte sin código): rango angosto de máximo $5 de spread (ej. "$18-$23"), con sufijo "(estimado)".
  - Confianza 70-84%: rango conservador (máximo $8 de spread) con sufijo "(estimado)" — nunca rangos tipo "$15-$60".
  - Confianza < 70% o producto no identificable con certeza: valor_amazon = null. No inventes un número solo para rellenar el campo.
- BUG-D — OEM/Genérico sin marca Y sin código de barras legible: el precio SIEMPRE lleva "(estimado)" sin importar la confianza, porque no hay listado que lo respalde. Pero si el OEM SÍ tiene un código de barras (UPC/EAN) legible, trátalo como precio exacto igual que cualquier otro producto con código.
- codigo_identificador: si leíste un código de barras (cualquier tipo: FNSKU, ASIN, UPC, EAN), transcríbelo aquí tal cual aparece. Si no hay ninguno legible, usa null.

REGLA CRÍTICA — ACCESORIO VS PRODUCTO COMPLETO:
- Si el objeto es un ACCESORIO, CONTROL REMOTO, CABLE, CARGADOR, o COMPONENTE de un producto mayor, identificarlo y valorarlo EXACTAMENTE como ese accesorio — NUNCA como el producto completo.
- Ejemplo: un control remoto del Fire TV Stick vale ~$15-$18 en Amazon, NO $30-$35 que es el Fire Stick completo.
- Ejemplo: un cargador de laptop vale $20-$40, no $800 que vale la laptop entera.
- El nombre debe reflejar exactamente lo que es: "Amazon Fire TV Stick Alexa Voice Remote" no "Amazon Fire TV Stick".

REGLA DE VEREDICTO (evalúa en este orden — cualquier excepción de abajo gana sobre la regla general):
1. Si la identificación es insuficiente o ambigua (confianza < 70%), el veredicto NO puede ser COMPRAR. Debe ser REVISAR o PASAR.
2. BUG-G — CONFIANZA MEDIA + PRECIO NO VERIFICADO: si la confianza está entre 70% y 84% Y el precio de Amazon no viene de un código de barras legible (es decir, lleva "(estimado)"), el veredicto NUNCA puede ser COMPRAR — usa 🟡 REVISAR.
3. BUG-E — PRODUCTOS MECÁNICOS: productos con partes móviles propensas a fallar (sombrillas, sillas plegables, herramientas manuales con bisagras/resortes, juguetes mecánicos, artículos con mecanismos de apertura/cierre) van a 🟡 REVISAR por defecto — la única excepción es si está claramente sellado de fábrica y nuevo, sin señales de uso.
4. BUG-H — APPLE DE ALTO VALOR: cualquier producto Apple identificado (iPhone, iPad, MacBook, Apple Watch, AirPods, etc.) con valor de mercado superior a $50 va SIEMPRE a 🟡 REVISAR, sin excepción, y el checklist debe incluir verificar autenticidad (número de serie, logo, materiales) — el riesgo de falsificación es demasiado alto para dar COMPRAR directo.
5. Si nada de lo anterior aplica: COMPRAR = identidad clara (confianza >= 70%, y si es de precio medio 70-84% el precio debe estar verificado por un código de barras legible) Y (margen >40% O excelente valor de uso personal).
6. REVISAR: margen atractivo pero hay riesgo (empaque dañado, accesorios dudosos, confianza media, estacionalidad, o cualquiera de las excepciones BUG-A/E/G/H).
7. PASAR: roto, sin margen real, demanda nula, o no identificable con confianza suficiente.

BUG-B — CONSUMIBLES: si el producto es un consumible o tiene fecha de caducidad (comida, suplementos, cosméticos, medicamentos, baterías, productos de limpieza), el PRIMER punto del checklist debe ser siempre "Verificar fecha de vencimiento/caducidad" — sin excepción.

BUG-C — CLIMA FRÍO EN MIAMI: productos de clima frío (calentadores, ropa de invierno, guantes térmicos, quitanieves, botas de nieve, decoración navideña de nieve) deben recibir demanda_local = "Baja" automáticamente, sin importar qué tan bueno parezca el producto — Miami no tiene mercado real para esto.

BUG-009 — REVENTA VS USO PERSONAL (siempre debe quedar clarísimo, nunca mezclado):
- "mejor_para" = "Reventa": cuando el margen de ganancia supera claramente el valor de uso personal (ej. producto que el usuario no necesita pero se vende rápido y bien).
- "mejor_para" = "Uso Personal": cuando el ahorro/utilidad para el propio comprador es el factor principal, aunque el margen de reventa sea bajo o nulo.
- "mejor_para" = "Ambos": cuando es fuerte en las dos dimensiones (buen margen Y útil para el hogar).
- El campo "uso_personal" y la sección de reventa deben seguir siendo textos independientes — "mejor_para" es solo la etiqueta rápida que resume cuál pesa más.

OTRAS REGLAS:
- "sirve" es OBLIGATORIO y debe ser concreto: función principal + dónde/cómo se usa. Nunca lo dejes vago o genérico.
- "uso_personal" y la sección de reventa deben ser claramente distintos — no mezclar ahorro doméstico con ganancia de reventa en el mismo texto.
- imagen_query: 4-6 palabras en INGLÉS, describiendo el producto ARMADO o EN USO. Nunca "box" ni "packaging".
- foto_muestra_producto: true SOLO si la foto que analizaste muestra el producto en sí (armado, fuera de caja, en uso, o claramente visible). false si la foto es de un código de barras, etiqueta, empaque cerrado, o cualquier cosa que NO deje ver cómo es el producto realmente — esto es importante porque esa foto se le mostrará al usuario como "referencia visual" y no queremos mostrarle un código de barras pensando que es el producto.
- asin: si identificaste un ASIN o FNSKU confiable (empieza con B0... o X00...), inclúyelo tal cual aquí. Si no hay ASIN/FNSKU confirmado, usa null — NUNCA inventes uno.
- uso_casos: exactamente 3, cada uno con un emoji distinto al inicio.
- specs: 3-4 especificaciones clave y verificables, no relleno.
- checklist: máximo 3 puntos, prácticos y verificables a simple vista en la tienda (recuerda BUG-B para consumibles).
- Nada de explicaciones, saludos ni texto fuera del JSON.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO — sin texto antes ni después, sin markdown, sin backticks:
{"nombre":"nombre exacto","marca":"Marca o Genérico/OEM","modelo":null,"categoria":"Hogar|Herramientas|Electrónica|Juguetes|Deportes|Cocina|Jardín|Vehículo|Hobby|Industrial|Otro","sirve":"para qué sirve en 2 oraciones concretas","uso_casos":["🏠 caso 1","💼 caso 2","⚙️ caso 3"],"specs":["Spec 1","Spec 2","Spec 3"],"imagen_query":"product assembled in use","foto_muestra_producto":true,"asin":"B0XXXXXXXX o null","codigo_identificador":"código de barras leído (cualquier tipo) o null","valor_amazon":"$XX o \\"$XX-$YY (estimado)\\" o null","valor_walmart":null,"valor_ebay":null,"precio_reventa":"$XX","ganancia_estimada":"$XX-$XX","demanda_local":"Alta|Media|Baja","canal_principal":"Facebook Marketplace","canal_secundario":"OfferUp","mejor_para":"Reventa|Uso Personal|Ambos","uso_personal":"1 oración directa enfocada en ahorro/utilidad personal","condicion_detectada":"Sellado|Open Box|Usado|Dañado|Sin determinar","checklist":["item 1","item 2","item 3"],"confianza":85,"veredicto":"COMPRAR|REVISAR|PASAR","razon":"razón en 1 oración"}`;

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
        model:      "claude-sonnet-4-5-20250929",
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

    // MEJORA-2: buscar imagen real de referencia server-side (evita CORS del navegador)
    parsed.imagen_url = await buscarImagen(parsed.imagen_query);

    // MEJORA-3 (corregido): link directo a Amazon.
    // OJO: el FNSKU (código que empieza en X00) es una etiqueta INTERNA de la bodega de Amazon —
    // no es un identificador público, buscarlo en amazon.com nunca devuelve resultados.
    // Solo un ASIN real (siempre empieza en B0) sirve para link directo /dp/.
    // Solo UPC/EAN (puros números) sirven para buscar por código.
    // Para todo lo demás (FNSKU, o sin código) buscamos por marca + nombre — eso sí encuentra el producto real.
    const asin = parsed.asin;
    const esASINReal = asin && /^B0[A-Z0-9]{8}$/i.test(asin);
    const codigo = parsed.codigo_identificador;
    const esUPCoEAN = codigo && /^\d{8,14}$/.test(codigo);

    if (esASINReal) {
      parsed.amazon_url = `https://www.amazon.com/dp/${asin}`;
    } else if (esUPCoEAN) {
      parsed.amazon_url = `https://www.amazon.com/s?k=${encodeURIComponent(codigo)}`;
    } else {
      const marca = parsed.marca && parsed.marca !== "Genérico/OEM" ? parsed.marca : "";
      const termino = [marca, parsed.nombre].filter(Boolean).join(" ") || parsed.nombre || "";
      parsed.amazon_url = `https://www.amazon.com/s?k=${encodeURIComponent(termino)}`;
    }

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
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`BinSmart corriendo en puerto ${PORT}`);
});
