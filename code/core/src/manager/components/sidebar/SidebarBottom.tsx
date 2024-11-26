import React, { useEffect, useRef, useState } from 'react';

import { styled } from '@storybook/core/theming';
import { type API_FilterFunction, type API_StatusValue } from '@storybook/core/types';

import {
  TESTING_MODULE_CRASH_REPORT,
  TESTING_MODULE_PROGRESS_REPORT,
  type TestingModuleCrashReportPayload,
  type TestingModuleProgressReportPayload,
} from '@storybook/core/core-events';
import {
  type API,
  type State,
  useStorybookApi,
  useStorybookState,
} from '@storybook/core/manager-api';

import { NotificationList } from '../notifications/NotificationList';
import { TestingModule } from './TestingModule';

// This ID is used dynamically add/remove space at the bottom to prevent overlapping the main sidebar content.
const SIDEBAR_BOTTOM_SPACER_ID = 'sidebar-bottom-spacer';
// This ID is used by some integrators to target the (fixed position) sidebar bottom element so it should remain stable.
const SIDEBAR_BOTTOM_WRAPPER_ID = 'sidebar-bottom-wrapper';

const filterNone: API_FilterFunction = () => true;
const filterWarn: API_FilterFunction = ({ status = {} }) =>
  Object.values(status).some((value) => value?.status === 'warn');
const filterError: API_FilterFunction = ({ status = {} }) =>
  Object.values(status).some((value) => value?.status === 'error');
const filterBoth: API_FilterFunction = ({ status = {} }) =>
  Object.values(status).some((value) => value?.status === 'warn' || value?.status === 'error');

const getFilter = (warningsActive = false, errorsActive = false) => {
  if (warningsActive && errorsActive) {
    return filterBoth;
  }

  if (warningsActive) {
    return filterWarn;
  }

  if (errorsActive) {
    return filterError;
  }
  return filterNone;
};

const Content = styled.div(({ theme }) => ({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  color: theme.color.defaultText,
  fontSize: theme.typography.size.s1,

  '&:empty': {
    display: 'none',
  },

  // Integrators can use these to style their custom additions
  '--sb-sidebar-bottom-card-background': theme.background.content,
  '--sb-sidebar-bottom-card-border': `1px solid ${theme.appBorderColor}`,
  '--sb-sidebar-bottom-card-border-radius': `${theme.appBorderRadius + 1}px`,
  '--sb-sidebar-bottom-card-box-shadow': `0 1px 2px 0 rgba(0, 0, 0, 0.05), 0px -5px 20px 10px ${theme.background.app}`,
}));

interface SidebarBottomProps {
  api: API;
  notifications: State['notifications'];
  status: State['status'];
  isDevelopment?: boolean;
}

