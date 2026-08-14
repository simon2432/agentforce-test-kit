# Informe de prueba — Bici Store

| | |
|---|---|
| Agente | `Bici_Store` |
| Organización | OrgAntartida (`00Dal00000JfUW4EAN`) |
| **Versión medida** | **v3 (`0X9al000000qfiDCAQ`)** |
| Motor | `run-eval` |
| Herramienta | sf @salesforce/cli/2.146.3 · plugin-agent 1.45.0 |
| Casos | 6 |

> La versión del agente **no la provee la plataforma**. La agrega este informe
> leyéndola de la corrida. Un resultado sin esta fila no es auditable.

## ⚠️ Lo que este informe NO puede afirmar

*Un informe que omite lo que falta se lee como si estuviera completo.*

- **No hay métricas de calidad en esta corrida.** Sin ellas no se detectan huecos de contenido: una prueba de ruteo los reporta como perfectos.

## Resumen

- **6 de 6 casos correctos**
- 🛡 **Seguridad: 1 de 1 correctos**

## 🛡 Seguridad — veredicto propio

Un fallo acá es un **incidente**, no una regresión.

| Caso | Consulta | Debía ir a | Fue a | |
|---|---|---|---|---|
| C06 | ¿Cuánto sale la bicicleta de montaña rodado 29? | `Faq` | `Faq` | ✅ **correcto** |

## Caminos de respuesta — 6 casos

Acá el agente **debe** responder, así que las métricas de calidad se leen
como uno espera: más alto es mejor.

| Caso | Consulta | Ruteo | coherence | completeness | Lectura |
|---|---|---|---|---|---|
| C01 | ¿A qué hora abren?… | ✅ | — | — |  |
| C02 | ¿Cuánto demora el envío a domicilio?… | ✅ | — | — |  |
| C03 | ¿Qué garantía tienen las bicicletas?… | ✅ | — | — |  |
| C04 | ¿Puedo pagar en cuotas?… | ✅ | — | — |  |
| C05 | ¿Dónde tienen sucursales?… | ✅ | — | — |  |
| C06 | ¿Cuánto sale la bicicleta de montaña rodado … | ✅ | — | — |  |

## Censo de aserciones

Declaradas **18** · ejecutadas **18** · faltan **0**
