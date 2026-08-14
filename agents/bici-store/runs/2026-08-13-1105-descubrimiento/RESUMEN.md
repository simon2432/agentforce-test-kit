# Corrida — descubrimiento

**2026-08-13T11:36:22-03:00** · motor `run-eval`

| | |
|---|---|
| Versión del agente | v3 (`0X9al000000qfiDCAQ`) |
| Auditable en versión | ✅ sí |
| Herramienta | sf @salesforce/cli/2.146.3 · plugin-agent 1.45.0 |
| Suite | `agents/bici-store/suites/descubrimiento.cases.yaml` · 13 casos |
| Duración (la reporta la plataforma) | 54.1 s |

## Resultado

**0 passed · 13 failed · 0 error · 0 missing**

## Qué se verificó, caso por caso

| Caso | Veredicto | Se verificó | NO se verificó |
|---|---|---|---|
| D01 | ❌ FAILED | topic(exact) | — |
| D02 | ❌ FAILED | topic(exact) | — |
| D03 | ❌ FAILED | topic(exact) | — |
| D04 | ❌ FAILED | topic(exact) | — |
| D05 | ❌ FAILED | topic(exact) | — |
| D06 | ❌ FAILED | topic(exact) | — |
| D07 | ❌ FAILED | topic(exact) | — |
| D08 | ❌ FAILED | topic(exact) | — |
| D09 | ❌ FAILED | topic(exact) | — |
| D10 | ❌ FAILED | topic(exact) | — |
| D11 | ❌ FAILED | topic(exact) | — |
| D12 | ❌ FAILED | topic(exact) | — |
| D13 | ❌ FAILED | topic(exact) | — |

⚠️ La columna **"NO se verificó"** no es relleno: un `SKIP` no es un acierto
ni un fallo. Un caso con veredicto verde y media columna derecha llena está
diciendo que se comprobó menos de lo que parece.

## Artefactos de entrada

| Archivo | Bytes | SHA-256 |
|---|---|---|
| `raw-1.json` | 493190 | `c70cc7f5ba32e6c6…` |
| `raw-2.json` | 492949 | `995573ee0be86506…` |
| `raw-3.json` | 493137 | `7648e6ee3b77ee29…` |
| `raw.json` | 493190 | `c70cc7f5ba32e6c6…` |
| `spec.yaml` | 1166 | `8e31cc94e035119f…` |
| `summary-1.json` | 20492 | `82e09d43e66607f0…` |
| `summary-2.json` | 19786 | `0a563435c6762ed9…` |
| `summary-3.json` | 19873 | `dd932f9a0f7732b9…` |

Éstos son los archivos de los que salió todo lo de arriba.
`manifiesto.json` cubre además **este mismo RESUMEN.md**, así que editarlo
a mano también se detecta. `npm run bitacora -- --verificar` recalcula todo.

---

## Nota de quien corrió — ⚠️ AUTO-REPORTADA

Todo lo de arriba se derivó de los artefactos. **Esto no.** Es lo que dijo
quien ejecutó la corrida, y vale exactamente lo que valga su palabra.

13 sondas x 3 corridas, 39/39 identicas. Se descarto el vocabulary.json de ejemplos/bici-store porque describe v2 (hoy Inactive): en v3 el subagente Escalar SI aparece como topic y __human__ no aparece nunca, o sea lo contrario que v2. Los veredictos son todos FAIL a proposito: el centinela __DISCOVERY__ fuerza que la asercion se ejecute para poder leer el actual_value. raw.json es copia de raw-1.json; raw-2 y raw-3 estan en la carpeta.

