# OpenThinking — Plan de Implementacion Completo

> Generado: 2026-05-18
> Basado en analisis exhaustivo del codebase actual (v0.1.3, branch dev)

---

## Estado Actual del Codebase

### Lo que YA existe:
- **Pipeline executor** con DAG, agent loop, sequential + orchestrated modes
- **Context store** SQLite con TTL, namespaces, get/set/list/clear/inspect
- **Policy engine** con glob matching read/write, rate limiting (token bucket), cost tracking
- **Provider system** con factory, OpenAI-compat adapter, Anthropic/Ollama customizations
- **Retry system** con exponential backoff, jitter, header parsing (Retry-After, rate-limit-reset)
- **Fallback models** por rate limit (ya en StageDefinition.fallback_models)
- **Run persistence** en SQLite (runs.db) con event stream completo
- **UI Web** con React + Zustand: Dashboard, Pipelines, Pipeline Editor (DAG visual), Runs, RunDetail, Providers, Skills, Context Store, Projects, History, Settings, Logs
- **SSE streaming** para runs en tiempo real
- **Event bus** tipado con pipeline/stage/tool/context/delegate events
- **Structured logger** con JSON en produccion, pretty-print en dev
- **Pricing table** con estimacion de costos por modelo
- **Skill system** con manifests (skill.yaml) y prompts (prompt.md)
- **Tool registry** con filtro por allowed_tools (skill.yaml o pipeline YAML override)
- **Workspace system** con .openthk/ por proyecto

### Lo que NO existe:
- Context versioning/snapshots/diffing/compression/schema validation
- Breakpoints, step-through, replay
- Distributed execution (workers)
- Skill composition/inheritance/hooks
- Rollback automatico, pause-on-error, human-in-the-loop
- OpenTelemetry, Prometheus metrics
- Cost predictor, auto-scaling de modelos
- Health checks a providers, round-robin, latency-based routing
- Audit logging completo, encryption de keys, deterministic replay
- Roles/permisos fine-grained, firma digital de skills
- Input validation/sanitization de prompts
- Test framework para skills/pipelines, mocking de providers, sandbox
- Doc generator
- Analytics avanzado
- Multi-LLM reasoning (debate, self-reflection)
- Agentic lookahead
- Token streaming en REPL
- Docker support

---

## Orden de Implementacion

Los items estan ordenados por:
1. **Prioridad** (items marcados !importante primero)
2. **Dependencias** (fundamentos antes que features que los necesitan)
3. **Impacto/valor** (max valor con min riesgo)
4. **Complejidad** (menor a mayor)

---

### FASE 1 — Fundamentos Criticos (!importante + dependencias core)

#### 1.1 Context Compression (!importante)
**Punto**: 5c — Context compression para pipelines largos
**Estado**: No existe
**Que hacer**:
- Agregar columna `compressed BOOLEAN DEFAULT 0` y `raw_size INTEGER` a `context_entries`
- Implementar `src/context/store/compression.ts` con zlib (gzip) para entries > 4KB
- Comprimir al escribir, descomprimir al leer (transparente)
- Agregar metodo `contextStore.getStats()` para ver ratio de compresion
- En el lazy context index, mostrar tamano real vs comprimido

**Que se rompe**: Nada — es una mejora transparente al store existente. Las migraciones de schema SQLite se aplican con ALTER TABLE + valor default.

**CLI**: `/context stats` muestra ratio de compresion
**UI**: En la vista **Context Store** (`ContextStore.tsx`), agregar badge de tamano comprimido junto a cada entry, y un resumen global arriba: "12 entries, 45KB raw, 8KB stored"

**Archivos a tocar**:
- `src/context/store/context-store.ts` — schema migration, compress on write, decompress on read
- `src/context/store/compression.ts` — nuevo
- `src/cli/repl/slash-commands.ts` — `/context stats`
- `src/ui/web/src/views/ContextStore.tsx` — UI de stats
- `src/ui/server/routes.ts` — endpoint `/api/context/stats`

---

#### 1.2 Permission System + Human-in-the-Loop (!importante)
**Punto**: 7d — Sistema de permisos integrado estilo Claude Code
**Estado**: No existe. El agent loop ejecuta todo sin pedir permiso.

**Modelo**: Como Claude Code, no como un simple flag YAML. Es un sistema de permisos
built-in que intercepta acciones potencialmente peligrosas y pide confirmacion automaticamente.

**Que hacer**:

**A) Permission Engine** (`src/core/permissions/`):
- Clasificar acciones por riesgo:
  - **Auto-allow**: `read_file`, `list_files`, `search_files`, `get_context` — solo lectura
  - **Confirm once**: `write_file` (nuevo archivo), `run_command` (comando no conocido)
  - **Confirm always**: `run_command` con sudo/rm/destructivos, escritura fuera del workspace
- Cada accion se evalua contra una **permission table** persistente:
  ```
  ~/.openthk/permissions.json
  {
    "rules": [
      { "tool": "write_file", "pattern": "/workspace/**", "action": "allow" },
      { "tool": "run_command", "pattern": "npm test", "action": "allow" },
      { "tool": "run_command", "pattern": "rm *", "action": "deny" }
    ]
  }
  ```
- Opciones al pedir confirmacion:
  - **Allow once** — solo esta vez
  - **Allow always** — guardar regla permanente en permissions.json
  - **Deny once** — bloquear esta vez, continuar pipeline
  - **Deny always** — guardar regla de denegacion permanente
  - **Inspect** — ver detalles de la accion antes de decidir

**B) Permission Modes** (como Claude Code):
- `--permissions auto` — todo auto-approve (CI/CD, scripts)
- `--permissions confirm` — default, pide confirmacion para acciones de riesgo
- `--permissions strict` — pide confirmacion para TODO excepto reads
- Configurable por pipeline en YAML: `permissions: confirm | auto | strict`
- Configurable globalmente: `~/.openthk/config.json: { "defaultPermissions": "confirm" }`

**C) Stage-level overrides** (opcional en YAML):
```yaml
stages:
  coder:
    permissions: auto          # trust this stage fully
    confirm_on_complete: true  # pero pedir review al terminar el stage
  deployer:
    permissions: strict        # every action needs approval
```

**D) Confirmation Gate** (reutilizable por error-recovery y debugging):
- `ConfirmationGate`: promesa que se resuelve desde CLI (readline) o UI (endpoint)
- Events: `permission:request`, `permission:granted`, `permission:denied`
- Timeout configurable: si nadie responde en X segundos, default action (deny)

**Que se rompe**: Nada — el default es `confirm` que pide permiso solo para writes/commands.
Sin configuracion, se comporta como un sistema nuevo pero no bloquea reads.
Para CI/CD, `--permissions auto` mantiene el comportamiento actual.

**CLI**:
- Al ejecutar una accion que necesita permiso:
  ```
  [write_file] /workspace/src/index.ts (new file, 45 lines)
  Allow? [y]es / [n]o / [a]lways / never / [i]nspect >
  ```
- Al terminar un stage con `confirm_on_complete`:
  ```
  Stage "coder" completed. Review output?
  [a]pprove / [r]eject / [i]nspect context >
  ```
