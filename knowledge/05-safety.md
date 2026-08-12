# Seguridad: por qué testear no rompe nada, y cómo romperlo

---

## La razón estructural

**CONFIRMADO y generalizable a cualquier agente.**

Ningún motor de test materializa una `MessagingSession`. Las "sesiones" que
aparecen en la salida (`session_id`, `generatedData.sessionId`) son **sesiones de
Agent API**, no registros de mensajería.

Medido, baseline/diff sobre un día completo de spike:

| Motor | Ejecuciones | MessagingSession | Case creados | Case modificados |
|---|---|---|---|---|
| `run-eval` | ~94 | **0** | **0** | **0** |
| `test run` | ~70 | **0** | **0** | **0** |
| `preview` (local, simulado y live) | 2 sesiones | **0** | **0** | **0** |

### Por qué — y ahora está observado, no razonado

Las acciones de un agente que tocan datos suelen empezar con un lookup por una
variable `linked` — típicamente `@MessagingSession.Id` (= `RoutableId`).

**Bajo test, las variables `linked` llegan NULL.** El lookup no encuentra nada,
el registro relacionado tampoco, y el DML posterior filtra por `Id = null` y
afecta **0 filas**.

En la validación esto dejó de ser una explicación y pasó a ser un dato. En las
8 sondas de descubrimiento, la salida de `run-eval` trae:

```json
"contextVariables": { "EndUserId": null, "RoutableId": null,
                      "ContactId": null, "EndUserLanguage": null,
                      "ChannelType": null }
```

**Las cinco en null, en todas las corridas. CONFIRMADO.**

📌 Y esto se puede verificar **sin necesitar un agente que escriba datos**: se ve
el campo exacto que se poblaría si el vector de riesgo se activara. Es
independiente del resultado del diff.

*Esa es la razón por la que testear es seguro. No es suerte, y no depende de que
las acciones sean read-only.*

### Verificado en el peor escenario

Corrimos dos escalaciones reales con `run-eval`, con acciones live. Ambas cayeron
en la rama **más riesgosa** — dentro de horario laboral, la que dispara la
transferencia real vía Omni-Channel, no la benigna. El flow se ejecutó de verdad.

Resultado: **0 Case creados, 0 Case modificados, 0 MessagingSession, 0 AgentWork.**

Aun cuando el flow contiene un `Update_Case` que corre en **las dos ramas** —
antes de la decisión de horario — no tocó nada.

### Y replicado en una org que SÍ escribe, con colas de Omni-Channel reales

La ronda 3 corrió contra un agente de producción cuyos dos flows hacen UPDATE de
verdad: `AGENTFORCE_Save_Survey` (4 `recordUpdates` sobre `Case` y
`MessagingSession`) y `AGENTFORCE_Business_Hours_Verifier` (1 sobre `Case`).

**101 conversaciones, 14 escalaciones, 5 objetos auditados:**

| Objeto | Δ |
|---|---|
| `Case` | **0** |
| `MessagingSession` | **0** |
| `AgentWork` | **0** |
| `PendingServiceRouting` | **0** |
| `MessagingEndUser` | **0** |

Y el mecanismo, **observado en el input real de la acción**:

```json
"input":  { "conversationSummary": "El paciente solicitó hablar con un ejecutivo…",
            "recordId": null }
"output": { "__action_execution_status__": "success", "isWithinBusinessHours": true }
```

**`recordId: null` llegó al flow, el flow devolvió `success`, y el DML afectó 0
filas.** En una org donde los flows escriben de verdad, **un cero es evidencia**.

📌 **`@utils.escalate` bajo test NO encola trabajo.** Sube de INFERIDO a
**CONFIRMADO**: 14 escalaciones, 0 `AgentWork`, 0 `PendingServiceRouting`, en una
org **con** Omni-Channel configurado.

### 🚨 Auditar el DML se hace leyendo el XML, NUNCA la prosa del `.agent`

**Error cometido dos veces, en dos rondas distintas.**

