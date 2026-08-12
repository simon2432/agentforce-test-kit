# Defectos conocidos de la plataforma

**23 defectos, ninguno documentado por Salesforce.** Cinco pueden producir un
pipeline en verde con la suite en rojo. Dos pueden producir lo contrario.

Tres patrones recorren la lista:

- **Los datos están bien, la comparación está mal.** De ahí el workaround
  general: usar los comandos como motores de ejecución y assertar por afuera.
- **Lo que falta no se ve.** Varios defectos hacen que algo no se ejecute sin que
  aparezca en ningún lado que el lector mire.
- **Creés estar mirando una cosa y estás mirando otra.** La versión del agente
  (D1), la versión del bundle local (D18), la versión de la herramienta (D22), el
  campo del que leés el literal (D8). Cuatro defectos con la misma forma.

---

## Índice por número

⚠️ **Los defectos están agrupados por gravedad, no por número.** D14–D17 son
menores y viven al final, después del D23. Este índice existe para buscar por
número sin depender del orden del archivo.

🚨 **Los números son identificadores estables. No se renumeran.** Están citados
188 veces en el repo, 123 de ellas en `evidencia/`, que es registro congelado:
renumerar dejaría la evidencia apuntando al defecto equivocado.

| | | | |
|---|---|---|---|
| **D1** versión que nadie alcanza | **D7** los motores comparan el topic distinto | **D13** `generate test-spec` interactivo | **D19** el mismo caso pasa en un motor y falla en otro |
| **D2** el exit code está invertido | **D8** el literal de escalación varía por campo | **D14** `run-eval` ignora `metrics` | **D20** `--preview` acepta specs que el servidor rechaza |
| **D3** una aserción puede no ejecutarse | **D9** `test run` exige Testing Center | **D15** `bot_response_rating` se inyecta solo | **D21** el export invierte el veredicto en seguridad |
| **D4** la trampa del `get_state` | **D10** `conversationHistory` incompatible | **D16** `run-eval` es efímero total | **D22** la CLI se auto-actualiza sola |
| **D5** `expectedActions: []` no asserta | **D11** `test run` cuelga 18-22 min | **D17** `--result-format json` ≠ `--json` | **D23** dos copias de la CLI en disco |
| **D6** `expectedActions` roto en `run-eval` | **D12** `test resume` sale 0 sin esperar | **D18** el bundle pierde el número de versión | |

`tests/punteros.test.mjs` verifica que toda cita `D<n>` en `lib/` exista acá y
apunte al defecto correcto.

---

## Críticos — dan verde con la suite rota

### D1. Podés estar testeando una versión que ningún usuario alcanza
**CONFIRMADO — medido en cuatro estados. El defecto más grave del catálogo.**

Los dos endpoints no coinciden sobre qué versión servir:

| | Cómo resuelve |
|---|---|
| **Evaluación** (`run-eval`) | `ORDER BY VersionNumber DESC LIMIT 1` — **sin filtrar por `Status`** |
| **Producción** (`preview --api-name`, y el canal real) | Sólo sirve la que está `Active` |

Medido montando el escenario exacto — v2 la más alta pero **inactiva**, v1 la
activa:

```
run-eval  →  bot_version_id = v2   exit 0   respuesta plausible
preview   →  sirve v1              exit 0   respuesta plausible
```

**Nada falla.** Los dos responden bien, al mismo tiempo, sirviendo versiones
distintas. La suite corre verde contra algo que ningún usuario puede alcanzar.

Y sin ninguna versión activa, la asimetría es aún más cruda: producción devuelve
`404 No valid version available` mientras evaluación responde normalmente.

**Workaround — y es la única defensa que existe:**
Leer `sessionContext.tags.bot_version_id` **de la corrida misma** y abortar si no
coincide con la versión activa. Una SOQL previa no alcanza: tiene ventana de
carrera, y es literalmente lo que nos pasó durante la validación.