- `/permissions list` — ver reglas guardadas
- `/permissions reset` — borrar todas las reglas
- `/permissions add <tool> <pattern> allow|deny` — agregar regla manual

**UI**:
- En **RunDetail** (`RunDetail.tsx`): cuando llega `permission:request`, modal con:
  - Detalle de la accion (tool, args, path, preview del contenido)
  - Botones: Allow / Allow Always / Deny / Deny Always / Inspect
  - Checkbox "Remember for this pipeline"
- En **Settings** (`Settings.tsx`): nueva seccion "Permissions"
  - Tabla de reglas guardadas con toggle allow/deny y boton delete
  - Selector de modo default (auto/confirm/strict)
  - Per-tool defaults (expandible)
- Nuevo endpoint `POST /api/runs/:id/permission` con `{ requestId, action, remember }`
- Endpoint `GET /api/permissions` y `PUT /api/permissions`

**Archivos a tocar**:
- `src/core/permissions/` — nuevo directorio
- `src/core/permissions/permission-engine.ts` — clasificacion de acciones, evaluacion de reglas
- `src/core/permissions/permission-store.ts` — persistencia de reglas en JSON
- `src/core/permissions/confirmation-gate.ts` — promesa resoluble desde CLI/UI
- `src/shared/types.ts` — nuevos eventos permission:*, PermissionMode en StageDefinition
- `src/tools/tool-registry.ts` — wrap tool execution con permission check
- `src/pipeline/executor/stage-executor.ts` — pass permission engine, confirm_on_complete
- `src/cli/repl/repl.ts` — readline prompt para confirmaciones
- `src/cli/commands/run.ts` — --permissions flag
- `src/cli/repl/slash-commands.ts` — /permissions subcommands
- `src/ui/server/routes.ts` — endpoints permission
- `src/ui/server/run-manager.ts` — pass permission signals
- `src/ui/web/src/views/RunDetail.tsx` — modal permission
- `src/ui/web/src/views/Settings.tsx` — permissions section
- `src/config/global-config.ts` — defaultPermissions setting

---

#### 1.3 Error Recovery: Backoff Exponencial por Stage + Rollback
**Punto**: 7a, 7b, 7c
**Estado**: Parcial — ya existe retry por stage con `on_fail.max_retries` y retry HTTP con backoff. FALTA: backoff exponencial entre stage retries, rollback a snapshot, pause-on-error.
**Que hacer**:
- **7a** `max_retries` con backoff: En `executeStageWithRetry()`, agregar delay exponencial entre reintentos de stage (no solo HTTP). Agregar `on_fail.backoff_base_ms` (default 2000).
- **7b** Rollback: Requiere context snapshots (ver 1.4). Al fallar un stage, restaurar el context snapshot tomado antes de ejecutarlo.
- **7c** Pause-on-error: Nuevo campo `on_fail.pause: boolean`. Si true, emitir `stage:error-paused` y esperar resolucion humana (reutilizar ConfirmationGate del permission system de 1.2).

**Que se rompe**: Nada — es backwards compatible. `on_fail` ya existe, se extiende.

**CLI**: En pause-on-error, REPL muestra error y opciones: `[R]etry / [S]kip / [A]bort / [I]nspect context`
**UI**: En **RunDetail**, panel de error pausado con las mismas opciones como botones. El DAG interactivo marca el stage en amarillo (paused).

**Archivos a tocar**:
- `src/shared/types.ts` — extender FailureConfig
- `src/pipeline/executor/stage-executor.ts` — backoff entre retries, rollback, pause
- `src/context/store/context-store.ts` — snapshot/restore (ver 1.4)
- `src/ui/web/src/views/RunDetail.tsx` — error pause UI

---

#### 1.4 Context Versioning: Snapshots
**Punto**: 5a — Context snapshots nombrados
**Estado**: No existe
**Que hacer**:
- Nueva tabla `context_snapshots` en context.db: `(id, name, created_at, created_by, entries_json)`
- Metodos: `saveSnapshot(name)`, `restoreSnapshot(name)`, `listSnapshots()`, `deleteSnapshot(name)`
- Auto-snapshot antes de cada stage execution (nombre: `pre-{stageName}-{timestamp}`)
- Snapshot manual via CLI/API

**Que se rompe**: Nada — nueva tabla, metodos nuevos.

**CLI**: `/context save <name>`, `/context restore <name>`, `/context snapshots`
**UI**: En **Context Store**, nueva seccion "Snapshots" con lista de snapshots, botones save/restore/delete. Icono de camara para save, icono de reloj para restore.

**Archivos a tocar**:
- `src/context/store/context-store.ts` — nueva tabla + metodos
- `src/context/store/snapshots.ts` — nuevo modulo
- `src/cli/repl/slash-commands.ts` — nuevos subcommands
- `src/ui/server/routes.ts` — `/api/context/snapshots`, POST/DELETE
- `src/ui/web/src/views/ContextStore.tsx` — snapshots UI

---

#### 1.5 Sandbox Execution Environment (!importante)
**Punto**: 18c — Ejecutar sin tocar ficheros reales
**Estado**: No existe
**Relacion con 1.2**: El sandbox es el **cuarto modo de permisos**. El permission system
(1.2) decide QUE acciones necesitan aprobacion. El sandbox decide DONDE se ejecutan.
Juntos forman el sistema de seguridad de ejecucion completo.

**Modelo** (inspirado en Codex):
- Los stages ejecutan en un **directorio espejo** (copia CoW o symlink + overlay del workspace)
- Todas las escrituras van al sandbox. Las lecturas leen primero del sandbox, fallback al real.
- Al terminar el stage (o pipeline), el humano revisa el diff y decide aplicar o descartar.
- Esto es distinto al permission system: en sandbox NO hay interrupciones durante la ejecucion.
  El stage corre libre dentro de su burbuja, y la revision es al final.

**Que hacer**:

**A) Sandbox Manager** (`src/core/sandbox/`):
- `createSandbox(workspaceDir)`: crea directorio temporal, copia estructura (o usa overlay)
  - En macOS/Linux: `cp -al` (hard links) para copies baratas, o tmpdir con overlay
  - Fallback: simple deep copy del workspace a `/tmp/openthk-sandbox-{uuid}/`
- `getSandboxDiff(sandboxDir, workspaceDir)`: genera diff unificado de todos los cambios
- `applySandbox(sandboxDir, workspaceDir)`: copia cambios del sandbox al workspace real
- `discardSandbox(sandboxDir)`: limpia el directorio temporal
- Network isolation: NO implementar (requiere containers), pero documentar que run_command
  tiene acceso a red. Para isolation real, usar Docker (punto 10.1).

**B) Integracion con Permission Modes** (extiende 1.2):
- Nuevo modo: `--permissions sandbox` — auto-approve todo DENTRO del sandbox, review al final
- Jerarquia completa:
  ```
  auto     → todo permitido, filesystem real (CI/CD)
  sandbox  → todo permitido dentro de sandbox, review del diff al final
  confirm  → pide permiso por accion en filesystem real (default)
  strict   → pide permiso para TODO en filesystem real
  ```
- Configurable por stage:
  ```yaml
  stages:
    coder:
      permissions: sandbox    # trabaja libre en sandbox
    reviewer:
      permissions: confirm    # cada accion supervisada
  ```

