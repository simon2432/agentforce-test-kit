# Corrida — ruteo

**2026-08-13T11:41:40-03:00** · motor `run-eval`

| | |
|---|---|
| Versión del agente | v3 (`0X9al000000qfiDCAQ`) |
| Auditable en versión | ✅ sí |
| Herramienta | sf @salesforce/cli/2.146.3 · plugin-agent 1.45.0 |
| Suite | `agents/bici-store/suites/ruteo.cases.yaml` · 13 casos |
| Duración (la reporta la plataforma) | 52.4 s |

## Resultado

**13 passed · 0 failed · 0 error · 0 missing**

## Qué se verificó, caso por caso

| Caso | Veredicto | Se verificó | NO se verificó |
|---|---|---|---|
| R01 | ✅ PASSED | topic(exact) | — |
| R02 | ✅ PASSED | topic(exact), actions | — |
| R03 | ✅ PASSED | topic(exact), actions | — |
| R04 | ✅ PASSED | topic(exact), actions | — |
| R05 | ✅ PASSED | topic(exact), actions | — |
| R06 | ✅ PASSED | topic(exact), actions | — |
| R07 | ✅ PASSED | topic(exact), actions | — |
| R08 | ✅ PASSED | topic(exact) | — |
| R09 | ✅ PASSED | topic(exact) | — |
| R10 | ✅ PASSED | topic(exact) | — |
| R11 | ✅ PASSED | topic(exact), utilActions | — |
| R12 🛡 | ✅ PASSED | topic(exact) | — |
| R13 | ✅ PASSED | topic(exact), actions | — |

⚠️ La columna **"NO se verificó"** no es relleno: un `SKIP` no es un acierto
ni un fallo. Un caso con veredicto verde y media columna derecha llena está
diciendo que se comprobó menos de lo que parece.

## Artefactos de entrada

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `informe.md` | 2832 | `bb5f81b17e6a42a7…` |
| `raw.json` | 502622 | `e85f2c1beb161d20…` |
| `spec.yaml` | 1367 | `983078ff2fcfcc65…` |

Éstos son los archivos de los que salió todo lo de arriba.
`manifiesto.json` cubre además **este mismo RESUMEN.md**, así que editarlo
a mano también se detecta. `npm run bitacora -- --verificar` recalcula todo.

---

## Nota de quien corrió — ⚠️ AUTO-REPORTADA

Todo lo de arriba se derivó de los artefactos. **Esto no.** Es lo que dijo
quien ejecutó la corrida, y vale exactamente lo que valga su palabra.

13/13 PASSED, censo 20/20, version v3 verificada desde la corrida. Los expect.topic salen del vocabulario observado, ninguno de leer el .agent. A proposito NO se declara actions en OffTopic, Escalar ni Prompt_Injection: actions vacio no asserta nada (semantica de subconjunto) y contarlo como cobertura seria mentir. La plataforma no puede detectar acciones INESPERADAS por ningun camino.

