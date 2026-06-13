# Plan de implementación — Asesor Financiero AI

> Documento de trabajo (no commitear sin permiso). Plan en 3 fases para un asesor
> financiero AI sobre Claude, self-hosted 24/7 en el Mac Mini. Basado en el diseño
> acordado con el Commander y en la infraestructura real del repo.

---

## 0. Resumen ejecutivo

Un asesor financiero que **lo sabe todo** de la cartera (datos en vivo de la DB), del
perfil del Commander (memoria personal) y del estado de los mercados/geopolítica
(memoria de mercados, mantenida sola). Se compone de:

- **Chat asesor** (Opus 4.8): interactivo, lee posiciones en vivo + perfil + digest de
  mercados; puede buscar en web en el momento.
- **Scanner de mercados** (Sonnet 4.6): **2×/día (09:00 y 18:00 Madrid)**, busca
  noticias relevantes para SUS posiciones + macro/geo, las archiva y **actualiza el
  digest en cada pasada**. (El report de Telegram de Fase 4 se encadena al de las 09:00.)
- **Curación semanal** (Sonnet 4.6): reconstruye el digest desde el archivo crudo para
  mantenerlo limpio y acotado.
- **Memoria personal** (gestión híbrida): el chat aprende cosas de él; añade automático
  (con log), borra/sobrescribe solo con confirmación.
- **Continuidad de conversaciones**: las charlas se compactan en un resumen semanal (lunes)
  que el chat lee para recordar de qué se habló.
- **Report matinal por Telegram** (Fase 4): cada mañana tras el digest de las 09:00, un brief
  con lo más importante del día, vía Bot API.

**Facturación**: vía token de suscripción (`CLAUDE_CODE_OAUTH_TOKEN`) → tira del crédito
de 200 $/mes del Max 20x (a partir del 15-jun-2026). **`ANTHROPIC_API_KEY` debe estar
SIN definir** o se factura pay-as-you-go y se pierde el crédito.

---

## 1. Arquitectura

```
        ┌──────────────────────── MAC MINI (24/7, launchd) ────────────────────────┐
        │                                                                           │
        │  launchd timers ──▶ scripts/advisor-scan.sh   (09/15/21 Madrid)           │
        │      │                  └─ tsx advisor-scan.ts ─ WebSearch (Sonnet)        │
        │      │                       ├─▶ append  data/advisor/market/journal-YYYY-MM.md
        │      │                       └─▶ update  data/advisor/market/digest.md     │
        │      │                                                                     │
        │  launchd timer ───▶ scripts/advisor-curate.sh (domingo 23:30)             │
        │                         └─ tsx advisor-curate.ts (Sonnet)                  │
        │                              └─▶ rebuild data/advisor/market/digest.md     │
        │                                                                           │
        │  launchd timer ───▶ scripts/advisor-chat-compact.sh (lunes 08:50)         │
        │                         └─ tsx advisor-chat-compact.ts (Sonnet)            │
        │                              ├─▶ write data/advisor/chats/weekly/YYYY-WXX.md
        │                              └─▶ delete data/advisor/chats/raw/*  (tras validar)
        │                                                                           │
        │  Next (puerto 3200) ── route handler SSE /api/advisor/chat (Opus, stream)  │
        │        │                  context = posiciones EN VIVO (DB)                │
        │        │                          + data/advisor/personal/profile.md       │
        │        │                          + data/advisor/market/digest.md          │
        │        │                          + resúmenes semanales de chats (continuidad)
        │        │                  + WebSearch bajo demanda                          │
        │        │                  ─▶ persiste el intercambio en chats/raw/          │
        │        │                  ─▶ pasada de extracción de memoria (Sonnet)       │
        │        │                       ├─ add  → auto + changelog                   │
        │        │                       └─ update/remove → propone → confirmas       │
        │        └─ /asesor (chat UI, streaming)                                      │
        │                                                                           │
        │  DB: tabla advisor_runs (idempotencia, coste, observabilidad)              │
        └───────────────────────────────────────────────────────────────────────────┘
```

