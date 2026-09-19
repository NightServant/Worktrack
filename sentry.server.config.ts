// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://81cbdb46c7c408679671744793555440@o4512111486435328.ingest.us.sentry.io/4512111491022848",

  // 10%, not the wizard's 1 (= 100%). Performance tracing bills per span and
  // the free tier's span allowance is small, so a sampling rate meant for a
  // first look at localhost is a quota that empties itself on the first day the
  // landing page gets shared. Errors are NOT sampled -- every exception is sent
  // regardless of this number, which is the half that was missing.
  tracesSampleRate: 0.1,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});
