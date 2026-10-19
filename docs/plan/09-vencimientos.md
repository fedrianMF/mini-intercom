# 09 · Calendario de vencimientos (Python, opcional)

Cubre la función del TDR "calendario de vencimientos": certificados, secretos y credenciales que caducan.

- `deploy/vencimientos.yaml`: lista de `{nombre, tipo: certificado|secreto|dominio|licencia, responsable, vence: YYYY-MM-DD | archivo: ruta.crt, aviso_dias: 30}`. Si hay `archivo`, la fecha se lee del certificado X.509.
- `intercom-cert expiries deploy/vencimientos.yaml [--markdown salida.md]`:
  - imprime una tabla ordenada por fecha;
  - sale con código 1 si algo vence dentro de su `aviso_dias` o ya venció.
  Dependencia nueva: `pyyaml` 6.0.3.
- Workflow `.github/workflows/vencimientos.yml`: semanal (`schedule`) y manual, corre el comando y publica la tabla en el resumen del job (`$GITHUB_STEP_SUMMARY`). Falla si hay algo por vencer.
- Pruebas: una fecha dentro del aviso, una vencida, una lejana y una leída de un `.crt` generado en la prueba.