**C) Tool Wrapping**:
- `write_file`: redirige path al sandbox dir transparentemente
- `read_file`: lee del sandbox si existe ahi, sino del workspace real
- `list_files`: merge de sandbox + workspace real
- `run_command`: ejecuta con `cwd` apuntando al sandbox dir
- `search_files`: busca en sandbox dir
- El LLM NO sabe que esta en sandbox — para el, es su workspace normal

**D) Review Flow al terminar**:
- CLI:
  ```
  Stage "coder" completed in sandbox. 5 files changed:
    M src/index.ts (+45 -12)
    A src/utils/helper.ts (new, 23 lines)
    A src/utils/types.ts (new, 8 lines)
    M package.json (+2 -0)
    D src/old-helper.ts (deleted)

  [a]pply all / [r]eject all / [i]nspect file-by-file / [d]iff >
  ```
- Inspect file-by-file permite aprobar/rechazar cambios individualmente
- UI: En **RunDetail**, tab "Sandbox Changes" con:
  - File tree de cambios (iconos M/A/D como git)
  - Click en archivo para ver diff side-by-side
  - Checkboxes por archivo para seleccionar cuales aplicar
  - Botones "Apply Selected" / "Apply All" / "Discard All"

**Que se rompe**: Nada — opt-in via `--permissions sandbox` o stage-level override.
El default sigue siendo `confirm` (filesystem real con permisos).

**CLI**: `--permissions sandbox` flag, review interactivo al final
**UI**:
- En **RunPipeline** (`RunPipeline.tsx`): el selector de permission mode incluye "Sandbox"
- En **RunDetail** (`RunDetail.tsx`): nueva tab "Sandbox Changes" con diff viewer
- En **Settings** (`Settings.tsx`): opcion de default permission mode incluye sandbox

**Archivos a tocar**:
- `src/core/sandbox/` — nuevo directorio
- `src/core/sandbox/sandbox-manager.ts` — create/diff/apply/discard
- `src/core/sandbox/sandbox-tools.ts` — wrappers de tools para redirigir paths
- `src/core/permissions/permission-engine.ts` — agregar modo sandbox
- `src/tools/tool-registry.ts` — condicional: si sandbox, usar wrappers
- `src/pipeline/executor/stage-executor.ts` — crear sandbox antes de stage, review al final
- `src/cli/repl/repl.ts` — review interactivo de sandbox diff
- `src/cli/commands/run.ts` — --permissions sandbox
- `src/ui/server/routes.ts` — `GET /api/runs/:id/sandbox-diff`, `POST /api/runs/:id/sandbox-apply`
- `src/ui/web/src/views/RunDetail.tsx` — sandbox diff tab
- `src/ui/web/src/views/RunPipeline.tsx` — sandbox option en permission selector

---

### FASE 2 — Observabilidad y Costos

#### 2.1 Context Diffing
**Punto**: 5b — Mostrar que cambio entre stages
**Estado**: No existe. El event bus ya emite `context:write` pero no guarda el valor anterior.
**Que hacer**:
- Antes de cada `contextStore.set()` en el executor, leer el valor anterior
- Emitir nuevo evento `context:diff` con `{ key, stageName, before: string | null, after: string }`
- Almacenar diffs en run_events para replay

**CLI**: `/context diff` despues de un run muestra cambios
**UI**: En **RunDetail**, nueva tab "Context Changes" que muestra un diff view por stage (estilo git diff, green/red).

**Archivos a tocar**:
- `src/shared/types.ts` — nuevo evento context:diff
- `src/pipeline/executor/stage-executor.ts` — leer antes de escribir
- `src/cli/repl/slash-commands.ts` — /context diff
- `src/ui/web/src/views/RunDetail.tsx` — tab context diffs

---

#### 2.2 Cost Predictor
**Punto**: 9a — Predecir costo antes de ejecutar
**Estado**: Ya existe `pricing.ts` con tabla de precios. No hay predictor.
**Que hacer**:
- `src/providers/cost-predictor.ts`: dado un pipeline config, estimar costo basado en:
  - Modelo de cada stage * max_tokens (peor caso)
  - Historial de runs anteriores del mismo pipeline (media)
- Mostrar antes de ejecutar: "Estimated cost: $X.XX - $Y.YY"
- Si `cost_limit` esta definido y el estimado lo excede, warning

**CLI**: Antes de `openthk run`, mostrar prediccion. Flag `--dry-run` para solo ver estimacion.
**UI**: En **RunPipeline** (`RunPipeline.tsx`), antes del boton "Start Run", mostrar badge con estimacion de costo. Si excede limite, warning rojo.

**Archivos a tocar**:
- `src/providers/cost-predictor.ts` — nuevo
- `src/cli/commands/run.ts` — dry-run
- `src/cli/repl/repl.ts` — mostrar estimacion antes de ejecutar
- `src/ui/server/routes.ts` — `POST /api/pipelines/:id/estimate`
- `src/ui/web/src/views/RunPipeline.tsx` — badge

---

#### 2.3 Cost Analytics
**Punto**: 9b — Que stage cuesta mas, donde hay ineficiencias
**Estado**: Los runs ya guardan cost por stage en run_events.
**Que hacer**:
- `src/providers/cost-analytics.ts`: queries sobre runs.db para agregar costos por stage, modelo, pipeline, periodo
- Top stages por costo, tendencia temporal, costo por token ratio

**CLI**: `/analytics cost` — tabla de costos agregados
**UI**: Nueva vista **Analytics** accesible desde sidebar (icono grafico de barras). Tabs: "Cost", "Performance", "Usage". La tab Cost muestra: bar chart de costo por stage, pie chart de costo por modelo, linea temporal.

**Archivos a tocar**:
- `src/providers/cost-analytics.ts` — nuevo
- `src/ui/server/routes.ts` — `/api/analytics/cost`
- `src/cli/repl/slash-commands.ts` — `/analytics`
- `src/ui/web/src/views/Analytics.tsx` — nuevo
- `src/ui/web/src/components/Layout.tsx` — nueva entrada en sidebar

---

#### 2.4 Provider Metrics (Dashboard)
**Punto**: 1d — Metricas por proveedor (costo acumulado, tiempo promedio, tasa de exito)
**Estado**: Los datos estan en run_events. No hay agregacion.
**Que hacer**:
- Query runs.db agrupando por provider: total cost, avg duration, success rate, total tokens
- Exponer via API

**CLI**: `/providers stats`
**UI**: En la vista **Providers** (`Providers.tsx`), agregar seccion "Usage Stats" debajo de cada provider card: total spent, avg latency, success rate (mini sparkline si hay datos historicos).

**Archivos a tocar**:
- `src/ui/server/routes.ts` — `/api/providers/stats`
- `src/ui/web/src/views/Providers.tsx` — stats section

---

#### 2.5 Structured Logging Mejorado + JSON Logs
**Punto**: 8b — Structured logging con contexto
**Estado**: Ya existe logger.ts con JSON en produccion. Falta: context automatico (runId, stageName, pipelineName), log level configurable por modulo, file output.
**Que hacer**:
- Extender logger con `createChildLogger(context)` que hereda y agrega campos
- Agregar `log_file` config en settings para output a archivo
- Log rotacion simple (por tamano)
- Cada componente usa child logger con su contexto

