# Tus agentes

Acá va **tu** agente. Un subdirectorio por agente.

```
agents/
  _template/          ← las plantillas, no tocar
  mi-agente/
    agent.json        ← el registro: org, tipo, subagentes, qué toca datos
    vocabulary.json   ← los destinos REALES. Se genera, no se escribe
    BITACORA.md       ← el rastro de auditoría. Append-only, se genera
    suites/
      descubrimiento.cases.yaml
      ruteo.cases.yaml
      contenido.cases.yaml
    runs/
      2026-08-12-1430-descubrimiento/
      2026-08-12-1505-ruteo/         ← una carpeta por corrida, TODO adentro
```

El paso a paso está en [`EMPEZAR-ACA.md`](../EMPEZAR-ACA.md), minuto 5.

---

## Una carpeta por corrida, y la bitácora

**Regla:** cada corrida contra una org va en su propia carpeta, dentro del
agente, con nombre `<YYYY-MM-DD-HHmm>-<proposito>`. Nunca en la raíz, nunca
mezclando dos agentes, nunca reusando una carpeta.

Adentro va todo lo de esa corrida:

| | |
|---|---|
| `spec.yaml` | lo que se le mandó al motor |
| `raw.json` | lo que devolvió, sin tocar |
| `informe.md` | el informe curado (`lib/report.mjs`) |
| `RESUMEN.md` | **qué se testeó y qué dio, caso por caso** — se genera |
| `manifiesto.json` | el sha256 de cada archivo — se genera |

### Registrar la corrida

```powershell
npm run bitacora -- --registrar --run agents\<slug>\runs\<carpeta> `
  --suite agents\<slug>\suites\<x>.cases.yaml `
  --proposito "batería de ruteo" --nota "qué decidiste y por qué"
```

Escribe `RESUMEN.md`, `manifiesto.json`, y agrega la entrada a `BITACORA.md`.

### Las dos capas, y por qué están separadas

La bitácora tiene **capa derivada** y **capa narrada**, marcadas como tales.

🚨 **Un log que el ejecutor escribe sobre sí mismo es la evidencia más débil del
repo, y por su ubicación se lee como la más fuerte.** Si quien corrió se saltea
un paso o se equivoca, la narración va a salir igual de convincente.

Por eso la capa derivada la calcula el script leyendo cosas que existen aparte:
la versión del agente sale del crudo (la emite la plataforma, no nosotros), los
veredictos se **recalculan** en vez de copiarse, y cada artefacto lleva su hash.
Eso no se puede falsear sin falsear los artefactos.

La capa narrada vale lo que valga la palabra de quien la escribió, y lo dice.

### El control

```powershell
npm run bitacora -- --verificar --agente agents\<slug>
```

Detecta tres cosas, las tres mecánicas:

- un artefacto **alterado o borrado** después de registrarse
- una corrida **que nunca se registró**
- una entrada **borrada** de la bitácora

La segunda es la que más importa: es el único control contra el olvido. Una
regla escrita se puede incumplir sin que se note; una corrida sin entrada, no.

### Qué se versiona

Los **crudos no** — traen las conversaciones enteras, que en un agente de cliente
es dato sensible, y en git es para siempre. Sí se versionan `BITACORA.md`,
`RESUMEN.md`, `manifiesto.json`, `informe.md` y `spec.yaml`.

⚠️ **Consecuencia, dicha de frente:** quien clone el repo puede comprobar la
**consistencia** de la cadena, no re-derivarla. Para re-derivar hace falta el
crudo, que queda en la máquina de quien corrió.

---

## Los tres archivos

### `agent.json` — se escribe a mano

El registro del agente. Cada campo trae un comentario que explica de dónde sale y
por qué importa.

Dos campos que no son decoración:

- **`org.orgId`** es una **guarda**, y desde 2026-08-12 está implementada:
  `npm run preflight -- --agent agents/<slug>/agent.json` verifica que el alias
  resuelva a ese Id y **aborta si no**. Un error de tipeo en un alias apunta a la
  org de otro cliente y la corrida sale bien igual — otro agente, otras
  respuestas, ningún error.
- **`quality.respondingTopics`** define qué entra en el promedio de las métricas
  de calidad. Si incluís destinos de rechazo, escalación o protecciones, **el
  promedio queda al revés** — esas métricas castigan los rechazos correctos. Ver
  `LIMITES.md` punto 8.

### `vocabulary.json` — se GENERA

🚨 **Este archivo no se escribe leyendo el código del agente.**

El código describe la intención; el clasificador hace otra cosa. Derivarlo del
prompt falló en los tres agentes medidos — 2 de 20, 1 de 8, 1 de 10 — y en uno de
ellos el código decía **explícitamente lo contrario** de lo que hizo el
clasificador.

Se genera corriendo el descubrimiento **como mínimo 3 veces**. Una sola
observación es ruido, no evidencia.

Y va a contener destinos que **no existen en tu código**: protecciones de la
plataforma y literales de escalación. Es normal, y es exactamente el motivo por
el que este paso existe.

⚠️ La lista de destinos de plataforma que conocemos es un **piso**, no la lista
completa. Salesforce no la documenta.

### `suites/*.cases.yaml` — se escriben, con el vocabulario al lado

Las cuatro reglas:

- El destino esperado sale de `vocabulary.json`.
- Nombres **completos**: `GeneralFAQ`, no `FAQ`. El motor compara por
  coincidencia parcial y los fragmentos pasan por accidente.
- Escalación → `human` con comparación `contains`. Nunca el nombre de tu
  subagente de escalación.
- El nombre de una acción es su **alias**, no el destino.

Y la que más engaña: **`actions: []` no verifica nada.** Es semántica de
subconjunto. Medido: 20 casos con lista vacía, los 20 invocaron acciones reales,
los 20 dieron verde. No cuenta como cobertura.

---

## Dos marcas que conviene usar

**`severity: safety`** — para los casos donde un fallo es un incidente, no una
regresión: consejo médico o legal, fuga de la configuración interna, datos
personales.

➡️ **Y corrélos N veces, no una.** Un fallo intermitente en un camino de
seguridad es indistinguible de verde si mirás una sola corrida. Medimos un fallo
real de escalación que aparecía 1 de cada 4 veces.

**`xfail` con `reason` obligatorio** — para lo que está roto **por la
plataforma**. No mueve el veredicto, y si algún día pasa hay que gritarlo:
significa que la plataforma cambió.

---

## Lo que nunca va acá

🚨 **Ningún identificador real** en la configuración de un caso — ni un
`RoutableId`, ni un `CaseId`, ni el id de una sesión.

Es el único mecanismo por el que las pruebas pueden modificar datos de verdad.
Sin identificadores reales, las acciones no encuentran ningún registro y afectan
cero filas — eso está medido, incluso contra una org con automatizaciones que
escriben.

`lib/gen-spec.mjs` tiene una guarda que los rechaza. **No confíes sólo en la
guarda.**

---

Ver un agente completo ya armado: [`ejemplos/bici-store/`](../ejemplos/).
