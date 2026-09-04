# Anexo técnico

El `README.md` y `TIPOS-DE-PRUEBA.md` están escritos sin nombres propios a
propósito, para que se entiendan sin conocer la CLI. **Acá están los nombres.**

Todo lo de este archivo está medido. Donde algo es inferido o abierto, se dice.

## Los comandos

Todo sale de `@salesforce/cli`. No hace falta instalar nada aparte.

Versiones contra las que está medido esto: plugin `agent` **1.42.0** (rondas 1-2)
y **1.44.5 → 1.45.0** (ronda 3). El salto ocurrió **a mitad de la ronda 3, solo,
sin aviso**, y se descubrió por casualidad. De ahí la regla de registrar la
versión de la CLI en cada corrida: `npm run doctor` la lee del plugin instalado.

```
sf agent validate authoring-bundle    compila el .agent
sf agent preview start|send|end       conversación programática, con --json
sf agent trace list|read              traces de una sesión de preview
sf agent test run-eval                MOTOR 1 — evaluación sin desplegar
sf agent test create                  despliega un AiEvaluationDefinition
sf agent test run                     MOTOR 2 — ejecuta esa definición
sf agent test results --job-id        recupera una corrida histórica
sf agent generate test-spec           conversor XML → YAML (sólo --from-definition)
```

⚠️ `sf agent list` **no existe**. Las versiones se consultan con SOQL sobre
`BotVersion`.

## Los dos motores

Cuando el texto de arriba dice "las dos herramientas" o "los dos motores", son
estos:

| | **`sf agent test run-eval`** | **`sf agent test run`** |
|---|---|---|
| **Prerequisito en la org** | ninguno | 🚩 **Testing Center habilitado** |
| **Madurez** | **BETA** — *"Don't use beta commands in your scripts"* | GA |
| **Entrada** | YAML local, directo | metadata desplegada (`AiEvaluationDefinition`) |
| **Escribe en la org** | **nada** | sí, vía `test create` |
| **Endpoint** | `POST api.salesforce.com/einstein/evaluation/v1/tests` | Testing Center de la org |
| **Sincronía** | síncrono | job asíncrono con `--wait` |
| **Paralelismo** | `--batch-size` 1-5, batches en `Promise.all` | no expuesto |
| **Evaluador de topic** | `evaluator.planner_topic_assertion` — operador **`contains`** | `topic_sequence_match` — **igualdad exacta** |
| **Evaluador de acciones** | `evaluator.planner_actions_assertion` — **roto** | `action_sequence_match` — funciona, subconjunto |
| **`metrics:`** | **ignorado en silencio** | evaluado, con `metricExplainability` |
| **`expectedOutcome`** | → `bot_response_rating` (sin explicación) | → `output_validation` (con explicación) |
| **`conversationHistory`** | descarta `role: agent`, **ejecuta** los turnos | los **exige**, **inyecta** como contexto |
| **`subjectVersion`** | ignorado en silencio | NO DETERMINADO |
| **Exit code** | roto | roto |
| **`--output-dir`** | no tiene | sí |
| **Tiempo, 20 casos** | **~21 s** | 222 s limpio / 1306 s con un caso colgado |
| **Fiabilidad** | 0 errores / ~94 ejecuciones | 1,7 % (1/60) |

**`run-eval` es el motor por defecto del repo, y la razón principal no es la
velocidad: es la auditabilidad.**

| Eje | `run-eval` | `test run` |
|---|---|---|
| Portabilidad | no requiere nada | requiere Testing Center — en 1 de 3 orgs no estaba |
| Fiabilidad | 0 errores / ~130 ejecuciones | 1,7 % · 20 % en la ronda 3 |
| Velocidad | ~21 s / 20 casos | ~222 s |
| **Assertar contenido y estado** | **sí** | **no** — devuelve la referencia sin resolver |
| 🚨 **¿Dice qué versión midió?** | **sí** | **no. Por ningún camino** |

🚨 **`test run` no es un plan B: es una herramienta estrictamente más débil que
además es GA.** Su único aporte exclusivo son las métricas de calidad con
explicación.

**Y de ahí sale el riesgo estructural más serio del repo:** la capacidad más
valiosa —verificar contenido y estado— **existe en un solo comando, y ese comando
es BETA.** No hay segunda fuente. No está mitigado: sólo documentado.

La ironía conviene tenerla presente: **el único motor donde se puede cumplir la
regla más importante del repo es el que puede cambiar sin aviso.**

