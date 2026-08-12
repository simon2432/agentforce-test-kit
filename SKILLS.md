# Skills

**Al copiar al repo nuevo, esta carpeta se renombra a `.claude/skills/`.**
(Se llama distinto acá sólo porque las rutas que empiezan con punto están
protegidas en el entorno donde se armó el paquete.)

## Qué hay

16 skills de `forcedotcom/sf-skills`, de ~112 instaladas. Las otras 96 son
ruido de contexto para un repo especializado en testing de agentes.

### Núcleo Agentforce (6)

| Skill | Por qué está |
|---|---|
| `agentforce-test` | La central. Test specs, `test create/run/run-eval/results`, cobertura, métricas, CI/CD, y testing de seguridad OWASP LLM Top 10 con payloads listos. **Parcheada — ver abajo** |
| `agentforce-generate` | Autoría y validación del `.agent`, authoring bundles, `sf agent preview` |
| `agentforce-architecture-analyze` | Inventario de planner, subagentes, acciones, flows y Apex, con grafo Mermaid. **La vía para conocer un agente nuevo antes de escribirle tests** |
| `agentforce-observe` | Traces de producción vía Data Cloud. Necesaria porque los traces locales del agente publicado vienen vacíos |
| `agentforce-d360-analyze` | Vista 360 de una sesión puntual por session id. Debug fino |
| `agentforce-bot-upgrade` | Migración de agentes. Tangencial al testing pero es el otro gran caso de uso |

### Soporte — las que el spike necesitó de verdad (10)

| Skill | Necesidad concreta |
|---|---|
| `platform-soql-query` | **Imprescindible.** `sf agent list` no existe: SOQL sobre `BotVersion` es la única vía para verificar la versión activa, y toda la auditoría de escritura pasa por acá |
| `platform-metadata-retrieve` | Traer los Flows de las acciones para auditar su DML sin ejecutarlos |
| `platform-metadata-deploy` | Desplegar `AiEvaluationDefinition` sin pasar por `test create` |
| `dx-org-switch` + `dx-org-manage` | Higiene de org. En el spike un alias inexistente hizo que la CLI sugiriera la sandbox de otro cliente |
| `platform-tracing-agentforce-configure` | Prerequisito de `agentforce-observe`: habilitar Session Tracing |
| `data360-query` | SQL de Data Cloud, base de la observabilidad de sesiones |
| `platform-docs-get` | Documentación de Salesforce desde la CLI |
| `platform-apex-logs-debug` | Cuando una acción de Apex falla dentro de un test |
| `platform-data-and-tooling-api-context-get` | Contexto de sObjects para las consultas de auditoría |

## `agentforce-test` está parcheada

Es buena y la mantuvimos, pero fue escrita sin conocer los 13 defectos que
medimos. Dos cambios:

**1. Bloque de correcciones al tope del `SKILL.md`** — apunta a
`knowledge/02-known-issues.md` y lista las tres correcciones que invalidan partes
del procedimiento original.

**2. `assets/basic-test-spec.yaml` y `assets/standard-test-spec.yaml`
corregidos.** Los dos traían:

```yaml
- utterance: "I want to talk to a real person"
  expectedTopic: Escalation      # ← falla siempre
```

El runtime **no devuelve el nombre del subagente** cuando una escalación se
concreta: devuelve un literal de humano que además varía por motor —
`human` en `test run`, `human__` o `__human__` en `run-eval`. Corregido a
`human`, con la nota de que hay que compararlo con `contains`.

⚠️ **Si algún día actualizás las skills desde upstream, hay que re-aplicar los
dos parches.** Están marcados con `CORREGIDO` en el texto para poder encontrarlos.

## Lo que aporta `agentforce-test` que no teníamos

Vale la pena mirarlo: trae 7 catálogos de payloads OWASP LLM Top 10
(`assets/payloads/`) — prompt injection, fuga de system prompt, exceso de agencia,
divulgación de información sensible, desinformación, manejo de output, consumo
sin límites — más referencias de scoring de seguridad y remediación.

Eso conecta directo con un hallazgo del spike: el guardrail `Prompt_Injection` de
la plataforma intercepta esos intentos antes de que lleguen a tus subagentes. Un
test de seguridad que espere `off_topic` falla aunque el agente se haya comportado
perfecto. Al usar esos payloads, el `expectedTopic` sale de `discover`, no del
catálogo.

## Duplicados

Si en el entorno destino también está instalado el plugin `agentforce-adlc`, van
a existir `agentforce-adlc:agentforce-test` y `agentforce-test` con el mismo
nombre — y la elección entre las dos es azarosa. Dejar **una sola**. El subagente
`adlc-qa` también se solapa.
