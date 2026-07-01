import { metrics } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { env } from './env-schema.js';

const exporter = new OTLPTraceExporter({
  url: env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces',
});

const metricExporter = new OTLPMetricExporter({
  url: env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/metrics',
});
const meterProvider = new MeterProvider({
  readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60000 })],
});
metrics.setGlobalMeterProvider(meterProvider);

export const sdk = new NodeSDK({
  traceExporter: exporter,
  serviceName: env.OTEL_SERVICE_NAME,
});
sdk.start();