📌 `subjectVersion` en el spec **se ignora en silencio** en `run-eval`. Creés que
fijaste versión y no fijaste nada.

#### 🚨 Limitación dura: `test run` no permite verificar la versión

**CONFIRMADO por búsqueda literal sobre el crudo, en tres artefactos distintos.**

| Vía | ¿Trae la versión? |
|---|---|
| JSON de `test run` | ❌ no expone `bot_version_id`, ni `sessionContext`, ni `tags` |
| El `AiEvaluationDefinition` que genera `test create` | ❌ no lleva `subjectVersion` |
| El export de Testing Center (endpoint `/results`) | ❌ no la trae en ninguna forma |

`generatedData` tiene exactamente seis claves: `actionsSequence`,
`generatedResponse`, `invokedActions`, `outcome`, `sessionId`, `topic`.

➡️ **Quien use `test run` como motor está ciego frente a D1: no puede saber si
midió la versión que sirve producción.** Y no es una limitación de la salida, es
estructural — las tres vías están cerradas.

**La ironía completa la regla:** el único motor donde la regla 1 del `CLAUDE.md`
es aplicable es el que está marcado BETA y puede cambiar sin aviso.

⚠️ **Trampa de diagnóstico:** buscar la cadena `sessionContext` en el crudo de
`test run` puede dar **positivo** — pero sólo porque devuelve refs crudas sin
resolver, que contienen esa palabra. Buscar `bot_version_id`, que sigue dando
negativo.

### D2. El exit code no está roto: está INVERTIDO
**En los DOS motores. CONFIRMADO. Reformulado en la ronda 3.**

```js
if (summary.errors > 0) { process.exitCode = 1; }
```

La formulación vieja —*"no refleja los fallos de aserción"*— se quedaba corta.
Medido:

| Corrida | Veredictos | Exit |
|---|---|---|
| 10 fallos de aserción, 0 evaluaciones ausentes | rojo de verdad | **0** |
| 8 pass, 1 fallo, **2 evaluaciones ausentes** | casi todo verde | **1** |

`errors` cuenta **evaluaciones que no corrieron**, no fallos de aserción.

➡️ **No es que ignore los fallos: mide lo que no importa.** Un CI que lo use da
**verde con el agente roto** y **rojo con un `expected` mal tipado**. Es
activamente engañoso en las dos direcciones — peor que inútil.

Y `summary.errors` dice **cuántas** faltaron, **nunca cuáles**. Recorrido completo
del JSON: cero campos con mensaje, id o explicación.

**Workaround:** `lib/assert.mjs` calcula el exit code propio. **Y el censo (D3) no
es una mejora: es la única forma de saber qué faltó.**

### D3. Una aserción puede no ejecutarse sin que se vea
**CUATRO mecanismos distintos ya observados. CONFIRMADO.**

| # | Mecanismo | Qué se ve en el reporte | ¿Deja rastro? |
|---|---|---|---|
| 1 | `expectedActions: []` en `run-eval` | **no se emite ninguna evaluación** | no |
| 2 | Ruta inexistente en `customEvaluations` | la evaluación **desaparece** de `evaluations[]` | sí — `summary.errors` |
| 3 | Falta `get_state` (D4) | corre contra un template **sin resolver** | sí — `actual_value` empieza con `{` |
| 4 | 🚨 **`test run` colapsa las aserciones repetidas** | 5 `string_comparison` declaradas → **1 devuelta** | **NO. Ninguno** |

El cuarto es el peor: en `run-eval` una evaluación que no corre al menos mueve
`summary.errors`; en `test run` **no mueve nada** — ni error, ni conteo, ni id.

**Workaround — censo de aserciones:** declarar N, verificar que corrieron N,
exit 1 si faltan. Es requisito de primera clase, no un fix puntual.

📌 Detector barato del mecanismo 3: si `actual_value` empieza con `{` y termina
con `}`, la referencia no resolvió.

#### ⚠️ Los cuatro estados de una evaluación — y el par indistinguible

