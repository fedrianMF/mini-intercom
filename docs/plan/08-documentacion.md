# 08 · Documentación

- `README.md`:
  - el diagrama de arquitectura incluye la ruta de Ecuador: cola → puente .NET → SOAP → SQL Server;
  - una tabla de componentes por lenguaje: Node/TypeScript, C#/.NET y Python;
  - el enlace a la demo pública;
  - una sección "Kit de certificación".
- `docs/adr/0005-puente-soap-para-sistemas-heredados.md`: por qué un puente en vez de pedir al país que cambie su sistema; contrato propio del cliente frente al WSDL; idempotencia por número de certificado.
- `docs/adr/0006-demo-en-dokploy.md`: por qué Compose en Dokploy para la demo y Helm/Argo CD para producción.
- `docs/runbook.md`:
  - "Ecuador: el sistema SOAP no responde": cómo leer los logs del bridge, revisar `/health` de legacy-customs y SQL Server, y qué pasa con los mensajes (reintento y luego muertos);
  - "Certificar una entidad nueva con el kit".
- Mantén el estilo de los documentos existentes: frases cortas, tablas donde ayudan y comandos que se pueden copiar.
- `docs/seguridad.md`: sección "Firma digital XML", con los parámetros, la PKI de desarrollo, cómo se registra el certificado de un país y cómo se rota.
- `docs/runbook.md`: "Un país recibe 422 signature_invalid" (certificado vencido o rotado sin registrar, documento alterado) y "Generar el reporte de estado para una entidad".
- `README.md`: tabla de lenguajes actualizada (el hub en Node verifica firmas, Python firma y certifica, .NET conecta el sistema heredado).
