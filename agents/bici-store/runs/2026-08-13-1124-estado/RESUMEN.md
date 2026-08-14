# Corrida — estado

**2026-08-13T11:42:53-03:00** · motor `run-eval`

| | |
|---|---|
| Versión del agente | v3 (`0X9al000000qfiDCAQ`) |
| Auditable en versión | ✅ sí |
| Herramienta | sf @salesforce/cli/2.146.3 · plugin-agent 1.45.0 |
| Suite | `agents/bici-store/suites/estado.cases.yaml` · 4 casos |
| Duración (la reporta la plataforma) | 24.6 s |

## Resultado

**4 passed · 0 failed · 0 error · 0 missing**

## Qué se verificó, caso por caso

| Caso | Veredicto | Se verificó | NO se verificó |
|---|---|---|---|
| E01 | ✅ PASSED | topic(exact), utilActions, state.encuestaEtapa | — |
| E02 | ✅ PASSED | topic(exact), utilActions, state.encuestaEtapa, state.encuestaNota, custom[la nota 5 quedó guardada en encuestaNota] | — |
| E03 | ✅ PASSED | topic(exact), utilActions, state.encuestaEtapa | — |
| E04 | ✅ PASSED | topic(exact), state.encuestaEtapa, custom[ante una nota inválida la etapa NO avanza] | — |

⚠️ La columna **"NO se verificó"** no es relleno: un `SKIP` no es un acierto
ni un fallo. Un caso con veredicto verde y media columna derecha llena está
diciendo que se comprobó menos de lo que parece.

## Artefactos de entrada

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `informe.md` | 1573 | `4204cca49d5fa944…` |
| `raw.json` | 171781 | `dc7adf26df41bc16…` |
| `spec.yaml` | 1331 | `c1cae290165d59c1…` |

Éstos son los archivos de los que salió todo lo de arriba.
`manifiesto.json` cubre además **este mismo RESUMEN.md**, así que editarlo
a mano también se detecta. `npm run bitacora -- --verificar` recalcula todo.

---

## Nota de quien corrió — ⚠️ AUTO-REPORTADA

Todo lo de arriba se derivó de los artefactos. **Esto no.** Es lo que dijo
quien ejecutó la corrida, y vale exactamente lo que valga su palabra.

4/4 PASSED, censo 6/6. Cubre el ciclo completo no_iniciada -> esperando_nota -> esperando_comentario -> lista y ademas el camino de error (nota invalida 'ocho' no avanza la etapa). run-eval EJECUTA los turnos previos de verdad: el agente tuvo que pasar por esperando_nota para interpretar el '5'. NO se asserta el texto de encuestaComentario, que lo escribe el modelo parafraseando.