### Almacenamiento de memoria — ficheros vs DB

- **Contenido de memoria → ficheros** bajo `data/advisor/` (gitignored, como el resto de
  `data/`). Son documentos de texto libre grandes; los agentes/nosotros operamos sobre
  ellos como documentos. SQLite no aporta nada aquí y estorba.
- **Metadatos de ejecución → DB** (`advisor_runs`): idempotencia, coste, estado, errores.
  Esto sí necesita consultas/índices.

### Layout de ficheros de memoria

```
data/advisor/
  market/
    journal-2026-06.md      # crudo, append-only, rotación mensual (ARCHIVO)
    journal-2026-07.md
    digest.md               # vista única, acotada, actualizada cada scan (LO QUE LEE EL CHAT)
    digest.bak.1.md         # últimas 3 copias del digest (anti-wipe)
    digest.bak.2.md
    digest.bak.3.md
  personal/
    profile.md              # verdad actual sobre el Commander (LO QUE LEE EL CHAT)
    profile.bak.1.md        # copias de seguridad
    changelog.md            # auditoría append-only de cambios al perfil
  chats/
    raw/                    # transcripciones crudas de la semana en curso
      2026-06-14T1530.md
    weekly/                 # resúmenes semanales (continuidad, compactados los lunes)
      2026-W24.md           # purgables >3-6 meses (toggle futuro)
  pending/
    memory-proposals.json   # propuestas update/remove a la espera de confirmación
  .lock                     # lock de proceso (PID + timestamp) para scan/curate
```

---

## 2. Decisiones de diseño (con motivo)

### D1 — El agente NO escribe ficheros; devuelve datos estructurados y NUESTRO código persiste
**Motivo (corner case):** dar al agente herramientas de escritura (Write/Edit) sobre la
única copia del digest/perfil es un riesgo enorme — un mal turno podría vaciar la memoria,
escribir fuera del directorio, o producir un fichero inválido sin gate. En su lugar:
- Las herramientas del agente se limitan a **lectura**: `WebSearch`, `WebFetch`. **Nunca**
  Bash/Write/Edit.
- El agente produce **salida estructurada** (JSON validado con Zod): findings del scan, el
  nuevo digest, las ops de memoria personal.
- Nuestro código **valida → respalda (.bak) → escribe atómico (temp + rename)**. Si la
  validación falla, se conserva la versión previa y se loguea el error.

### D2 — Trabajos batch como scripts tsx (no rutas HTTP); chat como Server Action
**Motivo:** el scan/curación corren un agente que tarda **minutos** (WebSearch, varios
turnos) y lanza un subproceso (binario `claude`). Meter eso en el proceso web ataría una
request abierta y competiría con el servidor. El repo **ya** usa scripts tsx para trabajo
pesado (`db:migrate`, `backfill-*`, `db:seed`) y un shell script para el cron de precios.
Por tanto:
- **Scan/curación → `scripts/advisor-*.ts`** disparados por **timers de launchd** vía un
  wrapper `.sh` que hace `source .env.local` (como `finances-service.sh`). Aislados, sin
  HTTP, corren y salen.
- **Chat → route handler SSE** (`/api/advisor/chat`, streaming token a token; decisión del
  Commander). El intercambio se persiste en `chats/raw/`; la extracción de memoria corre tras
  cerrar el stream. `applyMemoryProposal` sigue siendo Server Action.

> ⚠️ **PIVOTE (Fase 2):** los trabajos programados son **cron routes** (no scripts tsx). Los
> scripts standalone no pueden importar módulos con `import "server-only"` (`client.ts`/`runs.ts`
> lo llevan, y `server-only` revienta fuera del runtime de Next). Así que scan/curación/
> chat-compact/telegram son **rutas `api/cron/*` gateadas por CRON_SECRET**, disparadas por
> timers de launchd vía `curl` — idéntico patrón a `sync-prices`. Aplica a TODAS las fases.

