import type { FC, PropsWithChildren } from 'react';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import {
  STORY_FINISHED,
  STORY_RENDER_PHASE_CHANGED,
  type StoryFinishedPayload,
} from 'storybook/internal/core-events';
import {
  useAddonState,
  useChannel,
  useParameter,
  useStorybookState,
} from 'storybook/internal/manager-api';
import type { Report } from 'storybook/internal/preview-api';
import { convert, themes } from 'storybook/internal/theming';

import { HIGHLIGHT } from '@storybook/addon-highlight';

import type { AxeResults, Result } from 'axe-core';

import { ADDON_ID, EVENTS } from '../constants';
import type { A11yParameters } from '../params';
import type { A11YReport } from '../types';

export interface Results {
  passes: Result[];
  violations: Result[];
  incomplete: Result[];
}

export interface A11yContextStore {
  results: Results;
  highlighted: string[];
  toggleHighlight: (target: string[], highlight: boolean) => void;
  clearHighlights: () => void;
  tab: number;
  setTab: (index: number) => void;
  status: Status;
  setStatus: (status: Status) => void;
  error: unknown;
  handleManual: () => void;
}

const colorsByType = [
  convert(themes.light).color.negative, // VIOLATION,
  convert(themes.light).color.positive, // PASS,
  convert(themes.light).color.warning, // INCOMPLETION,
];

export const A11yContext = createContext<A11yContextStore>({
  results: {
    passes: [],
    incomplete: [],
    violations: [],
  },
  highlighted: [],
  toggleHighlight: () => {},
  clearHighlights: () => {},
  tab: 0,
  setTab: () => {},
  setStatus: () => {},
  status: 'initial',
  error: undefined,
  handleManual: () => {},
});

const defaultResult = {
  passes: [],
  incomplete: [],
  violations: [],
};

type Status = 'initial' | 'manual' | 'running' | 'error' | 'ran' | 'ready';

export const A11yContextProvider: FC<PropsWithChildren> = (props) => {
  const parameters = useParameter<A11yParameters>('a11y', {
    manual: false,
  });

  const getInitialStatus = useCallback((manual = false) => (manual ? 'manual' : 'initial'), []);

  const [results, setResults] = useAddonState<Results>(ADDON_ID, defaultResult);
  const [tab, setTab] = useState(0);
  const [error, setError] = React.useState<unknown>(undefined);
  const [status, setStatus] = useState<Status>(getInitialStatus(parameters.manual!));
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const { storyId } = useStorybookState();

  const handleToggleHighlight = useCallback((target: string[], highlight: boolean) => {
    setHighlighted((prevHighlighted) =>
      highlight
        ? [...prevHighlighted, ...target]
        : prevHighlighted.filter((t) => !target.includes(t))
    );
  }, []);

  const handleClearHighlights = useCallback(() => setHighlighted([]), []);

  const handleSetTab = useCallback(
    (index: number) => {
      handleClearHighlights();
      setTab(index);
    },
    [handleClearHighlights]
  );

  const handleError = useCallback((err: unknown) => {
    setStatus('error');
    setError(err);
  }, []);

  const handleResult = useCallback(
    (axeResults: AxeResults, id: string) => {
      if (storyId === id) {
        setStatus('ran');
        setResults(axeResults);

        setTimeout(() => {
          if (status === 'ran') {
            setStatus('ready');
          }
        }, 900);
      }
    },
    [setResults, status, storyId]
  );

  const handleReport = useCallback(
    ({ reporters }: StoryFinishedPayload) => {
      const a11yReport = reporters.find((r) => r.id === 'a11y') as Report<A11YReport> | undefined;

      if (a11yReport) {
        if ('error' in a11yReport.result) {
          handleError(a11yReport.result.error);
        } else {
          handleResult(a11yReport.result, storyId);
        }
      }
    },
    [handleError, handleResult, storyId]
  );

  const handleReset = useCallback(
    ({ newPhase }: { newPhase: string }) => {
      if (newPhase === 'loading') {
        setResults(defaultResult);
        if (parameters.manual) {
          setStatus('manual');
        } else {
          setStatus('running');
        }
      }
    },
    [parameters.manual, setResults]
  );

  const emit = useChannel(
    {
      [EVENTS.RESULT]: handleResult,
      [EVENTS.ERROR]: handleError,
      [STORY_RENDER_PHASE_CHANGED]: handleReset,
      [STORY_FINISHED]: handleReport,
    },
    [handleReset, handleReport, handleReset, handleError, handleResult]
  );

  const handleManual = useCallback(() => {
    setStatus('running');
    emit(EVENTS.MANUAL, storyId, parameters);
  }, [emit, parameters, storyId]);

  useEffect(() => {
    setStatus(getInitialStatus(parameters.manual));
  }, [getInitialStatus, parameters.manual]);

  useEffect(() => {
    emit(HIGHLIGHT, { elements: highlighted, color: colorsByType[tab] });
  }, [emit, highlighted, tab]);

  return (
    <A11yContext.Provider
      value={{
        results,
        highlighted,
        toggleHighlight: handleToggleHighlight,
        clearHighlights: handleClearHighlights,
        tab,
        setTab: handleSetTab,
        status,
        setStatus,
        error,
        handleManual,
      }}
      {...props}
    />
  );
};

export const useA11yContext = () => useContext(A11yContext);
