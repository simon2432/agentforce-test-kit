# Fixtures

**Todos salen de corridas reales archivadas en `evidencia/runs/`.** No están
escritos a mano: son la salida cruda que devolvió la plataforma, recortada a los
campos que `lib/` lee.

Por qué importa que sean reales: los tres bugs que estos tests reproducen
**existían y no se veían** porque el wrapper nunca se había corrido contra
`test run`. Un fixture inventado habría reproducido lo que creíamos que devuelve
la plataforma, no lo que devuelve.

⚠️ **Los fixtures se versionan; `evidencia/` no necesariamente.** `build.mjs` lee
de `evidencia/`, pero `npm test` no: corre sólo con lo que hay en esta carpeta.
Eso es a propósito — `evidencia/` se borra antes de compartir el repo fuera del
equipo, y los tests tienen que seguir pasando.

| Fixture | Origen | Para qué |
|---|---|---|
| `run-eval-c2.json` | `evidencia/runs/alemana/2026-08-06-faseC2/run-eval-1.json` | Suite de ruteo de 12 casos, motor `run-eval`. Veredictos contrastados contra el otro motor |
| `test-run-c2.json` | `evidencia/runs/alemana/2026-08-06-faseC2/test-run/test-result-4KBO30000000ea9OAA.json` | La misma suite por `test run`. **Trae los nombres de acción HTML-escapados** |
| `routing.cases.yaml` | `evidencia/agente-alemana/suites/routing.cases.yaml` | La suite de los dos anteriores |
| `discover.cases.yaml` | `evidencia/agente-alemana/suites/discover.cases.yaml` | 10 casos, **uno multi-turno** → `gen-spec --engine test-run` lo excluye |
| `test-run-discover.json` | `evidencia/runs/alemana/2026-08-06-faseB/test-run-1/…json` | La salida de esa suite: **9 casos, no 10**. Reproduce el desalineo por índice |
| `test-run-metrics-c2.json` | `evidencia/runs/alemana/2026-08-06-faseC2/test-run-metrics/…json` | La misma suite con métricas de calidad. Es la que expone el sesgo contra los rechazos correctos |
| `agent.json` · `vocabulary.json` | recorte de `evidencia/agente-alemana/` | Sólo los campos que lee `report.mjs`. **Recortados para que los tests no dependan de `evidencia/`** |

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
