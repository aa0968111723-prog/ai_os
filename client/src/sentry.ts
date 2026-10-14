import * as Sentry from "@sentry/react";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // 只取樣 20% 的 transaction 以控制 quota
    tracesSampleRate: 0.2,
    // Session replay 只取樣 10%（含錯誤的 session 全取）
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // 正式環境只上報 errorsPerMinute 以上的錯誤，避免 quota 爆表
    beforeSend(event) {
      // 不報 chunk load error（ChunkLoadError）——通常是使用者還在用舊版，
      // 重新整理就會消失，不是真正的 bug
      const isChunkError =
        event.exception?.values?.some((v) =>
          v.type?.includes("ChunkLoadError"),
        ) ?? false;
      if (isChunkError) return null;
      return event;
    },
  });
}

export { Sentry };
