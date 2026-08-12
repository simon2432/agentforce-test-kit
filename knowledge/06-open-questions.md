# Preguntas abiertas

Lo que quedó **NO DETERMINADO** o **INFERIDO**. No construir encima sin cerrarlo.

## ⚠️ Regla para escribir en este archivo

**Una pregunta abierta tiene que nombrar artefactos verificados.**

Si el candidato es *"falta declarar X en Y"*, **hay que haber visto Y**. Si no, la
pregunta se escribe **sin candidato** — es más honesto y más barato.

Esto no es teórico: la versión anterior de este archivo daba como candidato
principal *"falta declararlas en `globalConfiguration.contextVariables` del
bundle"*. **Ese artefacto no existe** — ni en el `.agent` fuente, ni en el
compilado, ni en el planner bundle, en ninguno de los dos agentes medidos.
Una hipótesis apuntando a un nombre inventado costó media fase antes de que se
descubriera.

---

## 🚨 Los tres riesgos que hay que leer primero

**1. La capacidad más valiosa depende de un comando BETA sin segunda fuente.**
Assertar contenido y estado —el hallazgo más grande del repo— **sólo funciona en
`run-eval`**. CONFIRMADO en la ronda 3: en `test run` las refs crudas devuelven el
template literal. El help de `run-eval` dice *"any aspect of this command can
change without advanced notice"*. **No está mitigado: sólo documentado.**

**2. La hipótesis del canal es INFERIDO, no confirmado.** Ver B6 abajo. Es la
mejor explicación que tenemos de por qué `contextVariables` no llega, y explica
todo lo observado — pero **cerrarla requiere una sesión de canal real**, que
ningún motor de test materializa.

**3. Todo se probó contra agentes Agent Script, del mismo tipo y el mismo
template.** Tres agentes, tres orgs, pero los tres `EinsteinServiceAgent` sobre
`SvcCopilotTmpl__AgentforceServiceAgent`. **Nada de lo de acá está verificado
fuera de esa combinación.**

---

## NO DETERMINADO

| # | Pregunta | Impacto | Cómo cerrarla |
|---|---|---|---|
| **C11** | **¿Por qué `contextVariables` no llega al runtime?** El candidato de la declaración **CAYÓ**: dos variables **declaradas** en `bot-meta.xml`, con sus 8 mappings de canal, tampoco llegan. Descartados también: el nombre `globalConfiguration` (no existe) y la nomenclatura (`$Context.` o sin él, mismo resultado) | **Alto** — hoy la técnica está **fuera** del `knowledge/` | Ver B6: el candidato que queda es el **canal**. Cerrarla requiere una sesión de mensajería real, que ningún motor de test materializa |
| **C13** | **¿Se va a validar el mapa de rutas contra una whitelist?** Hoy es un `?? path` no declarado | **Alto** — es la dependencia más frágil del enfoque. Y desde la ronda 3 sabemos que **no hay segunda fuente**: si se cierra, no queda ningún camino | Vigilar el plugin en cada corrida (D22). Verificado intacto en 1.42.0, 1.44.5 y 1.45.0 |
| **C14** | **¿Qué otras orgs no tienen Testing Center?** 1 de 3 medidas no lo tenía | Medio — define si `test run` puede ser parte de un flujo estándar o es opcional por org | Relevar las orgs del equipo |
| **C15** | **¿Por qué `actual_value` y `lastExecution.topic` reportan literales distintos en la misma corrida?** (`human__` vs `__human__`) | Medio — obliga a `contains` y a documentar de qué campo se lee | Soporte de Salesforce |
| **C16** | **¿`test run` colapsa TODAS las aserciones con el mismo nombre, o sólo las custom?** Medido: 5 `string_comparison` → 1 devuelta | Alto — es el 4º mecanismo de D3 y el único sin rastro | Correr 3 `numeric_comparison` y 3 `string_comparison` en un mismo caso |
| **C17** | **¿El cuelgue de 18-22 min de `test run` tiene otras causas además del nombre de context variable no declarado?** | Medio — la causa identificada es evitable; el resto no | Correr la suite que colgó, con nombres válidos, N veces |
| ~~C1~~ | ~~¿Por qué existen tres literales de escalación?~~ **REFORMULADA** → la causa no es el motor sino el **campo**. Ver C15 y `02`, D8 | — | — |
| ~~C12~~ | ~~¿El passthrough existe en `test run`?~~ **CERRADA: NO.** Ronda 3, 5 refs crudas, todas devolvieron el template literal | — | — |
| C2 | **¿Cuál es la lista completa de topics de plataforma?** Sólo observamos `Prompt_Injection` y los de humano | Alto — un topic desconocido rompe un test sin que el agente falle | Doc de guardrails de Agentforce |
| C3 | **Causa raíz de los `Agent call failed` de Testing Center** (1,7 %, cuelgue de ~22 min, `errorCode: 0` sin stack) | Medio — obliga a timeout y retry ciegos | Soporte, con el Job Id de una corrida afectada |
| C4 | **¿Cuánto retiene la org los resultados por job id?** | Medio — define si el archivado propio es respaldo o única copia | Doc, o prueba longitudinal |
| C5 | **Threshold exacto de `coherence`/`completeness`** | Bajo — no se usan como gate igual | Doc de Salesforce |
| C6 | **¿`test run` respeta `subjectVersion`?** (`run-eval` lo ignora, confirmado) | Medio — si lo respeta, es una ventaja real del motor GA | Spec con `subjectVersion` + `test create` + `run` |
| C7 | **¿Qué hace el Apex invocable dentro de los flows de acción?** | Depende del agente | Retrieve de la `ApexClass` |
| C8 | ~~**¿Se puede assertar sobre el trace del `preview`?**~~ **La necesidad que la motivaba está resuelta por otra vía**: las transiciones internas se asertan desde `executionHistory` de `run-eval`, sin `preview` ni bundle local. La pregunta original sigue abierta pero ya no bloquea nada | Bajo | — |
| C9 | **¿Cuál es el techo de concurrencia de `run-eval`?** 20 pasó sin degradación; el límite no se buscó | Medio — define el tamaño máximo de suite | Probar 50 y 100 casos con `--batch-size 1` |
| C10 | **¿El resultado de un test de escalación depende del horario?** Sólo observamos la rama dentro de horario | Alto para suites nightly | Correr un caso de escalación fuera de horario laboral |