| Estado | `actual_value` | Señal |
|---|---|---|
| **Resuelve** | el dato real | evaluación presente |
| **No resuelve** | el template literal `{gs.…}` | presente, `is_pass: false`, `COMPLETED`, **sin error** |
| **Rechazada** (ruta inexistente) | — | **la evaluación desaparece** |
| **Error de tipo** | — | **la evaluación desaparece** |

🚨 **"Rechazada" y "error de tipo" tienen la misma firma.** Sólo se distinguen
**controlando el tipo del valor**: si las rutas de string resuelven y sólo
desaparece la de booleano, fue coerción, no rechazo.

Sin ese control, un error de tipo se lee como ruta rechazada y **se concluye lo
contrario de lo que pasó.**

### D4. La trampa del `get_state`
**CONFIRMADO con control A/B.**

Un caso con **ref cruda** en `customEvaluations` y **sin `expectedTopic`** no
recibe el paso `agent.get_state`. La referencia nunca se resuelve y el motor
devuelve **el template literal** como valor real:

```
actual_value:    "{gs.response.planner_response.lastExecution.…}"
compute_status:  COMPLETED
error_message:   null
exit:            0
```

FAIL silencioso **indistinguible de una regresión real del agente**. Alguien va a
debuggear el agente durante horas por un problema del archivo de test.

Causa: `needsPlannerState()` sólo mira las 4 rutas del mapa conocido.

🚨 **Regla dura: toda ref cruda exige `expectedTopic` en el mismo caso.**

---

## Serios

### D5. `expectedActions: []` no asserta nada
**En los dos motores, pero con mecanismos distintos. CONFIRMADO.**

La semántica es de subconjunto: *"¿están las esperadas dentro de las reales?"*.
Con lista vacía la respuesta es trivialmente sí.

| Motor | Qué hace | Lectura del reporte |
|---|---|---|
| `test run` | Emite la evaluación y da **PASS score 1** | 🔴 **verde falso — y SUMA al conteo** |
| `run-eval` | **No emite ninguna evaluación** | 🟡 un hueco, no una mentira |

El de `run-eval` es menos engañoso: muestra que falta algo. El de `test run`
afirma que verificó cuando no verificó nada.

🚨 **Y es peor de lo que decía este archivo:** no sólo no asserta — **suma un PASS
al conteo**. Infla el verde, no sólo lo deja pasar. Medido:

```
actions_assertion  expected="[]"  actual="['AGENTFORCE_Business_Hours_Verifier']"  result=PASS  score=1
```

⚠️ **Y `test create` lo inyecta sin que se lo pidas.** Un spec sin ninguna
aserción de acciones sale con `action_sequence_match: []` en **todos** los casos.
O sea: el verde falso es el **default**, no algo que uno tenga que escribir.

➡️ No se puede assertar ausencia de acciones ni detectar acciones inesperadas.
**Y no cuenta como cobertura.** Una suite puede mostrar 20/20 verdes en la columna
de acciones sin haber verificado ni una.

### D6. `expectedActions` está roto en `run-eval`
**Falso negativo garantizado. CONFIRMADO con par de control.**

`expected` es una lista de strings; `actual` es un array anidado de objetos.

Medido con el par alias/target: **el caso con el nombre demostrablemente correcto
falla igual** — `expected=["consultar_faq"]` contra un `actual_value` que
contiene `function.name = "consultar_faq"` adentro.

Causa raíz: la API expone **dos** representaciones — `actionsSequence` (lista
plana) e `invokedActions` (objetos anidados). `test run` compara contra la
primera y funciona; `run-eval` contra la segunda y falla siempre.

⚠️ El síntoma documentado (`"Expected … but got [object Object]"`) **no es
confiable**: en la validación `error_message` vino `null` en los cuatro casos.
Lo confirmado es el fallo, no el mensaje.

### D7. Los dos motores comparan el topic distinto
**CONFIRMADO.**

