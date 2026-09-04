# Los motores

Cuatro comandos que parecen intercambiables y no lo son. Dos trabajan sobre el
archivo local, dos contra el agente publicado.

**Consecuencia estructural: no se puede testear automáticamente un cambio antes
de publicarlo.** Sólo se puede conversar con él manualmente vía `preview`.

---

## Tabla comparativa (números medidos, no estimados)

| Dimensión | `test run-eval` | `test run` |
|---|---|---|
| **Prerequisito en la org** | **Ninguno** | 🚩 **Testing Center habilitado** |
| **Madurez** | **BETA** — *"Don't use beta commands in your scripts"* | GA |
| **Entrada** | YAML/JSON local, o stdin | Metadata desplegada en la org |
| **Escribe en la org** | **Nada** | `AiEvaluationDefinition` (vía `test create`) |
| **Sincronía** | Síncrono | Async (job id, `--wait`) |
| **Evaluador de topic** | `planner_topic_assertion`, **`contains`** | `topic_sequence_match`, **igualdad exacta** |
| **Evaluador de acciones** | `planner_actions_assertion` — **ROTO** | `action_sequence_match` — funciona, pero es subconjunto |
| **`metrics`** | **ignorado en silencio** | **sí**, con `metricExplainability` en texto |
| **`conversationHistory`** | descarta `role: agent`, **EJECUTA** los turnos | **EXIGE** alternancia, **INYECTA** como contexto |
| **`subjectVersion`** | **ignorado en silencio** | **`test create` ni lo emite** en el XML |
| 🚨 **¿Dice contra qué versión corrió?** | **SÍ** — `sessionContext.tags.bot_version_id` | **NO. Por ningún camino** |
| 🚨 **¿Resuelve refs crudas (contenido y estado)?** | **SÍ** | **NO** — devuelve el template literal |
| **Exit code** | **INVERTIDO** (ver abajo) | **INVERTIDO** |
| **Paralelismo** | `--batch-size` (1-5), batches en paralelo | no expuesto |
| **Tiempo, 20 casos** | **~21 s** | **222 s** limpio / **1306 s** con un caso colgado |
| **Fiabilidad** | **0 errores / ~130 ejecuciones** | **1,7 %** (1/60) · **20 %** (1/5) en la ronda 3 |
| **Modo de falla** | — | cuelga **18-22 min**. **Disparador identificado**: un nombre no declarado en `contextVariables` lo produce de forma reproducible (2/2) |
| **Aserciones repetidas** | las devuelve todas | 🚨 **colapsa: 5 declaradas → 1 devuelta**, sin error ni rastro |
| **`--output-dir`** | **no tiene** | sí |
| **Rastro recuperable** | **ninguno** | sí, por job id |

Todo **CONFIRMADO**.

### 🚨 El exit code no está roto: está invertido

La formulación vieja —*"siempre devuelve 0"*— era incorrecta. Medido en la ronda 3:

| Corrida | Veredictos | Exit |
|---|---|---|
| 10 fallos de aserción, 0 evaluaciones ausentes | rojo de verdad | **0** |
| 8 pass, 1 fallo, **2 evaluaciones ausentes** | casi todo verde | **1** |

`if (summary.errors > 0)` — y `errors` cuenta **evaluaciones que no corrieron**, no
fallos de aserción.

➡️ **No es que ignore los fallos: es que mide lo que no importa.** Un CI que lo use
como gate da **verde con el agente roto** y **rojo con un `expected` mal tipado**.
Es activamente engañoso en las dos direcciones.

Y `summary.errors` dice **cuántas** faltaron, **nunca cuáles**. Recorrido completo
del JSON: no hay ningún campo con mensaje, id ni explicación. **El censo propio no
es una mejora: es la única forma de saber qué pasó.**

---

## `sf agent validate authoring-bundle` — sintaxis

Compila el `.agent` y devuelve errores de sintaxis. ~1,8 s de compilación real,
~5,6 s de wall clock.

**Requiere org. CONFIRMADO.** No hay modo offline: el compilador es server-side.
Cuatro señales independientes — el flag está marcado `(required)`, con alias
inexistente falla en la resolución de org antes de mirar el archivo, la salida es
un job asíncrono polleado, y el help menciona una *"Validation/compilation API"*
que devuelve 404/500.

Implicancia para CI: el pipeline necesita credenciales de org hasta para el
chequeo de sintaxis más básico.

## `sf agent preview` — exploración y debug

**Tiene API programática.** No es sólo una TUI:

| Subcomando | Qué hace |
|---|---|
| `preview start` | Abre sesión, devuelve session ID |
| `preview send` | Manda una utterance, devuelve la respuesta |
| `preview end` | Cierra y devuelve la ruta de los trace files |
| `preview sessions` | Lista sesiones cacheadas |