La descripción de una variable en un `.agent` real decía *"fuera de horario
incluye **el caso creado**"*. El flow **no crea Cases**: actualiza el que ya cuelga
de la `MessagingSession`. Quien leyera esa frase concluiría que hay un vector de
creación que no existe — o, peor, la próxima vez concluiría lo contrario en un
agente donde sí lo hay.

➡️ **El inventario de DML sale de `recordCreates` / `recordUpdates` /
`recordDeletes` del XML del flow. La prosa del `.agent` describe la intención del
autor, igual que con el ruteo.**

---

## El único vector: `contextVariables` con Ids reales

🚨 **Corolario inverso, también generalizable.**

Si alguien siembra un `RoutableId` o `CaseId` **real** vía `contextVariables`, el
lookup encuentra la `MessagingSession`, el `Update_Case` deja de afectar 0 filas,
y **se modifican registros de producción de verdad**.

En el agente del spike eso habría significado pisar `Case.Description` y, en el
camino de encuesta, **cerrar Cases** (`Status = 'Closed'`) — con toda la
automatización indirecta que eso dispara (triggers, assignment rules, emails).

### La regla

> **Nunca un Id real en `contextVariables`. Nunca.**

El wrapper debe **rechazar** un caso cuyo `context` contenga algo con forma de Id
de Salesforce (15 o 18 caracteres alfanuméricos empezando con un prefijo de
objeto) salvo que se pase un flag explícito de override.

⚠️ **Corrección:** este archivo decía que *"sembrar variables de estado es inocuo y
es la técnica recomendada"*. **La primera mitad es cierta; la segunda está
retirada** — sembrar no funciona en ningún motor, en ninguno de los dos agentes
medidos. Ver `06`.

### 🚨 Y por qué la regla NO se relaja aunque el vector parezca cerrado

La ronda 3 midió que **ni siquiera las variables declaradas llegan al runtime**.
Eso *sugiere* que el canal está cerrado del lado del servidor y que, por lo tanto,
**ni un Id sembrado por error llegaría**.

**No se relaja igual.** El razonamiento, que vale como criterio general:

> **Una regla que cuesta cero no se toca por un corolario tranquilizador.**
> No sabemos *por qué* el canal está cerrado. Una vía que se cierra sin
> explicación puede reabrirse igual — con un cambio de versión, de tipo de agente,
> de canal o de org. El costo de mantener la regla es nulo; el costo de que se
> reabra sin que nos enteremos es un incidente con datos de producción.

### El chequeo que sí conviene agregar

Los nombres válidos de `contextVariables` de un agente están en su
`bot-meta.xml`, bloque `<contextVariables>` → `<developerName>`. **Validar contra
esa lista antes de mandar** tiene dos beneficios:

1. Evita sembrar algo que no es context variable (y que por lo tanto nunca iba a
   funcionar)
2. **Evita un cuelgue de 18 minutos**: un nombre no declarado hace que `test run`
   devuelva `"Agent call failed"` de forma reproducible. Ver `02`, D11

---

## Auditoría antes de correr contra una org nueva

Para un agente que no conocés, no asumas nada de lo anterior. Es barato
verificarlo:

**1. Auditar el DML de las acciones sin ejecutarlas.**
```
sf project retrieve start --metadata Flow:<nombre> --target-org <org>
```
Leer el XML: qué objetos toca, qué operaciones (`recordCreates`, `recordUpdates`,
`recordDeletes`), y **de dónde sale el filtro** de cada lookup. Si el filtro viene
de una variable `linked`, es seguro bajo test.

⚠️ Mirar también dónde está el DML respecto de las decisiones. En el spike, un
`Update_Case` estaba **antes** de la bifurcación de horario: corría en ambas ramas.

**2. Baseline / diff sobre los objetos candidatos.**
```sql
SELECT COUNT() FROM MessagingSession WHERE CreatedDate = TODAY
SELECT Id, LastModifiedDate FROM Case WHERE LastModifiedDate = TODAY
```
Antes y después de una corrida aislada de un caso.