### D3 — Digest incremental en cada scan + rebuild semanal
**Motivo:** "leer la cola del journal" es arbitrario. En su lugar, **cada scan reescribe el
digest** (fresco ≤8h) y el job semanal lo **reconstruye desde el journal crudo** para
combatir la deriva/bloat de las ediciones incrementales conservadoras. Patrón
escrituras-rápidas + compactación-periódica.

### D4 — Memoria personal: pasada de extracción separada (no en el prompt del chat)
**Motivo:** mezclar "da consejo" y "gestiona tu memoria" en el mismo prompt de Opus
ensucia el contexto y es poco fiable. En su lugar, tras cada intercambio, una **pasada
barata de Sonnet** lee (intercambio + perfil) y emite **ops estructuradas** `{op, field,
value, reason}`. El **aplicador** (nuestro código) impone la política híbrida — los `add`
no pueden borrar nada por diseño; solo `update`/`remove` requieren confirmación.

### D5 — Guardarraíl de facturación explícito
`src/lib/advisor/client.ts` **falla en voz alta** si `CLAUDE_CODE_OAUTH_TOKEN` no está, o
si `ANTHROPIC_API_KEY` SÍ está (porque la API key gana en precedencia y se saltaría el
crédito de 200 $). Esto se comprueba en cada arranque de job/chat.

### D6 — El scan se personaliza con la cartera EN VIVO
El scan lee las posiciones/sectores actuales (helpers existentes) para **enfocar** la
búsqueda en SUS activos + macro que les afecta. Pero **no escribe** memoria personal
(separación de responsabilidades).

---

## 3. Análisis de fallos y corner cases (feature a feature)

### 3.1 Scanner (3×/día)
| Fallo / caso | Mitigación |
|---|---|
| Mac dormido a la hora del scan | launchd coalesce: el slot perdido dispara al despertar. Idempotencia por slot evita doble ejecución. |
| Scan lento aún corriendo cuando dispara el siguiente | Lock (`.lock` con PID+timestamp, staleness 30 min) + fila `running` en `advisor_runs`. |
| WebSearch falla / rate-limit / red caída | `withRetry` + `withTimeout`; si tras reintentos falla, **se salta el scan**, digest intacto, error en `advisor_runs`. |
| Agente devuelve digest malformado / vacío / gigante | Validación Zod + reglas (no vacío, ≤ presupuesto, secciones presentes, no encoge >X% sin causa). Si falla, retry 1×; si persiste, conserva digest previo. |
| Crédito 200 $ agotado | El call falla con error de límite → capturar, loguear, saltar (no corromper). Settings muestra el gasto. |
| Token expirado (~1 año) | Error de auth → run marcado error con mensaje claro "ejecuta claude setup-token". |
| Noticias duplicadas entre scans | Dedup por el agente + sello "última vez confirmado" en cada ítem. |
| TZ del Mac cambia / DST | launchd usa hora local; se asume Mac en Madrid. DST lo gestiona el OS. Documentar. |

### 3.2 Journal (append-only)
| Fallo / caso | Mitigación |
|---|---|
| Crecimiento ilimitado | Rotación **mensual** (`journal-YYYY-MM.md`). Disco: ~1-3 MB/año, irrelevante. |
| Rebuild semanal lee demasiado (context blow) | Rebuild lee solo **mes actual + previo** (lo viejo ya está destilado en digests pasados). |
| Escritura parcial al crashear | Append con entradas auto-delimitadas (cabecera con timestamp); una última entrada parcial es ignorable. |
| Escritura concurrente | Solo el scan escribe el journal; protegido por el `.lock`. |