**`send` es stateful. CONFIRMADO** — resolvió una elipsis (*"¿y el horario de los
sábados?"*) usando el contexto de turnos previos.

`send --json` devuelve **sólo el texto**: `metrics: {}`, `result: []`, cero topic,
cero acciones. **Para assertar hace falta `agent trace`**, que sí da topic, intent,
routing from/to, acciones con input y output, latencia, razonamiento del LLM y
safety scores.

### Modos

| | Simulado (default) | Live (`--use-live-actions`) |
|---|---|---|
| `generationId` | `"test-gen-001"` (hardcodeado) | UUID real |
| `__action_execution_status__` | ausente | `"success"` |
| Latencia de acción | ~1,9 s | ~10,3 s |

Esos tres marcadores son **la forma programática de detectar si una corrida fue
simulada o real**.

**Los mocks del modo simulado engañan activamente. CONFIRMADO.** No es que sean
pobres: inventan. El mock afirmó *"atiende las 24 horas del día, los 7 días de la
semana"* mientras la KB real decía *"TeleUrgencia de lunes a viernes de 08:00 a
23:00"*. Sirve para ruteo e invocación de acciones; **para contenido es
activamente engañoso** — un test de contenido en simulado pasa en verde validando
una alucinación.

**`preview --authoring-bundle --use-live-actions` es el mejor entorno de
desarrollo del ecosistema:** código local + acciones reales + traces ricos
(61-120 KB), sin publicar versión y sin dejar rastro en la org.

### Limitación de observabilidad

| Origen de sesión | Trace |
|---|---|
| `--authoring-bundle` (local) | 61-120 KB, parseables |
| `--api-name` (publicado) | **2 bytes: `{}`** |

**Contra el agente publicado no hay traces locales. CONFIRMADO.** El error dice
*"The trace schema may have changed"* — es engañoso: no hay datos. Para
observabilidad de producción hay que ir a Session Tracing / Data Cloud.

## `sf agent test run-eval` — el gate

Beta, sin documentar. Todo lo que se sabe salió del `--help` y de leer el código
del plugin.

Endpoint: `POST https://api.salesforce.com/einstein/evaluation/v1/tests`.
API externa de Einstein, no la org. 3 reintentos internos.

### Los 10 evaluadores

| # | Tipo | Determinista |
|---|---|---|
| 1 | `evaluator.planner_topic_assertion` | ✅ (operador `contains`) |
| 2 | `evaluator.planner_actions_assertion` | ✅ (operador `includes_items`) — **roto**, ver `02` |
| 3 | `evaluator.string_assertion` | ✅ |
| 4 | `evaluator.numeric_assertion` | ✅ |
| 5 | `evaluator.json_assertion` | ✅ |
| 6 | `evaluator.text_alignment` | ⚠️ embeddings (`base.cosine_similarity`) |
| 7 | `evaluator.bot_response_rating` | ❌ LLM, `threshold: 3.0` |
| 8 | `evaluator.hallucination_detection` | ❌ LLM |
| 9 | `evaluator.citation_recall` | ❌ LLM |
| 10 | `evaluator.answer_faithfulness` | ❌ LLM |

Sólo 1-5 sirven para gatear. Los 6-10 devuelven `score` sin `is_pass` — el runner
los cuenta aparte (`scored`).

### Paralelismo

`--batch-size` = tests por request HTTP (1-5). Los batches se disparan **todos en
paralelo** (`Promise.all`).

| `--batch-size` | n | Media |
|---|---|---|
| **1** | 4 | **19.478 ms** | σ ≈ **0,03 s** |
| 2 | 4 | 25.016 ms | — |
| 5 (default) | 6 | 45.951 ms | rango **32,8 – 63,1 s** |

Replicado en el segundo agente: 15,65 s / 20,17 s / 43,26 s → **2,8×**.

⚠️ **La varianza importa tanto como la media para un gate.** Con `--batch-size 1`
la desviación es de centésimas; con el default el mismo trabajo puede tardar el
doble entre corridas, y eso rompe presupuestos de CI.

**Curva monótona: 1 < 2 < 5. El default es 2,4× más lento. CONFIRMADO.**
Contraintuitivo pero medido: batches más chicos = más requests concurrentes.

Y con `--batch-size 1` el tiempo tiende **al caso más lento, no a la suma**:
20 casos ≈ 21 s, igual que 4 casos. No hay tope de throttling visible a 20.

### ⚠️ `run-eval` sí tiene juicio de LLM

Corrección: este archivo presentaba el juicio de LLM como exclusivo de `test run`.
No lo es.

`run-eval` **ignora** el bloque `metrics:` en silencio, pero **sí traduce
`expectedOutcome`** a `bot_response_rating`. O sea: tiene un veredicto de modelo,
por otra puerta.

Lo que no tiene es `explainability` — devuelve string vacío siempre — ni las
métricas nombradas (`coherence`, `completeness`, etc.).

**Consecuencia práctica para orgs sin Testing Center:** no quedan sin señal de
calidad, quedan con una más pobre. Veredicto sí, explicación no.

---

## `sf agent test run` — el reporte cualitativo

Requiere `test create` previo, que despliega un `AiEvaluationDefinition` a la org
y trae el metadata al proyecto.

### Lo que sólo él da: métricas con explicación

Escala 0-5. Threshold no expuesto (**INFERIDO: 3**; observado 4-5 → PASS,
0-2 → FAILURE).

Ejemplo de `metricExplainability` útil:
> *"The answer provides several possible reasons for the cancellation, but does
> not explicitly state the most common reason."* → hueco real de KB.

`run-eval` devuelve `explainability: ""` siempre.

### 🚨 CONTRAINDICACIÓN: la métrica premia romper los guardrails

Esto dejó de ser *"las métricas son ruidosas"*. Medido en la ronda 3, sobre un
agente con caminos de rechazo reales:

| Caso | Qué hizo el agente | Qué puso el juez |
|---|---|---|
| Pedido de medicación | **se negó a recomendar** | `coherence` **1** — el peor de la suite |
| Fuga de prompt | **no filtró su system prompt** | *"does not provide the requested system prompt"* |
| Consulta fuera de alcance | **la rechazó** | `coherence` **1** · `completeness` **0** |

➡️ **Un equipo que optimice contra estas métricas está optimizando para romper sus
propios guardrails.**

Y el sesgo **escala con la protección del agente**: 41 % de los ceros de
`completeness` eran comportamiento correcto en `Bici Store`; **75 %** en un agente
de producción bien protegido. **Cuanto mejor protegido está el agente, peor
puntúa.**

**Contraindicación, no advertencia de uso: no exponer estas métricas a nadie que
pueda actuar sobre ellas sin la segmentación al lado.** Nunca como objetivo,
nunca en un tablero, nunca en un OKR.

### 🎁 Y sin embargo: son valiosas como detector

El mismo agente, mismo día, misma versión: la consulta *"¿cuáles son los horarios
de urgencia?"* devolvió tres URLs con horarios en unas corridas y *"no tengo esa
información"* en otras. El ruteo fue `GeneralFAQ` en **el 100 %** de los casos.

**Una suite de ruteo reporta eso como perfecto. La métrica es lo único que lo vio.**

➡️ Las dos cosas son verdad a la vez, y hay que leerlas juntas:

> La métrica es **peligrosa como objetivo** —premia romper guardrails— y **valiosa
> como detector** —ve inconsistencias de contenido que ninguna aserción de ruteo
> puede ver—. Se usa **segmentada por topic**, **sólo sobre los caminos donde se
> espera que el agente responda**, y **nunca como métrica a optimizar**.

Es además el mejor ejemplo del corolario *"topic estable ≠ comportamiento
estable"*: acá el topic fue idéntico y la respuesta cambió por completo.

**Regla operativa: segmentar por topic antes de promediar, y en el segmento de
rechazo invertir la lectura — un `completeness: 0` ahí es comportamiento
correcto.**

### Estabilidad de las métricas

| | Estables entre 3 corridas | Variaron | Delta máx |
|---|---|---|---|
| `coherence` | 13/19 | 6 | 2 puntos |
| `completeness` | 14/19 | 5 | **5 puntos** |

Caso extremo: `completeness [4, 4, 0]` sobre input idéntico → PASS, PASS, FAILURE.

Pero el **agregado sí es estable**: media por corrida ±0,3 sobre escala 0-5.

➡️ **Sirven en macro, no en micro. Nunca como gate por caso.**

### `test create` inyecta DOS aserciones que nadie pidió

**`bot_response_rating`.** Se agrega aunque el spec no lo pida. Sin
`expectedOutcome` aparece como:

```
output_validation  expected=""  result=FAILURE  status=ERROR
                   errorMessage="Skip metric result due to missing expected input"
```

`status: ERROR` **y** `result: FAILURE` a la vez. Un contador ingenuo lo suma como
fallo de aserción cuando es una aserción que la CLI inventó y que **nunca podía
pasar**. O ponés `expectedOutcome` siempre, o convivís con un rojo permanente.

**`action_sequence_match` con `[]`.** Peor: da **PASS con score 1** aunque el
agente sí haya invocado acciones.

```
actions_assertion  expected="[]"  actual="['AGENTFORCE_Business_Hours_Verifier']"  result=PASS
```

➡️ **No sólo no asserta: suma un PASS al conteo.** Infla el verde y la sensación
de cobertura. Ver `02`, D5.

**Y un tercero, en los casos sin `expectedTopic`:** `test create` emite igual un
`<expectation><name>topic_sequence_match</name></expectation>` **sin
`<expectedValue>`**, que falla siempre. En `run-eval` ese evaluador simplemente no
se emite.

---

## Multi-turno: la diferencia que importa

| | `run-eval` | `test run` |
|---|---|---|
| Entradas `role: agent` | **descartadas en silencio** | **obligatorias** (falla el deploy sin ellas) |
| Qué hace con el historial | **lo EJECUTA**: N llamadas reales | **lo INYECTA** como contexto |
| Respuestas del agente en el historial | irrelevantes | **fabricadas por quien escribe el test** |

**La prueba fina.** Escribimos un turno `agent` falso que decía *"atiende las 24
horas del día"*. `test run` respondió *"…no tiene un horario específico publicado
para los sábados, ya que **funciona las 24 horas**"* — repitió nuestra invención.
`run-eval`, que ejecutó el turno real, respondió desde la KB real.

➡️ **`test run` multi-turno valida un camino que puede no existir en producción.**

No es inútil: la inyección es **determinista** y sirve para fijar un estado exacto
sin depender de que el agente llegue solo. Pero si se usa, los turnos del agente
deben **capturarse de una sesión real de `preview`**, nunca inventarse.

⚠️ **Este archivo recomendaba `contextVariables` como alternativa para fijar
estado. Esa recomendación está retirada:** no funciona en ninguno de los dos
motores, en ninguno de los dos agentes medidos. Ver `04` y `06`. **El único camino
confirmado para fijar estado es reproducir los turnos con `run-eval`.**

---

## Recomendación

| Modo | Motor | Costo |
|---|---|---|
| **Gate de PR** | `run-eval` + wrapper, `--batch-size 1` | ~21 s / 20 casos |
| **Nightly cualitativo** | `test run` + `metrics`, segmentado por topic | ~4 min |
| **Desarrollo / debug** | `preview` sobre bundle local | interactivo |

### 🚨 `test run` no es una alternativa a `run-eval`

> **`test run` no es un plan B: es una herramienta estrictamente más débil que
> además es GA.** No puede assertar contenido ni estado, y no puede decir contra
> qué versión corrió. Su único aporte exclusivo son las métricas de calidad con
> explicación.
>
> **La capacidad más valiosa del enfoque —assertar contenido y estado— existe en
> un solo comando, y ese comando es BETA. No hay segunda fuente.** Es el riesgo
> estructural más serio del repo, y **no está mitigado: sólo documentado.**

`run-eval` gana el gate por tres ejes, y **el tercero pesa más que los dos
primeros**:

| Eje | `run-eval` | `test run` |
|---|---|---|
| **Portabilidad** | no requiere nada | requiere Testing Center — **en 1 de 3 orgs no estaba** |
| **Fiabilidad** | 0 errores / ~130 ejecuciones | 1,7 % · 20 % en la ronda 3 |
| 🚨 **Auditabilidad** | **expone la versión servida** | **imposible saberla, por ningún camino** |

Más: no escribe en la org, y es ~10× más rápido.

**Y la ironía hay que dejarla escrita: el único motor donde la regla 1 del
`CLAUDE.md` es aplicable es el que puede cambiar sin aviso.** Elegir el motor GA
es elegir quedarse ciego frente al defecto más grave.

**El plan B real es el wrapper sobre la salida cruda**, que es independiente del
motor. La abstracción de motor sigue valiendo para poder cambiar; la migración a
`test run` como mitigación, no.

### ⚠️ El wrapper tampoco es infalible

En la ronda 3 el wrapper corrigió al motor en 3 casos y **se equivocó en 1**, por
tres bugs propios (HTML sin des-escapar, `SKIP` que nunca dispara, apareo por
índice). **La capa que corrige los bugs de la plataforma era la única sin tests.**

➡️ La combinación a usar es **`run-eval` + wrapper**, y no porque el wrapper sea
perfecto: porque es la única que se validó de punta a punta.

### El preflight necesita detección de capacidades

No alcanza con verificar la versión. Antes de correr hay que determinar **qué
motores están disponibles en esa org**. Enterarse con un `DeploymentFailed` a
mitad de corrida es la peor forma.

```bash
# 1) ¿existe el tipo de metadata?
sf org list metadata --metadata-type AiEvaluationDefinition -o <alias> --json

# 2) ¿se puede desplegar? El dry-run NO escribe (checkOnly: true)
sf project deploy start --metadata AiEvaluationDefinition:<Kit_X> -o <alias> --dry-run --json
```

Las dos vías juntas. La primera sola no distingue "el tipo existe" de "puedo
usarlo".
