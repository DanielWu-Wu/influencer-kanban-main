'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCooperationCalendarEvents,
  mapFeishuCooperationRecord,
} from '@/lib/cooperation-projects';
import {
  fetchFeishuRecordSnapshot,
  type CachedFeishuRecord,
} from '@/lib/feishu-record-cache';
import type { FeishuFieldMapping } from '@/lib/feishu-mapping';

export function useCooperationCalendarEvents({
  active,
  ready,
  url,
  mapping,
}: {
  active: boolean;
  ready: boolean;
  url: string;
  mapping: FeishuFieldMapping;
}) {
  const normalizedUrl = url.trim();
  const [records, setRecords] = useState<CachedFeishuRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const requestVersionRef = useRef(0);

  const load = useCallback(async (force = false) => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    if (!normalizedUrl) {
      setRecords([]);
      setError('');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (force) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const snapshot = await fetchFeishuRecordSnapshot(normalizedUrl, { force });
      if (requestVersionRef.current !== requestVersion) return;
      setRecords(snapshot.records);
    } catch (loadError) {
      if (requestVersionRef.current !== requestVersion) return;
      setError(loadError instanceof Error ? loadError.message : '读取合作项目时间节点失败。');
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [normalizedUrl]);

  useEffect(() => {
    requestVersionRef.current += 1;
    setRecords([]);
    setError('');
  }, [normalizedUrl]);

  useEffect(() => {
    if (!active || !ready) return;
    void load(false);
  }, [active, load, ready]);

  const projects = useMemo(
    () => records
      .filter((record) => Object.keys(record.fields).length > 0)
      .map((record) => mapFeishuCooperationRecord(record, mapping)),
    [mapping, records],
  );
  const events = useMemo(
    () => buildCooperationCalendarEvents(projects),
    [projects],
  );
  const refresh = useCallback(() => load(true), [load]);

  return {
    events,
    configured: Boolean(normalizedUrl),
    loading,
    refreshing,
    error,
    refresh,
  };
}
