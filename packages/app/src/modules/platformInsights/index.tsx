import { createFrontendPlugin } from '@backstage/frontend-plugin-api';
import {
  EntityCardBlueprint,
  EntityContentBlueprint,
} from '@backstage/plugin-catalog-react/alpha';

const platformInsightsOverviewCard = EntityCardBlueprint.make({
  name: 'overview',
  params: {
    filter: 'kind:component',
    loader: async () => {
      const { PlatformInsightsOverviewCard } = await import(
        './PlatformInsightsDashboard'
      );
      return <PlatformInsightsOverviewCard />;
    },
  },
});

const platformInsightsContent = EntityContentBlueprint.make({
  name: 'scorecards-dora',
  params: {
    path: '/scorecards-dora',
    title: 'Scorecards & DORA',
    filter: 'kind:component',
    loader: async () => {
      const { PlatformInsightsPage } = await import(
        './PlatformInsightsDashboard'
      );
      return <PlatformInsightsPage />;
    },
  },
});

export const platformInsightsPlugin = createFrontendPlugin({
  pluginId: 'platform-insights',
  extensions: [platformInsightsOverviewCard, platformInsightsContent],
});
