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