**Que se rompe**: Nada — extensiones al logger existente.

**CLI**: Flag `--log-level debug`, `--log-file /path`
**UI**: En **Settings** (`Settings.tsx`), campo para log level y log file path.

**Archivos a tocar**:
- `src/shared/logger.ts` — child loggers, file output
- `src/cli/index.ts` — flags
- `src/ui/server/routes.ts` — settings endpoint

---

#### 2.6 Telemetria OpenTelemetry
**Punto**: 8a — Exportar traces a OpenTelemetry
**Estado**: No existe
**Que hacer**:
- Dependencia: `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`
- `src/core/telemetry/tracer.ts`: wrappear pipeline execution, stage execution, tool calls en spans
- Config en settings: `telemetry.enabled`, `telemetry.endpoint`
- Span attributes: pipeline name, stage name, model, tokens, cost, duration

**Que se rompe**: Nada — opt-in.

**CLI**: Flag `--otel-endpoint http://localhost:4318`
**UI**: En **Settings**, seccion "Telemetry" con toggle y endpoint field.

**Archivos a tocar**:
- `src/core/telemetry/` — nuevo directorio
- `src/core/telemetry/tracer.ts` — nuevo
- `src/pipeline/executor/stage-executor.ts` — wrap con spans
- `package.json` — nuevas deps (opcionales)

---

#### 2.7 Prometheus Metrics
**Punto**: 8c — Metricas Prometheus
**Estado**: No existe
**Que hacer**:
- `src/core/telemetry/metrics.ts`: contadores y histogramas
  - `openthk_stage_duration_seconds` (histogram, labels: pipeline, stage, model, status)
  - `openthk_tokens_total` (counter, labels: pipeline, stage, model, direction)
  - `openthk_cost_dollars_total` (counter, labels: pipeline, model)
  - `openthk_pipeline_runs_total` (counter, labels: pipeline, status)
- Endpoint `/metrics` en el UI server (formato Prometheus text)

**CLI**: N/A (server-side)
**UI**: El endpoint `/metrics` es consumido por Prometheus externamente. En **Settings**, mostrar la URL del metrics endpoint.

**Archivos a tocar**:
- `src/core/telemetry/metrics.ts` — nuevo
- `src/ui/server/routes.ts` — `/metrics` endpoint
- `src/pipeline/executor/stage-executor.ts` — emit metrics

---

#### 2.8 Alertas
**Punto**: 8d — Si pipeline tarda mas de X, si costo excede presupuesto
**Estado**: cost_limit ya existe. No hay alertas de tiempo.
**Que hacer**:
- `policies.global.time_limit: "10m"` — max duracion de pipeline
- `policies.global.stage_time_limit: "5m"` — max duracion por stage
- En executor, check periodico. Si se excede, emitir `pipeline:alert` o `stage:alert` event.
- Alertas escritas a log + event bus (el UI las muestra como toast/banner)

**CLI**: Warnings en terminal (amarillo)
**UI**: Toast notifications en la UI cuando llegan alertas via SSE.

**Archivos a tocar**:
- `src/shared/types.ts` — nuevos campos en policies, nuevos eventos
- `src/pipeline/executor/stage-executor.ts` — time checks
- `src/ui/web/src/components/ToastProvider.tsx` — alert toasts

---

### FASE 3 — Seguridad y Control

#### 3.1 Audit Logging Completo
**Punto**: 11a, 11d
**Estado**: Los run events ya se guardan en SQLite. Falta: who (user), exportacion, formato estandar.
**Que hacer**:
- Agregar campo `user` a runs table (por ahora hostname/username del SO)
- `src/core/audit/audit-log.ts`: API unificada para audit events
- Export a JSON Lines format (estandar para audit logs)
- Comando de export

**CLI**: `openthk audit export --from 2026-01-01 --to 2026-05-18 --format jsonl`
**UI**: En **Settings**, nueva seccion "Audit" con boton "Export audit logs" y filtros de fecha.

**Archivos a tocar**:
- `src/core/audit/` — nuevo directorio
- `src/core/audit/audit-log.ts` — nuevo
- `src/cli/commands/audit.ts` — nuevo
- `src/ui/server/routes.ts` — `/api/audit/export`
- `src/ui/web/src/views/Settings.tsx` — audit section

---

#### 3.2 Encryption de API Keys
**Punto**: 11b — Encriptacion de API keys en descanso
**Estado**: Las keys se guardan en texto plano en `~/.openthk/providers.json`.
**Que hacer**:
- En macOS: usar `security` CLI (Keychain). En Linux: `secret-tool` (libsecret). En Windows: `dpapi` via Node.
- Fallback: AES-256 con key derivada de machine-specific entropy (hostname + user).
- `src/config/keyring.ts`: interfaz unificada `store(id, key)`, `retrieve(id)`, `delete(id)`
- Migrar keys existentes al keyring en primera ejecucion con el nuevo codigo

**Que se rompe**: Migration path necesario. Si el keyring falla, fallback a archivo cifrado con warning.

**CLI**: Transparente — las keys se almacenan seguro automaticamente
**UI**: En **Providers**, badge "Encrypted" junto a cada key configurada. En **Settings**, info sobre donde estan las keys.

**Archivos a tocar**:
- `src/config/keyring.ts` — nuevo
- `src/config/global-config.ts` — usar keyring
- `src/config/setup-wizard.ts` — usar keyring

---

#### 3.3 Context Schema Validation
**Punto**: 5d — Schema TypeScript para contexto con validacion en runtime
**Estado**: No existe. El context store acepta cualquier string como value.
**Que hacer**:
- Campo opcional `context.schema` en pipeline YAML: mapa de namespace → JSON Schema
- Validar al escribir: `contextStore.set()` valida contra schema si definido
- Usar `ajv` (JSON Schema validator) lightweight

```yaml
context:
  schema:
    plan:
      type: object
      properties:
        architecture: { type: string }
        components: { type: array, items: { type: string } }
      required: [architecture]
```

**CLI**: `/context validate` — valida todas las entries contra schema
**UI**: En **Context Store**, icono de check/warning por entry si tiene schema definido.

**Archivos a tocar**:
- `src/shared/types.ts` — schema en ContextConfig
- `src/context/store/context-store.ts` — validation on write
- `src/context/store/schema-validator.ts` — nuevo
- `src/pipeline/parser/pipeline-parser.ts` — parsear schema del YAML

---

#### 3.4 Input Validation & Prompt Sanitization
**Punto**: 13a, 13b — Validacion de tipos, sanitizacion de prompts
**Estado**: No existe
**Que hacer**:
- `src/core/security/prompt-guard.ts`:
  - Detectar patrones de prompt injection (system prompt override, role switching)
  - Sanitizar output de tools antes de pasarlo al LLM (strip control chars)
  - Configurable: `policies.global.prompt_guard: "warn" | "block" | "off"`
- Emitir evento `security:prompt-injection-detected` si se detecta

**CLI**: Warning en terminal cuando se detecta injection
**UI**: Toast rojo cuando se detecta. En **RunDetail**, badge de seguridad por stage.