### Los 10 evaluadores de `run-eval`

| Tipo | Determinista |
|---|---|
| `evaluator.planner_topic_assertion` | ✅ (`contains`) |
| `evaluator.planner_actions_assertion` | ✅ (`includes_items`) — **roto**, ver D6 |
| `evaluator.string_assertion` | ✅ |
| `evaluator.numeric_assertion` | ✅ |
| `evaluator.json_assertion` | ✅ |
| `evaluator.text_alignment` | ⚠️ embeddings |
| `evaluator.bot_response_rating` | ❌ LLM, `threshold: 3.0` |
| `evaluator.hallucination_detection` | ❌ LLM |
| `evaluator.citation_recall` | ❌ LLM |
| `evaluator.answer_faithfulness` | ❌ LLM |

Sólo los cinco primeros sirven para gatear. Los otros devuelven `score` sin
`is_pass`.

## Dónde vive cada dato

El motor devuelve un `planner_response` por caso. Las rutas que importan:

```
lastExecution.topic                                  el destino (topic/subagente)
lastExecution.invokedActions                         acciones reales, objetos anidados
lastExecution.invokedActions[0][0].function.output   ← el valor determinista
sessionContext.tags.bot_version_id                   ← la versión que sirvió
sessionContext.stateVariables.<var>                  el estado al final del turno
sessionContext.executionHistory[N].actionName        incluye @utils.*
sessionContext.contextVariables                      las linked (llegan null SIEMPRE)
sessionContext.plugins                               mapa subagente → acciones
```

Las últimas cinco **no están documentadas**. Se alcanzan porque el traductor de
specs hace `return MAPA_CONOCIDO[path] ?? path` — un passthrough. Las referencias
desconocidas pasan tal cual al eval API.

**Ahí está la capacidad más valiosa del enfoque, y también su fragilidad**: si
mañana validan las rutas contra una whitelist, todos los asserts de contenido y
estado se rompen de golpe. Por eso se assertan también por wrapper.

🚨 **Y esto es exclusivo de `run-eval`. CONFIRMADO, ya no inferido.** En `test run`
las mismas referencias vuelven **sin resolver** — devuelve el texto del template
como si fuera el valor real, con veredicto `FAILURE`, estado `COMPLETED` y sin
mensaje de error. **No hay segunda fuente para esta capacidad.**

El passthrough se verificó intacto en las versiones `1.42.0`, `1.44.5` y `1.45.0`
del plugin. **Hay que re-verificarlo en cada sesión** — la CLI se actualiza sola
(D22).

## El vocabulario de topics

El runtime devuelve más que los subagentes del `.agent`:

| Valor | Origen |
|---|---|
| Nombres limpios (`GeneralFAQ`, `Faq`) | tus subagentes. **Nunca el compilado con sufijo de planner** |
| `Prompt_Injection` | guardrail de plataforma |
| `human` / `human__` / `__human__` | escalación concretada — **el literal varía por motor** |

Y un subagente cuyo único trabajo es `@utils.escalate` **nunca aparece como
topic**, aunque exista y funcione.

## Correspondencia: nombre técnico ↔ nombre en el texto

| En el texto de arriba | Técnicamente |
|---|---|
| "destino" / "sección" | topic / subagente |
| "el motor recomendado" | `sf agent test run-eval` |
| "el otro motor" | `sf agent test create` + `sf agent test run` |
| "verificación avanzada" | `customEvaluations` con referencia cruda |
| "el archivo del agente" | `.agent` dentro del `aiAuthoringBundle` |
| "conversación exploratoria" | `sf agent preview start/send/end` + `agent trace read` |
| "la funcionalidad adicional" | Testing Center (`AiEvaluationDefinition` desplegable) |
| "el guardián de la plataforma" | guardrail `Prompt_Injection` |
| "variables que conectan con datos reales" | variables `linked` (`@MessagingSession.Id`, etc.) |

## Los 23 defectos, por identificador

Detalle completo en `knowledge/02-known-issues.md`.

**Críticos — dan verde con la suite rota**

- **D1** — los dos endpoints resuelven distinto la versión. `run-eval` toma
  `ORDER BY VersionNumber DESC LIMIT 1` sin filtrar `Status`; producción sirve la
  `Active`. Medido en 4 estados.
  🚨 **Y `test run` no expone la versión por ningún camino** — ni en su JSON, ni
  en el `AiEvaluationDefinition`, ni en el export