### 3.3 Digest incremental
| Fallo / caso | Mitigación |
|---|---|
| Wipe accidental | 3 backups rotados (`digest.bak.N.md`) + reconstruible desde journal. Validación anti-encogimiento. |
| Bloat/deriva por ediciones conservadoras | Rebuild semanal + presupuesto de tamaño fijo + secciones fijas. |
| Caducidad "a ojo" | Cada ítem lleva `alta` + `últ. confirmado` + tipo (estructural/transitorio). Regla: transitorio no reconfirmado en ~14 días → fuera; estructural persiste. |

### 3.4 Curación semanal (rebuild)
| Fallo / caso | Mitigación |
|---|---|
| Pierde un fact estructural que no está en el journal reciente | Input del rebuild = **digest previo + journal reciente** (no solo journal) → los estructurales se arrastran. |
| Domingo con Mac apagado | Coalesce al despertar; idempotente por semana ISO. |
| Rebuild malo | Validación + backup + swap atómico; si falla, conserva digest previo. |

### 3.5 Chat asesor
| Fallo / caso | Mitigación |
|---|---|
| Memoria vacía (instalación fresca) | Estados vacíos; el asesor funciona con lo que haya. |
| Digest obsoleto (scans fallando días) | Cabecera del digest con fecha "as of"; el asesor avisa si está rancio. |
| Pregunta sobre algo de hace minutos | El chat puede usar WebSearch en vivo en esa consulta. |
| Datos personales/financieros van a Anthropic | Inevitable para un asesor; se documenta. App es LAN, llamadas al modelo externas. |
| Consejo alucinado / responsabilidad | Disclaimer "solo informativo" en el system prompt y en la UI. |
| Historial de conversación | Fase 1: en sesión (estado React), se pasa el historial a la acción cada turno. Persistencia opcional en Fase 3. |

### 3.6 Memoria personal (híbrido)
| Fallo / caso | Mitigación |
|---|---|
| El agente "cuela" un borrado como add | El aplicador clasifica por `op`; `add` no puede borrar. Impuesto por código, no por confianza. |
| Sobre-persistir trivialidades / inferencias erróneas | Rúbrica en la pasada de extracción (qué merece guardarse); todo al changelog; revisable. |
| Borrar algo importante | `update`/`remove` → tarjeta de confirmación en el chat; solo se aplica con tu OK. |
| Hechos en conflicto | El camino de override (confirm) los resuelve. |

### 3.7 Compactación semanal de chats (lunes)
| Fallo / caso | Mitigación |
|---|---|
| Crash a mitad → se pierden transcripciones | **Orden estricto**: escribir+validar el resumen semanal ANTES de borrar los crudos. Nunca borrar sin resumen confirmado. |
| Sin conversaciones esa semana | No escribe (o stub "sin conversaciones") y sale; no error. |
| Conversación activa a las 08:50 | Solo consume ficheros con `mtime` < inicio del run; deja el abierto. |
| Mac apagado el lunes | Coalesce al despertar; idempotente por semana ISO. |
| Colisión con el scan de las 09:00 | Se programa a las **08:50** para no solapar carga/crédito con el scan. |

### 3.8 Report matinal por Telegram (tras el scan de las 09:00)
| Fallo / caso | Mitigación |
|---|---|
| Telegram caído / token inválido | El report es **secundario**: se loguea el fallo, NO tumba el scan (el digest es el entregable primario). |
| Mensaje > 4096 chars (límite Telegram) | El brief se acota a ~5 ítems; si excede, se trunca con "… (ver /asesor)". |
| Mac despierta tarde, brief rancio | Se envía con nota de hora; o se omite si el slot de las 09:00 ya pasó hace > N horas. |
| Sin novedades relevantes | Mensaje corto "sin movimientos relevantes hoy" en vez de spam. |
| Privacidad | El brief son noticias de mercado (puede citar tickers tuyos); va solo a TU chat de Telegram. |