| | Operador | `expectedTopic: Fa` vs real `Faq` |
|---|---|---|
| `run-eval` | `contains` | ✅ PASS — falso positivo |
| `test run` | igualdad exacta | ❌ FAILURE |

El mismo spec da veredictos opuestos.

**Workaround:** modo de comparación explícito por caso. **No forzar exacto
siempre** — ver D8.

### D8. El literal de escalación varía — pero no por el motor: **por el campo**
**CONFIRMADO. Re-atribuido en la ronda 3: la causa vieja era incorrecta.**

La formulación anterior decía *"tres literales según el motor"*. Es falso. Lo
medido, **en la misma corrida y el mismo caso**:

```
evaluations[].actual_value  = "human__"
lastExecution.topic         = "__human__"
```

| Corrida | `expected` | `evaluations[].actual_value` | `lastExecution.topic` |
|---|---|---|---|
| descubrimiento (×2) | `__DISCOVERY__` | `__human__` | `__human__` |
| control positivo | `human` | **`human__`** | `__human__` |
| `test run` | `human` | `human` | `human` |

`lastExecution.topic` fue `__human__` en las **5** observaciones de `run-eval`.
El que se mueve es `actual_value`, el campo del **evaluador**.

➡️ **Campos distintos de la misma respuesta reportan literales distintos.** De ahí
salió el `human__` del spike: de leer el campo del evaluador en vez del del
runtime. **Por qué se mueve: NO DETERMINADO.**

📌 **`lib/extract.mjs` lee `lastExecution.topic`** — es la elección correcta (es el
dato del runtime, no el del evaluador), pero hay que saber que **está eligiendo**:
quien compare contra `actual_value` va a ver otra cosa y no va a entender por qué.

**Workaround:** assertar `human` con `match: contains`.

#### ⚠️ Y la portabilidad de `human` es CONTINGENTE, no estructural

Corrido como regla por primera vez en la ronda 3, un control positivo por motor:

| Motor | `expected` | `actual` | Operador | |
|---|---|---|---|---|
| `run-eval` | `human` | `human__` | `contains` | ✅ `is_pass: true` |
| `test run` | `human` | `human` | **igualdad exacta** | ✅ `result: PASS` |

**Pasan por motivos distintos.** En `run-eval` por la laxitud del operador; en
`test run` porque ese motor devuelve el literal corto y compara **exacto**.

🚨 **El día que `test run` devuelva `__human__`, la regla se rompe ahí y no existe
ningún `expectedTopic` que sirva para los dos motores.** No es una regla robusta:
es una coincidencia que hoy funciona.

📌 Y esto **no depende de la infraestructura de routing**: se replicó en una org
**sin ninguna cola de Omni-Channel**, y también en una **con** colas reales. El
literal lo emite el planner al resolver la intención, no el routing al concretar
la transferencia. Se puede assertar escalación en cualquier org.

### D9. `test run` requiere Testing Center habilitado
**CONFIRMADO.**

```
DeploymentFailed: AiEvaluationDefinition — "Not available for deploy for this organization"
```

Rechazo del servidor a nivel Metadata API, no del spec ni de la CLI. En una de las
dos orgs donde probamos, no estaba.

**Consecuencias estratégicas:**
- `run-eval` gana **por portabilidad**, no sólo por velocidad
- *"Si `run-eval` rompe, migramos a `test run`"* **no es un plan B** en orgs como
  ésta. El plan B real es el wrapper sobre la salida cruda, que es independiente
  del motor
- El preflight necesita **detección de capacidades**: enterarse con un
  `DeploymentFailed` a mitad de corrida es la peor forma

### D10. `conversationHistory` es incompatible entre motores
**CONFIRMADO.** Un spec multi-turno **no es portable**.

- `run-eval` descarta `role: agent` y **ejecuta** los turnos de usuario
- `test run` los **exige** alternados terminando en agent, y rechaza el deploy
  si no

Y no significan lo mismo: uno ejecuta la conversación real, el otro inyecta
ficción escrita a mano. Ver `01-engines.md`.

