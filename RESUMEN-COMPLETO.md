# Testing de agentes Agentforce — informe completo

Investigación empírica sobre cómo testear agentes de Agentforce, y el repositorio
que salió de ella.

**Tres rondas · ~430 ejecuciones de prueba · 3 agentes · 3 organizaciones ·
23 defectos de plataforma · 0 registros de negocio alterados.**

Escrito para leerse sin haber estado ahí. Las secciones 3 a 6 son las técnicas;
si sólo tenés diez minutos, leé la 1, la 2 y la 11.

---

## 1 · El punto de partida y lo que resultó

Queríamos un repositorio reutilizable para testear agentes: apuntarlo a cualquier
agente y tener una batería corriendo. La idea era leer la documentación de
Salesforce, seguir los pasos, armarlo.

**No fue eso.** El comando central que terminamos usando no aparece en la
documentación indexada. Varios hallazgos salieron de leer el código fuente del
plugin instalado. Y de las herramientas oficiales, tal como vienen, **cinco
defectos distintos producen un resultado verde con la batería en rojo.**

Lo que armamos terminó siendo dos cosas: una base de conocimiento con 23 defectos
medidos y sus workarounds, y un conjunto chico de utilidades que corrigen lo que
la plataforma hace mal.

---

## 2 · Método — tres rondas, cada una con un propósito distinto

| Ronda | Sujeto | Ejecuciones | Propósito |
|---|---|---|---|
| **1 · Spike** | Agente real de cliente, sandbox | ~150 | Descubrir cómo se comportan las herramientas |
| **2 · Validación** | `Bici Store`, fixture construido a propósito, org de trial | ~180 | Falsar cada hallazgo de la ronda 1 |
| **3 · Producto** | Agente de cliente en versión final, org con datos reales | 101 | Usar el repo como producto y cerrar lo que faltaba |

**La ronda 2 es la que da confianza al conjunto.** Convertimos cada hallazgo en
una **predicción falsable** —25 en total— y construimos un agente de juguete con
defectos deliberados, cada uno reproduciendo un fenómeno medido. Resultado:
12 se cumplieron, 2 fallaron, 5 quedaron a medias, 2 bloqueadas.

**La ronda 3 es la que más corrigió.** Fue la primera contra un agente de
producción, con flows que escriben datos de verdad. Cerró los dos riesgos
abiertos —los dos dieron el resultado malo—, tiró abajo una hipótesis principal,
re-atribuyó dos defectos que estaban mal explicados, y encontró **6 defectos
nuevos de la plataforma más 3 bugs en las utilidades del propio repo**.

**Cuatro conclusiones nuestras resultaron falsas al medirlas**, dos de ellas ya
escritas en la base de conocimiento. Ese es el mejor indicador de que el método
funciona: atrapó sus propios errores.

---

## 3 · Cómo se testea un agente — el modelo

Un agente no es código determinista. Tiene tres capas y fallan distinto.

| Capa | Pregunta | Reproducibilidad medida |
|---|---|---|
| **Sintaxis** | ¿El `.agent` compila? | Determinista |
| **Ruteo** | ¿La consulta llega al subagente correcto? | **127 observaciones, 0 variación** |
| **Contenido** | ¿La respuesta es correcta? | **No reproducible** |

La misma pregunta, **dentro de la misma corrida**, devolvió dos respuestas
distintas. Las métricas de calidad automáticas viraron hasta 5 puntos sobre input
idéntico.

**Regla base: la batería verifica ruteo. El contenido se observa.**

### El matiz que casi nadie ve

**Que el ruteo sea estable no significa que el agente haga siempre lo mismo.**

127 observaciones sin una sola variación de destino, sobre un agente que en unas
corridas consultaba su base de conocimiento y en otras contestaba de memoria.
Mismo destino, distinta ejecución.

En producción eso es la diferencia entre responder con el dato correcto y
responder con lo que el modelo recuerde. **Una batería que sólo verifica el
destino reporta eso como perfecto.**

Y peor: con las herramientas tal como vienen esa inestabilidad es **invisible**,
porque la verificación de acciones falla siempre por un bug, y un rojo constante
tapa uno intermitente.

---

## 4 · Los dos motores

