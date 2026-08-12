# Agentforce Test Kit

Repositorio para testear agentes de Agentforce. Sirve para cualquier agente
escrito en Agent Script, en cualquier organización.

**Empezá por [`EMPEZAR-ACA.md`](EMPEZAR-ACA.md).** Son los primeros 30 minutos,
paso a paso.

---

## Qué es esto, en una frase

**Testear un agente de Agentforce con las herramientas oficiales, tal como
vienen, produce resultados incorrectos por defecto.** Este repositorio es el mapa
de esos defectos, más las utilidades mínimas para trabajar alrededor de ellos.

No es una herramienta con comandos: es sobre todo **conocimiento verificado**.
Las utilidades de `lib/` existen porque hay cosas que la plataforma hace mal y
hay que corregirlas — pero el valor está en saber cuáles son.

Todo lo que se afirma acá está medido: **~430 ejecuciones de prueba sobre
3 agentes distintos, en 3 organizaciones**. Cada afirmación lleva su nivel de
confianza. Lo que no sabemos está en [`LIMITES.md`](LIMITES.md), y conviene
leerlo antes que nada.

---

## Qué puede y qué no puede hacer

**Puede, y está medido:**

| | |
|---|---|
| Verificar **ruteo** — que cada consulta llegue al subagente correcto | 20 casos en ~21 s, sin escribir en la org |
| Verificar la **máquina de estados** de una conversación | funciona en cualquier agente |
| Verificar **contenido exacto** de una acción determinista | sólo si el agente tiene una |
| Detectar **huecos de contenido** con métricas de calidad | requiere curar el resultado |
| Correr **ataques OWASP** contra el agente | 7 catálogos incluidos |
| **No romper nada** — ~430 ejecuciones, 0 registros de negocio alterados | mecanismo entendido, no suerte |

**No puede:**

| | |
|---|---|
| Verificar el **texto que genera el modelo** | no es reproducible: la misma consulta devuelve cosas distintas en la misma corrida |
| Testear un cambio **antes de publicarlo** | los motores corren contra el agente publicado |
| Decir contra qué versión corrió, **si usás el motor GA** | ver `LIMITES.md` |
| Detectar acciones **inesperadas** | la plataforma sólo detecta las faltantes |
| Producir **evidencia presentable sin curar** | el export de Salesforce invierte el veredicto en los casos de seguridad |

**Alcance:** sólo agentes **Agent Script**. Los clásicos quedan afuera por
decisión, no por falta de pruebas.

**Nunca se probó en:** agentes que no sean de servicio (un Employee Agent puede
ser Agent Script igual), agentes con más de 5 subagentes, ni cadenas de acciones
de varios pasos. Ver `LIMITES.md`.

---

## Lo único que hay que entender antes de empezar

Un agente no es código determinista. Tiene tres capas y fallan distinto:

| Capa | Pregunta | Reproducibilidad medida |
|---|---|---|
| **Sintaxis** | ¿Compila? | Determinista |
| **Ruteo** | ¿La consulta llega al lugar correcto? | 127 observaciones, 0 variación |
| **Contenido** | ¿La respuesta es correcta? | No reproducible |

**De ahí la regla base: la batería verifica ruteo; el contenido se observa.**

### Y el matiz que casi nadie ve

**Que el ruteo sea estable no significa que el agente haga siempre lo mismo.**

127 observaciones sin una sola variación de destino, sobre un agente que en unas
corridas consultaba su base de conocimiento y en otras contestaba de memoria.
Mismo destino, distinta ejecución.

Una batería que sólo verifica el destino **reporta eso como perfecto**. Por eso
los tipos 4 y 5 no son opcionales.

---

## Los siete tipos de prueba

Detalle completo en [`TIPOS-DE-PRUEBA.md`](TIPOS-DE-PRUEBA.md).

| # | Tipo | Responde | Costo |
|---|---|---|---|
| 1 | **Compilación** | ¿El archivo del agente es válido? | ~5 s |
| 2 | **Descubrimiento** | ¿Qué destinos devuelve realmente? | ~1 min |
| 3 | **Ruteo** | ¿Cada consulta llega a donde debe? | ~21 s / 20 casos |
| 4 | **Contenido determinista** | ¿Devolvió exactamente el dato correcto? | ~20 s |
| 5 | **Estado y conversación** | ¿Sostiene el hilo y guarda bien? | ~60 s |
| 6 | **Calidad** | ¿Las respuestas son buenas, en general? | ~4 min |
| 7 | **Seguridad** | ¿Resiste intentos de manipulación? | ~30 s |

