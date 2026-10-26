# 2.3 Agente documental con Google Drive — Archivo TIC IA

| | |
|---|---|
| **Alumno** | Fernando Rosales Tello |
| **Materia** | Inteligencia artificial aplicada a las TIC |
| **Docente** | M.C. Víctor Manuel Pinedo Fernández |
| **Institución** | Tecnológico Nacional de México campus Pachuca |
| **Repositorio** | https://github.com/FerTello29/agente-documental-tic |
| **Producción (Vercel)** | https://agente-documental-tic-theta.vercel.app |

Proyecto académico de **Inteligencia artificial aplicada a las TIC**, Tecnológico Nacional de México, campus Pachuca. Continuación de **2.2 Agente investigador**: se reemplaza la búsqueda pública Web Search por recuperación documental de **Google Drive**, **OpenAI Vector Stores** y **File Search (RAG)**.

## Propósito pedagógico

El alumno comprenderá que una organización necesita consultar documentos propios y autorizados, no solamente Internet. Identificará el papel de OAuth, Google Drive API, sincronización, indexación semántica, recuperación de contexto, respuestas sustentadas y trazabilidad mediante fuentes. Comparará respuestas **sin** y **con** acceso documental, observará qué sucede al modificar una fuente y realizará todas las pruebas iniciales en **localhost**. El despliegue a Vercel es un **reto autónomo**, no una configuración lista para producción.

## Arquitectura

- `app/main.py`: FastAPI, endpoints REST, frontend estático y protección local de sincronización.
- `app/core/config.py`: configuración y secretos cargados desde `.env`.
- `app/models/documento.py`: modelos de solicitud y respuesta.
- `app/services/drive_service.py`: OAuth Desktop, listado limitado a una carpeta y descarga/exportación de archivos.
- `app/services/sync_service.py`: Vector Store, manifiesto de archivos, altas, cambios y bajas.
- `app/services/agent_service.py`: Responses API + File Search y fuentes verificadas por anotaciones de archivo.
- `index.html` y `assets/`: interfaz Bootstrap 5 y clases JavaScript (`ApiClient`, `Pipeline`, `DocumentLibrary`, `App`): flujo RAG animado, comparativa A/B sin y con File Search, fuentes verificables e historial de la sesión.
- `api/index.py` y `vercel.json`: función serverless que expone la misma app FastAPI en Vercel.
- `data/manifest.json`: estado local del índice (no se publica).

## 1. Requisitos

Python 3.11+, VS Code, Git, cuentas de Google Cloud y OpenAI API con créditos, navegador y documentos de prueba autorizados. **Las claves y los archivos de Drive no se incluyen en el ZIP.**

## 2. Configuración Google Drive

