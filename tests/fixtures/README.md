# Fixtures

**Todos salen de corridas reales de la plataforma, anonimizadas.** No están
escritos a mano: son la salida cruda que devolvió Salesforce, recortada a los
campos que `lib/` lee, con los nombres e Ids del agente original reemplazados por
ficticios.

Por qué importa que sean reales: los tres bugs que estos tests reproducen
**existían y no se veían** porque el wrapper nunca se había corrido contra
`test run`. Un fixture inventado habría reproducido lo que creíamos que devuelve
la plataforma, no lo que devuelve.

⚠️ **Qué se anonimizó, y qué no.** Se cambiaron el nombre del agente, el alias y
Org Id de la org, el `botVersionId` y los datos de contacto que aparecían en las
respuestas generadas. **No se tocó ni un byte de la estructura**: el escapado
HTML de los nombres de acción, el desalineo por índice, los `null` donde debería
haber datos y los veredictos del motor están exactamente como llegaron. Eso es lo
que los tests miden.

Los registros de investigación de los que salieron **no se distribuyen** —
traen metadata de orgs de clientes. Estos fixtures son autosuficientes: `npm test`
corre sólo con lo que hay en esta carpeta.

| Fixture | Qué es | Para qué |
|---|---|---|
| `run-eval-c2.json` | Suite de ruteo de 12 casos, motor `run-eval` | Veredictos contrastados caso por caso contra el otro motor |
| `test-run-c2.json` | La misma suite por `test run` | **Trae los nombres de acción HTML-escapados** |
| `routing.cases.yaml` | La suite de los dos anteriores | La entrada que produjo esas dos salidas |
| `discover.cases.yaml` | 10 casos, **uno multi-turno** | `gen-spec --engine test-run` lo excluye |
| `test-run-discover.json` | La salida de esa suite: **9 casos, no 10** | Reproduce el desalineo por índice |
| `test-run-metrics-c2.json` | La misma suite con métricas de calidad | Expone el sesgo contra los rechazos correctos |
| `agent.json` · `vocabulary.json` | Recorte a los campos que lee `report.mjs` | Que los tests no dependan de un registro completo |

## La verdad de referencia

Los veredictos correctos de `routing.cases.yaml` **no son una opinión**: se
establecieron contrastando los dos motores caso por caso en la Fase C.2, y las
discrepancias se resolvieron leyendo el crudo.

| Caso | Veredicto correcto | Por qué |
|---|---|---|
| R1 | **PASSED** | topic y acción correctos. `test run` los devuelve HTML-escapados |
| R4 | **FAILED** | rojo deliberado: espera `off_topic`, va a `GeneralFAQ` |
| R5 | **FAILED** | espera `FAQ` (substring). El wrapper compara exacto |
| R7 | **FAILED** | la escalación no se concretó: devolvió `escalation`, no `human` |
| resto | **PASSED** | |

⚠️ **R7 es un fallo real del agente**, no del test: el planner escribió la llamada
a la herramienta como texto en vez de ejecutarla. Está en el fixture a propósito.
