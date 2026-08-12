# Ejemplos

Un agente completo, ya armado, para mirar cómo queda todo junto antes de hacerlo
con el tuyo.

---

## `bici-store/`

Un agente de juguete construido a propósito para la ronda 2 de la
investigación. Vende bicicletas, responde preguntas frecuentes, consulta precios,
y escala a un humano.

No es un ejemplo de mentira: **es el agente sobre el que se midieron ~180
ejecuciones**, y cada archivo de acá corrió de verdad.

| | |
|---|---|
| `agent.json` | El registro completo, con todos los campos resueltos |
| `vocabulary.json` | El vocabulario **generado con el descubrimiento**, no escrito a mano |
| `suites/routing.cases.yaml` | Batería de ruteo |
| `suites/content.cases.yaml` | Verificación de contenido determinista — el patrón más valioso |
| `suites/state.cases.yaml` | Conversación de varios turnos y verificación de estado |
| `sfdx/` | El proyecto con el código fuente del agente, para ver de dónde salen los nombres |

---

## Qué mirar, y en qué orden

**1 · `vocabulary.json`, y comparalo con el `.agent`.**

Fijate que aparecen `Prompt_Injection` y un literal de escalación **que no están
en el código del agente**. Ese es el motivo por el que el descubrimiento es
obligatorio y no una formalidad.

**2 · `content.cases.yaml`, el caso con doble verificación.**

Verifica lo mismo por dos caminos distintos a propósito. **No lo "limpies":** es
una cobertura deliberada contra una técnica que no está documentada como
característica de la plataforma. Si Salesforce la cierra, el caso lo va a avisar
en vez de fallar en silencio. El motivo está escrito en
`knowledge/03-assertions.md`.

**3 · `state.cases.yaml`, el caso marcado `xfail`.**

Está roto **por la plataforma**, no por el agente ni por el caso. Marcado así, no
mueve el veredicto — pero **el día que empiece a pasar hay que gritarlo**:
significa que la plataforma cambió.

---

## Cómo usarlo

**No lo corras.** La org de este agente ya no está disponible, y de todos modos
no es tu agente.

Sirve como referencia de formato: cuando no sepas cómo se escribe algo, buscalo
acá. Las plantillas en blanco están en [`agents/_template/`](../agents/).
