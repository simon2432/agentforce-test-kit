# Estado y trabajo pendiente

Última actualización: 2026-08-12, después de la auditoría de `lib/`.

Para usar el repo no hace falta leer esto. Es para quien lo vaya a **continuar**.

---

## Estado

**El repo está en un estado usable.** Las tres rondas están destiladas en
`knowledge/`, las utilidades tienen 91 tests propios, y la documentación está
partida en cuatro entradas según para qué venís (`README`, `EMPEZAR-ACA`,
`LIMITES`, `TIPOS-DE-PRUEBA`).

### Cerrado el 2026-08-12 — la auditoría de `lib/`

Siete hallazgos, los siete arreglados con test. **Los cuatro primeros producían
resultados incorrectos en silencio**, que es el modo de falla que el repo entero
existe para atajar.

| | Qué era | Cómo quedó |
|---|---|---|
| **P1** | `--expect-version` era opcional y su ausencia silenciosa: leer la versión se veía igual que verificarla | Obligatorio en `run-eval`. Sin él, exit 1 y "NO auditable". Escape `--no-version-check` que deja rastro |
| **P2** | `report.mjs` apareaba métricas por posición en `rows`, que incluye los SKIPPED. **Reproducido**: con un multi-turno, cada métrica se corría un lugar | Apareo por cursor `sentToEngine` + verificación contra `inputs.utterance`. Si no cierra, descarta todo y lo nombra |
| **P3** | 10 bloques de comentario en `lib/` citaban el defecto equivocado (`D1` decía "exit code") | Corregidos. **`tests/punteros.test.mjs` los fija**: verifica toda cita `D<n>` contra el catálogo |
| **P4** | El "preflight" estaba escrito en presente en cuatro archivos y no existía | `lib/preflight.mjs`, 13 tests. Guarda de Org Id, gate de versión, detección de Testing Center |
| **P6** | `doctor.mjs` no verificaba `report.mjs` | Verifica los 6 módulos |
| **P7** | `assertNoRealIds` aceptaba un `allowOverride` que ningún flag exponía — una puerta trasera sin uso en la guarda más crítica del repo | Sacado. La guarda **no tiene escape**. Partida en `findRealIds` (pura, testeable) + `assertNoRealIds` (aborta). **9 tests nuevos**: hasta ahora era la única línea que separa una prueba de un UPDATE real y no tenía ninguno |

También se dieron de baja los **agentes clásicos** como limitación pendiente:
el repo es sólo para Agent Script **por decisión**, así que no es algo que falte
medir. ⚠️ Pero se dejó explícito en cuatro archivos que **eso no cubre el eje del
tipo de agente**: un Employee Agent puede ser Agent Script igual, y ese hueco
sigue abierto.

⚠️ **Decisión que cambió sobre la marcha en P3: NO se renumeró el catálogo.** El
plan original era reordenar `knowledge/02` para que los defectos quedaran en
orden numérico. Se descartó al contar las citas: **188 en el repo, 123 de ellas
en `evidencia/`**, que es registro congelado. Renumerar habría dejado la
evidencia apuntando al defecto equivocado — el problema que se estaba
arreglando, a mayor escala. En su lugar se agregó un índice por número al frente
del catálogo.

### Cerrado antes

- Evidencia separada del producto. `evidencia/` y `ejemplos/` ya no se confunden
  con `agents/`, que ahora tiene sólo la plantilla.
- El README pasó de 781 líneas a un punto de entrada corto. Lo técnico está en
  `ANEXO-TECNICO.md`; los tipos de prueba en `TIPOS-DE-PRUEBA.md`.
- `LIMITES.md` nuevo: lo que el repo **no** sabe, al frente en vez de escondido.
- `EMPEZAR-ACA.md` nuevo: el camino real de los primeros 30 minutos.
- Las 16 skills están en `.claude/skills/`, completas y verificadas por
  `npm run doctor`.
- Los tres bugs de `assert.mjs` encontrados en la ronda 3, arreglados y con
  tests.

---

## ⚠️ Lo que queda abierto de la auditoría

**`lib/preflight.mjs` nunca corrió contra una org.** Sus 13 tests mockean `sf`,
así que verifican la **lógica de decisión** —qué hace ante cada respuesta— y no
que las consultas sean correctas contra Salesforce.