**Archivos a tocar**:
- `src/core/security/` — nuevo directorio
- `src/core/security/prompt-guard.ts` — nuevo
- `src/pipeline/executor/agent-loop.ts` — sanitize tool outputs, check user content
- `src/shared/types.ts` — nuevos eventos security:*

---

#### 3.5 Fine-grained Permissions & Roles
**Punto**: 12a, 12b — Permisos granulares, roles
**Estado**: Ya existe: allowed_tools por skill, read/write globs por stage, rate/cost limits. FALTA: roles, permisos por usuario.
**Que hacer**:
- `~/.openthk/roles.json`: define roles (admin, developer, auditor) con permisos
- `~/.openthk/users.json`: asigna roles a usuarios (por username del SO)
- `src/policies/roles.ts`: check role before pipeline execution
- Roles controlan: que pipelines puede ejecutar, que providers puede usar, que tools estan disponibles

**CLI**: `openthk roles list`, `openthk roles assign <user> <role>`
**UI**: Nueva seccion en **Settings** > "Roles & Permissions" con tabla de usuarios y selector de roles.

**Archivos a tocar**:
- `src/policies/roles.ts` — nuevo
- `src/config/global-config.ts` — roles/users config
- `src/pipeline/executor/stage-executor.ts` — role check
- `src/ui/server/routes.ts` — `/api/roles`
- `src/ui/web/src/views/Settings.tsx` — roles UI

---

#### 3.6 Rate Limiting por Usuario/Skill/Provider
**Punto**: 12d
**Estado**: Rate limiting existe pero solo global.
**Que hacer**:
- Extender policy engine para aceptar rate limits granulares:
  ```yaml
  policies:
    rate_limits:
      per_provider:
        openai: "100/hour"
        anthropic: "50/hour"
      per_skill:
        core/code-writer: "20/hour"
  ```
- En el policy engine, componer multiples rate limiters y checkear todos

**Archivos a tocar**:
- `src/shared/types.ts` — extender PoliciesConfig
- `src/policies/engine/policy-engine.ts` — multiple rate limiters
- `src/pipeline/parser/pipeline-parser.ts` — parsear nuevos campos

---

#### 3.7 Skill Signing
**Punto**: 12c — Firma digital de skills
**Estado**: No existe
**Que hacer**:
- Hash SHA-256 de `prompt.md + skill.yaml` guardado en `.openthk/skill-signatures.json`
- Al cargar un skill, verificar hash. Si cambiado, warning o block segun config.
- `policies.global.skill_verification: "warn" | "block" | "off"`

**CLI**: `openthk skills sign <path>`, `openthk skills verify <path>`
**UI**: En **Skills**, badge "Verified" o "Modified" por skill. Boton "Sign" en el editor.

**Archivos a tocar**:
- `src/skills/signing.ts` — nuevo
- `src/skills/catalog.ts` — verificacion al cargar

---

#### 3.8 Content Filtering
**Punto**: 13c, 13d — Bloquear outputs inapropiados, cuarentena
**Estado**: No existe
**Que hacer**:
- `src/core/security/content-filter.ts`: configurable filters
  - Regex patterns para contenido prohibido
  - Si output contiene patrones prohibidos: quarantine (guardar en contexto con flag)
  - Config en pipeline YAML: `policies.global.content_filter: { patterns: [...], action: "warn" | "block" }`

**Archivos a tocar**:
- `src/core/security/content-filter.ts` — nuevo
- `src/pipeline/executor/agent-loop.ts` — filter outputs

---

### FASE 4 — UX y Debugging

#### 4.1 Dashboard Visual Mejorado
**Punto**: 1a, 1b, 1c — Tablero de ejecucion, DAG interactivo, historico
**Estado**: Ya existe Dashboard.tsx, Dag.tsx, History.tsx, Runs.tsx, RunDetail.tsx. El DAG ya es interactivo.
**Que hacer**:
- **1a** Tablero de ejecucion en tiempo real: El RunDetail ya muestra eventos en tiempo real via SSE. MEJORAR: agregar panel lateral con recursos (tokens/s, memory, active tools), progress bar por stage.
- **1b** DAG interactivo con estado: Ya existe en Dag.tsx. MEJORAR: colorear nodos por status (running=blue, success=green, failed=red, pending=gray, paused=yellow), animar edges, click para ver stage detail.
- **1c** Historico: Ya existe en History/Runs views. MEJORAR: graficos de tendencia (runs por dia, success rate, avg cost).

**CLI**: Ya existe. Mejorar: spinner con stage progress durante ejecucion.
**UI**: Mejoras en vistas existentes, no nuevas vistas.

**Archivos a tocar**:
- `src/ui/web/src/views/RunDetail.tsx` — resource panel, progress bars
- `src/ui/web/src/components/Dag.tsx` — status colors, animations
- `src/ui/web/src/views/History.tsx` — trend charts

---

#### 4.2 Debugging: Breakpoints & Step-Through
**Punto**: 2a, 2b — Breakpoints en stages, step-through
**Estado**: No existe
**Que hacer**:
- `ExecutorDeps.debugMode: { breakpoints: string[], stepThrough: boolean }`
- En `executePipeline()`, antes de cada stage, check breakpoints. Si match, pausar (reutilizar ConfirmationGate).
- En step-through: pausar despues de cada stage, mostrar resultado, esperar continue.

**CLI**: `openthk run -p file.yaml --debug` o `/debug on-stage my-stage`. En debug mode, despues de cada stage se muestra output y se espera input.
**UI**: En **RunPipeline**, toggle "Debug mode" con lista de stages para breakpoint (checkboxes). En **RunDetail**, cuando esta en breakpoint, botones Step/Continue/Abort + inspector de context.

**Archivos a tocar**:
- `src/shared/types.ts` — debug config
- `src/pipeline/executor/stage-executor.ts` — breakpoint checks
- `src/cli/commands/run.ts` — --debug flag
- `src/ui/web/src/views/RunPipeline.tsx` — debug toggle
- `src/ui/web/src/views/RunDetail.tsx` — breakpoint controls

---

#### 4.3 Debugging: Context Inspector
**Punto**: 2c — Inspect context en cualquier momento
**Estado**: Ya existe `/context inspect` en CLI y Context Store view en UI. MEJORAR: durante ejecucion en vivo.
**Que hacer**:
- En RunDetail, boton "Inspect Context" que lee el context store actual del proyecto en vivo
- Filtro por stage/namespace

**UI**: En **RunDetail**, nueva tab "Live Context" que hace polling a `/api/context` durante el run.

**Archivos a tocar**:
- `src/ui/web/src/views/RunDetail.tsx` — live context tab

---

#### 4.4 Replay de Ejecuciones
**Punto**: 2d — Replay de ejecuciones anteriores con contexto guardado
**Estado**: Los eventos se guardan en run_events. Falta: replay UI, deterministic replay (11c).
**Que hacer**:
- Replay UI: reproducir la secuencia de eventos del run anterior como animacion (stage por stage, mostrando tool calls, context changes)
- Los context snapshots de FASE 1 permiten restaurar el estado para re-ejecutar
- `openthk replay <runId>` — reproduce la visualizacion

**CLI**: `openthk replay <runId>` — reproduce eventos en terminal con timing
**UI**: En **RunDetail** de un run completado, boton "Replay" que anima el timeline. Slider de velocidad (1x, 2x, 5x).