🚨 **El 2 es obligatorio y va primero.** El runtime devuelve destinos que **no
están en el código del agente** — guardianes de la plataforma y literales de
escalación. Deducirlos leyendo el código falló 2 de 20 veces en un agente y 1 de
8 en otro. Sin el descubrimiento, los demás tipos miden suposiciones.

---

## Las cinco trampas que hay que conocer sí o sí

Detalle y evidencia en [`knowledge/02-known-issues.md`](knowledge/02-known-issues.md).

**Podés estar midiendo una versión que ningún usuario alcanza.** Los dos
endpoints de Salesforce no coinciden sobre qué versión servir. Medido: la batería
corriendo contra una versión inactiva mientras producción servía otra. **Los dos
respondieron bien. Nada falló.**

**El código de salida está invertido.** Da verde con el agente roto y rojo con un
error de tipeo en el archivo de prueba. Nunca lo uses para gatear nada — usá
`lib/assert.mjs`, que lo calcula bien.

**Una verificación puede no ejecutarse sin que se note.** Cuatro mecanismos
distintos observados, y uno no deja ningún rastro. De ahí el censo de
verificaciones.

**"No espero acciones" no verifica nada.** Medido: 20 de 20 casos con lista
vacía, los 20 invocaron acciones reales, los 20 dieron verde. No cuenta como
cobertura.

**Nunca pongas un identificador real en la configuración de una prueba.** Es el
único mecanismo que puede hacer que las pruebas modifiquen datos de verdad. Sin
él, las acciones no encuentran registros y no tocan nada — eso está medido, no
supuesto.

Y en Windows: **PowerShell, nunca Git Bash.** Desde Git Bash la CLI siempre
reporta error, incluso cuando funciona.

---

## Cómo trabajar con Claude Code

El repositorio está diseñado para que Claude haga el trabajo. Lee `CLAUDE.md`
siempre y `knowledge/` cuando lo necesita, así que ya conoce las trampas.

Antes de pedir un test, **llegá con seis cosas** que sólo sabe quien conoce el
agente — están listadas en la skill (`.claude/skills/agentforce-test/SKILL.md`),
en el Paso 0. El resto lo averigua Claude solo.

Pedidos que funcionan:

> *"Registrá el agente X de la organización Y y hacé el descubrimiento."*
>
> *"Armá una batería de ruteo. Preguntame lo que necesites."*
>
> *"El caso S5 falla. ¿Es el agente o es la expectativa?"*

**Lo que Claude no va a hacer solo:** inventar consultas del negocio sin
contexto, ni deducir destinos leyendo el código del agente. Está prohibido en
`CLAUDE.md` por una razón medida.

---

## Estructura

| | |
|---|---|
| `EMPEZAR-ACA.md` | **Los primeros 30 minutos.** Empezá por acá |
| `LIMITES.md` | Lo que este repo NO sabe. Leelo antes de confiar |
| `TIPOS-DE-PRUEBA.md` | Los 7 tipos en detalle |
| `ANEXO-TECNICO.md` | Comandos, rutas de datos, los 23 defectos por identificador |
| `CLAUDE.md` | 15 reglas inviolables — Claude las carga siempre |
| `SKILLS.md` | Qué skills hay y por qué |
| `knowledge/` | El conocimiento profundo, con nivel de confianza por afirmación |
| `.claude/skills/` | 16 skills de Agentforce, de ~112 disponibles |
| `lib/` + `tests/` | 7 utilidades, 91 tests |
| `agents/_template/` | Plantillas para registrar **tu** agente |
| `ejemplos/bici-store/` | Un agente de juguete completo, con baterías reales |
| `evidencia/` | Los 3 registros de investigación y sus salidas crudas |
| `RESUMEN-COMPLETO.md` | El informe de toda la investigación |

---

## Sobre la confianza

Cada afirmación de `knowledge/` está marcada como **CONFIRMADO** (medido),
**INFERIDO** (razonado, no observado) o **NO DETERMINADO** (abierto).

Esa distinción es la parte más importante del diseño. En esta investigación
**cuatro conclusiones que parecían obvias resultaron falsas al medirlas**, y dos
de ellas ya estaban escritas acá. Por eso nada se afirma con más confianza de la
que se verificó, y por eso las preguntas abiertas están a la vista en vez de
escondidas.

**Un repositorio que oculta sus propios límites es exactamente lo que nos hizo
perder tiempo con la documentación de Salesforce.**
