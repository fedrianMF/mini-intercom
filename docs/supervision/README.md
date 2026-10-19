# Supervisión de entregables

En este repositorio, cada tarea de `docs/plan/` la implementa un agente de código (Codex CLI). Se trata como el entregable de un proveedor externo: se revisa contra una lista fija antes de aceptarla, y la revisión queda registrada en un informe.

Es el mismo proceso que se aplicaría a un proveedor que desarrolla un módulo de la plataforma.

## Lista de revisión

| Área | Qué se verifica |
|---|---|
| Alcance | Hace lo que pide la tarea, ni más ni menos. Sin dependencias fuera de las acordadas. |
| Compila y pasa | Compilación limpia, pruebas en verde en un ambiente limpio (no en la máquina del proveedor), sin advertencias nuevas. |
| Pruebas | Cubren cada regla del requisito, el camino feliz y los errores. Prueban de verdad lo que dicen probar. |
| Seguridad | Sin secretos reales, dependencias sin vulnerabilidades conocidas (incluidas las transitivas), entradas validadas. |
| Robustez | Errores clasificados (transitorio o permanente), idempotencia, concurrencia, reintentos. |
| Operación | Logs estructurados, health check, configuración por variables, nada fijo en el código. |
| Estilo | Sigue `AGENTS.md` y el código vecino. Nombres claros, comentarios solo donde aportan. |
| Documentación | Lo que un operador necesita saber queda escrito. |

## Resultado

- **Conforme**: se acepta tal cual.
- **Conforme con observaciones**: se acepta; las observaciones menores pasan a una tarea siguiente.
- **No conforme**: se devuelve al proveedor con la lista de correcciones.

## Informes

| Tarea | Resultado | Informe |
|---|---|---|
| 01 · Sistema aduanero simulado | No conforme → corregido en la revisión | [01-legacy-customs.md](01-legacy-customs.md) |
