{{- define "mi.name" -}}{{ .Release.Name }}{{- end -}}

{{- define "mi.labels" -}}
app.kubernetes.io/part-of: mini-intercom
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "mi.image" -}}
{{ .root.Values.image.registry }}/{{ .image.repository }}:{{ .image.tag }}
{{- end -}}

{{- define "mi.securityContext" -}}
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities: { drop: [ALL] }
  seccompProfile: { type: RuntimeDefault }
{{- end -}}

{{- define "mi.hubEnv" -}}
- name: DATABASE_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.hub.existingSecret }}, key: DATABASE_URL } }
- name: AMQP_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.hub.existingSecret }}, key: AMQP_URL } }
{{- end -}}
