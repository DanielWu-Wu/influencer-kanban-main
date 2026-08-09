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
import {
  buildChannelAvatarLookup,
  resolveChannelAvatars,
} from '@/lib/youtube-channel-avatar';

export function useCooperationCalendarEvents({
  active,
  ready,
  url,
  mapping,
  regionCode = '',
  relevanceLanguage = '',
}: {
  active: boolean;
  ready: boolean;
  url: string;
  mapping: FeishuFieldMapping;
  regionCode?: string;
  relevanceLanguage?: string;
}) {
  const normalizedUrl = url.trim();
  const [records, setRecords] = useState<CachedFeishuRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [avatarByProjectId, setAvatarByProjectId] = useState<Record<string, string>>({});
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

  const baseProjects = useMemo(
    () => records
      .filter((record) => Object.keys(record.fields).length > 0)
      .map((record) => mapFeishuCooperationRecord(record, mapping)),
    [mapping, records],
  );

  useEffect(() => {
    if (!baseProjects.length) {
      setAvatarByProjectId((current) => Object.keys(current).length ? {} : current);
      return;
    }
    let cancelled = false;

    const enrichAvatars = async () => {
      const lookupByProjectId = new Map<string, NonNullable<ReturnType<typeof buildChannelAvatarLookup>>>();
      for (const project of baseProjects) {
        const lookup = buildChannelAvatarLookup({
          channelId: project.channelId,
          channelUrl: project.channelUrl,
        });
        if (lookup) lookupByProjectId.set(project.id, lookup);
      }
      if (!lookupByProjectId.size) {
        if (!cancelled) {
          setAvatarByProjectId((current) => Object.keys(current).length ? {} : current);
        }
        return;
      }

      const resolved = await resolveChannelAvatars(
        Array.from(lookupByProjectId.values()),
        { regionCode, relevanceLanguage },
      );
      if (cancelled) return;
      const nextAvatars: Record<string, string> = {};
      for (const [projectId, lookup] of lookupByProjectId) {
        const avatar = resolved.get(lookup.key);
        if (avatar?.status === 'ready' && avatar.avatarUrl) {
          nextAvatars[projectId] = avatar.avatarUrl;
        }
      }
      setAvatarByProjectId(nextAvatars);
    };

    void enrichAvatars();
    return () => { cancelled = true; };
  }, [baseProjects, regionCode, relevanceLanguage]);

  const projects = useMemo(
    () => baseProjects.map((project) => ({
      ...project,
      avatarUrl: avatarByProjectId[project.id],
    })),
    [avatarByProjectId, baseProjects],
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