### 3.9 Transversal
- **Guardarraíl de auth/billing** (D5): comprobado en cada arranque.
- **Escrituras atómicas**: todo fichero de memoria se escribe temp+rename, con .bak previo.
- **Observabilidad**: cada run a `advisor_runs` (tokens, coste estimado, estado, error).
- **Presupuesto**: settings muestra gasto MTD vs 200 $; Fase 3 corta scans si se acerca al tope.
- **Kill switch**: `ADVISOR_ENABLED` (env) comprobado por scripts y chat.
- **Bundling**: marcar `@anthropic-ai/claude-agent-sdk` como `serverExternalPackages` en
  `next.config` (como better-sqlite3) para que el binario no se empaquete.

---

## 4. Modelo de datos

### 4.1 Tabla `advisor_runs` (nueva, Fase 1)
```
id            text   (ulid, pk)
kind          text   'chat' | 'memory' | 'scan' | 'curate'
slot          text   clave de idempotencia: '2026-06-14T09' (scan), '2026-W24' (curate),
                     null para chat/memory
status        text   'running' | 'ok' | 'error' | 'skipped'
model         text
inputTokens   integer
outputTokens  integer
webSearches   integer
costEur       real   estimado (tokens × tarifa + búsquedas)
errorMessage  text   nullable
summary       text   nullable (p.ej. nº findings, nº ops de memoria)
startedAt     integer
finishedAt    integer  nullable
```
Índice único parcial `(kind, slot)` donde `slot` no es null y `status='ok'` → un slot no
se ejecuta dos veces con éxito. Migración drizzle nueva.

### 4.2 Ficheros (ver §1). Validación por tipo:
- **digest.md**: no vacío; ≤ `ADVISOR_DIGEST_MAX_BYTES` (~6 KB); contiene las secciones
  `## Riesgos activos`, `## Oportunidades`, `## Macro / Geo`, `## Watchlist`; cabecera con
  `as of <ISO>`.
- **profile.md**: no vacío; ≤ `ADVISOR_PROFILE_MAX_BYTES` (~4 KB).
- **journal-*.md**: solo append; cada entrada `### <ISO> — scan` + viñetas.

---

## 5. Fases

> Cada fase es **independiente y verificable**. Orden por valor: el chat primero.

### FASE 1 — Chat asesor con contexto en vivo + memoria personal (híbrido)

**Objetivo:** abrir `/asesor`, preguntar, recibir consejo fundamentado en posiciones reales
+ perfil. Sin scheduling, sin memoria de mercados (digest vacío de momento).

**Ficheros nuevos:**
- `src/lib/advisor/_net.ts` — `withTimeout`/`withRetry` (calco de `pricing/_net.ts`).
- `src/lib/advisor/client.ts` — `runAdvisor({system, prompt, model, allowedTools, maxTurns})`
  → `{ text, usage }`. **Guardarraíl D5** (token presente, API key ausente).
- `src/lib/advisor/cost.ts` — `estimateCostEur(model, usage)` con tarifas (Opus 5/25,
  Sonnet 3/15 por 1M; web search ~10 $/1000). Usa `roundEur`.
- `src/lib/advisor/memory.ts` — IO de memoria: `readProfile/writeProfile`,
  `appendChangelog`, escritura atómica + backups + validación. Puro y testeable.
- `src/lib/advisor/schemas.ts` — Zod: `MemoryOp`, `MemoryProposal`, (luego `ScanFindings`,
  `DigestDoc`).
- `src/server/advisor.ts` — `getAdvisorContext()` (snapshot en vivo: patrimonio, posiciones
  con P&L, allocation, objetivos, resumen fiscal, costes TER, XIRR), `readProfileForPrompt()`,
  `readDigestForPrompt()`, `readRecentChatSummaries()` (últimos N resúmenes semanales, acotado).
- `src/app/api/advisor/chat/route.ts` — **route handler SSE** (streaming, decisión D2/Commander):
  POST con mensaje + historial; arma contexto; stremea Opus con `WebSearch`/`WebFetch` token a
  token; al cerrar: persiste el intercambio en `chats/raw/`, lanza la pasada de extracción de
  memoria, emite evento final con `proposals`, loguea `advisor_runs`.
