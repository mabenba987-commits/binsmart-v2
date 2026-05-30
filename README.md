# BinSmart v2.0 — Instrucciones de Deploy en Render

## ¿Qué hay en este proyecto?

```
binsmart-render/
├── server.js          ← Backend (proxy a Anthropic API)
├── package.json       ← Dependencias Node.js
├── public/
│   └── index.html    ← Frontend completo rediseñado
└── README.md
```

---

## PASO 1 — Subir a GitHub

1. Ve a github.com → crea un nuevo repo llamado `binsmart-v2`
2. Sube estos archivos (server.js, package.json, y la carpeta public/)

---

## PASO 2 — Crear cuenta en Render

1. Ve a **render.com**
2. Sign up con tu cuenta de GitHub (mabenba987@gmail.com)
3. Conecta tu cuenta de GitHub

---

## PASO 3 — Crear el servidor en Render

1. Click en **"New +"** → **"Web Service"**
2. Conecta el repo `binsmart-v2`
3. Configura así:
   - **Name:** `binsmart-server`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`

---

## PASO 4 — Agregar la API key

1. En Render, ve a tu servicio → **"Environment"**
2. Agrega esta variable:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** (tu API key de Anthropic)
3. Click **"Save Changes"**

---

## PASO 5 — Deploy y URL

1. Render hará el deploy automáticamente
2. Te dará una URL tipo: `https://binsmart-server.onrender.com`
3. Abre la app en tu teléfono: `https://binsmart-server.onrender.com`
   (el frontend está servido desde el mismo servidor)

---

## PASO 6 — Verificar que funciona

- Abre la URL en tu teléfono
- El punto verde en la app confirma que el servidor está activo
- Toma una foto de un producto → selecciona precio → ANALIZAR

---

## NOTAS IMPORTANTES

- **Render Free tiene límite:** el servidor "duerme" después de 15 min de inactividad
  → La primera petición puede tardar 30-60 segundos en "despertar"
  → Las siguientes son normales (3-5 segundos)
  → Para evitar esto: upgrade a Render Starter ($7/mes) o usar el plan gratuito de Railway.app

- **La API key de Anthropic ya la tienes** en Netlify — cópiala desde:
  Netlify → tu sitio → Site configuration → Environment variables

---

## DIFERENCIAS v1 → v2

| v1 (Netlify) | v2 (Render) |
|---|---|
| Créditos limitados | Sin límite de créditos |
| Solo proxy | Proxy + Frontend |
| Respuesta texto | Tarjeta visual |
| Solo COMPRA/REVISA/PASA | + ROI + Historial + Compartir |
| Sin historial | Historial del día |