Salesforce ofrece dos formas de correr una batería, y son productos distintos.

| | `sf agent test run-eval` | `sf agent test create` + `test run` |
|---|---|---|
| **Prerequisito en la org** | ninguno | **Testing Center habilitado** |
| **Madurez** | **BETA** — *"don't use in scripts"* | GA |
| **Entrada** | YAML local, directo | metadata desplegada en la org |
| **Escribe en la org** | **nada** | sí |
| **Endpoint** | `api.salesforce.com/einstein/evaluation/v1/tests` | Testing Center |
| **Paralelismo** | `--batch-size` 1-5 | no expuesto |
| **Verificar contenido y estado** | ✅ | ❌ devuelve el template sin resolver |
| **Decir contra qué versión corrió** | ✅ `sessionContext.tags.bot_version_id` | ❌ **imposible, tres vías cerradas** |
| **Métricas de calidad con explicación** | ❌ | ✅ único que las da |
| **Tiempo, 20 casos** | **~21 s** | 222 s limpio / 1306 s con un caso colgado |
| **Fiabilidad** | 0 errores / ~94 ejecuciones | 1,7 % |

**`test run` no es un plan B: es estrictamente más débil, y además es GA.**
No puede verificar contenido ni estado, y no puede decir qué versión midió. Su
único aporte exclusivo son las métricas de calidad.

**La consecuencia incómoda:** la capacidad más valiosa del enfoque existe en un
solo comando, y ese comando está en beta. No hay segunda fuente.

---

## 5 · Los 23 defectos

Ninguno documentado por Salesforce. Tres patrones los recorren:

- **Los datos están bien, la comparación está mal** — de ahí el workaround
  general: usar los comandos como motores de ejecución y verificar por afuera
- **Lo que falta no se ve** — varios hacen que algo no se ejecute sin aparecer en
  ningún lado que el lector mire
- **Creés estar mirando una cosa y estás mirando otra** — la versión del agente,
  la del bundle local, la de la herramienta, el campo del que leés un valor

### Los cinco que dan verde con la batería rota

**D1 · Podés estar midiendo una versión que ningún usuario alcanza.**
`run-eval` resuelve por `ORDER BY VersionNumber DESC` sin filtrar por `Status`;
producción sirve la activa. Medido montando el escenario: la batería corriendo
contra v2 inactiva mientras producción servía v1. **Los dos endpoints devolvieron
exit 0 con respuestas plausibles.** Nada falla.

*Y `test run` no permite defenderse:* no expone `bot_version_id`, el
`AiEvaluationDefinition` no lleva `subjectVersion`, y el export tampoco la trae.
**Tres vías cerradas.** La única defensa —leer la versión de la corrida misma—
sólo existe en el comando beta.

**D2 · El exit code no está roto: está invertido.**
`if (summary.errors > 0)` cuenta *evaluaciones que no corrieron*, no fallos.
Medido: 10 fallos reales → exit **0**. Un `expected` mal tipado → exit **1**.
Da verde con el agente roto y rojo con un error de tipeo.

**D3 · Una verificación puede no ejecutarse sin que se vea.** Cuatro mecanismos
distintos observados. El cuarto —`test run` colapsa las verificaciones repetidas,
5 declaradas → 1 devuelta— **no deja ningún rastro**.

**D4 · La trampa del `get_state`.** Una referencia avanzada sin destino esperado
nunca se resuelve: el motor compara contra el texto literal de la plantilla, con
`compute_status: COMPLETED` y sin mensaje de error. Falla indistinguible de una
regresión real del agente.

**D5 · "No espero acciones" no verifica nada.** Semántica de subconjunto. Medido:
20 de 20 casos declararon lista vacía, los 20 invocaron acciones reales, los 20
dieron PASS score 1 — **y sumaron al conteo de verdes**.

### Los que hacen perder tiempo

`expectedActions` roto en `run-eval` (falso negativo garantizado, incluso con el
nombre correcto) · los dos motores comparan el destino distinto —uno con
`contains`, otro con igualdad exacta— · tres literales distintos para escalación,
y el que aparece depende **del campo que leas, no del motor** · un caso colgado
bloquea ~22 minutos con un error sin diagnóstico · un comando que dice "esperá" y
devuelve éxito a los 3 segundos sin resultados · la herramienta oficial de
generación produce baterías que fallan siempre · el bundle local pierde el número
de versión al retraerse y se sobrescribe sin aviso.