export const SidebarBottomBase = ({
  api,
  notifications = [],
  status = {},
  isDevelopment,
}: SidebarBottomProps) => {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [warningsActive, setWarningsActive] = useState(false);
  const [errorsActive, setErrorsActive] = useState(false);
  const { testProviders } = useStorybookState();

  const warnings = Object.values(status).filter((statusByAddonId) =>
    Object.values(statusByAddonId).some((value) => value?.status === 'warn')
  );
  const errors = Object.values(status).filter((statusByAddonId) =>
    Object.values(statusByAddonId).some((value) => value?.status === 'error')
  );
  const hasWarnings = warnings.length > 0;
  const hasErrors = errors.length > 0;

  useEffect(() => {
    const spacer = spacerRef.current;
    const wrapper = wrapperRef.current;
    if (spacer && wrapper) {
      const resizeObserver = new ResizeObserver(() => {
        if (spacer && wrapper) {
          spacer.style.height = `${wrapper.clientHeight}px`;
        }
      });
      resizeObserver.observe(wrapper);
      return () => resizeObserver.disconnect();
    }
  }, []);

  useEffect(() => {
    const filter = getFilter(hasWarnings && warningsActive, hasErrors && errorsActive);
    api.experimental_setFilter('sidebar-bottom-filter', filter);
  }, [api, hasWarnings, hasErrors, warningsActive, errorsActive]);

  useEffect(() => {
    const onCrashReport = ({ providerId, ...details }: TestingModuleCrashReportPayload) => {
      api.updateTestProviderState(providerId, {
        details,
        running: false,
        crashed: true,
        watching: false,
      });
    };

    const onProgressReport = async ({
      providerId,
      ...result
    }: TestingModuleProgressReportPayload) => {
      if (result.status === 'failed') {
        api.updateTestProviderState(providerId, { ...result, running: false, failed: true });
      } else {
        const update = { ...result, running: result.status === 'pending' };
        api.updateTestProviderState(providerId, update);

        const { mapStatusUpdate, ...state } = testProviders[providerId];
        const statusUpdate = mapStatusUpdate?.({ ...state, ...update });

        // TODO: Remove as soon as frontend is refactored to use the new statusUpdate
        const testProviderID = 'storybook/test/test-provider';
        const a11yProviderID = 'storybook/addon-a11y/test-provider';
        const a11yPanelID = 'storybook/a11y/panel';
        const statusMap: Record<any['status'], API_StatusValue> = {
          failed: 'error',
          passed: 'success',
          warning: 'warn',
          pending: 'pending',
        };

        if (providerId === testProviderID) {
          const obj = Object.fromEntries(
            (result.details?.testResults || []).flatMap((testResult: any) =>
              testResult.results
                .map(({ storyId, status: reportStatus, testRunId, reports, ...rest }: any) => {
                  const report = reports.find((r: any) => r.id === 'a11y');
                  if (storyId && report) {
                    const statusObject = {
                      title: 'Accessibility tests',
                      status: statusMap[report.status],
                      data: {
                        testRunId,
                      },
                      onClick: () => {
                        api.setSelectedPanel(a11yPanelID);
                        api.togglePanel(true);
                      },
                    };
                    return [storyId, statusObject];
                  }
                })
                .filter(Boolean)
            )
          );
          await api.experimental_updateStatus(a11yProviderID, obj);
        }
        // TODOEND: Remove as soon as frontend is refactored to use the new statusUpdate
        if (statusUpdate) {
          await api.experimental_updateStatus(providerId, statusUpdate);
        }
      }
    };

    api.on(TESTING_MODULE_CRASH_REPORT, onCrashReport);
    api.on(TESTING_MODULE_PROGRESS_REPORT, onProgressReport);

    return () => {
      api.off(TESTING_MODULE_CRASH_REPORT, onCrashReport);
      api.off(TESTING_MODULE_PROGRESS_REPORT, onProgressReport);
    };
  }, [api, testProviders]);

  const testProvidersArray = Object.values(testProviders || {});
  if (!hasWarnings && !hasErrors && !testProvidersArray.length && !notifications.length) {
    return null;
  }

  return (
    <div id={SIDEBAR_BOTTOM_SPACER_ID} ref={spacerRef}>
      <Content id={SIDEBAR_BOTTOM_WRAPPER_ID} ref={wrapperRef}>
        <NotificationList notifications={notifications} clearNotification={api.clearNotification} />
        {isDevelopment && (
          <TestingModule
            {...{
              testProviders: testProvidersArray,
              errorCount: errors.length,
              errorsActive,
              setErrorsActive,
              warningCount: warnings.length,
              warningsActive,
              setWarningsActive,
            }}
          />
        )}
      </Content>
    </div>
  );
};

export const SidebarBottom = ({ isDevelopment }: { isDevelopment?: boolean }) => {
  const api = useStorybookApi();
  const { notifications, status } = useStorybookState();
  return (
    <SidebarBottomBase
      api={api}
      notifications={notifications}
      status={status}
      isDevelopment={isDevelopment}
    />
  );
};
