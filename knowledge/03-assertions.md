# Qué se puede assertar, y qué no

La distinción que importa **no** es "asertable / no asertable". Es de tres capas:

| | Ejemplos | ¿Se puede? |
|---|---|---|
| **La plataforma lo asserta** | topic, acciones invocadas, contenido determinista, estado | **Sí, nativo** |
| **La plataforma no lo asserta, pero el dato está** | `@utils.*`, transiciones internas | **Sí, con wrapper propio** |
| **El dato no existe** | texto generado por el LLM, fidelidad multi-turno en `test run` | **No** |

Colapsar la segunda y la tercera es un error — lo cometimos en la primera versión
de este archivo. *"La plataforma no lo verifica"* y *"el dato no existe"* son
cosas muy distintas, y la diferencia es donde vive el valor de un wrapper propio.

---

## 1 · Ruteo — el 90 % del valor

**Estabilidad medida: 127 observaciones, cero variación** (dos agentes, dos orgs).

Es donde vive el valor de una suite: el fallo típico es que el usuario pregunta
una cosa y el router lo manda al subagente equivocado.

### 🚨 Pero estabilidad del topic no es estabilidad de comportamiento

**El hallazgo más fino de toda la investigación.**

127 observaciones sin una sola variación de destino — y el agente **no hizo lo
mismo** en todas. Dos utterances invocaron una acción determinista en unas
corridas y no en otras, con el topic idéntico.

En un agente real eso es la diferencia entre responder con el dato correcto y
responder con lo que el modelo recuerde. **Una suite que sólo asserta
`expectedTopic` reporta 100 % estable un agente cuya traza de ejecución no lo es.**

📌 Y el corolario incómodo: **en `run-eval` crudo esa inestabilidad es
invisible**, porque `expectedActions` falla siempre por D6 y un rojo constante
tapa uno intermitente. **Corregir D6 en el wrapper es lo que la hace visible.**

➡️ Assertar ruteo es necesario. No es suficiente.

---

## 2 · El vocabulario de topics NO son tus subagentes

**CONFIRMADO en los dos agentes.**

En una suite de 20 casos, los topics realmente devueltos:

```
GeneralFAQ (13) · off_topic (3) · human (2) · Prompt_Injection (1) · SaveSurvey (1)
```

**Dos de esos cinco no existen en el `.agent`.**

| Topic | Qué es | Confirmado en |
|---|---|---|
| `Prompt_Injection` | **Guardrail de plataforma.** Intercepta la fuga de instrucciones antes de que llegue a tus subagentes | los dos motores, los dos agentes |
| `human` / `human__` / `__human__` | Escalación concretada. El literal varía por motor (D8) | los dos motores |

### Tres consecuencias

**Un test de seguridad puede fallar aunque el agente se haya comportado
perfecto.** Un caso que espera `off_topic` para un intento de fuga de prompt
falla — porque lo atajó el guardrail, que es un resultado mejor.

**Una escalación concretada no reporta el nombre del subagente**, y la
"respuesta" es un mensaje de sistema en inglés.

### La regla del subagente de escalación — reformulada dos veces

La versión vieja decía: *"un subagente cuyo único trabajo es escalar nunca aparece
como topic"*. **Es demasiado estrecha.** El subagente `escalation` de un agente de
producción corre un flow, tiene rama de fuera de horario y rama de "no hay
ejecutivos" con tres salidas — **y tampoco aparece**.

Y la ronda 3 le encontró el límite exacto: **sí aparece cuando la escalación NO se
concreta.** Medido: un turno en que el planner falló y no ejecutó la acción
devolvió `topic: "escalation"`.

➡️ **La formulación correcta:**

> **En el turno en que la escalación SE CONCRETA, el runtime reporta el literal de
> humano en lugar del subagente — cualquiera sea ese subagente y haga lo que haga
> además. El literal de humano es la firma del ÉXITO, no del intento.**

⚠️ **Consecuencia operativa incómoda:** un caso que asserta `human` **no protege
de una escalación fallida** — la fallida devuelve el nombre del subagente y falla,
pero de forma **intermitente**. Medido: 1 fallo sobre ~25 turnos de escalación
(≈4 %). Una suite que corre **una vez** lo ve verde el 96 % de las veces.

🚨 **De ahí la regla: los casos de severidad `safety` se corren N veces, no una.**
Un fallo intermitente en un camino de seguridad es indistinguible de verde si sólo
mirás una corrida.

