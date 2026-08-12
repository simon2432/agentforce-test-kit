# Índice del conocimiento

Base destilada de **tres rondas** de investigación empírica sobre agentes
Agentforce:

| Ronda | Sujeto | Ejecuciones |
|---|---|---|
| **Spike** (2026-08-04/05) | Agente real de un cliente, Agent Script, sandbox | ~150 |
| **Validación** (2026-08-05) | `Bici Store`, fixture construido a propósito, otra org | ~180 |
| **Producto** (2026-08-06) | Agente de cliente **en versión final**, con flows que **escriben de verdad**, tercera org | 101 |

La segunda ronda convirtió cada hallazgo de la primera en una **predicción
falsable** y las midió todas.

**La tercera fue la primera vez que el repo se usó como producto y no como
laboratorio**, y es la que más corrigió: cerró los dos riesgos que estaban
abiertos (los dos dieron el resultado malo), tiró abajo una hipótesis principal,
re-atribuyó dos defectos mal explicados, y encontró **6 defectos nuevos de la
plataforma más 3 bugs en las utilidades del propio repo**.

Evidencia cruda: `SPIKE-NOTES.md` del repo anterior (2.576 líneas),
`evidencia/ronda-2-bici-store.md` (2.580 líneas) y
`evidencia/ronda-3-alemana.md`.

---

## Cómo leer esto

Cada afirmación lleva un nivel de confianza:

| Marca | Significa |
|---|---|
| **CONFIRMADO** | Medido u observado directamente. Se puede codificar como regla |
| **INFERIDO** | Razonado a partir de evidencia, pero no observado. Requiere advertencia |
| **NO DETERMINADO** | Abierto. No construir encima |

### ⚠️ "Confirmado por código" no es un nivel

Leer el código del plugin instalado es evidencia **sólo para un lado del cable**:

| La afirmación es sobre… | Leer el código es… | Ejemplo |
|---|---|---|
| **El cliente** — qué manda la CLI, cómo mapea campos, cómo calcula el exit code | **evidencia suficiente** → CONFIRMADO | El exit code sólo mira `summary.errors`; el SOQL de resolución de versión |
| **El servidor** — si el runtime lo honra | **INFERIDO**, nunca CONFIRMADO | `contextVariables`: el cliente arma el payload perfectamente y **el runtime lo ignora** |

Esto no es teórico. Una fila del `knowledge/` estaba marcada "confirmado por
código" sobre una afirmación de servidor, y **fue exactamente la que falló al
medirla**. El código estaba bien leído; la conclusión era falsa.

La ronda 3 lo confirmó por segunda vez, en los dos motores a la vez: el cliente
arma el payload de `contextVariables` perfectamente —verificado en el código de
`run-eval` y en el XML de `test run`— y **el runtime lo descarta igual**.

### ⚠️ Y una verificación de código VENCE

La CLI se auto-actualizó a mitad de la ronda 3 —`plugin-agent` 1.44.5 → 1.45.0—
sin aviso, y se descubrió por accidente. Todo lo marcado "confirmado por código
del cliente" está medido contra un código que puede cambiar abajo tuyo.

➡️ **Registrar la versión de CLI y del plugin en cada corrida, junto al
`bot_version_id`, y re-verificar los anclajes al cierre de cada sesión.** Un
resultado sin las dos versiones no es auditable. Ver `02`, D22.

### ⚠️ Una pregunta abierta tiene que nombrar artefactos verificados

Si el candidato es *"falta declarar X en Y"*, **hay que haber visto Y**. Si no, la
pregunta se escribe sin candidato.

Costó media fase de la ronda 3: el candidato principal apuntaba a
`globalConfiguration.contextVariables`, **un artefacto que no existe en ningún
agente**. Ver `06`.

### La documentación oficial no es fuente

La documentación de Salesforce y el comportamiento real de sus herramientas
**divergen de forma significativa**. El comando central de este repo no aparece
en la documentación indexada. Varios hallazgos salieron de leer el código fuente.
Regla general: verificar antes de confiar.

---

## Los archivos

| Archivo | Cuándo leerlo |
|---|---|
| `01-engines.md` | Antes de elegir con qué correr algo |
| `02-known-issues.md` | **Antes de escribir cualquier automatización.** Los defectos |
| `03-assertions.md` | Antes de escribir un caso. Qué se puede y qué no assertar |
| `04-spec-formats.md` | Al escribir specs o tocar los adaptadores de motor |
| `05-safety.md` | Antes de correr contra una org que no sea descartable |
| `06-open-questions.md` | Cuando algo no cierre y no esté acá |

---

## Los ocho hallazgos que más pesan

1. **Podés estar testeando una versión que ningún usuario alcanza, sin que nada
   falle.** Los dos endpoints no coinciden sobre qué versión servir. Medido en
   cuatro estados. → `02`, D1

2. 🚨 **`test run` no puede decir contra qué versión corrió — por ningún camino.**
   Ni el JSON, ni el `AiEvaluationDefinition`, ni el export. **La regla 1 sólo se
   puede cumplir con el comando BETA.** → `02`, D1

3. **La estabilidad del ruteo no es estabilidad de comportamiento.** 127
   observaciones sin una variación de topic, sobre un agente que demostrablemente
   no ejecutó lo mismo en todas las corridas. Una suite que sólo asserta el topic
   reporta eso como perfecto. → `03`

4. **El contenido de una acción determinista SÍ se asserta**, con igualdad exacta
   y de forma nativa — **pero sólo en `run-eval`, que es BETA. No hay segunda
   fuente.** Es el riesgo estructural más serio del enfoque. → `03`

5. **Una aserción puede no ejecutarse sin que se vea en los veredictos.** **Cuatro**
   mecanismos distintos observados, y el cuarto no deja ningún rastro. De ahí sale
   el requisito de censo. → `02`, D3

6. **El vocabulario de topics excede tus subagentes.** El runtime devuelve
   guardrails de plataforma y literales de escalación que no están en el `.agent`.
   → `03`

7. 🚨 **Las métricas de calidad premian romper los guardrails.** Le pusieron el
   peor puntaje de la suite al caso en que el agente se negó a recomendar un
   medicamento, y penalizaron al agente por no filtrar su system prompt. **El
   sesgo escala con lo bien protegido que esté el agente.** → `01`

8. **Testear es seguro por una razón estructural, no por suerte** — las variables
   `linked` llegan NULL, observado, y ahora también en una org cuyos flows
   escriben de verdad — y hay exactamente un modo de romperlo. → `05`
