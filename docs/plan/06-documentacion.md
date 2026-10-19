# 06 · Documentación

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