- **D2** — exit code **invertido**: `if (summary.errors > 0)`. Verde con fallos de
  aserción, rojo con una evaluación mal tipada
- **D3** — una aserción puede no ejecutarse. **Cuatro** mecanismos observados; el
  cuarto no deja ningún rastro
- **D4** — ref cruda sin `expectedTopic` → no corre `agent.get_state` → se compara
  contra el template literal, con `compute_status: COMPLETED`

**Serios**

- **D5** — `expectedActions: []` no asserta (subconjunto). `test run` da verde
  falso **y suma al conteo**; `run-eval` no emite evaluación. **Inyectado por
  `test create` sin pedirlo**
- **D6** — `planner_actions_assertion` compara strings contra `invokedActions`
  anidado. Debería usar `actionsSequence`
- **D7** — `contains` vs igualdad exacta según el motor
- **D8** — el literal de escalación varía **por campo, no por motor**
- **D9** — `test run` requiere Testing Center
- **D10** — `conversationHistory` incompatible entre motores
- **D11** — `test run` cuelga 18-22 min. **Disparador identificado**: un nombre de
  context variable no declarado lo produce de forma reproducible
- **D12** — `test resume` devuelve exit 0 sin esperar
- **D13** — `generate test-spec` interactivo ofrece `Object.keys(genAiPlugins)`,
  o sea los nombres compilados
- **D18** — el authoring bundle **pierde el número de versión** al retraerse;
  `--api-name` usa el nombre de la carpeta local
- **D19** — el mismo archivo de casos funciona en un motor y **falla en el otro**
  (`description` demasiado largo)
- **D20** — `--preview` **acepta specs que el servidor rechaza**
- **D21** — el export de Testing Center **invierte el veredicto en los casos de
  seguridad**, no trae la versión, y sin `metrics:` no trae ninguna explicación
- **D22** — **la CLI se auto-actualiza a mitad de sesión** e invalida toda
  verificación de código previa
- **D23** — hay **dos copias de la CLI en disco** con versiones distintas, y la
  obsoleta está en la ruta obvia

**Menores**

- **D14** — `metrics:` ignorado en `run-eval`
- **D15** — `bot_response_rating` inyectado sin pedirlo en `test run`
- **D16** — `run-eval` sin `--output-dir` y sin rastro
- **D17** — `--json` y `--result-format json` producen estructuras distintas

## Formato de un caso

El repo define su propio formato y genera el de cada motor, porque los dos
formatos multi-turno son incompatibles y `run-eval` es beta.

```yaml
- id: S1
  utterance: ¿A qué hora abren?
  turns: []                       # turnos previos de usuario (multi-turno)
  context: {}                     # state variables. NUNCA un Id real
  expect:
    topic: Faq                    # limpio y completo
    match: exact                  # exact | contains | regex
    actions: [consultar_faq]      # el ALIAS del .agent, no el target
    utilActions: []               # @utils.* — vía executionHistory
    stateVariables: {}            # estado esperado al final del turno
  customEvaluations: []           # referencias crudas — exigen expect.topic
  gate: true
  flaky: false                    # inestable entre corridas
  xfail: { reason: "..." }        # roto por la plataforma; no mueve el exit code
  severity: routing               # routing | safety
```

Plantilla completa con los siete tipos de caso comentados en
`agents/_template/suites/ejemplo.cases.yaml`.

## Invocación real

```bash
# Motor 1 — sin escribir en la org
sf agent test run-eval --spec <spec>.yaml --target-org <alias> \
  --batch-size 1 --json > runs/<ts>/raw.json

# Motor 2 — requiere Testing Center
sf agent test create --spec <spec>.yaml --api-name <Suite> --force-overwrite -o <alias>
sf agent test run --api-name <Suite> -o <alias> --result-format json --output-dir runs/<ts>/

# Ver qué aserciones va a ejercer `test run` — NO valida que el spec sea desplegable
sf agent test create --spec <spec>.yaml --api-name <Suite> --preview
```

⚠️ **`--preview` no es auditoría estática.** Este archivo lo llamaba así y es
engañoso: **acepta specs que el servidor rechaza** (medido con un multi-turno sólo
de turnos de usuario — `--preview` exit 0, deploy exit 1). Lo que valida es la
traducción a XML, no la validez del contenido.

