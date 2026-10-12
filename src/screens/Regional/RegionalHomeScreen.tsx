import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import { getLearnerProfile, listLearnerDocumentResources, listLearnerProfiles, listOrgHierarchies } from '../../graphql/queries';
import SectionCard from '../../components/shared/SectionCard';
import ViewPerformance from '../../components/teacher/ViewPerformance';
import LearnerComments from '../../components/shared/LearnerComments';
import LearnerPerformanceGraphs from '../../components/shared/LearnerPerformanceGraphs';
import SubjectPerformanceGraph from '../../components/shared/SubjectPerformanceGraph';
import SubjectEvidenceActions from '../../components/shared/SubjectEvidenceActions';
import LearnerClusterPerformanceGraph from '../../components/shared/LearnerClusterPerformanceGraph';
import CbeJurisdictionAnalytics from '../../components/shared/CbeJurisdictionAnalytics';
import LearnerFollowUpDashboard from '../../components/shared/LearnerFollowUpDashboard';
import JurisdictionTransferManager from '../../components/shared/JurisdictionTransferManager';
import calculateHistoricalClusterSeries, { calculateDeviationPercentage } from '../../utils/cluster';
import { resolveLearnerCareerTarget } from '../../utils/learnerCareer';
import { RegionalCountySetupContent } from './RegionalCountySetupScreen';

type RegionEntity = {
  id: string;
  code: string;
  name: string;
  nationCode?: string | null;
  regionCode?: string | null;
  assignedOfficerEmail?: string | null;
};

type CountyEntity = {
  id: string;
  code: string;
  name: string;
  regionCode?: string | null;
  assignedOfficerEmail?: string | null;
};

type SubCountyEntity = {
  id: string;
  code: string;
  name: string;
  countyCode?: string | null;
};

type RegionalSchoolEntity = {
  id: string;
  code: string;
  name: string;
  subCountyCode?: string | null;
};

export default function RegionalHomeScreen() {
  return <RegionalHomeContent />;
}