---

## INFERIDO — necesitan advertencia al usarlos

| # | Afirmación | Por qué no está confirmada |
|---|---|---|
| **B6** | 🚨 **Las 7 `contextVariables` no son seteables: son DERIVADAS DEL CANAL.** El runtime valida el nombre —por eso uno no declarado revienta con `"Agent call failed"`— y **descarta el valor** —porque la variable no se setea, se calcula—. Sin una sesión de canal real no hay origen del cual poblarlas, y por eso llegan `null`. El cliente las manda porque la API acepta el campo; el runtime las ignora porque las deriva | **Es el INFERIDO principal.** Explica las tres cosas que ninguna otra hipótesis explica junta: la simetría exacta (7 declaradas = 7 `linked` = 7 `null`), que lo declarado se acepte sin tomar valor, y que lo no declarado dé error duro. **Pero es razonamiento sobre el servidor, no observación.** Cerrarlo requiere una sesión de canal real |
| B7 | Alternativa menor a B6: es **deliberado** — el runtime de evaluación ignora `context_variables` por diseño | Sería la explicación más simple, pero no explica por qué valida los nombres |
| B8 | Alternativa menor a B6: depende del **tipo de agente** | Los tres agentes medidos son `EinsteinServiceAgent` con el mismo template. Sin contraste |
| ~~B1~~ | ~~`test run` honra `contextVariables` en runtime~~ | **CERRADA: NO.** El XML los lleva y el runtime no los aplica. Y con un nombre no declarado, **falla la corrida entera** |
| ~~B2~~ | ~~El export de Testing Center sirve como evidencia~~ | **CERRADA: NO, sin curar.** Invierte el veredicto en los casos de seguridad. Ver `02` D21 y `05` |
| B3 | Una escalación fuera de horario reportaría el nombre del subagente | Sólo observamos la rama dentro de horario. **Reforzado indirectamente**: cuando la escalación falló por otro motivo, el topic **sí** fue `escalation` |
| B4 | El threshold de las métricas es 3 | Observado 4-5 → PASS, 0-2 → FAILURE, en dos rondas. El valor no se expone |
| B5 | El límite de concurrencia de `run-eval` es > 20 | 20 pasó sin degradación; el techo no se buscó |

---

## Nunca verificado

- **La UI de Testing Center.** El **contenido** del export está CONFIRMADO (se leyó
  del endpoint que la UI usa), pero **la UI misma nunca se abrió**: el CSV no se
  puede exportar por CLI. Lo que sigue abierto es si un auditor real acepta el
  reporte curado.
- **Otros tipos de agente.** Los tres son `EinsteinServiceAgent` sobre
  `SvcCopilotTmpl__AgentforceServiceAgent`, sobre Messaging. Un Employee Agent o
  un agente custom puede tener otro vocabulario de context variables y otro
  comportamiento de escalación. **Es la limitación de alcance más grande que
  queda.**

  ⚠️ **No confundir con el eje de Agent Script.** Son independientes:
  `agentDSLEnabled` dice cómo está escrito el agente; `type` dice qué clase de
  agente es. **Un Employee Agent puede ser Agent Script.** Que el repo sea sólo
  para Agent Script no cierra este hueco.

  ~~**Agentes clásicos** (sin Agent Script)~~ — **fuera de alcance por decisión
  desde 2026-08-12.** El repo es sólo para Agent Script. Ya no se lista como
  limitación pendiente: no es algo que falte medir, es algo que no se va a
  soportar.
- **Una org de producción de verdad.** Tres sandboxes. La tercera tenía datos y
  flows reales, que es lo más cerca que estuvimos — pero sigue siendo sandbox.
- **La rama de escalación fuera de horario.** Todo se midió dentro de horario
  laboral. El resultado de un test de escalación **depende de la hora a la que
  corras**, y esa mitad nunca se observó.

---

## Cómo mantener este archivo

Cuando algo de acá se cierre, moverlo al archivo que corresponda con la marca
**CONFIRMADO** y la evidencia. Cuando aparezca una pregunta nueva, agregarla acá
antes de olvidarla.

La utilidad de todo el `knowledge/` depende de que la distinción
CONFIRMADO / INFERIDO / NO DETERMINADO se mantenga honesta. En el spike, dos
conclusiones "obvias" resultaron falsas al medirlas — una era mía sobre el DML de
los flows, otra sobre los tiempos relativos de los motores, corregida dos veces.