Es exactamente la distinción de `knowledge/00-index.md`: leer el código del
cliente alcanza para afirmar qué manda la CLI, no para afirmar qué devuelve el
servidor. **Hasta que se corra contra una org real, el preflight está en estado
INFERIDO.**

➡️ Primera corrida contra una org: verificar que `sf org display --json`
devuelva `result.id`, y que la SOQL sobre `BotVersion` con
`BotDefinition.DeveloperName` traiga registros. Si alguna de las dos falla, el
script lo va a reportar como fatal y hay que distinguir el bug propio del
hallazgo real.

---

## Pendiente — código

Lo que quedó de la auditoría del 2026-08-12. Nada de esto bloquea usar el repo.

### P5 · No es un repositorio git

Sin historia no se puede reconstruir cuándo cambió una afirmación de `knowledge/`
ni por qué. Para un repo cuya regla de cierre es *"toda verificación de código
vence"*, eso es una contradicción.

➡️ `git init`, primer commit, y de ahí en adelante un commit por hallazgo. El
`.gitignore` ya está.

⚠️ Antes del primer commit, decidir qué pasa con `evidencia/`: contiene metadata
real de un cliente. Ver `evidencia/README.md`.

### P8 · Encadenar el preflight con el assert

Hoy el `botVersionId` viaja a mano: el preflight lo imprime y el operador lo
copia a `--expect-version`. Funciona, pero depende de un copy-paste.

➡️ Un script que corra preflight → gen-spec → run-eval → assert pasando el valor
solo. Es la última pieza para que la regla #1 no dependa de nadie.

---

## Pendiente — investigación

Ordenado por cuánto cambiaría las cosas si se cierra.

**1 · Un agente que no sea de servicio.** Es el hueco de alcance más grande que
queda. Los tres agentes medidos son `EinsteinServiceAgent` sobre
`SvcCopilotTmpl__AgentforceServiceAgent`, los tres sobre Messaging. Un Employee
Agent o uno a medida puede tener otro vocabulario de variables y otro
comportamiento de escalación, y el repo **no lo detecta ni se adapta**.

⚠️ **Esto NO es lo mismo que "agentes clásicos", que se dio de baja como
pendiente el 2026-08-12.** Son dos ejes distintos y conviene no volver a
mezclarlos: `agentDSLEnabled` dice si el agente está escrito en Agent Script;
`type` dice si es de servicio o de empleado. **Un Employee Agent puede ser Agent
Script perfectamente.** El repo es sólo para Agent Script por decisión, así que
el primer eje está cerrado; el segundo sigue abierto.

**2 · La rama de escalación fuera de horario.** Todo se midió dentro de horario
de atención. Si alguien arma una batería nocturna, esto es lo primero que va a
fallar — y va a parecer una regresión del agente.

**3 · Por qué no llegan las variables de contexto.** El candidato principal
**cayó** en la ronda 3: declararlas en el metadata tampoco alcanza. Lo que queda
es la hipótesis del canal (`knowledge/06`, B6), y cerrarla requiere una sesión de
mensajería real, que ningún motor de prueba crea.

**4 · El techo de concurrencia.** 20 casos pasaron sin degradación. El límite no
se buscó. Define el tamaño máximo de una batería.

⚠️ **Regla para escribir preguntas abiertas:** una pregunta tiene que nombrar
artefactos **verificados**. Si el candidato es *"falta declarar X en Y"*, hay que
haber visto Y. La versión anterior de este archivo apuntaba a un artefacto que no
existe, y costó media fase de la ronda 3.

---

## Lo que no hay que hacer

**No borrar `lib/`.** Cada utilidad existe porque hay algo que la plataforma hace
mal. Que la puerta de entrada del repo sea la documentación y no los comandos no
significa que sobren.

**No "limpiar" la doble verificación de `ejemplos/bici-store/content.cases.yaml`.**
Es una cobertura deliberada contra una técnica que no está documentada como
característica. El motivo está en `knowledge/03-assertions.md`.

**No relajar la escala de confianza.** CONFIRMADO / INFERIDO / NO DETERMINADO es
la parte más importante del diseño. Cuatro conclusiones que parecían obvias
resultaron falsas al medirlas, y dos ya estaban escritas en el repo con más
confianza de la que correspondía.

**Y una verificación de código vence.** La CLI se auto-actualizó a mitad de la
ronda 3, sin aviso. Re-verificar los anclajes al abrir **y al cerrar** cada
sesión, y registrar la versión en cada corrida.