function RegionalHomeContent() {
  const client = useMemo(() => generateClient(), []);
  const [region, setRegion] = useState<RegionEntity | null>(null);
  const [counties, setCounties] = useState<CountyEntity[]>([]);
  const [regionalSubCounties, setRegionalSubCounties] = useState<SubCountyEntity[]>([]);
  const [regionalSchools, setRegionalSchools] = useState<RegionalSchoolEntity[]>([]);
  const [regionLearners, setRegionLearners] = useState<Array<{ id: string; fullName: string; gradeLevel?: string | null; classCode?: string | null; assessmentNumber?: string | null; countyCode?: string | null; subCountyCode?: string | null; schoolCode?: string | null }>>([]);
  const [selectedCountyCode, setSelectedCountyCode] = useState<string | null>(null);
  const [selectedSubCountyCode, setSelectedSubCountyCode] = useState<string | null>(null);
  const [selectedSchoolCode, setSelectedSchoolCode] = useState<string | null>(null);
  const [selectedLearnerGrade, setSelectedLearnerGrade] = useState<string | null>(null);
  const [learnerCareerMap, setLearnerCareerMap] = useState<Record<string, string | null>>({});
  const [selectedLearner, setSelectedLearner] = useState<any | null>(null);
  const [selectedLearnerProfile, setSelectedLearnerProfile] = useState<any | null>(null);
  const [performanceAction, setPerformanceAction] = useState<'viewMenu' | 'viewCluster' | 'viewSubjects' | 'viewGuidance' | 'viewEPortfolio' | null>(null);
  const [learnerDocuments, setLearnerDocuments] = useState<any[]>([]);
  const [performanceSessionId, setPerformanceSessionId] = useState(0);
  const profileRequestRef = useRef(0);

  const resetPerformanceModal = () => {
    profileRequestRef.current += 1;
    setPerformanceSessionId((current) => current + 1);
    setPerformanceAction(null);
    setSelectedLearner(null);
    setSelectedLearnerProfile(null);
    setLearnerDocuments([]);
  };
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void loadCurrentRegion();
  }, []);

  useEffect(() => {
    if (region?.code) {
      void loadRegionLearners();
    }
  }, [region?.code]);

  useEffect(() => {
    if (selectedCountyCode) {
      void loadRegionalSubCounties(selectedCountyCode);
    } else {
      setRegionalSubCounties([]);
    }
    setSelectedSubCountyCode(null);
    setSelectedSchoolCode(null);
    setSelectedLearnerGrade(null);
  }, [selectedCountyCode]);

  useEffect(() => {
    if (selectedSubCountyCode) {
      void loadRegionalSchools(selectedSubCountyCode);
    } else {
      setRegionalSchools([]);
    }
    setSelectedSchoolCode(null);
    setSelectedLearnerGrade(null);
  }, [selectedSubCountyCode]);

  const loadCurrentRegion = async () => {
    try {
      setIsLoading(true);
      setNotice('');

      const session = await fetchAuthSession();
      const currentEmail = (session.tokens?.idToken?.payload as { email?: string } | undefined)?.email?.trim().toLowerCase();

      if (!currentEmail) {
        setNotice('No signed-in user email was found.');
        setRegion(null);
        setCounties([]);
        return;
      }

      const regionResult = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'region' } }, { assignedOfficerEmail: { eq: currentEmail } }],
          },
          limit: 20,
        },
      });

      const regionPayload = regionResult as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const matchedRegion = regionPayload.data?.listOrgHierarchies?.items?.[0];

      if (!matchedRegion) {
        setRegion(null);
        setCounties([]);
        setNotice(`No region is assigned to ${currentEmail}.`);
        return;
      }

      const nextRegion: RegionEntity = {
        id: matchedRegion.id,
        code: matchedRegion.code,
        name: matchedRegion.name,
        nationCode: matchedRegion.nationCode,
        regionCode: matchedRegion.regionCode,
        assignedOfficerEmail: matchedRegion.assignedOfficerEmail,
      };

      setRegion(nextRegion);

      const countyResult = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'county' } }, { regionCode: { eq: nextRegion.code } }],
          },
          limit: 100,
        },
      });

      const countyPayload = countyResult as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const mappedCounties = (countyPayload.data?.listOrgHierarchies?.items || [])
        .filter((item: any) => Boolean(item?.id && item?.code && item?.name))
        .map((item: any) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          regionCode: item.regionCode,
          assignedOfficerEmail: item.assignedOfficerEmail,
        }));

      setCounties(mappedCounties);
    } catch {
      setRegion(null);
      setCounties([]);
      setNotice('Could not load the regional dashboard for this account.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadSelectedLearnerCareer = async (learnerId: string) => {
    try {
      const result = await client.graphql({
        query: listLearnerProfiles,
        variables: { filter: { id: { eq: learnerId } }, limit: 20 },
      } as any);

      const payload = result as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const learnerRecord = payload.data?.listLearnerProfiles?.items?.[0];
      const savedCareerTarget = await resolveLearnerCareerTarget(client, learnerRecord);

      setLearnerCareerMap((current) => ({ ...current, [learnerId]: savedCareerTarget }));
    } catch {
      setLearnerCareerMap((current) => ({ ...current, [learnerId]: null }));
    }
  };

  const loadRegionalSubCounties = async (countyCode: string) => {
    try {
      const result = await client.graphql({
        query: listOrgHierarchies,
        variables: { filter: { and: [{ entityType: { eq: 'subCounty' } }, { countyCode: { eq: countyCode } }] }, limit: 200 },
      } as any);
      const items = (result as any).data?.listOrgHierarchies?.items || [];
      setRegionalSubCounties(items.filter((item: any) => item?.id && item?.code && item?.name).map((item: any) => ({ id: item.id, code: item.code, name: item.name, countyCode: item.countyCode })));
    } catch (error) {
      console.warn('loadRegionalSubCounties failed', error);
      setRegionalSubCounties([]);
    }
  };

  const loadRegionalSchools = async (subCountyCode: string) => {
    try {
      const result = await client.graphql({
        query: listOrgHierarchies,
        variables: { filter: { and: [{ entityType: { eq: 'school' } }, { subCountyCode: { eq: subCountyCode } }] }, limit: 200 },
      } as any);
      const items = (result as any).data?.listOrgHierarchies?.items || [];
      setRegionalSchools(items.filter((item: any) => item?.id && item?.code && item?.name).map((item: any) => ({ id: item.id, code: item.code, name: item.name, subCountyCode: item.subCountyCode })));
    } catch (error) {
      console.warn('loadRegionalSchools failed', error);
      setRegionalSchools([]);
    }
  };

  const getLatestClusterAssessment = (learner: any, profile: any) => {
    const clusterSeries = calculateHistoricalClusterSeries(learner, profile || {});
    if (!Array.isArray(clusterSeries) || clusterSeries.length === 0) return null;
    const ordered = [...clusterSeries].sort((left, right) => Number(left.label) - Number(right.label));
    const lastEntry = ordered[ordered.length - 1];
    if (!lastEntry) return null;

    const clusterValue = Number(lastEntry.value ?? 0);
    const target = Number(lastEntry.target ?? 0);
    const deviation = Number(lastEntry.deviation ?? calculateDeviationPercentage(clusterValue, target) ?? 0);
    return {
      lastGrade: Number(lastEntry.label),
      clusterValue,
      target,
      deviation,
    };
  };

  const loadLearnerProfile = async (learnerId?: string) => {
    if (!learnerId) return null;
    const requestId = ++profileRequestRef.current;

    try {
      const res = await client.graphql({ query: getLearnerProfile, variables: { id: learnerId } } as any);
      const item = (res as any).data?.getLearnerProfile || null;
      if (!item) {
        if (requestId === profileRequestRef.current) {
          setSelectedLearnerProfile(null);
        }
        return null;
      }

      const parsedSupportProfile = (() => {
        if (!item?.supportProfile) return null;
        try {
          return typeof item.supportProfile === 'string' ? JSON.parse(item.supportProfile) : item.supportProfile;
        } catch {
          return null;
        }
      })();

      const normalized = {
        ...item,
        supportProfile: parsedSupportProfile || item.supportProfile || null,
        selectedSubjects: Array.isArray(parsedSupportProfile?.selectedSubjects) ? parsedSupportProfile.selectedSubjects : (Array.isArray(item?.selectedSubjects) ? item.selectedSubjects : []),
        historicalSelectedSubjects: Array.isArray(parsedSupportProfile?.historicalSelectedSubjects) ? parsedSupportProfile.historicalSelectedSubjects : (Array.isArray(item?.historicalSelectedSubjects) ? item.historicalSelectedSubjects : []),
        targetCareer: parsedSupportProfile?.targetCareer ?? item?.targetCareer ?? null,
      };

      if (requestId !== profileRequestRef.current) {
        return normalized;
      }

      setSelectedLearnerProfile(normalized);
      return normalized;
    } catch (error) {
      console.warn('loadLearnerProfile failed', error);
      if (requestId === profileRequestRef.current) {
        setSelectedLearnerProfile(null);
      }
      return null;
    }
  };

  const openDocument = async (resource: any) => {
    if (!resource?.fileKey) return;
    const rawKey = String(resource.fileKey || '').trim();
    if (rawKey.startsWith('http://') || rawKey.startsWith('https://')) {
      await Linking.openURL(rawKey);
      return;
    }
    if (rawKey.startsWith('s3://')) {
      await Linking.openURL(rawKey.replace(/^s3:\/\//, 'https://'));
      return;
    }

    try {
      const signed = await getUrl({
        path: rawKey,
        options: {
          validateObjectExistence: true,
          expiresIn: 900,
        },
      });
      const url = String((signed as any)?.url || signed);
      if (url) {
        await Linking.openURL(url);
        return;
      }
    } catch (error) {
      console.warn('openDocument failed', error);
    }

    Alert.alert('Unable to open file', 'This file could not be opened right now.');
  };

  const loadRegionLearners = async () => {
    if (!region?.code) return;
    try {
      const countyResult = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'county' } }, { regionCode: { eq: region.code } }],
          },
          limit: 100,
        },
      });

      const countyPayload = countyResult as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const countyCodes = (countyPayload.data?.listOrgHierarchies?.items || [])
        .map((item: any) => item?.code)
        .filter(Boolean);

      if (countyCodes.length === 0) {
        setRegionLearners([]);
        return;
      }

      const learnerBatches = await Promise.all(countyCodes.map(async (countyCode: string) => {
        const result = await client.graphql({
          query: listLearnerProfiles,
          variables: { filter: { countyCode: { eq: countyCode } }, limit: 500 },
        } as any);
        return ((result as any).data?.listLearnerProfiles?.items || []) as Array<any>;
      }));

      const items = learnerBatches.flat();
      const filteredItems = items.filter((learner: any) => {
        const supportProfile = (() => {
          if (!learner?.supportProfile) return null;
          try {
            return typeof learner.supportProfile === 'string' ? JSON.parse(learner.supportProfile) : learner.supportProfile;
          } catch {
            return null;
          }
        })();

        const normalizedProfile = {
          ...learner,
          supportProfile: supportProfile || learner.supportProfile || null,
          selectedSubjects: Array.isArray(supportProfile?.selectedSubjects) ? supportProfile.selectedSubjects : (Array.isArray(learner?.selectedSubjects) ? learner.selectedSubjects : []),
          historicalSelectedSubjects: Array.isArray(supportProfile?.historicalSelectedSubjects) ? supportProfile.historicalSelectedSubjects : (Array.isArray(learner?.historicalSelectedSubjects) ? learner.historicalSelectedSubjects : []),
          targetCareer: supportProfile?.targetCareer ?? learner?.targetCareer ?? null,
        };

        const lastAssessment = getLatestClusterAssessment(learner, normalizedProfile);
        const includeLearner = !!lastAssessment && lastAssessment.deviation < -60;

        console.log('[RegionalHomeScreen] learner last grade cluster check', JSON.stringify({
          learnerId: learner.id,
          learnerName: learner.fullName,
          lastGrade: lastAssessment?.lastGrade ?? null,
          clusterValue: lastAssessment?.clusterValue ?? null,
          target: lastAssessment?.target ?? null,
          deviation: lastAssessment?.deviation ?? null,
          includeLearner,
        }, null, 2));

        return includeLearner;
      });

      setRegionLearners(filteredItems.map((learner: any) => ({
        id: learner.id,
        fullName: learner.fullName,
        gradeLevel: learner.gradeLevel,
        classCode: learner.classCode,
        assessmentNumber: learner.assessmentNumber,
        countyCode: learner.countyCode,
        subCountyCode: learner.subCountyCode,
        schoolCode: learner.schoolCode,
      })));

      await Promise.all(filteredItems.map((learner: any) => loadSelectedLearnerCareer(learner.id)));
    } catch (error) {
      console.warn('loadRegionLearners failed', error);
      setRegionLearners([]);
    }
  };

  const modalContent = performanceAction && selectedLearner ? (
    <Modal transparent visible={!!performanceAction} animationType="slide" onRequestClose={resetPerformanceModal}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' }}>
        <View key={`${performanceSessionId}-${selectedLearner?.id ?? 'regional-performance'}`} style={{ margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '90%' }}>
          <Text style={{ fontWeight: '800', marginBottom: 6 }}>{selectedLearner.fullName}</Text>
          <Text style={{ color: '#6b7280', marginBottom: 8 }}>Grade {selectedLearner.gradeLevel || 'N/A'}</Text>

          {performanceAction === 'viewMenu' ? (
            <ViewPerformance
              learner={selectedLearner}
              profile={selectedLearnerProfile || {}}
              targetCareer={learnerCareerMap[selectedLearner.id]}
              onViewCluster={() => setPerformanceAction('viewCluster')}
              onViewSubjects={() => setPerformanceAction('viewSubjects')}
              onViewGuidance={() => setPerformanceAction('viewGuidance')}
            />
          ) : null}

          {performanceAction === 'viewCluster' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <LearnerClusterPerformanceGraph learner={selectedLearner} profile={selectedLearnerProfile || {}} targetCareer={learnerCareerMap[selectedLearner.id]} />
            </ScrollView>
          ) : null}

          {performanceAction === 'viewSubjects' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <SubjectPerformanceGraph
                learner={selectedLearner}
                profile={selectedLearnerProfile || {}}
                renderSubjectActions={(subject) => (
                  <SubjectEvidenceActions learnerId={selectedLearner.id} subjectId={subject.id} subjectName={subject.label} />
                )}
              />
            </ScrollView>
          ) : null}

          {performanceAction === 'viewGuidance' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <LearnerComments learnerId={selectedLearner.id} currentGrade={selectedLearner.gradeLevel} authorRoleOverride="regional" />
            </ScrollView>
          ) : null}

          {performanceAction === 'viewEPortfolio' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700', marginBottom: 8 }}>E-portfolio files</Text>
              {(() => {
                const loadDocs = async () => {
                  const learnerSchoolCode = selectedLearnerProfile?.schoolCode || null;
                  const baseFilter = {
                    and: [
                      { learnerId: { eq: selectedLearner.id } },
                      { resourceCategory: { eq: 'e_portfolio' } },
                    ],
                  } as any;
                  const filter = learnerSchoolCode ? { and: [{ schoolCode: { eq: learnerSchoolCode } }, ...baseFilter.and] } : baseFilter;
                  const res = await client.graphql({ query: listLearnerDocumentResources, variables: { filter, limit: 200 } } as any);
                  const items = ((res as any).data?.listLearnerDocumentResources?.items || [])
                    .filter((item: any) => item?.id && item?.learnerId && item?.fileKey)
                    .map((item: any) => ({
                      id: item.id,
                      title: item.title,
                      fileName: item.fileName,
                      fileKey: item.fileKey,
                      status: item.status || 'pending_review',
                    }))
                    .sort((left: any, right: any) => String(right.title || '').localeCompare(String(left.title || '')));
                  setLearnerDocuments(items);
                };

                if (!learnerDocuments.length) {
                  void loadDocs();
                }

                if (!learnerDocuments.length) {
                  return <Text style={{ color: '#6b7280' }}>No e-portfolio files are attached to this learner yet.</Text>;
                }

                return learnerDocuments.map((doc: any) => (
                  <TouchableOpacity key={doc.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }} onPress={() => openDocument(doc)}>
                    <Text style={{ fontWeight: '600', color: '#1d4ed8' }}>{doc.title || doc.fileName || 'Untitled document'}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 12 }}>{doc.fileName || 'Document file'} • {doc.status || 'pending_review'}</Text>
                  </TouchableOpacity>
                ));
              })()}
            </ScrollView>
          ) : null}

          <View style={{ alignItems: 'flex-end', marginTop: 10 }}>
            <TouchableOpacity onPress={resetPerformanceModal} style={{ paddingVertical: 8, paddingHorizontal: 12 }}>
              <Text style={{ color: '#1d4ed8', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  ) : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionCard title="Regional Office" subtitle="Your assigned region and county dashboard.">
          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color="#1d4ed8" />
              <Text style={styles.loadingText}>Loading your regional dashboard...</Text>
            </View>
          ) : null}

          {!isLoading && notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {!isLoading && region ? (
            <View style={styles.regionSummary}>
              <Text style={styles.heading}>{region.name}</Text>
              <Text style={styles.meta}>Code: {region.code}</Text>
              <Text style={styles.meta}>Nation: {region.nationCode || 'N/A'}</Text>
              <Text style={styles.meta}>Assigned officer: {region.assignedOfficerEmail || 'Not set'}</Text>
            </View>
          ) : null}
        </SectionCard>

        {region ? <CbeJurisdictionAnalytics
          scopeType="region"
          scopeCode={region.code}
          scopeName={region.name}
          nationCode={region.nationCode}
        /> : null}
        {region?.nationCode ? <LearnerFollowUpDashboard
          scopeType="region"
          scopeCode={region.code}
          scopeName={region.name}
          nationCode={region.nationCode}
        /> : null}

        <SectionCard title="Counties in this region" subtitle="All counties linked to your assigned region.">
          {!isLoading && counties.length === 0 ? (
            <Text style={styles.empty}>No counties are assigned to this region yet.</Text>
          ) : null}

          {counties.map((county) => (
            <TouchableOpacity
              key={county.id}
              style={[styles.row, selectedCountyCode === county.code && styles.rowSelected]}
              onPress={() => setSelectedCountyCode(county.code)}
              accessibilityState={{ selected: selectedCountyCode === county.code }}
            >
              <Text style={styles.rowCode}>{county.code}</Text>
              <Text style={styles.rowName}>{county.name}</Text>
              <Text style={styles.rowMeta}>{county.assignedOfficerEmail || 'No county officer assigned'}</Text>
            </TouchableOpacity>
          ))}
          {selectedCountyCode ? (
            <View style={styles.selectionBlock}>
              <Text style={styles.selectionTitle}>Sub-counties in {counties.find((item) => item.code === selectedCountyCode)?.name || selectedCountyCode}</Text>
              {!regionalSubCounties.length ? <Text style={styles.empty}>No sub-counties found in this county.</Text> : regionalSubCounties.map((subCounty) => (
                <TouchableOpacity
                  key={subCounty.id}
                  style={[styles.schoolButton, selectedSubCountyCode === subCounty.code && styles.schoolButtonActive]}
                  onPress={() => setSelectedSubCountyCode(subCounty.code)}
                  accessibilityState={{ selected: selectedSubCountyCode === subCounty.code }}
                >
                  <Text style={styles.rowCode}>{subCounty.code}</Text>
                  <Text style={styles.rowName}>{subCounty.name}</Text>
                </TouchableOpacity>
              ))}
              {selectedSubCountyCode ? (
                <View style={styles.selectionBlock}>
                  <Text style={styles.selectionTitle}>Schools in {regionalSubCounties.find((item) => item.code === selectedSubCountyCode)?.name || selectedSubCountyCode}</Text>
                  {!regionalSchools.length ? <Text style={styles.empty}>No schools found in this sub-county.</Text> : regionalSchools.map((school) => (
                    <TouchableOpacity
                      key={school.id}
                      style={[styles.schoolButton, selectedSchoolCode === school.code && styles.schoolButtonActive]}
                      onPress={() => {
                        setSelectedSchoolCode(school.code);
                        setSelectedLearnerGrade(null);
                      }}
                      accessibilityState={{ selected: selectedSchoolCode === school.code }}
                    >
                      <Text style={styles.rowCode}>{school.code}</Text>
                      <Text style={styles.rowName}>{school.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {selectedSchoolCode ? (
                    <View style={styles.gradeSelector}>
                      {['7', '8', '9', '10', '11', '12'].map((grade) => (
                        <TouchableOpacity key={grade} style={[styles.gradeButton, selectedLearnerGrade === grade && styles.gradeButtonActive]} onPress={() => setSelectedLearnerGrade(grade)} accessibilityState={{ selected: selectedLearnerGrade === grade }}>
                          <Text style={[styles.gradeButtonText, selectedLearnerGrade === grade && styles.gradeButtonTextActive]}>Grade {grade}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Affected learners" subtitle="Select a county, sub-county, school, and grade to view affected learners.">
          {!regionLearners.length ? (
            <Text style={styles.empty}>No learners in this region are below target by more than 60% in their last grade yet.</Text>
          ) : !selectedCountyCode || !selectedSubCountyCode || !selectedSchoolCode || !selectedLearnerGrade ? (
            <Text style={styles.empty}>Select a county, sub-county, school, and grade above to view learners.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 720 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator>
              {regionLearners.filter((learner) => {
                const learnerGrade = String(learner.gradeLevel || learner.classCode || '').replace(/\D/g, '');
                return learner.countyCode === selectedCountyCode && learner.subCountyCode === selectedSubCountyCode && learner.schoolCode === selectedSchoolCode && learnerGrade === selectedLearnerGrade;
              }).map((learner) => (
                <View key={learner.id} style={styles.learnerRow}>
                  <Text style={styles.learnerText}>{learner.fullName} - {learnerCareerMap[learner.id] || 'Career target not set'}</Text>
                  <Text style={styles.learnerMeta}>{regionalSchools.find((school) => school.code === learner.schoolCode)?.name || learner.schoolCode || 'School N/A'} • {learner.schoolCode || 'Registration code N/A'}</Text>
                  <Text style={styles.learnerMeta}>Grade {learner.gradeLevel || learner.classCode || 'N/A'} • Class {learner.classCode || 'N/A'} • {learner.subCountyCode || 'N/A'} • {learner.countyCode || 'N/A'}</Text>
                  <TouchableOpacity
                    style={styles.learnerActionButton}
                    onPress={async () => {
                      profileRequestRef.current += 1;
                      setPerformanceSessionId((current) => current + 1);
                      setSelectedLearner(learner);
                      setSelectedLearnerProfile(null);
                      setPerformanceAction('viewMenu');
                      const profile = await loadLearnerProfile(learner.id);
                      if (!profile) {
                        Alert.alert('Learner profile unavailable', 'This learner record does not yet contain performance data.');
                        return;
                      }
                      setSelectedLearnerProfile(profile);
                    }}
                  >
                    <Text style={styles.learnerActionButtonText}>View performance</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {!regionLearners.some((learner) => {
                const learnerGrade = String(learner.gradeLevel || learner.classCode || '').replace(/\D/g, '');
                return learner.countyCode === selectedCountyCode && learner.subCountyCode === selectedSubCountyCode && learner.schoolCode === selectedSchoolCode && learnerGrade === selectedLearnerGrade;
              }) ? <Text style={styles.empty}>No affected learners match this selection.</Text> : null}
            </ScrollView>
          )}
        </SectionCard>

        <RegionalCountySetupContent />
        {region ? <JurisdictionTransferManager scope="region" scopeCodes={{ nationCode: region.nationCode || '', regionCode: region.code }} /> : null}
      </ScrollView>

      {modalContent}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  content: {
    padding: Platform.OS === 'web' ? 32 : 20,
    gap: Platform.OS === 'web' ? 22 : 16,
    paddingBottom: 36,
    width: Platform.OS === 'web' ? '100%' : undefined,
    maxWidth: Platform.OS === 'web' ? 1680 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' : undefined,
  },
  buttonRow: {
    gap: 12,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 14,
    backgroundColor: '#f9fafb',
    padding: 16,
  },
  actionButtonActive: {
    borderColor: '#1d4ed8',
    backgroundColor: '#eff6ff',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  actionButtonTextActive: {
    color: '#1d4ed8',
  },
  actionButtonDescription: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  actionButtonDescriptionActive: {
    color: '#1e40af',
  },
  loadingState: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  loadingText: {
    color: '#374151',
    fontSize: 14,
    marginLeft: 10,
  },
  notice: {
    color: '#b91c1c',
    fontSize: 14,
    marginTop: 10,
  },
  regionSummary: {
    marginTop: 10,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  meta: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 6,
  },
  empty: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 8,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  rowSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  rowCode: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1d4ed8',
    marginBottom: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  rowMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  selectionBlock: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  selectionTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  schoolButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#f8fafc',
  },
  schoolButtonActive: {
    borderColor: '#1d4ed8',
    backgroundColor: '#eff6ff',
  },
  gradeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  gradeButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  gradeButtonActive: {
    borderColor: '#1d4ed8',
    backgroundColor: '#eff6ff',
  },
  gradeButtonText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  gradeButtonTextActive: {
    color: '#1d4ed8',
  },
  learnerRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  learnerText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  learnerMeta: {
    fontSize: 12,
    color: '#4b5563',
    marginBottom: 8,
  },
  learnerActionButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  learnerActionButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
});