### Ambientales

La CLI **se auto-actualiza sola, incluso a mitad de sesión** —nos pasó, de 1.44.5
a 1.45.0, y lo descubrimos por accidente—. Hay **dos copias del plugin en disco**
y la de la ruta obvia es la obsoleta. En Windows desde Git Bash la CLI **siempre**
reporta error, incluso cuando funciona.

---

## 6 · Qué se puede verificar, y qué no

La distinción útil no es "verificable / no verificable". Son tres capas:

| | Ejemplos | ¿Se puede? |
|---|---|---|
| La plataforma lo verifica | destino, acciones, contenido determinista, estado | **Sí, nativo** |
| No lo verifica, pero el dato está | utilidades internas, transiciones | **Sí, con capa propia** |
| El dato no existe | texto generado por el modelo | **No** |

Colapsar las dos últimas fue un error nuestro, y corregirlo abrió la capacidad
más valiosa del repo.

### El hallazgo técnico central

El traductor de especificaciones hace `return MAPA_CONOCIDO[path] ?? path`.
Ese `?? path` es un **passthrough no declarado**: las rutas desconocidas pasan
intactas al API de evaluación. Eso permite alcanzar cualquier punto de la
respuesta del planner:

```
lastExecution.invokedActions[0][0].function.output.<campo>   ← valor determinista
sessionContext.stateVariables.<variable>                     ← estado del turno
sessionContext.executionHistory[N].actionName                ← incluye utilidades
sessionContext.tags.bot_version_id                           ← la versión servida
```

**Con eso se puede:**

- **Verificar contenido con igualdad exacta** — no contra la respuesta al usuario,
  que el agente adorna, sino contra **el valor que devolvió la acción**, que es
  byte-exacto. Medido 3/3 corridas
- **Verificar la máquina de estados** — que el agente guardó el puntaje correcto,
  que avanzó del paso 1 al 2, que ejecutó una transición. Determinismo sobre una
  conversación

⚠️ **Y es la dependencia más frágil del enfoque.** No es una funcionalidad
declarada: es un descuido que nos favorece. Si mañana validan las rutas contra una
lista blanca, todo eso se rompe de golpe. Por eso las verificaciones importantes
se hacen **por dos vías en paralelo** — una nativa, una propia.

### Dos límites que descubrimos por accidente

**Verificar contenido depende del agente.** El fixture de la ronda 2 tenía una
acción barata que devolvía textos fijos; el agente de producción no tenía
**ninguna** alcanzable en un turno. La técnica es general, su aplicabilidad no.
El fixture era más conveniente que la realidad y eso nos ocultó la limitación.

**Verificar estado no depende de nada.** Existe en cualquier turno, en cualquier
agente. Esa parte sí es universal.

---

## 7 · Seguridad — por qué correr baterías no rompe nada

**~430 ejecuciones en tres rondas, 3 organizaciones, cero registros de negocio
creados o alterados.** Incluyendo una org con Cases y MessagingSessions reales
cuyos flows hacen UPDATE de verdad.

**Y el mecanismo está observado, no supuesto.** Las acciones que tocan datos
empiezan con una búsqueda por una variable derivada del canal. Bajo test esas
variables llegan **null** —verificado en la salida cruda, las 7 en null en cada
corrida—, la búsqueda no encuentra nada, y el DML posterior afecta 0 filas.

```
"input":  { "recordId": null, "conversationSummary": "…" }
"output": { "__action_execution_status__": "success", "isWithinBusinessHours": true }
```

El flow corrió, devolvió éxito, y no tocó un registro. La cadena se rompe en el
primer eslabón.

**Verificado también en el peor escenario:** 14 escalaciones contra una org **con
colas de Omni-Channel reales**, dentro del horario laboral —la rama que dispara
la transferencia—. Cero Cases, cero MessagingSessions, cero AgentWork.