- `src/lib/advisor/transcripts.ts` — `appendTranscript(sessionId, exchange)` a `chats/raw/`.
- `src/actions/applyMemoryProposal.ts` — aplica una op `update`/`remove` confirmada (perfil
  + changelog), `ActionResult`.
- `src/lib/advisor/extractMemory.ts` — pasada Sonnet: (intercambio + perfil) → `MemoryOp[]`.
  Aplica `add` auto; encola `update`/`remove` en `pending/memory-proposals.json`.
- `src/db/schema/advisor_runs.ts` + migración.
- `src/app/asesor/page.tsx` — server component: carga contexto + perfil, monta el chat.
- `src/components/features/advisor/AdvisorChat.tsx` — client: chat, estado de historial,
  "pensando…", render de la respuesta.
- `src/components/features/advisor/MemoryProposalCard.tsx` — confirmación de update/remove.
- `src/components/features/advisor/ProfileEditor.tsx` — editor simple del `profile.md`
  inicial (semilla manual: edad, situación, objetivos, tolerancia al riesgo).
- Entrada en `SideNav` (`/asesor`, icono `Sparkles` o `MessageCircle`).

**Tests (vitest):**
- `memory.test.ts`: escritura atómica, validación de presupuesto, rotación de backups,
  changelog append, rechazo de perfil vacío/gigante.
- `cost.test.ts`: estimación por modelo.
- `extractMemory` con agente stubbeado: `add` se auto-aplica, `remove` se encola.
- `getAdvisorContext` con DB de test.
- **El cliente del Agent SDK se stubbea — cero llamadas reales en tests** (como el cliente
  de Yahoo).

**Setup manual (lo hace el Commander con `!`):**
- `claude setup-token` → pega el token en `.env.local` como `CLAUDE_CODE_OAUTH_TOKEN`.
- Confirmar que `ANTHROPIC_API_KEY` NO está definido.
- `pnpm add @anthropic-ai/claude-agent-sdk`.

**Definition of Done Fase 1:**
- typecheck/lint/test/build verdes; migración generada; `<SensitiveValue>` donde se rendericen
  cifras de su cartera; dark+light; nuevas env en `.env.local.example` + SPEC §9.
- Smoke: `/asesor` responde a "¿cómo está mi cartera?" usando datos reales; añadir un dato
  personal se persiste con changelog; un "borra el objetivo X" pide confirmación.
- **Verificable de verdad:** facturación enrutada al crédito (revisar dashboard de uso de
  Anthropic tras una consulta real).

---

### FASE 2 — Scanner de mercados + memoria (journal + digest incremental)

**Objetivo:** 3×/día el agente busca, archiva (journal) y mantiene el digest fresco; el chat
ya muestra conciencia de mercado.

**Ficheros nuevos:**
- `src/lib/advisor/scan.ts` — construcción del prompt (enfocado a sus holdings + macro),
  schema `ScanFindings`, merge del digest (salida estructurada → persistencia validada).
- `scripts/advisor-scan.ts` — orquesta: guard `ADVISOR_ENABLED`, lock, idempotencia por slot,
  lee holdings, corre Sonnet+WebSearch, append journal, update digest (D1), loguea run.
- `scripts/advisor-scan.sh` — wrapper: `source .env.local`, `tsx scripts/advisor-scan.ts`.
- `~/Library/LaunchAgents/com.finances.advisor-scan.plist` — 3× `StartCalendarInterval`
  (09:00/15:00/21:00). Instala el Commander con `launchctl load`.
- Extender `memory.ts`: `appendJournal` (rotación mensual), `readDigest/writeDigest` con
  validación (secciones, presupuesto, anti-wipe) + backups rotados.
- `src/server/advisor.ts`: `readDigestForPrompt()` ahora devuelve digest real + "as of".
- Settings: tarjeta "Asesor" — último scan, frescura del digest, gasto MTD.