**Archivos a tocar**:
- `src/cli/commands/replay.ts` — nuevo
- `src/ui/web/src/views/RunDetail.tsx` — replay mode

---

#### 4.5 Streaming UI en REPL
**Punto**: 23a, 23b, 23c — Token streaming, progreso visual, live tree
**Estado**: Parcial — el REPL ya muestra progress via event bus (thinking messages, token meter). Falta: streaming de tokens character by character, live tool call tree.
**Que hacer**:
- **23a** Token streaming: El provider.stream() ya existe. Conectarlo al REPL output para mostrar tokens en vivo (como Claude Code).
- **23b** Tool calls progress: Mostrar tool name + args cuando se invoca, resultado cuando completa (ya parcial con event bus).
- **23c** Live reasoning tree: Arbol expandible de: stage > iteration > action (tool call/response/thinking).

**CLI**: Streaming de tokens en terminal con colores (ya parcial, mejorar). Tree view con indentacion.
**UI**: En **RunDetail**, panel "Agent Reasoning" con arbol expandible de iteraciones y tool calls.

**Archivos a tocar**:
- `src/cli/repl/repl.ts` — enhanced streaming display
- `src/ui/web/src/views/RunDetail.tsx` — reasoning tree component

---

### FASE 5 — Provider Intelligence

#### 5.1 Provider Health Checks
**Punto**: 10c — Detectar si estan down
**Estado**: Ya existe `LLMProvider.healthCheck()`. No hay monitoring continuo.
**Que hacer**:
- `src/providers/health-monitor.ts`: check periodico (configurable, default 5min) de providers configurados
- Estado en memoria: `healthy`, `degraded` (slow), `down`
- Emitir eventos `provider:health-change`

**CLI**: `/providers health` — tabla con status
**UI**: En **Providers**, indicador de status (punto verde/amarillo/rojo) junto a cada provider.

**Archivos a tocar**:
- `src/providers/health-monitor.ts` — nuevo
- `src/ui/server/routes.ts` — `/api/providers/health`
- `src/ui/web/src/views/Providers.tsx` — health indicators

---

#### 5.2 Provider Fallback Avanzado
**Punto**: 10a — Multiples providers como backup
**Estado**: Ya existe `fallback_models` en StageDefinition para rate limit fallback. EXTENDER: fallback por cualquier error, multi-provider.
**Que hacer**:
- Nuevo campo `fallback` en stage def:
  ```yaml
  stages:
    coder:
      provider: openai
      model: gpt-4o
      fallback:
        - provider: anthropic
          model: claude-sonnet-4-20250514
        - provider: groq
          model: llama-3.3-70b-versatile
  ```
- En `executeStageWithRetry()`, si falla por cualquier razon y hay fallback, intentar siguiente.
- Combinar con health checks: si provider esta `down`, skip directamente al siguiente.

**Archivos a tocar**:
- `src/shared/types.ts` — fallback config
- `src/pipeline/executor/stage-executor.ts` — fallback logic
- `src/pipeline/parser/pipeline-parser.ts` — parse fallback

---

#### 5.3 Load Balancing & Routing
**Punto**: 10b, 10d — Round-robin, cost-based, latency-based
**Estado**: No existe
**Que hacer**:
- `src/providers/router.ts`: strategies: round-robin, cost-based (cheapest first), latency-based (fastest first)
- Config en pipeline YAML:
  ```yaml
  stages:
    coder:
      routing:
        strategy: cost-based  # round-robin | cost-based | latency-based
        providers:
          - { provider: openai, model: gpt-4o }
          - { provider: anthropic, model: claude-sonnet-4-20250514 }
  ```
- Latency tracking: medido en cada request, exponential moving average

**CLI**: `/routing stats` — tabla de latencies y costos por provider
**UI**: En stage editor del **Pipeline Editor**, seccion "Routing" con strategy selector y provider list.

**Archivos a tocar**:
- `src/providers/router.ts` — nuevo
- `src/shared/types.ts` — routing config
- `src/pipeline/executor/stage-executor.ts` — use router

---

#### 5.4 Auto-scaling de Modelos
**Punto**: 9c — Si tarea simple, usar modelo mas barato
**Estado**: No existe
**Que hacer**:
- `src/providers/auto-scaler.ts`: analizar complejidad del task (basado en input size, context size, skill type)
- Reglas configurables: si input < 1000 tokens y skill es simple, downgrade a modelo menor
- Config: `policies.global.auto_scale: true`

**CLI**: Info line: "Auto-scaled: gpt-4o -> gpt-4o-mini (simple task)"
**UI**: En **RunDetail**, badge "Auto-scaled" en stages donde se aplico.

**Archivos a tocar**:
- `src/providers/auto-scaler.ts` — nuevo
- `src/pipeline/executor/stage-executor.ts` — invoke auto-scaler

---

#### 5.5 Budget Enforcement
**Punto**: 9d — Rechazar ejecucion si excede limite
**Estado**: Ya existe `cost_limit` en policies (rechaza durante ejecucion). FALTA: pre-execution check.
**Que hacer**:
- Antes de ejecutar, usar cost predictor (2.2). Si estimacion alta excede cost_limit, bloquear con error descriptivo.
- Flag `--force` para override

**CLI**: Error message con estimacion vs limite
**UI**: En **RunPipeline**, boton "Start" deshabilitado con tooltip explicando que el costo estimado excede el limite.

**Archivos a tocar**:
- `src/pipeline/executor/stage-executor.ts` — pre-check
- `src/cli/commands/run.ts` — --force flag

---

### FASE 6 — Skills & Composition

#### 6.1 Skill Composition & Inheritance
**Punto**: 6a — Skills que extiendan otras
**Estado**: No existe. Los skills son independientes.
**Que hacer**:
- En `skill.yaml`: `extends: core/base-agent@1.0`
- El skill hijo hereda: prompt (prepend/append), allowed_tools (merge), constraints (override)
- `src/skills/inheritance.ts`: resolver cadena de herencia, merge manifests

**CLI**: `/skills tree <name>` — muestra cadena de herencia
**UI**: En **Skills** editor, dropdown "Extends" para seleccionar skill base. Visual de herencia en skill list.

**Archivos a tocar**:
- `src/skills/inheritance.ts` — nuevo
- `src/skills/catalog.ts` — resolver herencia al cargar
- `src/shared/types.ts` — extends en SkillManifest

---

#### 6.2 Stage Hooks
**Punto**: 6b — pre_stage, post_stage, on_error
**Estado**: No existe
**Que hacer**:
- En pipeline YAML:
  ```yaml
  stages:
    coder:
      hooks:
        pre_stage: "echo 'Starting coder stage'"
        post_stage: "npm test"
        on_error: "notify-team --channel errors"
  ```
- Hooks son shell commands ejecutados en el workingDir
- Hook failures: pre_stage failure aborts stage, post_stage failure logs warning, on_error failure logs error

**CLI**: Hook output visible en stage progress
**UI**: En **RunDetail**, hook execution visible como sub-events del stage.

**Archivos a tocar**:
- `src/shared/types.ts` — hooks en StageDefinition
- `src/pipeline/executor/stage-executor.ts` — execute hooks
- `src/pipeline/executor/hooks.ts` — nuevo