**El único vector: sembrar un identificador real.** Si alguien pasa un
`RoutableId` verdadero, la cadena se completa y el DML se vuelve real. Es la única
regla que no se relaja nunca.

*(Nota: en la ronda 3 medimos que sembrar variables de contexto tampoco llega al
runtime, lo que sugiere que ese vector puede estar cerrado del lado del servidor.
No relajamos la regla: no sabemos por qué está cerrado, y una puerta cerrada sin
explicación puede reabrirse.)*

---

## 8 · Un hallazgo que hay que mirar aparte

**Las métricas de calidad de Salesforce premian romper los guardrails.**

Medido sobre un agente de salud en producción:

| Caso | Qué hizo el agente | Qué puso el evaluador |
|---|---|---|
| Pedido de medicación | **se negó a recomendar** | coherencia **1** — el peor de la batería |
| Fuga de instrucciones | **no filtró su prompt de sistema** | *"does not provide the requested system prompt"* |
| Consulta fuera de alcance | **la rechazó** | 0 en completitud |

**El 75 % de los ceros de completitud son comportamiento correcto** — 41 % en el
agente menos protegido. **El sesgo escala con lo bien protegido que esté el
agente.**

Un equipo que optimice contra estas métricas está optimizando para exponerse.

**Y el export que Salesforce ofrece como evidencia presentable arrastra ese
sesgo**: marca como FALLIDOS los tres casos donde el agente se comportó mejor, dos
de ellos críticos de seguridad, con una explicación en inglés que suena
autoritativa. Un cliente que lea esa planilla sin curar concluye que su agente
falla en seguridad, cuando pasó.

**Pero no son inútiles.** Un cuarto cero era real: detectó que la misma consulta
devolvía la información completa en unas corridas y *"no tengo esa información"*
en otras — misma versión, mismo día. **El ruteo fue correcto al 100 %**, o sea
invisible para una batería de ruteo.

➡️ Peligrosas como objetivo, valiosas como detector. Se usan segmentadas por
destino, sólo sobre los caminos donde se espera que el agente responda.

---

## 9 · Lo que encontramos en los agentes reales

Sin buscarlos, el repositorio detectó **dos defectos genuinos** en el agente de
producción:

**El agente le muestra código al paciente.** En ~4 % de las escalaciones el
planner escribe la llamada a la herramienta como texto en vez de ejecutarla. El
usuario ve literalmente `check_business_hours(conversationSummary=…)` en el chat,
y la derivación no ocurre.

**Un hueco de contenido reproducible.** La misma consulta sobre horarios de
urgencia devuelve la información completa en unas corridas y *"no tengo esa
información"* en otras. Misma versión, mismo día.

**Ninguno de los dos lo ve una batería de ruteo**: el destino fue correcto al
100 % en ambos.

Y en el agente de juguete, sin planearlo, encontró un tercero: un usuario que
escribe "hola" recibía un rechazo, contra lo que el propio código del agente decía
que debía pasar.

---

## 10 · Qué es el repositorio hoy

```
CLAUDE.md          15 reglas inviolables — se cargan siempre
knowledge/         7 archivos, cada afirmación con su nivel de confianza
.claude/skills/    16 skills de Agentforce, de ~112 disponibles
lib/               7 utilidades + 91 tests, 26 suites, 0 fallos
agents/<slug>/     configuración, vocabulario y baterías por agente
runs/              el archivo de cada corrida
```

**Las utilidades** hacen lo que la plataforma hace mal: verificación propia sobre
la salida cruda, exit code correcto, censo de verificaciones, generación de
especificaciones para los dos motores, chequeo de integridad de la instalación,
registro de versiones, e informe curado.

**Los tests usan corridas reales archivadas como fixtures**, no datos inventados
— porque un fixture inventado reproduce lo que *creemos* que devuelve la
plataforma, que es exactamente cómo se nos pasaron tres bugs.

**El informe curado** es la pieza que hace auditable el resultado: segmenta por
destino, invierte la lectura en los caminos de rechazo, marca los casos de
seguridad aparte, explica los fallos que la plataforma deja sin explicación, y
—sobre todo— **nombra lo que falta**. Un informe que omite las ausencias se lee
como si estuviera completo.

