/**
 * App entry: build the composition-root container for the current learner, hydrate
 * persisted settings and restore any in-progress reading (revisit restore, task 10.4),
 * then mount the router under the AppProvider + React Query providers. Before sign-in the
 * learner is the `anonymous` namespace; the AuthAdapter migrates to `lexia_<userId>` on
 * first sign-in (out of scope for this bootstrap).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAppRouter } from './ui/router';
import { createContainer } from './ui/app/container';
import { AppProvider } from './ui/app/AppContext';
import { hydrateSettings, restoreReadingSession } from './state/controllers/sessionBootstrap';
import { ANONYMOUS_USER_ID } from './infra/auth/authAdapter';
// F-7: self-hosted design fonts (@fontsource, font-display: swap). The variable
// families ship one file with unicode-range subsetting, so the CJK subsets
// lazy-load per glyph; IBM Plex Sans pins the 400/500/600/700 weights we use.
import '@fontsource-variable/newsreader/index.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource-variable/noto-sans-jp/index.css';
import '@fontsource-variable/noto-serif-jp/index.css';
import './ui/theme/global.css';

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;

  const userId = ANONYMOUS_USER_ID;
  const container = await createContainer(userId);

  // Restore prior preferences + reading position before the first paint.
  await hydrateSettings(container.settings, container.repos.settings, userId);
  await restoreReadingSession(
    { passages: container.repos.passages, progress: container.repos.progress, session: container.session },
    userId,
    container.now(),
  );

  const queryClient = new QueryClient();
  const router = createAppRouter();

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppProvider container={container}>
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