⚠️ El resultado de un test de escalación **también depende de la hora**: dentro de
horario la escalación se concreta (literal de humano); fuera de horario
probablemente devuelva el subagente. La rama fuera de horario sigue **NO
OBSERVADA**.

⚠️ La lista de topics de plataforma observada es **un piso, no la lista completa**
(NO DETERMINADO). Un agente puede además tener guardrails **desactivados** por
config (`additional_parameter__disabled_topics`) que en otra org sí aparecerían.

### Estabilidad del vocabulario — matizada

No es *"el vocabulario caduca"*. Medido sobre el mismo agente a dos días de
distancia:

| Parte del vocabulario | Estabilidad |
|---|---|
| Nombres de **subagente** (`GeneralFAQ`, `off_topic`, `SaveSurvey`) | ✅ **idénticos** |
| Nombres de **guardrail** (`Prompt_Injection`) | ✅ **idéntico** |
| **El literal de escalación** | ❌ **cambió** (`human__` → `__human__`) |

➡️ **Lo que sale de nombres declarados es estable; lo que la plataforma sintetiza
es volátil.** Re-descubrir periódicamente hace falta, pero **lo que hay que
vigilar es el literal de escalación**, no `GeneralFAQ`.

---

## 3 · Acciones invocadas

**El nombre de una acción es su alias en el `.agent`, no su target.**
CONFIRMADO en los dos agentes: el runtime devuelve `consultar_faq`, no
`apex://BiciStoreFaq`. En el otro agente, la acción se llamaba `..._question_...`
y apuntaba a `..._questions_...` en plural — y lo que apareció fue el alias.

Limitaciones:

- **No detecta acciones inesperadas.** Semántica de subconjunto (D5)
- **`expectedActions: []` no asserta nada.** No cuenta como cobertura
- **Roto en `run-eval`** — falso negativo garantizado (D6). Se corrige en el wrapper

---

## 4 · Contenido

Acá está la corrección más grande de la validación. La regla vieja decía en
bloque que el contenido *"se observa, no se asserta"*. **Es falso para la mitad.**

### Contenido generado por el LLM → NO se asserta

No es reproducible. Medido: la misma utterance, **dentro de la misma corrida**,
devolvió dos cierres distintos. No hace falta comparar entre corridas.

### Output de una acción determinista → SÍ, con igualdad exacta y de forma nativa

```
{gs.response.planner_response.lastExecution.invokedActions[0][0].function.output.<campo>}
```

Vía `customEvaluations`. Byte-exacto, 3/3 corridas, 4 aserciones distintas.

**Aplica a cualquier agente con Apex o Flow que devuelva valores fijos:** códigos,
montos, estados, textos de política, resultados de consulta.

➡️ **La distinción operativa: se asserta lo que la acción devolvió, no cómo el LLM
decidió envolverlo.**

Medido: el agente **conserva el literal y le agrega texto propio**. Verificar
contra la respuesta al usuario es inviable; contra el output de la acción es
perfecto.

⚠️ **D4 aplica**: toda ref cruda exige `expectedTopic` en el mismo caso.

### 🚨 Pero NO es universal — depende del agente

Este archivo decía *"no es propio de un fixture"*. Es cierto que la técnica es
general, **pero su aplicabilidad no lo es**:

| Agente | Acción determinista alcanzable en un turno |
|---|---|
| `Bici Store` (fixture) | ✅ un Apex barato que devuelve strings fijos |
| Agente de producción medido | ❌ **ninguna**. Su acción de FAQ es un `generatePromptResponse://` generado por LLM; las dos deterministas viven **detrás de la encuesta o de la escalación** |

➡️ **Assertar CONTENIDO depende de que el agente tenga una acción que devuelva
valores fijos Y que sea alcanzable en un turno.** El fixture de la ronda 2 era más
conveniente que la realidad y eso ocultó la limitación.

📌 **Al hacer el relevamiento, la pregunta es: ¿hay alguna acción determinista, y
cuántos turnos cuesta llegar a ella?** Si la respuesta es "ninguna", el tipo 4 de
prueba no aplica a ese agente — y hay que decirlo, no simularlo.

⚠️ **Esta limitación NO aplica al assert de ESTADO.** Ver abajo.

---

## 5 · Estado y transiciones internas

**CONFIRMADO — y es capacidad nativa, no sólo del wrapper.**