### D11. `test run` cuelga 18-22 minutos — y tiene un disparador identificado
**CONFIRMADO. Tasa 1,7 % (1/60) y 20 % (1/5) en la ronda 3.**

Un caso colgado se comió 1303 s de un job de 1306 s; los otros 19 terminaron en
≤206 s. **El wall time ≈ el timeout del caso colgado**, sin relación con el
tamaño de la suite.

El error crudo es inútil: `errorMessage: "Agent call failed"`, `errorCode: 0`,
sin stack, sin categoría.

🚩 **La ronda 3 le encontró una causa reproducible.** Este archivo lo describía
como *"un fallo transitorio"*. No siempre lo es:

> **Un nombre no declarado en `contextVariables` produce el cuelgue de forma
> determinista.** 2 de 2 casos con `surveyStage` (que es una state variable, no una
> context variable) dieron `status: ERROR` / `"Agent call failed"` y consumieron
> los 18 minutos completos. Los 3 casos de la misma corrida con nombres declarados
> terminaron en 15-17 s.

➡️ **No prueba que sea la única causa, pero convierte una parte de ese 1,7 % en
algo evitable:** validar los nombres de `context` contra las variables declaradas
del agente **antes** de mandar. Ver `05`, la lista de `Bot.contextVariables`.

**Workaround:** validar nombres antes de mandar, timeout propio (~3 min) y
reintentos ciegos, máximo 2.

### D12. `test resume` devuelve exit 0 sin esperar y sin resultados
**CONFIRMADO.** Salió con éxito a los 3,3 s con el job todavía corriendo y sin
escribir el archivo de salida.

**Workaround:** lanzar sin `--wait`, guardar el `runId`, polling propio con
`test results --job-id`. Nunca `resume`.

### D13. `generate test-spec` interactivo genera specs rotos
**CONFIRMADO por código + runtime.**

```js
const expectedTopic = await select({ choices: Object.keys(genAiPlugins) });
```

`genAiPlugins` sale de `<genAiPluginName>` del planner bundle — los nombres
**compilados**. El runtime devuelve el limpio. Falla en los dos motores.

**La herramienta oficial de generación produce tests rotos.** Sólo sirve como
conversor con `--from-definition`, que sí es lossless.

### D18. El authoring bundle pierde el número de versión al retraerse
**CONFIRMADO. Es un primo local de D1.**

```
sf project retrieve start --metadata AiAuthoringBundle:MiAgente_29
→ aterriza en aiAuthoringBundles/MiAgente/     ← SIN el _29
```

La única prueba de qué versión es está adentro:

```xml
<target>MiAgente.v29</target>
```

Dos consecuencias medidas:

1. **Retraer otra versión sobrescribe la misma carpeta**, sin conflicto ni aviso.
   Quedás con el `.agent` de v27 en un árbol que parece decir v29 — y
   `validate authoring-bundle` o `preview` corren contra eso.
2. **`--api-name` usa el nombre de la CARPETA LOCAL, no el de la org.**
   `--api-name MiAgente_29` no encuentra nada; `--api-name MiAgente` sí. Son dos
   espacios de nombres homónimos.

🚨 **Workaround: verificar `<target>` del `.bundle-meta.xml` antes de confiar en
un bundle local.** El nombre de la carpeta no es evidencia.

### D19. El mismo archivo de casos funciona en un motor y falla en el otro
**CONFIRMADO.**

El `<description>` del `AiEvaluationDefinition` tiene límite de tamaño en la org.
Con una descripción larga:

```
sf agent test create → SfError: "Evaluation Type: data value too large: …"  exit 1
sf agent test run-eval → funciona: ni emite el campo
```

➡️ **Es un defecto de portabilidad del formato de spec**, no del generador. Un
spec válido para un motor puede ser indesplegable en el otro por un campo que el
primero ni mira.

### D20. `--preview` acepta specs que el servidor rechaza
**CONFIRMADO con control A/B.**

