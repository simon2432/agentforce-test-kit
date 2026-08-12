# Evidencia

**Esta carpeta no es parte del producto.** Es el registro crudo de las tres
rondas de investigación de las que salió todo el `knowledge/`.

Se conserva por una razón concreta: cuando alguien dude de una afirmación del
repo, acá está la corrida que la respalda, con su fecha y su salida sin editar.

---

## 🔒 Antes de compartir este repositorio

**Esta carpeta contiene metadata real de un cliente** (Clínica Alemana): el
código del agente, sus flows, una clase Apex, el Org Id, y ~3,7 MB de
conversaciones de prueba.

➡️ Si vas a publicar el repo o compartirlo fuera del equipo, **borrá
`evidencia/` primero.** El producto funciona sin ella: nada de `lib/`,
`knowledge/`, `agents/` ni la documentación depende de estos archivos.

---

## Qué hay

| | |
|---|---|
| `ronda-1-spike.md` | 2.576 líneas. Agente real de cliente, sandbox. ~150 ejecuciones. **Exploratoria** |
| `ronda-2-bici-store.md` | 2.580 líneas. Agente de juguete hecho a propósito, otra org. ~180 ejecuciones. **Cada hallazgo de la ronda 1 convertido en predicción falsable y medido** |
| `ronda-3-alemana.md` | 1.896 líneas. Agente de cliente en versión final, con flows que escriben de verdad, tercera org. 101 ejecuciones. **La primera vez que el repo se usó como producto** |
| `runs/` | Las salidas crudas de las corridas, ~13 MB, organizadas por fase |
| `agente-alemana/` | El registro del agente de la ronda 3 y su proyecto SFDX |

---

## Por qué la ronda 3 vale más que las otras dos

Fue la primera vez que el repo se usó **contra un agente que no habíamos armado
nosotros**. Y corrigió más que las dos anteriores juntas:

- Cerró los dos riesgos que estaban abiertos. **Los dos dieron el resultado
  malo.**
- Tiró abajo la hipótesis principal sobre por qué no funcionan las variables de
  contexto.
- Re-atribuyó dos defectos que estaban mal explicados.
- Encontró **6 defectos nuevos de la plataforma** y **3 bugs en las utilidades
  del propio repo**.

Ese último punto es el más incómodo: la capa que existe para corregir los errores
de la plataforma tenía tres errores propios, y aparecieron recién en la tercera
ronda de uso.

---

## Cómo leer una ronda

Los tres documentos están en orden cronológico de fases. Cada fase tiene:
hipótesis → comando exacto → salida cruda → qué se concluyó.

**Lo que está acá es el material crudo, con sus errores incluidos.** Varias
conclusiones intermedias fueron corregidas después. La versión destilada y
vigente está en `knowledge/`, no acá.

Si una afirmación de `knowledge/` contradice algo de esta carpeta, **manda
`knowledge/`**.