**3. Lo que no se puede auditar leyendo.**
- El Apex invocable dentro de un flow es una caja negra hasta retraerlo
- La automatización indirecta (triggers, flows record-triggered, assignment rules)
  que dispara un `Status = 'Closed'`
- Los flows corriendo `SystemModeWithoutSharing` saltan reglas de compartición

---

## Rastro que dejan los motores

| | `run-eval` | `test run` | `preview` (bundle local) |
|---|---|---|---|
| Registros de negocio | 0 | 0 | 0 |
| Metadata en la org | ninguna | `AiEvaluationDefinition` + `AiJobRun` | ninguna |
| Rastro local | **ninguno** | `--output-dir` | traces ricos (61-120 KB) |
| Recuperable después | **NO** | **sí**, por job id | sí, en `.sfdx/agents` |

`test run` deja filas en `AiJobRun` (`JobType: AgentforceScorerPromptBuilder`) —
sólo metadata de job, sin utterances ni respuestas. **No existen sObjects
`AiEvaluation*` consultables por SOQL. CONFIRMADO.**

### 🚨 El export de Testing Center NO es evidencia presentable

**Este archivo afirmaba lo contrario. Estaba mal, y es peligroso.**

La afirmación vieja —*"es evidencia presentable tal cual, legible por alguien que
no sepa nada de la CLI"*— se escribió mirando el export de un fixture con pocos
caminos de rechazo, donde el sesgo casi no se veía. En un agente bien protegido el
sesgo es sistemático:

| Caso | Qué hizo el agente | Cómo figura en el export |
|---|---|---|
| Pedido de medicación | **se negó a recomendar** | FAILURE × 2 |
| Fuga de prompt | **no filtró su system prompt** | FAILURE — *"does not provide the requested system prompt"* |
| Consulta fuera de alcance | **la rechazó** | FAILURE × 2 |

➡️ **La formulación correcta:**

> **El export de Testing Center es materia prima, no evidencia.** Sin curar, marca
> como fallidos los casos donde el agente se comportó mejor —incluidos los de
> seguridad— y no trae la versión del agente. Exportarlo tal cual a un cliente o
> un auditor **es peor que no darle nada**.

Tres limitaciones concretas (ver `02`, D21):

1. **Invierte el veredicto** en los caminos de rechazo, por el umbral de las métricas
2. **No trae la versión del agente**, por ningún camino
3. **`metricExplainability` viene vacío en todas las aserciones** — un export de una
   corrida sin `metrics:` no tiene ni una sola explicación

Y **no se exporta por CLI**: es un botón de la UI. La única vía programática es el
endpoint del que la UI lo genera:

```
GET /services/data/v<API>/einstein/ai-evaluations/runs/{jobId}/results
```

➡️ **El artefacto de evidencia es el reporte curado de `lib/report.mjs`**, no el
export. Igual hay que archivar el crudo por corrida; el job id es la clave.

📌 Nota de vocabulario: la UI dice **Subagent**, no *Topic*. Coincide con el
renombre de la plataforma. El YAML sigue diciendo `expectedTopic`.

⚠️ El export es salida de `test run` únicamente. `run-eval` no tiene equivalente:
lo único que existe es el JSON que capture el wrapper.

⚠️ La retención server-side existe (recuperamos un job de 22 h antes,
byte-idéntico) pero **su duración es NO DETERMINADO**. No dependas de ella:
archivá.

---

## Higiene de org

Riesgo real, no hipotético. Durante el spike se usó un alias que no existía y la
CLI respondió *"Did you mean `sura-dev`?"* — **la sandbox de otro cliente**.

Un typo de alias más una corrida con Ids reales es un incidente con datos de un
tercero.

- El alias va **explícito y verificado** en `agents/<slug>/agent.json`
- El preflight valida que el alias resuelva al Org Id esperado antes de correr
- Nunca depender de la org default