**Y clasifica los fallos** para responder la única pregunta que importa cuando ves
un rojo: ¿falló el agente o estaba mal la expectativa?

### El valor no está en el código

Tres rondas mostraron el mismo patrón: **cada vez que confiamos en código propio
aparecieron bugs** —tres en la capa que existe justamente para corregir los bugs
de la plataforma—; **cada vez que confiamos en un hallazgo medido, aguantó**.

El repositorio no es una herramienta con comandos. Es un mapa de campos minados.

---

## 11 · Riesgos, límites y decisiones

### Riesgos abiertos

**La capacidad más valiosa depende de un comando BETA sin segunda fuente.**
Verificar contenido y estado —y verificar contra qué versión se midió— sólo
funciona en `run-eval`, cuyo propio manual dice que no se use en scripts. Está
documentado, no mitigado.

**El passthrough que lo hace posible no es una funcionalidad declarada.**
Si Salesforce valida las rutas, se rompe de golpe. Mitigado parcialmente con la
doble verificación.

**Toda afirmación sobre el código del cliente vence.** La CLI se movió dos veces
durante el trabajo. Por eso el repo registra ahora la versión de la herramienta
junto a la del agente, y re-verifica los anclajes al cierre.

### Límites de la evidencia

Todo se midió sobre agentes **Agent Script**, del mismo tipo y plantilla.

Los **agentes clásicos** quedaron **fuera de alcance por decisión** (2026-08-12):
el repo es sólo para Agent Script. No es una limitación pendiente.

Lo que sí sigue abierto es el **tipo** de agente: los tres medidos son
`EinsteinServiceAgent`. Un Employee Agent puede tener otro vocabulario de
variables y otro comportamiento de escalación — **y puede estar escrito en Agent
Script igual**, así que la decisión de alcance no cubre este hueco.

Tres agentes, tres organizaciones. Es muestra chica para hablar de "la
plataforma".

Y hay preguntas abiertas honestas: por qué el runtime descarta las variables de
contexto (la hipótesis principal —que son derivadas del canal, no seteables— es
**inferida**, no confirmada), la rama de escalación fuera de horario nunca se
observó, y la lista de guardrails de plataforma es **un piso, no la lista
completa**.

### Lo que se puede hacer hoy

- **Regresión de ruteo** como control antes de aprobar un cambio: 20 casos en
  ~21 segundos, sin escribir en la org, sin reintentos
- **Verificación de la máquina de estados** en cualquier agente
- **Verificación de contenido exacto** en agentes que tengan una acción
  determinista alcanzable
- **Reporte cualitativo curado** para revisar calidad y detectar huecos de
  contenido
- **Batería de seguridad** con siete catálogos de ataques OWASP incluidos

### Dos recomendaciones que exceden el testing

**Diseñar los agentes para que se puedan testear.** Varias limitaciones vienen de
testear agentes que no fueron pensados para eso. Una acción determinista
alcanzable en un turno cuesta veinte líneas y desbloquea toda la verificación de
contenido. Evitar instrucciones discrecionales —*"ofrecé derivar"* en vez de
*"derivá"*— en los caminos críticos: son las que producen trazas no
reproducibles.

**Considerar una organización descartable para testear los efectos.** Hoy tenemos
un punto ciego: sabemos que el agente **no escribe** bajo test, y por eso mismo no
podemos verificar que **escriba bien cuando debe**. Con datos de juguete sembrados
en una org descartable, esa mitad se vuelve verificable.

---

## Fuentes

Toda afirmación de este informe tiene evidencia cruda detrás:

| | |
|---|---|
| `evidencia/ronda-1-spike.md` | ronda 1 — 2.576 líneas |
| `evidencia/ronda-2-bici-store.md` | ronda 2 — 2.580 líneas |
| `evidencia/ronda-3-alemana.md` | ronda 3 — 1.896 líneas |
| `runs/` | salidas crudas de cada corrida |
| `knowledge/` | el destilado, con nivel de confianza por afirmación |

**Y la distinción que sostiene todo:** cada afirmación está marcada como
**medida**, **razonada** o **abierta**. En esta investigación cuatro conclusiones
"obvias" resultaron falsas al medirlas. Nada se afirma con más confianza de la que
se verificó.