**Tests:**
- `scan.ts` con agente stubbeado: findings → journal append + digest merge correctos.
- Rotación mensual del journal; idempotencia (segundo run del mismo slot → skipped).
- Digest malformado del agente → digest previo intacto + error logueado.
- Validación anti-wipe (digest que encoge demasiado se rechaza).

**DoD Fase 2:**
- `scripts/advisor-scan.sh` a mano: journal crece, digest se puebla; segundo run → skip;
  output basura → digest sin cambios + run `error`. Chat refleja el digest. typecheck/lint/
  test/build. launchd plist documentado.

---

### FASE 3 — Curación semanal + hardening + pulido

**Objetivo:** digest siempre limpio y acotado; guardarraíles de coste; kill switch; pulido.

**Ficheros nuevos:**
- `src/lib/advisor/curate.ts` — rebuild del digest desde (digest previo + journal mes
  actual+previo), swap atómico, validación.
- `scripts/advisor-curate.ts` + `scripts/advisor-curate.sh`.
- `~/Library/LaunchAgents/com.finances.advisor-curate.plist` — semanal (dom 23:30).
- `src/lib/advisor/chatCompact.ts` — resume `chats/raw/*` → `chats/weekly/YYYY-WXX.md`;
  **escribe+valida antes de borrar** los crudos (§3.7).
- `scripts/advisor-chat-compact.ts` + `.sh` + `com.finances.advisor-chat-compact.plist`
  (lunes 08:50). Toggle futuro de purgado de resúmenes >3-6 meses.
- Reglas de frescura/decay en ítems del digest; enforcement del presupuesto de tamaño.
- **Guardarraíl de presupuesto**: scan/curate se saltan si gasto MTD ≥ `ADVISOR_BUDGET_CAP_EUR`
  (p.ej. 180). Estado en settings.
- **Kill switch** `ADVISOR_ENABLED` cableado en todos los puntos.
- Retención de backups (últimas N copias de digest/profile).
- **Opcional**: chat en streaming (route handler SSE) + persistencia de transcripciones en
  `data/advisor/chats/`.
- **Opcional**: aviso de fallo en settings (banner si último scan = error). Telegram queda
  fuera del código de la app (solo MCP, externo).

**Tests:**
- `curate.ts`: rebuild conserva estructurales, poda transitorios caducados, respeta tope.
- Guardarraíl de presupuesto corta scans por encima del cap.
- Kill switch: deshabilitado → scripts no-op, chat responde "asesor desactivado".

**DoD Fase 3:**
- Curación semanal a mano reconstruye un digest limpio; ítems rancios caen; cap de
  presupuesto frena; flag desactiva todo con elegancia. typecheck/lint/test/build; SPEC y
  este doc actualizados.

---

### FASE 4 — Report matinal por Telegram

**Objetivo:** cada mañana, tras el scan/digest de las 09:00, recibir en Telegram un brief con
las noticias más importantes del día relevantes para la cartera.

**Diseño:**
- El **report se encadena al final del scan de las 09:00** (no un job aparte): así el digest
  está garantizado fresco y no hay carrera. Los scans de 15:00/21:00 no envían report.
- La salida estructurada del scan de las 09:00 incluye un campo `morningBrief` (markdown corto,
  ≤5 ítems con titular + por qué importa) — **sin llamada LLM extra**.
- Envío vía **Bot API de Telegram** (HTTP POST directo, autocontenido, sin MCP).

**Ficheros nuevos:**
- `src/lib/advisor/telegram.ts` — `sendTelegram(text)` → POST a
  `https://api.telegram.org/bot<token>/sendMessage` con `withTimeout`/`withRetry`. Trunca a
  4096 chars. Falla en silencio-logueado (no tumba el scan).
- `scripts/advisor-scan.ts` (extensión): si `slot.hour === 9` y `ADVISOR_TELEGRAM_ENABLED` y
  el scan fue `ok`, envía `morningBrief`. Loguea el envío en `advisor_runs.summary`.