Un spec multi-turno con **sólo** turnos `user`:

| Paso | Resultado |
|---|---|
| `test create --preview` | ✅ **exit 0**, XML generado con `<conversationHistory><role>user</role>…` |
| `test create` (deploy real) | ❌ **exit 1** — *"Conversation order is incorrect there should be 1 user and 1 agent elements alternating…"* |

➡️ **`--preview` NO es una validación completa.** Valida la traducción a XML, no
la validez del contenido. Sirve para **ver qué aserciones va a ejercer `test run`**
—incluidas las que inyecta sin pedirlas— pero **no** para saber si el spec es
desplegable.

✅ Lo bueno: el rechazo del deploy es claro, específico y con exit 1 correcto. Es
el único punto del kit donde la plataforma falla bien.

### D21. El export de Testing Center invierte el veredicto en los casos de seguridad
**CONFIRMADO. El defecto más peligroso para presentar resultados.**

Las métricas traen umbral: **score ≥ 3 → `PASS`, ≤ 2 → `FAILURE`**. Combinado con
el sesgo de `01`:

| Caso | Qué hizo el agente | Cómo figura en el export |
|---|---|---|
| Pedido de medicación | **se negó a recomendar** | `coherence` **FAILURE** · `completeness` **FAILURE** |
| Fuga de prompt | **no filtró su system prompt** | `completeness` **FAILURE** — *"does not provide the requested system prompt"* |
| Consulta fuera de alcance | **la rechazó** | `coherence` **FAILURE** · `completeness` **FAILURE** |

➡️ **No es que el export sea incompleto: invierte el veredicto justo donde el
veredicto más importa.** Un cliente que lea esa planilla sin contexto concluye que
su agente falla en seguridad. Pasó.

Y dos limitaciones más del export:

- **No trae la versión del agente** (ver D1) — tercera vía cerrada
- **`metricExplainability` viene vacío en TODAS las aserciones**
  (`topic_assertion`, `actions_assertion`, `output_validation`). Sólo lo traen
  `coherence` y `completeness`. ➡️ **Un export de una corrida sin `metrics:` no
  tiene ni una sola explicación.**

🚨 **Regla: el export es materia prima, no evidencia.** Ver el reporte curado en
`lib/report.mjs`.

📌 **Y no se exporta por CLI.** `sf agent test results` sólo ofrece
`json|human|junit|tap`; la cadena `csv` no aparece en la librería. El CSV es un
botón de la UI. La única vía programática es el endpoint del que la UI lo genera:

```
GET /services/data/v<API>/einstein/ai-evaluations/runs/{jobId}/results
```

⚠️ Con `sf api request rest` hay que poner el prefijo `/services/data/v67.0`
completo. Sin él devuelve **una página HTML** de *"URL No Longer Exists"* — jsforce
lo agrega solo, el comando no.

### D22. La CLI se auto-actualiza a mitad de sesión
**CONFIRMADO. Detectado por accidente, en un stack trace.**

Durante la ronda 3 la CLI saltó de **2.144.6 / plugin-agent 1.44.5** a
**2.146.3 / 1.45.0** entre dos fases, sin aviso. `SF_AUTOUPDATE_DISABLE=true`
seteado **por invocación no lo impidió**.

**Por qué importa:** todo defecto marcado *"confirmado por código del cliente"*
—el exit code, la resolución de versión, el passthrough de `customEvaluations`—
está medido contra un código que **puede cambiar abajo tuyo**. Si los anclajes
hubieran cambiado, se habría atribuido un resultado al servidor cuando la causa
era el cliente.

Es **el mismo error que D1, un nivel arriba**: nos aseguramos de saber qué versión
del *agente* medimos, y no estábamos registrando qué versión de la *herramienta*
produjo el resultado.

**Dos reglas:**

1. **Registrar la versión de CLI y del plugin en cada corrida**, junto al
   `bot_version_id`. Un resultado sin las dos versiones no es auditable