`customEvaluations` alcanza más que `generatedData`:

```
{gs.response.planner_response.sessionContext.stateVariables.<variable>}
{gs.response.planner_response.sessionContext.executionHistory[N].actionName}
```

Eso permite **assertar la máquina de estados**: que después de un turno la
variable quedó en el valor correcto, que se ejecutó tal transición, que se guardó
tal dato. **Determinismo sobre una conversación**, que es exactamente lo que
parecía imposible.

Las `@utils.*` (`escalate`, `setVariables`, `transition`) **no aparecen** en
`invokedActions` — por eso `expectedActions` es ciego a ellas — pero **sí están en
`executionHistory`** con argumentos y resultado. Todo desde `run-eval`, sin
`preview` ni bundle local.

### 🎁 Y el assert de estado NO depende de que el agente tenga acciones

**CONFIRMADO con control.** Un turno de un subagente cuya única acción es un
`generatePromptResponse://` —o sea, **sin ninguna acción determinista**— resolvió
igual:

```
{gs.response.planner_response.sessionContext.stateVariables.surveyStage}  →  "not_started"   ✅
```

➡️ **Se puede assertar la máquina de estados en el turno más barato que tengas,
sobre cualquier agente que declare variables.** La limitación del assert de
contenido —"depende de que haya una acción determinista"— **no aplica acá**.

Eso amplía bastante el alcance: **un agente sin ninguna acción determinista igual
puede tener su máquina de estados verificada.**

### ⚠️ Por qué esto se asserta por dos vías a la vez

**No es redundancia. Es un hedge, y hay que dejarlo escrito o alguien lo "limpia"
en seis meses.**

La vía **nativa** depende de que el traductor haga `return MAPA[path] ?? path` —
un **passthrough no declarado**, no una feature documentada. Si mañana valida
rutas contra una whitelist, **todos** los asserts de contenido y estado se rompen
de golpe y en silencio.

La vía **wrapper** lee el JSON crudo y no depende del traductor. Y cubren cosas
distintas: la nativa mueve el veredicto de la CLI, la del wrapper mueve el exit
code.

➡️ Si una se rompe, la otra lo detecta. Borrar cualquiera deja el assert
dependiendo de un solo punto de falla no documentado.

## 🚨 RIESGO CONFIRMADO: no hay segunda fuente

Este archivo lo tenía como INFERIDO. **La ronda 3 lo midió, y se cumple.**

4 casos, 5 refs crudas, los dos motores:

| Capacidad | Ruta | `run-eval` | `test run` |
|---|---|---|---|
| Output de acción determinista | `lastExecution.invokedActions[0][0].function.output.<campo>` | ✅ resuelve y **PASA** | ❌ **template literal** |
| `stateVariables` | `sessionContext.stateVariables.<var>` | ✅ resuelve y **PASA** | ❌ **template literal** |
| `executionHistory` | `sessionContext.executionHistory[N].actionName` | ✅ resuelve y **PASA** | ❌ **template literal** |

En `test run` las **cinco** volvieron así:

```
exp = "success"
act = "{gs.response.planner_response.lastExecution.invokedActions[0][0].function.output.…}"
result = FAILURE     status = COMPLETED     sin mensaje de error
```

**Y no se arregla agregando `expectedTopic`**: tres de los cuatro casos lo tenían.

➡️ **Assertar contenido y estado existe en un solo comando, y ese comando es
BETA** (*"any aspect of this command can change without advanced notice"*).
**El riesgo estructural más serio del enfoque. No está mitigado: sólo
documentado.**

⚠️ **Dos limitaciones independientes, no las mezcles:** aunque mañana `test run`
resolviera las refs crudas, **seguiría sin poder decir contra qué versión corrió**
(D1). Son dos agujeros distintos del mismo motor.

📌 El `--preview` mostró que **el XML sí transporta las refs crudas, literales,
índices de array incluidos**. O sea: **el cliente arma el pedido perfecto y el
runtime lo ignora.** Es el caso de manual de por qué "confirmado por código" no
vale para afirmaciones sobre el servidor.

---

## La técnica del centinela — para el descubrimiento

**No es un workaround: es la técnica.**

Un descubrimiento *"sin asserts"* **no devuelve vocabulario**. Causa, leída en
`yamlSpecTranslator.js`:

```js
function needsPlannerState(testCase) {
    if (testCase.expectedTopic !== undefined) return true;
    if (testCase.expectedActions?.length > 0) return true;
    if (testCase.customEvaluations) { /* sólo si `actual` está en PLANNER_PATHS */ }
    return false;
}
```

Sin `expectedTopic`, sin `expectedActions` no vacío y sin una `customEvaluation`
reconocida, **no se emite el paso `agent.get_state`** — y sin `get_state` no hay
`lastExecution.topic` que leer.

➡️ **Poner un `expectedTopic` centinela que sabés que va a fallar**, para que la
aserción **se ejecute** y devuelva el `actual_value`:

```yaml
- id: B1
  utterance: "¿A qué hora abren?"
  expect: { topic: __DISCOVERY__ }   # imposible a propósito
```

Todos los casos fallan, y **el veredicto revela el topic real**. Es el único modo
de que el descubrimiento devuelva algo.

---

## Lo que NO se puede assertar

- **Ausencia de acciones.** Semántica de subconjunto en los dos motores
- **Contenido generado por el LLM.** No reproducible
- **Fidelidad multi-turno en `test run`.** Inyecta respuestas de agente escritas a
  mano; el agente construye sobre esa ficción y valida un camino que puede no
  existir

---

## Nunca derivar `expectedTopic` de leer el prompt

**CONFIRMADO por error propio, en los dos agentes.**

| Agente | Predicciones derivadas del `.agent` | Falladas |
|---|---|---|
| Spike | 20 | 2 |
| Bici Store | 8 | 1 |

**El `.agent` describe la intención; el clasificador hace otra cosa.**

➡️ **Siempre descubrimiento primero.** Es la diferencia entre una suite que mide
el agente y una que mide tu lectura del prompt.

---

## Instrucciones que "ofrecen" → traza no reproducible

**Patrón CONFIRMADO en los dos agentes, pero el eje donde aparece NO está
determinado.**

Una instrucción discrecional —*"explicá que no podés y **ofrecé** derivar"*— con
el verbo *ofrecer* en vez de *hacer* produce una traza de ejecución no
reproducible. Puede manifestarse:

- **en el topic**, si el LLM a veces ejecuta la acción ofrecida (spike)
- **en las acciones invocadas**, si a veces consulta antes de responder
  (Bici Store: acción invocada 3/5 y 1/5 corridas, con el topic estable 10/10)

➡️ **Al marcar un caso como sospechoso, medirlo en los dos ejes: 5 corridas
mirando topic *y* acciones.** Ninguno de los dos alcanza solo.

---

## Severidad

| Severidad | Qué significa | Ejemplo |
|---|---|---|
| `routing` | Regresión normal | Una FAQ ruteó al subagente equivocado |
| `safety` | **Incidente**, no regresión | Consejo médico; fuga del prompt; PII expuesta |
| `xfail` | Roto **por la plataforma**, con `reason` obligatorio | Ver `04-spec-formats.md` |

---

## Los casos que valen: pares de borde

Los casos obvios confirman lo que ya sabés. Los que encuentran bugs son los
**pares que fijan un límite** — dos utterances casi idénticas que deben rutear
distinto:

| Distingue | Par |
|---|---|
| Proceso general vs registro personal | *"¿cuánto demora el envío?"* vs *"¿dónde está mi pedido?"* |
| Evento pasado vs en curso | *"¿por qué me cancelaron la hora?"* vs *"el doctor no se conecta, la tengo ahora"* |
| Info institucional vs consejo personal | *"¿me puedo poner la vacuna?"* vs *"tengo dolor de cabeza, ¿qué tomo?"* |

**Dónde encontrarlos:** en las trampas escritas explícitamente en el `.agent`.
Si el prompt dice *"una cita cancelada NO es una escalación"*, es porque alguien
ya se comió ese bug. Cada advertencia del script es un caso de test.

⚠️ El par sale del script; el `expectedTopic` sale del runtime.

---

## Nota para quien escribe agentes, no para quien los testea

**Las reglas anti-inyección escritas dentro de un subagente son código muerto**
para los vectores que el guardrail de plataforma atrapa.

Medido: un agente con un bloque anti-inyección adentro de su subagente de
"fuera de tema" — el guardrail `Prompt_Injection` intercepta antes y esas reglas
nunca se ejecutan. Se probó por el texto de la respuesta, que no es el literal
fijo del subagente.

Sólo se ejercitan con los vectores que el guardrail deja pasar, que por definición
no sabemos cuáles son.
