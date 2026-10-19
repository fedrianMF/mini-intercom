# 07 · Firma digital XML (Node + Python)

El certificado de origen en XML llega **firmado por la entidad emisora** (XMLDSig, firma envuelta). El hub verifica la firma con el certificado registrado del país y rechaza los documentos alterados. Responde a la "parametrización de firma digital" del TDR.

- Firma: Python, en el kit de certificación, porque es la herramienta que usa la entidad.
- Verificación: Node, en el hub.

Que sean dos lenguajes distintos prueba que la firma es estándar y no depende de una librería.

## Parámetros de firma (iguales en los dos lados)

- Firma envuelta (`enveloped-signature`) sobre todo el documento (`URI=""`).
- `RSA-SHA256`, digest `SHA-256` y canonicalización `exc-c14n` (`http://www.w3.org/2001/10/xml-exc-c14n#`).
- `KeyInfo` con el certificado X.509. El hub **no confía** en el certificado que viene en el documento: lo compara con el registrado para el país de origen.

## PKI de desarrollo

- `scripts/dev-pki.sh` genera con `openssl`, si no existen, una clave RSA 3072 y un certificado autofirmado por país (`BO`, `PE`, `CO`, `EC`). Van en `deploy/pki/<PAIS>.key` y `.crt`.
- `.gitignore` incluye `deploy/pki/*.key`. Los `.crt` sí se versionan.
- Para pruebas en CI: `services/hub/test/fixtures/` con un `.crt` de prueba y dos XML **ya firmados por el kit de Python** (uno válido y uno con `<Cantidad>` alterada después de firmar). No se versiona ninguna clave privada; el script que regenera los fixtures está en `tools/certification-kit/scripts/make_fixtures.py`.

## Hub (Node, `services/hub`)

- Dependencias: `xml-crypto` 6.4.0 y `@xmldom/xmldom` 0.9.12.
- `src/signature.ts`, con `verifyXmlSignature(xml, trustedCertPem)`:
  - devuelve `{valid: true}` o `{valid: false, reason}`;
  - exige exactamente una firma;
  - exige que la referencia cubra el documento completo, para evitar el ataque de envoltura de firma: comprueba que la `Reference` tiene `URI=""` y que el elemento firmado es la raíz;
  - exige que el certificado del `KeyInfo` coincida con el de confianza (compara la huella SHA-256).
- Configuración: `XMLDSIG_TRUST_DIR` (carpeta con `<PAIS>.crt`) y `XMLDSIG_REQUIRED_COUNTRIES` (lista separada por comas; por defecto vacía, para no romper nada).
- Se valida después del XSD. Si el país de origen está en la lista y la firma falta o no es válida, responde **422** problem+json con `code: "signature_invalid"` y el motivo.
- Se registra en el evento `RECEIVED` el detalle `signature: "verified"` o `"not-required"`, para que se vea en la traza.
- Métrica: `intercom_signature_checks_total{origin_country, result}`.
- Pruebas: firma válida, documento alterado, certificado de otro país, sin firma con el país obligado, y sin firma con el país no obligado.

## Kit de certificación (Python)

- Dependencias: `signxml` 5.2.0 (trae `lxml` y `cryptography`).
- Comando `intercom-cert sign --key deploy/pki/BO.key --cert deploy/pki/BO.crt entrada.xml salida.xml`.
- Casos nuevos:
  - `signed-xml`: un XML firmado llega a `ACCEPTED`;
  - `tampered-xml`: el mismo, alterado después de firmar, devuelve 422 `signature_invalid`.
  Se ejecutan solo si se pasa `--sign-key` y `--sign-cert`. La página pública los ejecuta siempre, con la clave de BO montada en el contenedor.
- Prueba: `pytest` firma la muestra y verifica con `signxml` (`XMLVerifier`) usando el mismo certificado.

## Compose y Dokploy

- `hub`: monta `deploy/pki` en solo lectura como `XMLDSIG_TRUST_DIR` y recibe `XMLDSIG_REQUIRED_COUNTRIES=BO`.
- `certification-kit`: monta `deploy/pki/BO.key` y `BO.crt`.
- `scripts/demo.sh`: llama a `scripts/dev-pki.sh` al inicio y agrega el paso "XML firmado y XML alterado".
- Dokploy: la clave de BO viene de una variable con su contenido en base64, que el contenedor escribe a un archivo al arrancar. Documéntalo en `05-dokploy.md`.

## Verificación

```sh
./scripts/dev-pki.sh
cd services/hub && npm test && cd ../..
pytest tools/certification-kit
docker compose up -d --build && ./scripts/demo.sh   # el paso de firma muestra ACCEPTED y luego 422 signature_invalid
```