Sí sirve, y mucho, para **ver qué aserciones va a ejercer `test run`** — incluidas
las **tres que inyecta sin que se las pidas**. Eso cuesta cero y conviene mirarlo
antes de gastar una corrida.

```bash
# Antes de nada: ¿el entorno está sano y qué versión corre?
npm run doctor

# Descubrimiento — el centinela es obligatorio o no devuelve vocabulario
node lib/gen-spec.mjs --suite <cases>.yaml --agent <ApiName> --engine run-eval \
  --discover --out <spec>.yaml

# Veredicto propio + censo de aserciones + guarda de versión
node lib/assert.mjs --raw runs/<ts>/raw.json --suite <cases>.yaml \
  --engine run-eval --expect-version <botVersionId>

# El informe presentable
node lib/report.mjs --suite <cases>.yaml --raw runs/<ts>/raw.json \
  --metrics runs/<ts>/test-result-*.json \
  --agent agents/<slug>/agent.json --vocabulary agents/<slug>/vocabulary.json \
  --out runs/<ts>/informe.md
```

⚠️ **`--json`, no `--result-format json`, para `run-eval`.** Son dos estructuras
distintas y la segunda emite un preámbulo que rompe el parseo (D17).

⚠️ **Windows: PowerShell.** Desde Git Bash el wrapper de `sf` siempre devuelve
exit 1, incluso en `sf --version`.

⚠️ **Y en PowerShell, nunca `2>&1`.** El warning de update de la CLI va a stderr;
mezclarlo en el stdout **rompe todo parseo de JSON** con un error que no se parece
en nada a la causa. Usar `2>$null`.

## Qué hay en `lib/`

Seis utilidades, más `tooling.mjs` que varias usan para resolver la versión de
la CLI. **No son la puerta de entrada del repo** — el camino se puede
recorrer entero con Claude Code — pero resuelven lo que a mano sale mal.

| | |
|---|---|
| `gen-spec.mjs` | formato propio → spec del motor. Guarda de Ids reales; excluye multi-turno sin turnos capturados |
| `extract.mjs` | lectura de evidencia. Separa `invokedActions` de `@utils.*`, registra el `bot_version_id`, sale con error si una suite corrió contra más de una versión |
| `assert.mjs` | aserción propia sobre el JSON crudo. Modo de comparación por caso, `xfail`/`XPASS`, exit code correcto, **censo de aserciones** |
| `report.mjs` | el informe auditable. Segmenta por destino, **invierte la lectura en los caminos de rechazo**, marca los casos de seguridad aparte, explica los fallos —la plataforma devuelve la explicación vacía—, agrega la versión del agente, y **nombra lo que falta en vez de callarlo** |
| `doctor.mjs` | chequeo del entorno antes de gastar presupuesto: skills completas, `lib/` entera, y **qué versión de la CLI corre de verdad** |
| `preflight.mjs` | chequeo de la ORG antes de gastar una corrida: **guarda de Org Id** (un typo de alias apunta a otro cliente), **gate de versión** (activa == mayor número, D1), y detección de Testing Center (D9). Devuelve el `--expect-version` que consume `assert.mjs`. ⚠️ Sus tests mockean `sf`: la lógica está verificada, las consultas contra una org real **no** |

🚨 **Y una advertencia honesta sobre esta carpeta.** En la tercera ronda
encontramos **tres bugs en `assert.mjs`** —la capa que existe precisamente para
corregir los bugs de la plataforma—, los tres falsos negativos. **La capa en la
que más confiamos era la única sin tests propios.**

Los tres están arreglados y hoy `lib/` tiene 110 tests (`npm test`). Pero el punto
no es que estén arreglados: es que **aparecieron recién en la tercera ronda de
uso**, contra el primer agente que no habíamos armado nosotros.

🚨 **Y volvió a pasar.** La auditoría del 2026-08-12 encontró cuatro más, de la
misma familia —resultados incorrectos en silencio—, incluido uno idéntico en
forma al que ya los había quemado: `report.mjs` apareaba métricas por índice,
que es exactamente lo que `evaluate()` corrige con un cursor. Están arreglados y
con test. **El patrón es el hallazgo: los bugs de `lib/` no se ven en los
veredictos, igual que los de la plataforma.**

➡️ **`lib/` es la parte reemplazable del repo, y la que más hay que mirar con
desconfianza.** El conocimiento de `knowledge/` no falló nunca; las utilidades sí.