2. **Toda verificación de código vence.** Re-hacerla al cierre de cada sesión, no
   sólo al principio

⚠️ Y fijar `SF_AUTOUPDATE_DISABLE` **a nivel de entorno**, no por comando. O clavar
la versión.

### D23. Hay dos copias de la CLI en disco, con versiones distintas
**CONFIRMADO.**

| Ruta | Versión | ¿Corre? |
|---|---|---|
| `C:\Program Files\sf\client\node_modules\…` | 1.42.0 | ❌ instalador original, queda obsoleta |
| `%LOCALAPPDATA%\sf\client\<build>\node_modules\…` | 1.45.0 | ✅ **es la que corre** |

El auto-update deja la vieja en su lugar, **y la vieja está en la ruta obvia**.

➡️ **Verificar sobre la copia equivocada da la respuesta equivocada.** El chequeo
correcto es contrastar la versión del archivo contra `sf plugins --core`.

---

## Menores

### D14. `run-eval` ignora `metrics` en silencio
Ni error ni warning. `translateTestCase` nunca lee `testCase.metrics`.

⚠️ Pero **sí traduce `expectedOutcome`** a `bot_response_rating`. O sea:
`run-eval` no está privado de juicio de LLM — tiene uno por otra puerta, sin
explicación pero con veredicto.

### D15. `bot_response_rating` se inyecta solo en `test run`
`test create` lo agrega aunque el spec no lo pida. Sin `expectedOutcome`, **cada
caso** arrastra `Outcome Test Result Status: ERROR` con *"Skip metric result due
to missing expected input"* — aun con `Run Status: Completed`. Observado 20/20.

🚨 **El riesgo: un parser que busque la cadena `ERROR` marca la suite entera como
fallida** cuando ejecutó perfecto. Distinguir `Run Status` (ejecución) de los
resultados de métricas.

### D16. `run-eval` es efímero total y no tiene `--output-dir`
Cero archivos, nada en `trace list`, ningún registro consultable. **Si no se
captura stdout, la corrida se pierde.**

`test run` sí tiene red: `test results --job-id` recuperó un job de 22 horas
antes, byte-idéntico.

⚠️ Y `test run --verbose` sin `--output-dir` escupió **7,9 millones de
caracteres** de spinner a terminal.

### D17. `--result-format json` y `--json` producen formatos distintos
**CONFIRMADO.**

| | `--result-format json` | `--json` |
|---|---|---|
| Primer nivel | `{ results: [...] }` | `{ status, result, warnings }` |
| Array de evals | `evaluation_results` | `evaluations` |
| `summary` | ausente | presente |
| stdout parseable | **no** (preámbulo antes del JSON) | sí |

**El repo usa `--json`.** El otro produce un stdout que no es JSON válido.

---

## Ambientales

### `sf agent list` no existe
Verificar versiones con SOQL sobre `BotVersion`.

### En Git Bash, `sf` siempre devuelve exit 1
Incluso `sf --version`. Verificado con controles (`true` y `node` dan 0 en el
mismo shell). **En Windows: PowerShell.**

### En PowerShell, `2>&1` rompe todo parseo de JSON
El warning de update de la CLI va a **stderr**. Con `2>&1` se mezcla en el stdout
y `ConvertFrom-Json` falla con `Unexpected character encountered while parsing
value: »`.

```powershell
sf ... --json 2>&1 | ConvertFrom-Json    # ❌ rompe
sf ... --json 2>$null | ConvertFrom-Json # ✅
```

El `README` insiste con `--json` pero no menciona esto, y el síntoma no se parece
en nada a la causa.

### `sf project retrieve start` sin `--json` emite ~156 KB de spinner ANSI
Inutilizable si se captura la salida. Siempre `--json`.

### El help de `test results` documenta un flag que no existe
`--use-most-recent` aparece en DESCRIPTION y EXAMPLES pero no en USAGE ni FLAGS.

### `sf agent --help` sale con exit code 1
Ruido de oclif. Importa si se encadena con `set -e`.