---

#### 6.3 Skill Dependencies
**Punto**: 6c — Skill dependencies resolver
**Estado**: No existe
**Que hacer**:
- En `skill.yaml`: `dependencies: ["core/base-agent@1.0", "utils/formatter@1.0"]`
- Al cargar un skill, resolver y cargar dependencias primero
- Dependencias aportan tools adicionales o context entries

**Archivos a tocar**:
- `src/skills/dependency-resolver.ts` — nuevo
- `src/skills/catalog.ts` — resolver deps

---

### FASE 7 — Testing & DX

#### 7.1 Provider Mocking
**Punto**: 18b — Respuestas fake deterministas
**Estado**: No existe
**Que hacer**:
- `src/providers/adapters/mock-adapter.ts`: provider que devuelve respuestas predefinidas
- Config: `providers: [{ id: mock, responses: { "stage-name": "fake response" } }]`
- Modo: `openthk run -p file.yaml --mock` para usar mock provider en todos los stages

**CLI**: `--mock` flag en run
**UI**: En **RunPipeline**, toggle "Mock mode".

**Archivos a tocar**:
- `src/providers/adapters/mock-adapter.ts` — nuevo
- `src/providers/adapters/provider-factory.ts` — soporte mock
- `src/cli/commands/run.ts` — --mock flag

---

#### 7.2 Skill/Pipeline Testing
**Punto**: 18a, 18d — Unit tests, regression testing
**Estado**: No existe
**Que hacer**:
- `openthk test -p file.yaml --snapshot` — ejecuta pipeline, guarda output como snapshot
- `openthk test -p file.yaml --compare` — ejecuta y compara con snapshot anterior
- Test assertions en YAML:
  ```yaml
  test:
    assertions:
      - stage: planner
        output_contains: "architecture"
      - stage: coder
        context_key: "code.files"
        not_empty: true
  ```

**CLI**: `openthk test` subcommand
**UI**: En **Pipelines**, boton "Test" junto a "Run". Vista **Test Results** muestra comparacion con snapshot.

**Archivos a tocar**:
- `src/cli/commands/test.ts` — nuevo
- `src/pipeline/testing/` — nuevo directorio
- `src/pipeline/testing/snapshot.ts` — nuevo
- `src/pipeline/testing/assertions.ts` — nuevo

---

#### 7.3 Documentation Generator
**Punto**: 19 — Documentacion automatica de skills
**Estado**: No existe
**Que hacer**:
- `openthk docs generate --skills --output docs/` — genera markdown de cada skill
- Template: nombre, version, descripcion, tools disponibles, context read/write, constraints, ejemplos
- Troubleshooting auto-generado basado en errores frecuentes del historial de runs

**CLI**: `openthk docs generate`
**UI**: En **Skills**, boton "Generate Docs" que descarga ZIP de markdown. Preview inline en la vista.

**Archivos a tocar**:
- `src/cli/commands/docs.ts` — nuevo
- `src/skills/doc-generator.ts` — nuevo

---

### FASE 8 — Analytics & Intelligence

#### 8.1 Analytics Dashboard
**Punto**: 20 — Combinacion mas rentable, failures, patrones, sugerencias
**Estado**: No existe como vista dedicada. Los datos estan en runs.db.
**Que hacer**:
- Queries de analytics sobre runs.db:
  - Top model combos por cost-effectiveness (success rate / cost)
  - Stage failure rate ranking
  - Skill usage frequency
  - Optimization suggestions engine (simple rules)
- API endpoints: `/api/analytics/models`, `/api/analytics/failures`, `/api/analytics/suggestions`

**CLI**: `/analytics` con sub-tabs
**UI**: Vista **Analytics** (creada en 2.3) con tabs adicionales: "Models", "Failures", "Suggestions".

**Archivos a tocar**:
- `src/providers/cost-analytics.ts` — extender
- `src/ui/server/routes.ts` — analytics endpoints
- `src/ui/web/src/views/Analytics.tsx` — tabs

---

### FASE 9 — Modos Experimentales

#### 9.1 Multi-LLM Reasoning: Debate
**Punto**: 21a — Etapa genera multiples respuestas, otra las evalua
**Estado**: No existe
**Que hacer**:
- Nuevo modo de stage: `mode: debate`
  ```yaml
  stages:
    debate:
      mode: debate
      participants:
        - { provider: anthropic, model: claude-sonnet-4-20250514 }
        - { provider: openai, model: gpt-4o }
      rounds: 3
      judge:
        provider: anthropic
        model: claude-opus-4-5-20250520
  ```
- Cada participante genera respuesta. El juez evalua y selecciona o sintetiza.
- Implementacion: orquestar multiples agent loops secuenciales

**CLI**: Output muestra cada ronda del debate con colores distintos
**UI**: En **RunDetail**, vista especial para debate stages: columnas lado a lado con cada respuesta + evaluacion del juez.

**Archivos a tocar**:
- `src/pipeline/executor/debate-executor.ts` — nuevo
- `src/pipeline/executor/stage-executor.ts` — route debate mode
- `src/shared/types.ts` — debate config

---

#### 9.2 Self-Reflection
**Punto**: 21c — LLM valida su propio output
**Estado**: No existe
**Que hacer**:
- Nuevo campo `self_reflect: true` en stage def
- Despues de obtener output, enviar otro prompt: "Review your output for errors, inconsistencies, and completeness. If issues found, provide a corrected version."
- Si la reflexion produce cambios, usar la version corregida

**Archivos a tocar**:
- `src/shared/types.ts` — self_reflect field
- `src/pipeline/executor/agent-loop.ts` — reflection loop

---

#### 9.3 Agentic Lookahead
**Punto**: 22 — LLM planifica herramientas, valida acceso, simula
**Estado**: No existe
**Que hacer**:
- Antes de ejecutar un stage, enviar prompt de planificacion: "What tools will you need? What context keys will you read/write?"
- Validar que las herramientas y context keys planificadas estan permitidas
- Si no, ajustar o advertir

**Archivos a tocar**:
- `src/pipeline/executor/lookahead.ts` — nuevo
- `src/pipeline/executor/stage-executor.ts` — invoke lookahead

---

### FASE 10 — Infraestructura

#### 10.1 Docker Support
**Punto**: 24 — Dockerfile, docker-compose, volumes
**Estado**: No existe
**Que hacer**:
- `Dockerfile`:
  ```dockerfile
  FROM oven/bun:1 AS builder
  COPY . .
  RUN bun install && bun run build:all

  FROM oven/bun:1-slim
  COPY --from=builder /app/dist /app/dist
  WORKDIR /app
  VOLUME ["/root/.openthk", "/workspace"]
  EXPOSE 17880
  CMD ["bun", "run", "dist/cli/index.cjs"]
  ```
- `docker-compose.yml`: single service con volumes para config y workspace
- Documentacion en README

**CLI**: N/A (Docker es alternativa al CLI nativo)
**UI**: N/A (el UI server dentro del container se expone en el puerto mapeado)

**Archivos a crear**:
- `Dockerfile` — nuevo
- `docker-compose.yml` — nuevo
- `.dockerignore` — nuevo

---