1. En [Google Cloud Console](https://console.cloud.google.com/), crea un proyecto y habilita **Google Drive API**.
2. Configura **Google Auth Platform**, pantalla de consentimiento y usuarios de prueba si corresponde.
3. Crea credenciales OAuth 2.0 de tipo **Desktop app** y descarga el archivo a la raíz del proyecto como `credentials.json`.
4. Crea una carpeta de Google Drive con **al menos cinco** documentos autorizados. Admite PDF, TXT y Google Docs nativos. Extrae el ID de su URL `/folders/ID`.
5. Este ejercicio utiliza el alcance `drive.readonly` para lectura; puede exigir validaciones adicionales al distribuir una app real. Usa una cuenta y una carpeta de laboratorio sin datos personales.

## 3. Preparar proyecto en Windows (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edita `.env`: define `OPENAI_API_KEY`, un `OPENAI_MODEL` compatible con File Search y `GOOGLE_DRIVE_FOLDER_ID`. `VECTOR_STORE_ID` se deja vacío la primera vez: el sistema lo guardará en el manifiesto. No insertes claves en el código ni en el navegador.

## 4. Ejecutar localmente

```powershell
python app.py
```

Abre <http://127.0.0.1:5000>. Usa **Sincronizar desde Drive** para autenticar Google, descargar/exportar los archivos autorizados e indexarlos. La primera ejecución abre el navegador OAuth en la computadora donde está corriendo Python. Después escribe preguntas sobre el contenido. Para ensayar recuperación, desactiva **File Search (RAG)** y repite exactamente la misma pregunta.

**Importante:** la sincronización usa una solicitud HTTP en localhost. Si estableces `LOCAL_ADMIN_KEY`, proporciona la cabecera `X-Admin-Key` mediante Thunder Client para `/api/sync` (el botón web no envía claves administrativas). Ejecuta el backend en `127.0.0.1`, no en `0.0.0.0`.

## 5. Endpoints

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/health` | Comprueba configuración y servidor. |
| GET | `/api/documents` | Documentos ya indexados (manifiesto local). |
| POST | `/api/sync` | Indexa cambios, requiere cliente desde loopback. |
| POST | `/api/ask` | Pregunta con `question` y `use_search`. |

Ejemplo JSON para Thunder Client:

```json
{"question": "¿Qué documentos tratan sobre AWS RDS?", "use_search": true}
```

## 6. Experimentos

1. Ejecuta una pregunta muy específica presente en los archivos **sin File Search**.
2. Repite **con File Search**: inspecciona contenido y fuentes (anotaciones verificadas).
3. Prueba temas ausentes: el agente debe declarar insuficiencia de información.
4. Agrega un documento con un dato singular, sincroniza y vuelve a preguntar.
5. Modifica un documento, vuelve a sincronizar y verifica que no se duplican registros en el manifiesto.
6. Elimina un documento de prueba del Drive autorizado, sincroniza y comprueba que desaparece del manifiesto.

**Limitaciones:** las búsquedas RAG pueden generar errores; comprueba siempre las respuestas contra las fuentes. La eliminación del índice tiene **consistencia eventual** y puede tardar en reflejarse. Los resultados sin citas explícitas no se presentan como fuentes. La actualización de un mismo archivo puede crear cargos transitorios mientras se reemplaza el anterior.

## 7. Pruebas automáticas

```powershell
pytest -q
```

Las pruebas son locales y no requieren claves reales ni consumen OpenAI.

## 8. Git/GitHub y reto autónomo Vercel

### Historial de versiones

`main` contiene la estructura inicial del docente; el desarrollo se hizo en `feature/agente-documental` con commits por hito (`feat(config)`, `feat(api)`, `feat(vercel)`, `test`, `feat(ui)`, `docs`) y después se integró en `main`. `.env`, `credentials.json`, `token.json` y `data/manifest.json` nunca se versionan.

### Por qué el prototipo local no puede publicarse tal cual

| Elemento local | Problema en Vercel | Solución aplicada |
|---|---|---|
| `InstalledAppFlow` (OAuth Desktop) | Abre un navegador **en el servidor**; en serverless no hay usuario ni pantalla. | La sincronización se ejecuta solo en localhost. `/api/sync` responde 403 en Vercel (`VERCEL=1`). |
| `token.json` | El sistema de archivos de la función es efímero y de solo lectura; el token se perdería. | No se despliega (`.vercelignore`). |
| `data/manifest.json` | Igual: no persiste entre invocaciones. | Su contenido se publica como variable de entorno `DOCUMENTS_MANIFEST`; `SyncService.load_manifest()` la usa cuando no existe el archivo. |
| `local_only` | Comprueba loopback; detrás del proxy de Vercel no es una autenticación. | Bloqueo explícito por entorno + `protect_ask` en `/api/ask`. |
| `/api/ask` público | Cualquiera podría consumir la clave de OpenAI. | Límite por IP (`ASK_RATE_LIMIT`), código de acceso opcional (`APP_ACCESS_KEY` → cabecera `X-Access-Key`) y límite de presupuesto en OpenAI Platform. |

### Arquitectura desplegada

- **CDN de Vercel:** sirve `index.html` y `assets/`.
- **Función Python (`api/index.py`):** recibe `/api/*` (reescritura en `vercel.json`) y ejecuta FastAPI. `OPENAI_API_KEY` solo existe en esta función.
- **OpenAI Vector Store:** es el índice persistente, compartido entre localhost y Vercel mediante `VECTOR_STORE_ID`.

### Variables de entorno en Vercel (Settings → Environment Variables, Production)

| Variable | Valor |
|---|---|
| `OPENAI_API_KEY` | Clave del proyecto (sensible). |
| `OPENAI_MODEL` | `gpt-4.1-mini` |
| `VECTOR_STORE_ID` | El `vector_store_id` de `data/manifest.json` tras sincronizar en local. |
| `DOCUMENTS_MANIFEST` | Contenido completo de `data/manifest.json` (nombres, enlaces de Drive e IDs de archivo). |
| `APP_ACCESS_KEY` | Opcional: código para restringir quién consulta. |
| `ASK_RATE_LIMIT` | Opcional: consultas por minuto por IP (12 por defecto). |

`GOOGLE_DRIVE_FOLDER_ID`, `credentials.json` y `token.json` **no** se configuran en Vercel. Flujo de actualización: modificar Drive → `POST /api/sync` en localhost → actualizar `DOCUMENTS_MANIFEST` en Vercel → redeploy.

### Despliegue

```powershell
npx vercel link --project agente-documental-tic
npx vercel env add OPENAI_API_KEY production
npx vercel deploy --prod
```

Comprobaciones en producción: `GET /api/health` devuelve `environment: "vercel"` y `sync_enabled: false`; `POST /api/sync` responde 403; ninguna respuesta ni archivo de `assets/js` contiene la clave (revisado en DevTools → Network/Sources).

### Investigación: OAuth web para sincronizar desde Vercel (no implementado)

Para sincronizar desde la nube sin depender del equipo local se requiere:

1. Un cliente OAuth tipo **Web application** en Google Cloud, con URI de redirección autorizada `https://<dominio>/api/oauth/callback`.
2. Flujo de *authorization code* con `google_auth_oauthlib.flow.Flow`, parámetros `state` (anti-CSRF) y `access_type=offline` para obtener un *refresh token*.
3. Sesión de usuario (cookie firmada `HttpOnly; Secure; SameSite=Lax`) y lista de cuentas autorizadas para administrar la sincronización.
4. Almacenamiento persistente y cifrado del refresh token y del manifiesto (p. ej. Vercel Marketplace: Upstash Redis o Postgres), nunca el sistema de archivos de la función.
5. Ejecutar la sincronización como tarea (Vercel Cron o una cola), porque indexar varios archivos puede superar la duración máxima de una función.

Se dejó fuera del alcance porque el alcance `drive.readonly` en una app pública exige verificación de Google y porque, para el laboratorio, el índice de solo lectura cumple el objetivo sin exponer Drive.

## 9. Costos y privacidad

OpenAI cobra por el uso de modelos, búsqueda y almacenamiento según su tarifario vigente. No subas a OpenAI documentos confidenciales, datos personales o material sin permiso del propietario. El material descargado se transmite a OpenAI para indexación. Revoca y rota cualquier credencial filtrada, incluso si ya fue borrada de GitHub.

## Entrega

Repositorio GitHub con historia de commits, URL de Vercel si culminas el reto (o documentación del bloqueo), y conclusiones sobre OAuth, Google Drive API, RAG, File Search, FastAPI, OOP, Git/GitHub y seguridad.