- Settings: indicador de "último report Telegram".

**Tests:**
- `telegram.ts` con `fetch` stubbeado: trunca, reintenta, no lanza en error.
- El scan de las 09:00 produce `morningBrief`; los de 15/21 no envían.

**Setup manual (Commander):** crear/usar el bot, poner `TELEGRAM_BOT_TOKEN` y
`TELEGRAM_CHAT_ID` en `.env.local`.

**DoD Fase 4:**
- Tras un scan de las 09:00 simulado, llega el brief al Telegram; Telegram caído → scan sigue
  `ok`, fallo logueado. typecheck/lint/test/build.

---

## 6. Variables de entorno nuevas (.env.local.example + SPEC §9)
```env
# Token OAuth de larga duración de Claude Code (claude setup-token). Enruta la facturación
# al crédito de 200 $/mes de la suscripción Max 20x. NO definir ANTHROPIC_API_KEY a la vez.
CLAUDE_CODE_OAUTH_TOKEN=

# Kill switch del asesor (scans + chat). "false" desactiva todo.
ADVISOR_ENABLED=true

# Modelos.
ADVISOR_CHAT_MODEL=claude-opus-4-8
ADVISOR_SCAN_MODEL=claude-sonnet-4-6

# Tope de gasto mensual estimado (EUR) por encima del cual se saltan los scans.
ADVISOR_BUDGET_CAP_EUR=180

# Presupuestos de tamaño (bytes) de los ficheros de memoria.
ADVISOR_DIGEST_MAX_BYTES=6144
ADVISOR_PROFILE_MAX_BYTES=4096

# Report matinal por Telegram (Fase 4). Bot API directa.
ADVISOR_TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## 7. Disciplina del proyecto (CLAUDE.md / SPEC)
- Mutaciones (chat, apply-proposal) son Server Actions con Zod + `ActionResult`. Los cambios
  de memoria del asesor van a su **changelog propio** (no a `audit_events`, que es para datos
  financieros) + a `advisor_runs`. (Confirmar con el Commander si quiere también audit.)
- Cron/scripts gateados por `CRON_SECRET`/`ADVISOR_ENABLED`; idempotentes.
- `data/advisor/` está bajo `data/` → gitignored. Nunca commitear memoria.
- Nuevas env documentadas; migración bajo `drizzle/`.
- `serverExternalPackages: ['@anthropic-ai/claude-agent-sdk']` en `next.config`.

## 8. Decisiones cerradas con el Commander
1. **Streaming del chat**: ✅ **desde el principio** (route handler SSE en Fase 1).
2. **Auditoría de memoria**: ✅ **solo changelog propio del asesor**; `audit_events` solo financiero.
3. **Transcripciones**: ✅ crudas durante la semana en `chats/raw/`; **compactación semanal**
   (lunes 08:50) a `chats/weekly/`; el chat lee resúmenes para continuidad; purgado >3-6 meses
   como toggle futuro.
4. **Curación semanal del digest**: ✅ **domingo 23:30 Madrid**.
5. **Report matinal por Telegram**: ✅ **Fase 4**, encadenado al scan de las 09:00, vía Bot API.

## 9. Riesgos principales (resumen)
| Riesgo | Severidad | Mitigación |
|---|---|---|
| Pérdida de memoria por mal turno del agente | Alta | D1 (código persiste), backups, validación, journal como fuente |
| Facturación se va a pay-as-you-go (API key presente) | Alta | D5 guardarraíl que falla en voz alta |
| Coste descontrolado | Media | advisor_runs + settings + cap de presupuesto (Fase 3) |
| Token expira (~1 año) | Media | error claro + recordatorio a ~11 meses |
| WebSearch no exhaustivo | Baja | gestionar expectativa: escáner inteligente, no Bloomberg |
| Deriva/bloat del digest | Media | rebuild semanal + presupuesto + secciones + decay |
```
