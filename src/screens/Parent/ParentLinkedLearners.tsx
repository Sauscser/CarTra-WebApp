import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getUrl } from 'aws-amplify/storage';
import { listParentLearnerLinks, listLearnerProfiles, listParentProfiles, listLearnerDocumentResources } from '../../graphql/queries';
import useSessionUser from '../../hooks/useSessionUser';
import LearnerComments from '../../components/shared/LearnerComments';
import SubjectPerformanceGraph from '../../components/shared/SubjectPerformanceGraph';
import LearnerClusterPerformanceGraph from '../../components/shared/LearnerClusterPerformanceGraph';
import { parseLearnerSupportProfile, resolveLearnerCareerTarget } from '../../utils/learnerCareer';
import { getLearnerResourceUrl, isLearnerVideoResource } from '../../utils/learnerResourceUrl';

type Props = {
  parentProfileId?: string | null;
  parentNationalId?: string | null;
};

export default function ParentLinkedLearners({ parentProfileId, parentNationalId, parentTabFocused }: Props & { parentTabFocused?: boolean }) {
  const client = useMemo(() => generateClient(), []);
  const { sessionUser } = useSessionUser();
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [linkedLearners, setLinkedLearners] = useState<Array<{ id: string; fullName: string; classCode?: string | null; gradeLevel?: string | null; targetCareer?: string | null }>>([]);
  const [learnerFullMap, setLearnerFullMap] = useState<Record<string, any>>({});
  const [learnerResources, setLearnerResources] = useState<any[]>([]);
  const [selectedLearner, setSelectedLearner] = useState<any | null>(null);
  const [performanceAction, setPerformanceAction] = useState<'viewCluster' | 'viewSubjects' | null>(null);
  const [selectedSubjectEvidence, setSelectedSubjectEvidence] = useState<{ subjectId: string; subjectName: string; kind: 'document' | 'video' } | null>(null);
  const [openingResourceId, setOpeningResourceId] = useState<string | null>(null);
  const [resourceOpenError, setResourceOpenError] = useState<string | null>(null);
  const [resourceLoadError, setResourceLoadError] = useState<string | null>(null);
  const [selectedLearnerProfile, setSelectedLearnerProfile] = useState<any | null>(null);
  const [performanceSessionId, setPerformanceSessionId] = useState(0);
  const [performanceOpening, setPerformanceOpening] = useState<string | null>(null);
  const profileRequestRef = useRef(0);

  const resetPerformanceModal = () => {
    profileRequestRef.current += 1;
    setPerformanceSessionId((current) => current + 1);
    setPerformanceAction(null);
    setSelectedLearner(null);
    setSelectedLearnerProfile(null);
    setLearnerResources([]);
    setSelectedSubjectEvidence(null);
    setOpeningResourceId(null);
    setResourceOpenError(null);
    setResourceLoadError(null);
    setPerformanceOpening(null);
  };

  const beginPerformanceForLearner = (learner: any, action: 'viewCluster' | 'viewSubjects') => {
    const learnerId = learner?.id || null;
    const requestId = ++profileRequestRef.current;
    const profileSnapshot = learnerId ? learnerFullMap[learnerId] || null : null;
    const subjectList = Array.isArray(profileSnapshot?.selectedSubjects)
      ? profileSnapshot.selectedSubjects
      : Array.isArray(profileSnapshot?.historicalSelectedSubjects)
        ? profileSnapshot.historicalSelectedSubjects
        : [];

    console.log('[PARENT_LOG] learner clicked for performance selection', JSON.stringify({
      requestId,
      learnerId,
      fullName: learner?.fullName || null,
      gradeLevel: learner?.gradeLevel || null,
      subjectCount: subjectList.length,
      subjects: subjectList.map((subject: any) => ({
        id: subject?.id || null,
        name: subject?.name || null,
        code: subject?.code || null,
        historyCount: Array.isArray(subject?.history) ? subject.history.length : 0,
      })),
    }, null, 2));

    setPerformanceSessionId((current) => current + 1);
    setPerformanceAction(null);
    setSelectedLearner(null);
    setSelectedLearnerProfile(null);
    setSelectedLearner(learner);
    setSelectedLearnerProfile(profileSnapshot);
    setPerformanceAction(action);
    setLearnerResources([]);
    setSelectedSubjectEvidence(null);
  };

  useEffect(() => {
    // Load when parent identifiers change or when sessionUser becomes ready
    void loadLinkedLearners();
  }, [parentProfileId, parentNationalId, sessionUser?.username, parentTabFocused]);

  useEffect(() => {
    if (isFocused) {
      void loadLinkedLearners();
    }
  }, [isFocused]);

  useEffect(() => {
    // refresh the local learnerFullMap if linkedLearners change (safety)
    if (linkedLearners && linkedLearners.length && Object.keys(learnerFullMap).length === 0) {
      // attempt to populate learnerFullMap by re-querying the learner ids
      const ids = linkedLearners.map((l) => l.id);
      (async () => {
        try {
          const res = await client.graphql({ query: listLearnerProfiles, variables: { filter: { id: { in: ids } }, limit: 200 } } as any);
          const learners = (res as any).data?.listLearnerProfiles?.items || [];
          const map: Record<string, any> = {};
          learners.forEach((l: any) => { map[l.id] = l; });
          setLearnerFullMap(map);
        } catch (e) {
          // ignore
        }
      })();
    }
  }, [linkedLearners]);

  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => {
      console.log('[DEBUG_PARENT_NAV_FOCUS] navigation focus event');
      void loadLinkedLearners();
    });
    return () => {
      try {
        if (!unsub) return;
        if (typeof unsub === 'function') {
          unsub();
          return;
        }
        const maybe = unsub as any;
        if (maybe && typeof maybe.remove === 'function') {
          maybe.remove();
        }
      } catch (e) {
        // ignore
      }
    };
  }, [navigation]);

  async function loadLinkedLearners() {
    try {
      setLoading(true);
      // Debug: log invocation context
      console.log('[DEBUG_LOAD_LINKED_LEARNERS] start', JSON.stringify({ parentProfileId, parentNationalId, sessionUsername: sessionUser?.username }));

      // If no parent identifiers passed, try to resolve the parent's profile for the signed-in user
      let resolvedParentProfileId = parentProfileId;
      let resolvedParentNationalId = parentNationalId;

      if (!resolvedParentProfileId && !resolvedParentNationalId && sessionUser?.username) {
        try {
          const p = await client.graphql({ query: listParentProfiles, variables: { filter: { userId: { eq: sessionUser.username } }, limit: 1 } } as any);
          const profile = (p as any).data?.listParentProfiles?.items?.[0];
          console.log('[DEBUG_LOAD_LINKED_LEARNERS] parentProfilesQuery', JSON.stringify({ raw: p, found: !!profile }));
          if (profile) {
            resolvedParentProfileId = profile.id;
            resolvedParentNationalId = resolvedParentNationalId || profile.nationalId || null;
          }
        } catch (e) {
          console.warn('[DEBUG_LOAD_LINKED_LEARNERS] parentProfilesQuery failed', e);
          // ignore and continue to fallback logic
        }
      }

      if (resolvedParentProfileId) {
        console.log('[DEBUG_LOAD_LINKED_LEARNERS] using resolvedParentProfileId', resolvedParentProfileId);
        const result = await client.graphql({ query: listParentLearnerLinks, variables: { filter: { parentUserId: { eq: resolvedParentProfileId } }, limit: 200 } } as any);
        const items = (result as any).data?.listParentLearnerLinks?.items || [];
        console.log('[DEBUG_LOAD_LINKED_LEARNERS] parentLearnerLinks', JSON.stringify({ count: items.length, items }));
        const learnerIds = items.map((i: any) => i.learnerId).filter(Boolean);
        if (learnerIds.length > 0) {
          const learnersResult = await client.graphql({ query: listLearnerProfiles, variables: { filter: { id: { in: learnerIds } }, limit: 200 } } as any);
          const learners = (learnersResult as any).data?.listLearnerProfiles?.items || [];
          console.log('[DEBUG_LOAD_LINKED_LEARNERS] learnersByIds', JSON.stringify({ count: learners.length, learners }));
          const normalizedLearners = await Promise.all(learners.map(async (l: any) => {
            const parsedSupportProfile = parseLearnerSupportProfile(l?.supportProfile);
            const targetCareer = await resolveLearnerCareerTarget(client, l);
            return {
              ...l,
              supportProfile: parsedSupportProfile || l.supportProfile || null,
              selectedSubjects: Array.isArray(parsedSupportProfile?.selectedSubjects) ? parsedSupportProfile.selectedSubjects : (Array.isArray(l?.selectedSubjects) ? l.selectedSubjects : []),
              historicalSelectedSubjects: Array.isArray(parsedSupportProfile?.historicalSelectedSubjects) ? parsedSupportProfile.historicalSelectedSubjects : (Array.isArray(l?.historicalSelectedSubjects) ? l.historicalSelectedSubjects : []),
              targetCareer,
            };
          }));
          setLinkedLearners(normalizedLearners.map((l: any) => ({ id: l.id, fullName: l.fullName, classCode: l.classCode, gradeLevel: l.gradeLevel, targetCareer: l.targetCareer })));
          const map: Record<string, any> = {};
          normalizedLearners.forEach((l: any) => { map[l.id] = l; });
          setLearnerFullMap(map);
          return;
        }
      }

      if (resolvedParentNationalId) {
        console.log('[DEBUG_LOAD_LINKED_LEARNERS] using resolvedParentNationalId', resolvedParentNationalId);
        const learnersRes = await client.graphql({ query: listLearnerProfiles, variables: { filter: { parentNationalId: { eq: resolvedParentNationalId } }, limit: 200 } } as any);
        const learners = (learnersRes as any).data?.listLearnerProfiles?.items || [];
        console.log('[DEBUG_LOAD_LINKED_LEARNERS] learnersByNationalId', JSON.stringify({ count: learners.length, learners }));
        const normalizedLearners = await Promise.all(learners.map(async (l: any) => {
          const parsedSupportProfile = parseLearnerSupportProfile(l?.supportProfile);
          const targetCareer = await resolveLearnerCareerTarget(client, l);
          return {
            ...l,
            supportProfile: parsedSupportProfile || l.supportProfile || null,
            selectedSubjects: Array.isArray(parsedSupportProfile?.selectedSubjects) ? parsedSupportProfile.selectedSubjects : (Array.isArray(l?.selectedSubjects) ? l.selectedSubjects : []),
            historicalSelectedSubjects: Array.isArray(parsedSupportProfile?.historicalSelectedSubjects) ? parsedSupportProfile.historicalSelectedSubjects : (Array.isArray(l?.historicalSelectedSubjects) ? l.historicalSelectedSubjects : []),
            targetCareer,
          };
        }));
        setLinkedLearners(normalizedLearners.map((l: any) => ({ id: l.id, fullName: l.fullName, classCode: l.classCode, gradeLevel: l.gradeLevel, targetCareer: l.targetCareer })));
        const map: Record<string, any> = {};
        normalizedLearners.forEach((l: any) => { map[l.id] = l; });
        setLearnerFullMap(map);
        return;
      }

      setLinkedLearners([]);
    } catch (error) {
      console.warn('loadLinkedLearners failed', error);
      setLinkedLearners([]);
    } finally {
      setLoading(false);
    }
  }

  const onViewCluster = async (learnerId?: string) => {
    if (!learnerId) return;
    setPerformanceOpening(`${learnerId}:cluster`);
    const found = linkedLearners.find((l) => l.id === learnerId) || { id: learnerId };
    const profile = learnerFullMap[learnerId] || null;
    const subjectList = Array.isArray(profile?.selectedSubjects) ? profile.selectedSubjects : Array.isArray(profile?.historicalSelectedSubjects) ? profile.historicalSelectedSubjects : [];
    console.log('[PARENT_LOG] learner selected for cluster view', JSON.stringify({
      learnerId,
      fullName: (found as any)?.fullName || null,
      gradeLevel: (found as any)?.gradeLevel || null,
      subjectCount: subjectList.length,
      subjects: subjectList.map((subject: any) => ({ id: subject?.id || null, name: subject?.name || null, code: subject?.code || null, historyCount: Array.isArray(subject?.history) ? subject.history.length : 0 })),
    }, null, 2));
    beginPerformanceForLearner(found, 'viewCluster');
    try {
      const nextProfile = await loadLearnerProfile(learnerId);
      if (nextProfile) {
        setSelectedLearnerProfile(nextProfile);
      }
    } finally {
      setPerformanceOpening(null);
    }
  };

  const onViewSubjects = async (learnerId?: string) => {
    if (!learnerId) return;
    setPerformanceOpening(`${learnerId}:subjects`);
    setResourceLoadError(null);
    const found = linkedLearners.find((l) => l.id === learnerId) || { id: learnerId };
    const profile = learnerFullMap[learnerId] || null;
    const subjectList = Array.isArray(profile?.selectedSubjects) ? profile.selectedSubjects : Array.isArray(profile?.historicalSelectedSubjects) ? profile.historicalSelectedSubjects : [];
    console.log('[PARENT_LOG] learner selected for subjects view', JSON.stringify({
      learnerId,
      fullName: (found as any)?.fullName || null,
      gradeLevel: (found as any)?.gradeLevel || null,
      subjectCount: subjectList.length,
      subjects: subjectList.map((subject: any) => ({ id: subject?.id || null, name: subject?.name || null, code: subject?.code || null, historyCount: Array.isArray(subject?.history) ? subject.history.length : 0 })),
    }, null, 2));
    beginPerformanceForLearner(found, 'viewSubjects');
    try {
      const [nextProfile, resourcesResult] = await Promise.all([
        loadLearnerProfile(learnerId),
        client.graphql({
          query: listLearnerDocumentResources,
          variables: { filter: { learnerId: { eq: learnerId } }, limit: 500 },
        } as any),
      ]);
      if (nextProfile) {
        setSelectedLearnerProfile(nextProfile);
      }
      const resourcePayload = resourcesResult as any;
      if (resourcePayload.errors?.length) {
        throw new Error(resourcePayload.errors.map((item: any) => item.message).filter(Boolean).join('; ') || 'Could not load learner resources.');
      }
      const resources = (resourcePayload.data?.listLearnerDocumentResources?.items || [])
        .filter((resource: any) => resource?.id && resource?.learnerId === learnerId)
        .filter((resource: any) => !resource.resourceCategory || resource.resourceCategory === 'e_portfolio')
        .filter((resource: any) => resource.relatedSubjectId && (resource.fileKey || resource.externalUrl))
        .sort((first: any, second: any) => new Date(second.createdAt || 0).getTime() - new Date(first.createdAt || 0).getTime());
      setLearnerResources(resources);
      console.log('[PARENT_SUBJECT_EVIDENCE_LOAD_SUCCESS]', {
        learnerId,
        resourceCount: resources.length,
        documentCount: resources.filter((resource: any) => !isLearnerVideoResource(resource)).length,
        videoCount: resources.filter(isLearnerVideoResource).length,
        subjectIds: [...new Set(resources.map((resource: any) => resource.relatedSubjectId).filter(Boolean))],
      });
    } catch (error) {
      setLearnerResources([]);
      console.error('[PARENT_SUBJECT_EVIDENCE_LOAD_FAILED]', {
        learnerId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      setResourceLoadError(error instanceof Error ? error.message : 'Could not load this learner’s documents and videos.');
    } finally {
      setPerformanceOpening(null);
    }
  };

  const openSubjectResource = async (resource: any) => {
    setResourceOpenError(null);
    const externalUrl = getLearnerResourceUrl(resource.externalUrl, resource.fileKey);
    let webWindow: Window | null = null;
    try {
      setOpeningResourceId(resource.id);
      if (externalUrl) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          webWindow = window.open(externalUrl.toString(), '_blank');
          if (!webWindow) {
            setResourceOpenError('Your browser blocked the new tab. Allow pop-ups for CarTra and try again.');
            return;
          }
          webWindow.opener = null;
        } else {
          await Linking.openURL(externalUrl.toString());
        }
        console.log('[PARENT_SUBJECT_EVIDENCE_OPENED_EXTERNAL_LINK]', {
          resourceId: resource.id,
          source: resource.externalUrl ? 'externalUrl' : 'fileKey',
        });
        return;
      }
      if (!resource.fileKey) throw new Error('This resource does not contain a link or file path.');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        webWindow = window.open('about:blank', '_blank');
        if (!webWindow) {
          setResourceOpenError('Your browser blocked the new tab. Allow pop-ups for CarTra and try again.');
          return;
        }
      }
      const signed = await getUrl({ path: String(resource.fileKey), options: { validateObjectExistence: true, expiresIn: 900 } });
      if (webWindow) webWindow.location.replace(signed.url.toString());
      else await Linking.openURL(signed.url.toString());
    } catch (error) {
      webWindow?.close();
      const message = error instanceof Error ? error.message : 'Could not open this resource.';
      console.error('[PARENT_SUBJECT_EVIDENCE_OPEN_FAILED]', {
        resourceId: resource.id,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        message,
      });
      setResourceOpenError(message);
    } finally {
      setOpeningResourceId(null);
    }
  };

  const loadLearnerProfile = async (learnerId?: string) => {
    if (!learnerId) return null;
    const requestId = ++profileRequestRef.current;

    try {
      const res = await client.graphql({ query: listLearnerProfiles, variables: { filter: { id: { eq: learnerId } }, limit: 1 } } as any);
      const item = (res as any).data?.listLearnerProfiles?.items?.[0] || null;
      if (!item) {
        return null;
      }

      const parsedSupportProfile = parseLearnerSupportProfile(item?.supportProfile);
      const targetCareer = await resolveLearnerCareerTarget(client, item);

      const normalizedItem = {
        ...item,
        supportProfile: parsedSupportProfile || item.supportProfile || null,
        selectedSubjects: Array.isArray(parsedSupportProfile?.selectedSubjects) ? parsedSupportProfile.selectedSubjects : (Array.isArray(item?.selectedSubjects) ? item.selectedSubjects : []),
        historicalSelectedSubjects: Array.isArray(parsedSupportProfile?.historicalSelectedSubjects) ? parsedSupportProfile.historicalSelectedSubjects : (Array.isArray(item?.historicalSelectedSubjects) ? item.historicalSelectedSubjects : []),
        targetCareer,
      };

      if (requestId !== profileRequestRef.current) return normalizedItem;
      setSelectedLearnerProfile(normalizedItem);
      setLearnerFullMap((current) => ({ ...current, [learnerId]: normalizedItem }));
      return normalizedItem;
    } catch (e) {
      return null;
    }
  };

  const activeProfile = selectedLearner && selectedLearnerProfile && selectedLearnerProfile.id === selectedLearner.id ? selectedLearnerProfile : null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Linked learners</Text>
      {loading ? <ActivityIndicator /> : null}

      {linkedLearners.length === 0 ? <Text>No learners linked.</Text> : (
        <View style={styles.linkedLearnersContent}>
          {linkedLearners.map((l) => (
            <View key={l.id} style={styles.learnerRow}>
              <Text style={styles.learnerText}>{l.fullName} ({l.gradeLevel || ''} - {l.classCode || ''})</Text>
              <Text>Career target: {l.targetCareer || 'Not set'}</Text>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => void onViewCluster(l.id)}
                  disabled={Boolean(performanceOpening)}
                  accessibilityState={{ disabled: Boolean(performanceOpening), busy: performanceOpening === `${l.id}:cluster` }}
                >
                  {performanceOpening === `${l.id}:cluster` ? <ActivityIndicator size="small" color="#1d4ed8" /> : <Text>Cluster</Text>}
                  {performanceOpening === `${l.id}:cluster` ? <Text>Opening... please wait</Text> : null}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => void onViewSubjects(l.id)}
                  disabled={Boolean(performanceOpening)}
                  accessibilityState={{ disabled: Boolean(performanceOpening), busy: performanceOpening === `${l.id}:subjects` }}
                >
                  {performanceOpening === `${l.id}:subjects` ? <ActivityIndicator size="small" color="#1d4ed8" /> : <Text>Subjects</Text>}
                  {performanceOpening === `${l.id}:subjects` ? <Text>Opening... please wait</Text> : null}
                </TouchableOpacity>
              </View>
              <View style={{ marginTop: 8 }}>
                <LearnerComments learnerId={l.id} currentGrade={l.gradeLevel} authorRoleOverride="parent" />
              </View>
            </View>
          ))}
        </View>
      )}

      <Modal transparent visible={!!performanceAction} animationType="slide" onRequestClose={resetPerformanceModal}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' }}>
          <View key={`${performanceSessionId}-${selectedLearner?.id ?? 'parent-performance'}`} style={{ margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, height: '90%', maxHeight: '90%', position: 'relative' }}>
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>{performanceAction && selectedLearner ? `View performance for ${selectedLearner.fullName || selectedLearner.id}` : 'View performance'}</Text>
            <Text style={{ color: '#6b7280', marginBottom: 8 }}>Grade {selectedLearner?.gradeLevel || 'N/A'}</Text>
            {!performanceOpening && performanceAction === 'viewSubjects' && resourceLoadError
              ? <Text style={styles.evidenceError}>Could not load learner resources: {resourceLoadError}</Text>
              : null}

            {performanceOpening ? (
              <View style={{ position: 'absolute', zIndex: 10, top: 0, right: 0, bottom: 0, left: 0, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <ActivityIndicator size="large" color="#1d4ed8" />
                <Text style={{ marginTop: 12, color: '#1d4ed8', fontWeight: '700', textAlign: 'center' }}>Opening performance data... please wait</Text>
              </View>
            ) : null}

            {!performanceOpening && performanceAction === 'viewCluster' ? (
              <ScrollView style={{ marginTop: 8, flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingBottom: 12 }} nestedScrollEnabled>
                <LearnerClusterPerformanceGraph
                  learner={selectedLearner}
                  profile={activeProfile || learnerFullMap[selectedLearner?.id] || {}}
                  targetCareer={selectedLearner?.targetCareer}
                />

                {/* Comments */}
                <View style={{ marginTop: 12 }}>
                  <LearnerComments learnerId={selectedLearner?.id} authorRoleOverride="parent" />
                </View>
              </ScrollView>
            ) : null}

            {!performanceOpening && performanceAction === 'viewSubjects' ? (
              <ScrollView style={{ marginTop: 8, flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingBottom: 12 }} nestedScrollEnabled>
                <SubjectPerformanceGraph
                  learner={selectedLearner}
                  profile={activeProfile || learnerFullMap[selectedLearner?.id] || {}}
                  renderSubjectActions={(subject) => {
                    const profileSubjects = Array.isArray(activeProfile?.selectedSubjects) ? activeProfile.selectedSubjects : [];
                    const learnerSubject = profileSubjects.find((item: any) =>
                      (subject.id && String(item.id || '') === String(subject.id))
                      || (subject.code && String(item.code || '').toLowerCase() === String(subject.code).toLowerCase())
                      || String(item.name || '').toLowerCase() === String(subject.label).toLowerCase(),
                    );
                    const subjectId = String(subject.id || learnerSubject?.id || '');
                    const subjectResources = learnerResources.filter((resource) =>
                      (subjectId && String(resource.relatedSubjectId || '') === subjectId)
                      || String(resource.relatedSubjectName || '').toLowerCase() === String(subject.label).toLowerCase(),
                    );
                    const documentCount = subjectResources.filter((resource) => !isLearnerVideoResource(resource)).length;
                    const videoCount = subjectResources.filter(isLearnerVideoResource).length;
                    const selectEvidence = (kind: 'document' | 'video') => setSelectedSubjectEvidence({
                      subjectId,
                      subjectName: subject.label,
                      kind,
                    });

                    return (
                      <View style={styles.subjectEvidenceActions}>
                        <TouchableOpacity style={styles.evidenceButton} onPress={() => selectEvidence('document')} disabled={!subjectId}>
                          <Text style={styles.evidenceButtonText}>Documents ({documentCount})</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.evidenceButton} onPress={() => selectEvidence('video')} disabled={!subjectId}>
                          <Text style={styles.evidenceButtonText}>Videos ({videoCount})</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
              </ScrollView>
            ) : null}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
              <TouchableOpacity onPress={resetPerformanceModal} style={{ padding: 8 }}>
                <Text style={{ color: '#1d4ed8', fontWeight: '700' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={Boolean(selectedSubjectEvidence && performanceAction === 'viewSubjects')}
        animationType="fade"
        onRequestClose={() => setSelectedSubjectEvidence(null)}
      >
        <View style={styles.evidenceBackdrop}>
          <View style={styles.evidenceModal}>
            <Text style={styles.evidenceTitle}>
              {selectedSubjectEvidence?.kind === 'video' ? 'Subject videos' : 'Subject documents'}
            </Text>
            <Text style={styles.evidenceSubject}>{selectedSubjectEvidence?.subjectName}</Text>
            {resourceOpenError ? <Text style={styles.evidenceError}>{resourceOpenError}</Text> : null}
            <ScrollView style={styles.evidenceList} contentContainerStyle={styles.evidenceListContent}>
              {(() => {
                const evidence = learnerResources
                  .filter((resource) => (
                    (selectedSubjectEvidence?.subjectId && String(resource.relatedSubjectId || '') === selectedSubjectEvidence.subjectId)
                    || String(resource.relatedSubjectName || '').toLowerCase() === String(selectedSubjectEvidence?.subjectName || '').toLowerCase()
                  ))
                  .filter((resource) => selectedSubjectEvidence?.kind === 'video'
                    ? isLearnerVideoResource(resource)
                    : !isLearnerVideoResource(resource));
                if (!evidence.length) {
                  return <Text style={styles.evidenceEmpty}>No {selectedSubjectEvidence?.kind === 'video' ? 'videos' : 'documents'} are linked to this subject yet.</Text>;
                }
                return evidence.map((resource) => (
                  <View key={resource.id} style={styles.evidenceRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.evidenceResourceTitle}>{resource.title || resource.fileName || 'Untitled resource'}</Text>
                      {resource.fileName ? <Text style={styles.evidenceMeta}>{resource.fileName}</Text> : null}
                      <Text style={styles.evidenceMeta}>{resource.status || 'Available'}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.evidenceOpenButton}
                      onPress={() => void openSubjectResource(resource)}
                      disabled={openingResourceId === resource.id}
                      accessibilityRole="button"
                    >
                      {openingResourceId === resource.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.evidenceOpenText}>Open</Text>}
                    </TouchableOpacity>
                  </View>
                ));
              })()}
            </ScrollView>
            <View style={styles.evidenceModalActions}>
              <TouchableOpacity
                onPress={() => setSelectedSubjectEvidence(null)}
                style={styles.evidenceCloseButton}
                accessibilityRole="button"
              >
                <Text style={styles.evidenceCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18 },
  sectionTitle: { fontWeight: '800', marginBottom: 8 },
  linkedLearnersContent: { paddingBottom: 140 },
  learnerRow: { padding: 10, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 8 },
  learnerText: { fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { padding: 8, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#f8fafc' },
  subjectEvidenceActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  evidenceButton: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#f8fafc', paddingHorizontal: 8 },
  evidenceButtonText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' },
  evidenceBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.62)', justifyContent: 'center', padding: 16 },
  evidenceModal: { width: '100%', maxWidth: 620, maxHeight: '82%', alignSelf: 'center', borderRadius: 12, backgroundColor: '#fff', padding: 16 },
  evidenceTitle: { color: '#111827', fontSize: 16, fontWeight: '800' },
  evidenceSubject: { color: '#475569', fontSize: 12, marginTop: 2, marginBottom: 8 },
  evidenceError: { color: '#b91c1c', fontSize: 12, marginBottom: 8 },
  evidenceList: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  evidenceListContent: { paddingBottom: 8 },
  evidenceModalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  evidenceCloseButton: { paddingVertical: 8, paddingHorizontal: 10 },
  evidenceCloseText: { color: '#1d4ed8', fontWeight: '700' },
  evidenceEmpty: { color: '#6b7280', fontSize: 13 },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  evidenceResourceTitle: { color: '#0f172a', fontSize: 13, fontWeight: '600' },
  evidenceMeta: { color: '#64748b', fontSize: 11, marginTop: 2 },
  evidenceOpenButton: { minWidth: 56, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: '#1d4ed8', paddingHorizontal: 10 },
  evidenceOpenText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