#### 10.2 Distributed Execution
**Punto**: 4 — Worker mode, remote stages
**Estado**: No existe. Es la feature mas compleja.
**Que hacer**:
- **Fase A**: Worker que se conecta al leader via WebSocket
  - `openthk worker --connect ws://leader:8080`
  - Leader distribuye stages a workers disponibles
  - Context store compartido via API calls al leader
- **Fase B**: Leader election simple (primero en conectar = leader, si cae, otro toma over)
- **Fase C**: Context sync via event sourcing (todos los writes se propagan)

**CLI**: `openthk worker --connect <url>`, `openthk serve --workers`
**UI**: Nueva vista **Workers** accesible desde sidebar: lista de workers conectados, status, assigned stages. En **RunDetail**, badge indicando en que worker se ejecuto cada stage.

**Archivos a crear**:
- `src/distributed/` — nuevo directorio
- `src/distributed/worker.ts` — worker process
- `src/distributed/leader.ts` — leader/coordinator
- `src/distributed/protocol.ts` — message types
- `src/cli/commands/worker.ts` — nuevo
- `src/ui/web/src/views/Workers.tsx` — nuevo

---

## Resumen de Nuevas Vistas UI

| Vista | Tab/Sidebar | Descripcion |
|-------|-------------|-------------|
| **Analytics** | Sidebar (nuevo) | Cost, Performance, Usage, Models, Failures, Suggestions |
| **Workers** | Sidebar (nuevo) | Lista de workers, status (Fase 10.2) |
| Improvements to existing: | | |
| **RunDetail** | Tab: Context Changes | Diff de context entre stages |
| **RunDetail** | Tab: Live Context | Context inspector en vivo |
| **RunDetail** | Tab: Agent Reasoning | Arbol de iteraciones/tool calls |
| **RunDetail** | Modal: Confirm | Human-in-the-loop approve/reject |
| **RunDetail** | Modal: Error Pause | Retry/Skip/Abort/Inspect |
| **RunPipeline** | Toggle: Debug | Breakpoints, step-through |
| **RunPipeline** | Toggle: Mock | Mock provider mode |
| **RunPipeline** | Selector: Permission Mode | auto/sandbox/confirm/strict |
| **RunDetail** | Tab: Sandbox Changes | Diff viewer con file tree, apply/discard |
| **RunPipeline** | Badge: Cost Estimate | Prediccion de costo |
| **Context Store** | Section: Snapshots | Save/restore/delete snapshots |
| **Context Store** | Badge: Compression | Tamano real vs comprimido |
| **Providers** | Section: Usage Stats | Cost, latency, success rate |
| **Providers** | Badge: Health | Verde/amarillo/rojo |
| **Settings** | Section: Telemetry | OTel toggle + endpoint |
| **Settings** | Section: Audit | Export audit logs |
| **Settings** | Section: Roles | User roles management |
| **Settings** | Field: Log Level | Debug/info/warn/error |
| **Skills** | Badge: Verified | Firma digital |
| **Skills** | Dropdown: Extends | Herencia de skills |
| **Pipeline Editor** | Section: Routing | Multi-provider routing |

---

## Resumen de Nuevos CLI Commands

| Comando | Descripcion |
|---------|-------------|
| `openthk run -p ... --debug` | Modo debug con breakpoints |
| `openthk run -p ... --mock` | Mock provider mode |
| `openthk run -p ... --permissions sandbox` | Sandbox mode (auto dentro, review al final) |
| `openthk run -p ... --dry-run` | Solo mostrar estimacion de costo |
| `openthk replay <runId>` | Replay de run anterior |
| `openthk test -p ...` | Test de pipeline con assertions |
| `openthk audit export` | Export de audit logs |
| `openthk docs generate` | Generar documentacion de skills |
| `openthk worker --connect <url>` | Iniciar worker |
| `openthk serve --workers` | Iniciar leader |
| `openthk roles list/assign` | Gestion de roles |
| `openthk skills sign/verify` | Firma de skills |
| `/context save/restore/snapshots` | Gestion de snapshots |
| `/context stats` | Stats de compresion |
| `/context diff` | Diff entre stages |
| `/analytics` | Analytics de cost/usage |
| `/providers health` | Health status de providers |
| `/providers stats` | Usage stats de providers |
| `/debug on-stage <name>` | Breakpoint en stage |

---

## Nuevas Dependencias

| Package | Fase | Proposito | Obligatoria |
|---------|------|-----------|-------------|
| `@opentelemetry/api` | 2.6 | Tracing API | Opcional (peer dep) |
| `@opentelemetry/sdk-trace-node` | 2.6 | Trace SDK | Opcional |
| `@opentelemetry/exporter-trace-otlp-http` | 2.6 | OTLP exporter | Opcional |
| `ajv` | 3.3 | JSON Schema validation | Si |
| `ws` | 10.2 | WebSocket (distributed) | Opcional |

---

## Orden Final de Ejecucion (checklist)

- [ ] **1.1** Context Compression (!importante)
- [ ] **1.2** Permission System + Human-in-the-Loop (!importante)
- [ ] **1.5** Sandbox Execution Environment (!importante)
- [ ] **1.3** Error Recovery: Backoff + Rollback + Pause-on-error
- [ ] **1.4** Context Versioning: Snapshots
- [ ] **2.1** Context Diffing
- [ ] **2.2** Cost Predictor
- [ ] **2.3** Cost Analytics
- [ ] **2.4** Provider Metrics Dashboard
- [ ] **2.5** Structured Logging Mejorado
- [ ] **2.6** Telemetria OpenTelemetry
- [ ] **2.7** Prometheus Metrics
- [ ] **2.8** Alertas
- [ ] **3.1** Audit Logging Completo
- [ ] **3.2** Encryption de API Keys
- [ ] **3.3** Context Schema Validation
- [ ] **3.4** Input Validation & Prompt Sanitization
- [ ] **3.5** Fine-grained Permissions & Roles
- [ ] **3.6** Rate Limiting Granular
- [ ] **3.7** Skill Signing
- [ ] **3.8** Content Filtering
- [ ] **4.1** Dashboard Visual Mejorado
- [ ] **4.2** Debugging: Breakpoints & Step-Through
- [ ] **4.3** Debugging: Context Inspector en vivo
- [ ] **4.4** Replay de Ejecuciones
- [ ] **4.5** Streaming UI en REPL
- [ ] **5.1** Provider Health Checks
- [ ] **5.2** Provider Fallback Avanzado
- [ ] **5.3** Load Balancing & Routing
- [ ] **5.4** Auto-scaling de Modelos
- [ ] **5.5** Budget Enforcement
- [ ] **6.1** Skill Composition & Inheritance
- [ ] **6.2** Stage Hooks
- [ ] **6.3** Skill Dependencies
- [ ] **7.1** Provider Mocking
- [ ] **7.2** Skill/Pipeline Testing
- [ ] **7.3** Documentation Generator
- [ ] **8.1** Analytics Dashboard Completo
- [ ] **9.1** Multi-LLM Reasoning: Debate
- [ ] **9.2** Self-Reflection
- [ ] **9.3** Agentic Lookahead
- [ ] **10.1** Docker Support
- [ ] **10.2** Distributed Execution
