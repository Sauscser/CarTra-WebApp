import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { generateClient } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import SectionCard from '../../components/shared/SectionCard';
import ViewPerformance from '../../components/teacher/ViewPerformance';
import LearnerComments from '../../components/shared/LearnerComments';
import LearnerPerformanceGraphs from '../../components/shared/LearnerPerformanceGraphs';
import SubjectPerformanceGraph from '../../components/shared/SubjectPerformanceGraph';
import SubjectEvidenceActions from '../../components/shared/SubjectEvidenceActions';
import LearnerClusterPerformanceGraph from '../../components/shared/LearnerClusterPerformanceGraph';
import NationalCbeAnalytics from '../../components/shared/NationalCbeAnalytics';
import { getLearnerProfile, learnerSubjectPerformancesByNationGrade, listNationalCbeRollupsByGrade, listCoreSubjects, listGrade12ResultSummaries, listLearnerDocumentResources, listLearnerProfiles, listOrgHierarchies, listSubjects, listSupportSubjects, listTertiaryCourses, listTertiaryInstitutionProfiles, listUsers } from '../../graphql/queries';
import calculateHistoricalClusterSeries, { CBE_ATTEMPTED_POINTS_MAX, calculateDeviationPercentage, getCbeAchievementLevel, getCourseRequirementGroups, hasCompleteCourseScoringData, hasValidCbeAchievementRanges, parseCbeAchievementRanges, parseCourseClusterRequirements } from '../../utils/cluster';
import { resolveLearnerCareerTarget } from '../../utils/learnerCareer';
import { loadSupportSubjectIds } from '../../hooks/useSupportSubjectFilter';
import { buildHistoricalPerformanceFactsFromProfiles, buildNationalCbeRollupsFromFacts } from '../../utils/nationalCbeAnalytics';
import { NationalOfficerSetupContent } from './NationalOfficerSetupScreen';
import { NationalCatalogContent, NationalRegionsContent } from './NationalHomeScreen';
import CbeAchievementRangesScreen from './CbeAchievementRangesScreen';
import CbeJurisdictionAnalytics from '../../components/shared/CbeJurisdictionAnalytics';
import LearnerFollowUpDashboard from '../../components/shared/LearnerFollowUpDashboard';
import JurisdictionTransferManager from '../../components/shared/JurisdictionTransferManager';

type NationalScreenKey = 'home' | 'setup' | 'regions' | 'catalog' | 'cbeRanges' | 'transfers' | 'performance' | 'deviations' | 'analytics' | 'followUp';

type NationalEntity = {
  id: string;
  code: string;
  name: string;
  assignedOfficerEmail?: string | null;
  metadata?: Record<string, any> | null;
};

type NationalRegionEntity = { id: string; code: string; name: string };
type NationalCountyEntity = { id: string; code: string; name: string };
type NationalSubCountyEntity = { id: string; code: string; name: string };
type NationalSchoolEntity = { id: string; code: string; name: string };

const NATIONAL_ACTIONS: Array<{ key: Exclude<NationalScreenKey, 'home'>; title: string; description: string }> = [
  {
    key: 'setup',
    title: 'Create National Office',
    description: 'Create the national office record and national officer profile.',
  },
  {
    key: 'regions',
    title: 'Manage Regions',
    description: 'Create and review regions under the nation.',
  },
  {
    key: 'catalog',
    title: 'Master Catalog',
    description: 'Add subjects, tracks, pathways, competencies, and core values.',
  },
  {
    key: 'cbeRanges',
    title: 'CBE and Subject Settings',
    description: 'Revise national mark ranges and search or update subject records.',
  },
  {
    key: 'transfers',
    title: 'Regional Officer Transfers',
    description: 'Transfer an existing regional officer to another region in this nation.',
  },
  {
    key: 'performance',
    title: 'Performance Summary',
    description: 'National Grade 12 outcome trends, tertiary coverage, and career targets.',
  },
  {
    key: 'analytics',
    title: 'National CBE Analytics',
    description: 'Grade-level achievement bands and learner and tertiary-target deviation distributions.',
  },
  {
    key: 'followUp',
    title: 'Progress Follow-up',
    description: 'Find schools, classes, and learners with outstanding targets, promotions, and assessment scores.',
  },
  {
    key: 'deviations',
    title: "Learner's deviations",
    description: 'Review learners whose latest deviation is below -80%.',
  },
];

function NationalPerformanceSummaryContent({
  nationalCareerSummary,
  tertiaryInstitutions,
  tertiaryCourses,
}: {
  nationalCareerSummary: {
    totalSummaries: number;
    metTarget: number;
    belowTarget: number;
    eligible: number;
    pending: number;
    institutionCount: number;
    courseCount: number;
    topCareers: Array<{ name: string; value: number }>;
  };
  tertiaryInstitutions: Array<{ id: string; institutionName: string; nationCode?: string | null; regionCode?: string | null; countyCode?: string | null; userId?: string | null; adminEmail?: string | null }>;
  tertiaryCourses: Array<{ id: string; institutionId?: string | null; institutionName?: string | null; courseCode?: string | null; courseName: string; clusterRequirements?: any; status?: string | null }>;
}) {
  const [expandedInstitutionIds, setExpandedInstitutionIds] = useState<Record<string, boolean>>({});
  const [showInstitutionList, setShowInstitutionList] = useState(true);

  const toggleInstitution = (institutionId: string) => {
    setExpandedInstitutionIds((current) => ({
      ...current,
      [institutionId]: !current[institutionId],
    }));
  };

  const toggleInstitutionPanel = () => setShowInstitutionList((current) => !current);

  return (
    <SectionCard title="Performance Summary" subtitle="Final Grade 12 outcomes captured across this national office." defaultExpanded={false}>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryTile}><Text style={styles.summaryLabel}>Total summaries</Text><Text style={styles.summaryValue}>{nationalCareerSummary.totalSummaries}</Text></View>
        <View style={styles.summaryTile}><Text style={styles.summaryLabel}>Met target</Text><Text style={styles.summaryValue}>{nationalCareerSummary.metTarget}</Text></View>
        <View style={styles.summaryTile}><Text style={styles.summaryLabel}>Below target</Text><Text style={styles.summaryValue}>{nationalCareerSummary.belowTarget}</Text></View>
        <View style={styles.summaryTile}><Text style={styles.summaryLabel}>Eligible</Text><Text style={styles.summaryValue}>{nationalCareerSummary.eligible}</Text></View>
        <View style={styles.summaryTile}><Text style={styles.summaryLabel}>Pending</Text><Text style={styles.summaryValue}>{nationalCareerSummary.pending}</Text></View>
        <View style={styles.summaryTile}><Text style={styles.summaryLabel}>Institutions</Text><Text style={styles.summaryValue}>{tertiaryInstitutions.length || nationalCareerSummary.institutionCount}</Text></View>
        <View style={styles.summaryTile}><Text style={styles.summaryLabel}>Courses</Text><Text style={styles.summaryValue}>{tertiaryCourses.length || nationalCareerSummary.courseCount}</Text></View>
      </View>

      <View style={styles.catalogSection}>
        <TouchableOpacity onPress={toggleInstitutionPanel} activeOpacity={0.8} style={styles.sectionHeaderButton}>
          <Text style={styles.selectionTitle}>Institutions in this nation</Text>
          <Text style={styles.expandToggleText}>{showInstitutionList ? '−' : '+'}</Text>
        </TouchableOpacity>

        {showInstitutionList ? (
          tertiaryInstitutions.length ? (
            tertiaryInstitutions.map((institution) => {
              const institutionCourses = tertiaryCourses.filter((course) => String(course.institutionId || '') === String(institution.id || ''));
              const isExpanded = !!expandedInstitutionIds[institution.id];

              return (
                <View key={institution.id} style={styles.catalogRow}>
                  <TouchableOpacity style={styles.institutionToggleRow} onPress={() => toggleInstitution(institution.id)} activeOpacity={0.8}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.catalogTitle}>{institution.institutionName}</Text>
                      <Text style={styles.catalogMeta}>Admin email: {institution.adminEmail || 'Unknown email'}</Text>
                      <Text style={styles.catalogMeta}>Region: {institution.regionCode || 'N/A'} • County: {institution.countyCode || 'N/A'}</Text>
                    </View>
                    <Text style={styles.expandToggleText}>{isExpanded ? '−' : '+'}</Text>
                  </TouchableOpacity>

                  {isExpanded ? (
                    <View style={styles.courseListContainer}>
                      {institutionCourses.length ? (
                        institutionCourses.map((course) => (
                          <View key={course.id} style={styles.courseRow}>
                            <Text style={styles.catalogTitle}>{course.courseName}</Text>
                            <Text style={styles.catalogMeta}>Code: {course.courseCode || 'N/A'}</Text>
                            {hasCompleteCourseScoringData(course.clusterRequirements) ? (
                              <Text style={styles.catalogMeta}>
                                CBE requirements (score max {8 * getCourseRequirementGroups(course.clusterRequirements).length}; seven-best minimum {parseCourseClusterRequirements(course.clusterRequirements)?.bestSubjectsMinimumPoints}/{CBE_ATTEMPTED_POINTS_MAX}): {getCourseRequirementGroups(course.clusterRequirements).map((group: any[]) => group.map((item) => `${item.subjectName || item.subjectId} min ${item.minimumPoints ?? '?'}${Number.isInteger(item.minimumPoints) ? ` ${getCbeAchievementLevel(Number(item.minimumPoints))}` : ''}`).join(' OR ')).join(' · ')}
                              </Text>
                            ) : <Text style={styles.catalogMeta}>Not assignable: cluster subject minima, tertiary seven-best minimum, or saved national CBE mark ranges are missing.</Text>}
                          </View>
                        ))
                      ) : (
                        <Text style={styles.empty}>No courses have been added for this institution yet.</Text>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text style={styles.empty}>No tertiary institutions have been created for this nation yet.</Text>
          )
        ) : null}
      </View>

      {nationalCareerSummary.topCareers.length ? (
        <View style={styles.careerList}>
          <Text style={styles.selectionTitle}>Top career targets</Text>
          {nationalCareerSummary.topCareers.map((item) => (
            <View key={item.name} style={styles.careerRow}>
              <Text style={styles.careerName}>{item.name}</Text>
              <Text style={styles.careerCount}>{item.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>No final Grade 12 career results have been captured for this nation yet.</Text>
      )}
    </SectionCard>
  );
}

function NationalDeviationWatchContent({
  nationalLearners,
  learnerCareerMap,
  nationalRegions,
  nationalCounties,
  nationalSubCounties,
  nationalSchools,
  selectedRegionCode,
  selectedCountyCode,
  selectedSubCountyCode,
  selectedSchoolCode,
  selectedLearnerGrade,
  setSelectedRegionCode,
  setSelectedCountyCode,
  setSelectedSubCountyCode,
  setSelectedSchoolCode,
  setSelectedLearnerGrade,
  onViewPerformance,
}: {
  nationalLearners: Array<{ id: string; fullName: string; gradeLevel?: string | null; classCode?: string | null; assessmentNumber?: string | null; regionCode?: string | null; countyCode?: string | null; subCountyCode?: string | null; schoolCode?: string | null }>;
  learnerCareerMap: Record<string, string | null>;
  nationalRegions: Array<{ id: string; code: string; name: string }>;
  nationalCounties: Array<{ id: string; code: string; name: string }>;
  nationalSubCounties: Array<{ id: string; code: string; name: string }>;
  nationalSchools: Array<{ id: string; code: string; name: string }>;
  selectedRegionCode: string | null;
  selectedCountyCode: string | null;
  selectedSubCountyCode: string | null;
  selectedSchoolCode: string | null;
  selectedLearnerGrade: string | null;
  setSelectedRegionCode: (value: string | null) => void;
  setSelectedCountyCode: (value: string | null) => void;
  setSelectedSubCountyCode: (value: string | null) => void;
  setSelectedSchoolCode: (value: string | null) => void;
  setSelectedLearnerGrade: (value: string | null) => void;
  onViewPerformance: (learner: { id: string; fullName: string; gradeLevel?: string | null; classCode?: string | null; assessmentNumber?: string | null; regionCode?: string | null; countyCode?: string | null; subCountyCode?: string | null; schoolCode?: string | null }) => void;
}) {
  const filteredLearners = nationalLearners.filter((learner) => {
    const learnerGrade = String(learner.gradeLevel || learner.classCode || '').replace(/\D/g, '');
    return learner.regionCode === selectedRegionCode && learner.countyCode === selectedCountyCode && learner.subCountyCode === selectedSubCountyCode && learner.schoolCode === selectedSchoolCode && learnerGrade === selectedLearnerGrade;
  });

  const regionSelector = (
    <View style={{ marginBottom: 12 }}>
      {!nationalRegions.length ? (
        <Text style={styles.empty}>No regions are available in this nation.</Text>
      ) : nationalRegions.map((regionItem) => (
        <TouchableOpacity
          key={regionItem.id}
          style={[styles.row, selectedRegionCode === regionItem.code && styles.rowSelected]}
          onPress={() => { setSelectedRegionCode(regionItem.code); }}
          accessibilityState={{ selected: selectedRegionCode === regionItem.code }}
        >
          <Text style={styles.rowCode}>{regionItem.code}</Text>
          <Text style={styles.rowName}>{regionItem.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SectionCard title="Learner's deviations" subtitle="Learners whose latest assessment deviation is below -80% in this nation." defaultExpanded={false}>
      {!nationalLearners.length ? (
        <Text style={styles.empty}>No learners in this nation are below target by more than 80% in their last grade yet.</Text>
      ) : (
        <>
          {!selectedRegionCode || !selectedCountyCode || !selectedSubCountyCode || !selectedSchoolCode || !selectedLearnerGrade ? (
            <Text style={styles.empty}>Select a region below, then choose the county, sub-county, school, and grade to view learners.</Text>
          ) : null}
          {regionSelector}
          {selectedRegionCode ? (
            <View style={styles.selectionBlock}>
              <Text style={styles.selectionTitle}>Counties in {nationalRegions.find((item) => item.code === selectedRegionCode)?.name || selectedRegionCode}</Text>
              {!nationalCounties.length ? <Text style={styles.empty}>No counties found in this region.</Text> : nationalCounties.map((county) => (
                <TouchableOpacity key={county.id} style={[styles.schoolButton, selectedCountyCode === county.code && styles.schoolButtonActive]} onPress={() => setSelectedCountyCode(county.code)} accessibilityState={{ selected: selectedCountyCode === county.code }}>
                  <Text style={styles.rowCode}>{county.code}</Text><Text style={styles.rowName}>{county.name}</Text>
                </TouchableOpacity>
              ))}
              {selectedCountyCode ? (
                <View style={styles.selectionBlock}>
                  <Text style={styles.selectionTitle}>Sub-counties in {nationalCounties.find((item) => item.code === selectedCountyCode)?.name || selectedCountyCode}</Text>
                  {!nationalSubCounties.length ? <Text style={styles.empty}>No sub-counties found in this county.</Text> : nationalSubCounties.map((subCounty) => (
                    <TouchableOpacity key={subCounty.id} style={[styles.schoolButton, selectedSubCountyCode === subCounty.code && styles.schoolButtonActive]} onPress={() => setSelectedSubCountyCode(subCounty.code)} accessibilityState={{ selected: selectedSubCountyCode === subCounty.code }}>
                      <Text style={styles.rowCode}>{subCounty.code}</Text><Text style={styles.rowName}>{subCounty.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {selectedSubCountyCode ? (
                    <View style={styles.selectionBlock}>
                      <Text style={styles.selectionTitle}>Schools in {nationalSubCounties.find((item) => item.code === selectedSubCountyCode)?.name || selectedSubCountyCode}</Text>
                      {!nationalSchools.length ? <Text style={styles.empty}>No schools found in this sub-county.</Text> : nationalSchools.map((school) => (
                        <TouchableOpacity key={school.id} style={[styles.schoolButton, selectedSchoolCode === school.code && styles.schoolButtonActive]} onPress={() => { setSelectedSchoolCode(school.code); setSelectedLearnerGrade(null); }} accessibilityState={{ selected: selectedSchoolCode === school.code }}>
                          <Text style={styles.rowCode}>{school.code}</Text><Text style={styles.rowName}>{school.name}</Text>
                        </TouchableOpacity>
                      ))}
                      {selectedSchoolCode ? <View style={styles.gradeSelector}>{['7', '8', '9', '10', '11', '12'].map((grade) => (
                        <TouchableOpacity key={grade} style={[styles.gradeButton, selectedLearnerGrade === grade && styles.gradeButtonActive]} onPress={() => setSelectedLearnerGrade(grade)} accessibilityState={{ selected: selectedLearnerGrade === grade }}>
                          <Text style={[styles.gradeButtonText, selectedLearnerGrade === grade && styles.gradeButtonTextActive]}>Grade {grade}</Text>
                        </TouchableOpacity>
                      ))}</View> : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {selectedRegionCode && selectedCountyCode && selectedSubCountyCode && selectedSchoolCode && selectedLearnerGrade ? (
            <ScrollView style={{ maxHeight: 720 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator>
              {filteredLearners.map((learner) => (
                <View key={learner.id} style={styles.learnerRow}>
                  <Text style={styles.learnerText}>{learner.fullName} - {learnerCareerMap[learner.id] || 'Career target not set'}</Text>
                  <Text style={styles.learnerMeta}>{nationalSchools.find((school) => school.code === learner.schoolCode)?.name || learner.schoolCode || 'School N/A'} • {learner.schoolCode || 'Registration code N/A'}</Text>
                  <Text style={styles.learnerMeta}>Grade {learner.gradeLevel || learner.classCode || 'N/A'} • Class {learner.classCode || 'N/A'} • {learner.subCountyCode || 'N/A'} • {learner.countyCode || 'N/A'} • {learner.regionCode || 'N/A'}</Text>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => onViewPerformance(learner)}
                  >
                    <Text style={styles.actionButtonText}>View performance</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {!filteredLearners.length ? <Text style={styles.empty}>No affected learners match this selection.</Text> : null}
            </ScrollView>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

export default function NationalOfficeScreen() {
  const [activeScreen, setActiveScreen] = useState<NationalScreenKey>('home');
  const client = useMemo(() => generateClient(), []);
  const [nation, setNation] = useState<NationalEntity | null>(null);
  const [nationalRegions, setNationalRegions] = useState<NationalRegionEntity[]>([]);
  const [nationalCounties, setNationalCounties] = useState<NationalCountyEntity[]>([]);
  const [nationalSubCounties, setNationalSubCounties] = useState<NationalSubCountyEntity[]>([]);
  const [nationalSchools, setNationalSchools] = useState<NationalSchoolEntity[]>([]);
  const [nationalLearners, setNationalLearners] = useState<Array<{ id: string; fullName: string; gradeLevel?: string | null; classCode?: string | null; assessmentNumber?: string | null; regionCode?: string | null; countyCode?: string | null; subCountyCode?: string | null; schoolCode?: string | null }>>([]);
  const [nationalCbeRollups, setNationalCbeRollups] = useState<any[]>([]);
  const [nationalSupportSubjectIds, setNationalSupportSubjectIds] = useState<ReadonlySet<string>>(new Set());
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsNotice, setAnalyticsNotice] = useState('');
  const [analyticsRequestedNation, setAnalyticsRequestedNation] = useState<string | null>(null);
  const [nationalCareerSummary, setNationalCareerSummary] = useState({
    totalSummaries: 0,
    metTarget: 0,
    belowTarget: 0,
    eligible: 0,
    pending: 0,
    institutionCount: 0,
    courseCount: 0,
    topCareers: Array<{ name: string; value: number }>(),
  });
  const [tertiaryInstitutions, setTertiaryInstitutions] = useState<Array<{ id: string; institutionName: string; nationCode?: string | null; regionCode?: string | null; countyCode?: string | null; userId?: string | null; adminEmail?: string | null }>>([]);
  const [tertiaryCourses, setTertiaryCourses] = useState<Array<{ id: string; institutionId?: string | null; institutionName?: string | null; courseCode?: string | null; courseName: string; clusterRequirements?: any; status?: string | null }>>([]);
  const [selectedRegionCode, setSelectedRegionCode] = useState<string | null>(null);
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
    void loadCurrentNationalOffice();
  }, [client]);

  useEffect(() => {
    if (nation?.code) {
      void loadNationalLearners();
      void loadNationalCareerSummary();
      void loadTertiaryCatalog();
    }
  }, [nation?.code]);

  useEffect(() => {
    if (activeScreen === 'analytics' && nation?.code && analyticsRequestedNation !== nation.code && !analyticsLoading) {
      void loadNationalAnalytics();
    }
  }, [activeScreen, nation?.code, analyticsRequestedNation, analyticsLoading]);

  useEffect(() => {
    if (selectedRegionCode) void loadNationalCounties(selectedRegionCode);
    else setNationalCounties([]);
    setSelectedCountyCode(null);
    setSelectedSubCountyCode(null);
    setSelectedSchoolCode(null);
    setSelectedLearnerGrade(null);
  }, [selectedRegionCode]);

  useEffect(() => {
    if (selectedCountyCode) void loadNationalSubCounties(selectedCountyCode);
    else setNationalSubCounties([]);
    setSelectedSubCountyCode(null);
    setSelectedSchoolCode(null);
    setSelectedLearnerGrade(null);
  }, [selectedCountyCode]);

  useEffect(() => {
    if (selectedSubCountyCode) void loadNationalSchools(selectedSubCountyCode);
    else setNationalSchools([]);
    setSelectedSchoolCode(null);
    setSelectedLearnerGrade(null);
  }, [selectedSubCountyCode]);

  const loadCurrentNationalOffice = async () => {
    try {
      setIsLoading(true);
      setNotice('');

      const session = await fetchAuthSession();
      const currentEmail = (session.tokens?.idToken?.payload as { email?: string } | undefined)?.email?.trim().toLowerCase();

      if (!currentEmail) {
        setNation(null);
        setNotice('No signed-in user email was found.');
        return;
      }

      const result = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'nation' } }, { assignedOfficerEmail: { eq: currentEmail } }],
          },
          limit: 20,
        },
      });

      const payload = result as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const matchedNation = payload.data?.listOrgHierarchies?.items?.[0];

      if (!matchedNation) {
        setNation(null);
        setNotice(`No national office is assigned to ${currentEmail}.`);
        return;
      }

      setNation({
        id: matchedNation.id,
        code: matchedNation.code,
        name: matchedNation.name,
        assignedOfficerEmail: matchedNation.assignedOfficerEmail,
        metadata: typeof matchedNation.metadata === 'string'
          ? (() => { try { return JSON.parse(matchedNation.metadata); } catch { return {}; } })()
          : matchedNation.metadata || {},
      });
    } catch {
      setNation(null);
      setNotice('Could not load the national account details for this user.');
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

  const loadNationalCounties = async (regionCode: string) => {
    const result = await client.graphql({ query: listOrgHierarchies, variables: { filter: { and: [{ entityType: { eq: 'county' } }, { regionCode: { eq: regionCode } }] }, limit: 500 } } as any);
    const items = (result as any).data?.listOrgHierarchies?.items || [];
    setNationalCounties(items.filter((item: any) => item?.id && item?.code && item?.name).map((item: any) => ({ id: item.id, code: item.code, name: item.name })));
  };

  const loadNationalSubCounties = async (countyCode: string) => {
    const result = await client.graphql({ query: listOrgHierarchies, variables: { filter: { and: [{ entityType: { eq: 'subCounty' } }, { countyCode: { eq: countyCode } }] }, limit: 500 } } as any);
    const items = (result as any).data?.listOrgHierarchies?.items || [];
    setNationalSubCounties(items.filter((item: any) => item?.id && item?.code && item?.name).map((item: any) => ({ id: item.id, code: item.code, name: item.name })));
  };

  const loadNationalSchools = async (subCountyCode: string) => {
    const result = await client.graphql({ query: listOrgHierarchies, variables: { filter: { and: [{ entityType: { eq: 'school' } }, { subCountyCode: { eq: subCountyCode } }] }, limit: 500 } } as any);
    const items = (result as any).data?.listOrgHierarchies?.items || [];
    setNationalSchools(items.filter((item: any) => item?.id && item?.code && item?.name).map((item: any) => ({ id: item.id, code: item.code, name: item.name })));
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

  const loadNationalCareerSummary = async () => {
    if (!nation?.code) {
      setNationalCareerSummary({
        totalSummaries: 0,
        metTarget: 0,
        belowTarget: 0,
        eligible: 0,
        pending: 0,
        institutionCount: 0,
        courseCount: 0,
        topCareers: [],
      });
      return;
    }

    try {
      const result = await client.graphql({
        query: listGrade12ResultSummaries,
        variables: { limit: 500 },
      } as any);

      const items = ((result as any).data?.listGrade12ResultSummaries?.items || []) as Array<any>;
      const summaries = items.filter((item: any) => {
        const nationCode = String(item?.nationCode || '').trim();
        return Boolean(item?.learnerId) && nationCode.length > 0 && nationCode.toLowerCase() === String(nation.code).trim().toLowerCase();
      });

      const metTarget = summaries.filter((item: any) => item?.wasTargetCareerReached === true || item?.resultStatus === 'met_target').length;
      const belowTarget = summaries.filter((item: any) => item?.wasTargetCareerReached === false || item?.resultStatus === 'below_target').length;
      const eligible = summaries.filter((item: any) => item?.placementStatus === 'eligible').length;
      const pending = summaries.filter((item: any) => item?.placementStatus === 'pending').length;

      const careerMap = new Map<string, number>();
      summaries.forEach((item: any) => {
        const name = String(item?.targetCareerName || item?.courseName || item?.institutionName || 'Unassigned').trim();
        if (!name) return;
        careerMap.set(name, (careerMap.get(name) || 0) + 1);
      });

      const topCareers = Array.from(careerMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 5);

      setNationalCareerSummary({
        totalSummaries: summaries.length,
        metTarget,
        belowTarget,
        eligible,
        pending,
        institutionCount: new Set(summaries.map((item: any) => String(item?.institutionName || '').trim()).filter(Boolean)).size,
        courseCount: new Set(summaries.map((item: any) => String(item?.courseName || '').trim()).filter(Boolean)).size,
        topCareers,
      });
    } catch (error) {
      console.warn('loadNationalCareerSummary failed', error);
      setNationalCareerSummary({
        totalSummaries: 0,
        metTarget: 0,
        belowTarget: 0,
        eligible: 0,
        pending: 0,
        institutionCount: 0,
        courseCount: 0,
        topCareers: [],
      });
    }
  };

  const loadTertiaryCatalog = async () => {
    if (!nation?.code) {
      setTertiaryInstitutions([]);
      setTertiaryCourses([]);
      return;
    }

    try {
      const [institutionResult, courseResult, userResult, subjectsResult, coreSubjectsResult, supportSubjectsResult] = await Promise.all([
        client.graphql({
          query: listTertiaryInstitutionProfiles,
          variables: { limit: 500 },
        } as any),
        client.graphql({
          query: listTertiaryCourses,
          variables: { limit: 500 },
        } as any),
        client.graphql({
          query: listUsers,
          variables: { limit: 500 },
        } as any),
        client.graphql({ query: listSubjects, variables: { limit: 500 } } as any),
        client.graphql({ query: listCoreSubjects, variables: { limit: 500 } } as any),
        client.graphql({ query: listSupportSubjects, variables: { limit: 500 } } as any),
      ]);

      const institutions = ((institutionResult as any).data?.listTertiaryInstitutionProfiles?.items || []) as Array<any>;
      const courses = ((courseResult as any).data?.listTertiaryCourses?.items || []) as Array<any>;
      const users = ((userResult as any).data?.listUsers?.items || []) as Array<any>;
      const subjectNameById = [
        ...(((subjectsResult as any).data?.listSubjects?.items || []) as Array<any>),
        ...(((coreSubjectsResult as any).data?.listCoreSubjects?.items || []) as Array<any>),
        ...(((supportSubjectsResult as any).data?.listSupportSubjects?.items || []) as Array<any>),
      ].reduce((map: Record<string, string>, subject: any) => {
        if (subject?.id) map[String(subject.id)] = String(subject.name || subject.code || subject.id);
        return map;
      }, {});

      const emailMap = users.reduce((map: Record<string, string>, user: any) => {
        if (user?.id) {
          map[user.id] = user.email || user.username || 'Unknown email';
        }
        return map;
      }, {} as Record<string, string>);

      const nationInstitutions = institutions
        .filter((item: any) => String(item?.nationCode || '').trim().toLowerCase() === String(nation.code).trim().toLowerCase())
        .map((item: any) => ({
          id: item.id,
          institutionName: item.institutionName,
          nationCode: item.nationCode,
          regionCode: item.regionCode,
          countyCode: item.countyCode,
          userId: item.userId,
          adminEmail: emailMap[String(item.userId || '')] || emailMap[String(item?.userId || '').toLowerCase()] || 'Unknown email',
        }));

      const institutionMap = new Map<string, string>();
      nationInstitutions.forEach((institution: any) => {
        institutionMap.set(institution.id, institution.institutionName || 'Unknown institution');
      });

      const nationCourses = courses
        .filter((course: any) => {
          const institutionName = institutionMap.get(String(course?.institutionId || ''));
          return Boolean(course?.courseName) && (course?.institutionId ? institutionMap.has(String(course.institutionId)) : true);
        })
        .map((course: any) => ({
          id: course.id,
          institutionId: course.institutionId,
          institutionName: institutionMap.get(String(course?.institutionId || '')) || 'Unknown institution',
          courseCode: course.courseCode,
          courseName: course.courseName,
          clusterRequirements: course.clusterRequirements ? (() => {
            const parsed = typeof course.clusterRequirements === 'string' ? JSON.parse(course.clusterRequirements) : course.clusterRequirements;
            const normalized = parseCourseClusterRequirements(parsed);
            if (!normalized?.subjectSequence) return null;
            return {
              ...normalized,
              subjectSequence: normalized.subjectSequence.map((requirement) => ({
                ...requirement,
                subjectName: subjectNameById[String(requirement.subjectId)] || String(requirement.subjectId),
              })),
            };
          })() : null,
          status: course.status,
        }));

      setTertiaryInstitutions(nationInstitutions);
      setTertiaryCourses(nationCourses);
    } catch (error) {
      console.warn('loadTertiaryCatalog failed', error);
      setTertiaryInstitutions([]);
      setTertiaryCourses([]);
    }
  };

  const loadNationalLearners = async () => {
    if (!nation?.code) return;
    try {
      const regionResult = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'region' } }, { nationCode: { eq: nation.code } }],
          },
          limit: 200,
        },
      });

      const regionPayload = regionResult as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const regionItems = (regionPayload.data?.listOrgHierarchies?.items || []).filter((item: any) => item?.id && item?.code && item?.name);
      setNationalRegions(regionItems.map((item: any) => ({ id: item.id, code: item.code, name: item.name })));
      const regionCodes = regionItems.map((item: any) => item.code).filter(Boolean);

      if (regionCodes.length === 0) {
        setNationalLearners([]);
        return;
      }

      const learnerBatches = await Promise.all(regionCodes.map(async (regionCode: string) => {
        const result = await client.graphql({
          query: listLearnerProfiles,
          variables: { filter: { regionCode: { eq: regionCode } }, limit: 500 },
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
        const includeLearner = !!lastAssessment && lastAssessment.deviation < -80;

        console.log('[NationalOfficeScreen] learner last grade cluster check', JSON.stringify({
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

      setNationalLearners(filteredItems.map((learner: any) => ({
        id: learner.id,
        fullName: learner.fullName,
        gradeLevel: learner.gradeLevel,
        classCode: learner.classCode,
        assessmentNumber: learner.assessmentNumber,
        regionCode: learner.regionCode,
        countyCode: learner.countyCode,
        subCountyCode: learner.subCountyCode,
        schoolCode: learner.schoolCode,
      })));

      await Promise.all(filteredItems.map((learner: any) => loadSelectedLearnerCareer(learner.id)));
    } catch (error) {
      console.warn('loadNationalLearners failed', error);
      setNationalLearners([]);
    }
  };

  const loadNationalAnalytics = async () => {
    if (!nation?.code) return;
    try {
      setAnalyticsRequestedNation(nation.code);
      setAnalyticsLoading(true);
      setNationalCbeRollups([]);
      setNationalSupportSubjectIds(new Set());
      setAnalyticsNotice('');
      const grades = [7, 8, 9, 10, 11, 12];
      const [gradeRollups, supportSubjectIds] = await Promise.all([Promise.all(grades.map(async (grade) => {
        const rollups: any[] = [];
        let nextToken: string | null = null;
        do {
          const page: any = await client.graphql({
            query: listNationalCbeRollupsByGrade,
            variables: {
              nationGradeKey: `${nation.code.trim().toUpperCase()}#${grade}`,
              limit: 500,
              nextToken,
            },
          } as any);
          const connection: { items?: any[]; nextToken?: string | null } | undefined = page?.data?.listNationalCbeRollupsByGrade;
          rollups.push(...(connection?.items || []));
          nextToken = connection?.nextToken || null;
        } while (nextToken);
        return rollups;
      })), loadSupportSubjectIds()]);

      const rollups = gradeRollups.flat();
      const gradesWithRollups = new Set(
        rollups.filter((item) => Number(item.count) > 0).map((item) => Number(String(item.nationGradeKey).split('#').pop())),
      );
      const gradesMissingRollups = grades.filter((grade) => !gradesWithRollups.has(grade));
      if (gradesMissingRollups.length > 0) {
        const annualFacts = (await Promise.all(gradesMissingRollups.map(async (grade) => {
          const facts: any[] = [];
          let nextToken: string | null = null;
          do {
            const page: any = await client.graphql({
              query: learnerSubjectPerformancesByNationGrade,
              variables: {
                nationGradeKey: `${nation.code.trim().toUpperCase()}#${grade}`,
                limit: 500,
                nextToken,
              },
            } as any);
            const connection: { items?: any[]; nextToken?: string | null } | undefined = page?.data?.learnerSubjectPerformancesByNationGrade;
            facts.push(...(connection?.items || []));
            nextToken = connection?.nextToken || null;
          } while (nextToken);
          return facts;
        }))).flat();
        rollups.push(...buildNationalCbeRollupsFromFacts(annualFacts));

        const regionResult: any = await client.graphql({
          query: listOrgHierarchies,
          variables: {
            filter: {
              and: [
                { entityType: { eq: 'region' } },
                { nationCode: { eq: nation.code } },
              ],
            },
            limit: 500,
          },
        } as any);
        const regionCodes = (regionResult?.data?.listOrgHierarchies?.items || [])
          .map((region: any) => String(region?.code || '').trim())
          .filter(Boolean);
        const learnerProfiles = (await Promise.all(regionCodes.map(async (regionCode: string) => {
          const profiles: any[] = [];
          let nextToken: string | null = null;
          do {
            const page: any = await client.graphql({
              query: listLearnerProfiles,
              variables: {
                filter: { regionCode: { eq: regionCode } },
                limit: 500,
                nextToken,
              },
            } as any);
            const connection: { items?: any[]; nextToken?: string | null } | undefined = page?.data?.listLearnerProfiles;
            profiles.push(...(connection?.items || []).filter((profile: any) => profile?.nationCode === nation.code));
            nextToken = connection?.nextToken || null;
          } while (nextToken);
          return profiles;
        }))).flat();
        const annualFactKeys = new Set(annualFacts
          .filter((fact) => {
            const cycle = String(fact?.termOrCycle || '').replace(/[^a-z]/gi, '').toLowerCase();
            const achievedMark = Number(fact?.achievedMark);
            return fact?.subjectId &&
              fact.subjectId !== '__ANNUAL_CLUSTER__' &&
              cycle === 'endofyear' &&
              Number(fact.gradeLevel) >= 7 &&
              Number(fact.gradeLevel) <= 12 &&
              Number.isFinite(achievedMark) &&
              achievedMark >= 0;
          })
          .map((fact) => `${fact.learnerId}#${fact.gradeLevel}#${fact.subjectId}`));
        const profileHistoryFacts = buildHistoricalPerformanceFactsFromProfiles(learnerProfiles, new Set(gradesMissingRollups))
          .filter((fact) => !annualFactKeys.has(`${fact.learnerId}#${fact.gradeLevel}#${fact.subjectId}`));
        rollups.push(...buildNationalCbeRollupsFromFacts(profileHistoryFacts));
      }
      setNationalCbeRollups(rollups);
      setNationalSupportSubjectIds(supportSubjectIds);
      setAnalyticsNotice('');
    } catch (error) {
      console.warn('loadNationalAnalytics failed', error);
      setAnalyticsNotice('Could not load complete national learner data. Try again before interpreting these statistics.');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const modalContent = performanceAction && selectedLearner ? (
    <Modal transparent visible={!!performanceAction} animationType="slide" onRequestClose={resetPerformanceModal}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' }}>
        <View key={`${performanceSessionId}-${selectedLearner?.id ?? 'national-performance'}`} style={{ margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '90%' }}>
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

          <View style={{ alignItems: 'flex-end', marginTop: 10 }}>
            <TouchableOpacity onPress={resetPerformanceModal} style={{ paddingVertical: 8, paddingHorizontal: 12 }}>
              <Text style={{ color: '#1d4ed8', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>

          {performanceAction === 'viewGuidance' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <LearnerComments learnerId={selectedLearner.id} currentGrade={selectedLearner.gradeLevel} authorRoleOverride="national" />
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
        </View>
      </View>
    </Modal>
  ) : null;

  const activeContent = useMemo(() => {
    switch (activeScreen) {
      case 'setup':
        return <NationalOfficerSetupContent />;
      case 'regions':
        return <NationalRegionsContent />;
      case 'catalog':
        return <NationalCatalogContent />;
      case 'cbeRanges':
        return <CbeAchievementRangesScreen />;
      case 'transfers':
        return nation ? <JurisdictionTransferManager scope="nation" scopeCodes={{ nationCode: nation.code }} /> : <Text style={styles.empty}>Load the assigned national office before transferring officers.</Text>;
      case 'performance':
        return (
          <NationalPerformanceSummaryContent
            nationalCareerSummary={nationalCareerSummary}
            tertiaryInstitutions={tertiaryInstitutions}
            tertiaryCourses={tertiaryCourses}
          />
        );
      case 'analytics':
        return (
          <SectionCard title="National CBE analytics" subtitle="Grade-by-grade distributions from saved learner records." defaultExpanded={true}>
            {analyticsLoading ? (
              <View style={styles.loadingState}><ActivityIndicator size="small" color="#176b87" /><Text style={styles.loadingText}>Loading annual performance records...</Text></View>
            ) : null}
            {analyticsNotice ? <Text style={styles.notice}>{analyticsNotice}</Text> : null}
            {!analyticsLoading ? (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => { setAnalyticsRequestedNation(null); setAnalyticsNotice(''); }}
                accessibilityRole="button"
              >
                <Text style={styles.actionButtonText}>{analyticsNotice.startsWith('Could not load') ? 'Retry annual statistics' : 'Refresh annual statistics'}</Text>
              </TouchableOpacity>
            ) : null}
            {!analyticsLoading && nationalCbeRollups.length ? (
              <NationalCbeAnalytics
                rollups={nationalCbeRollups}
                supportSubjectIds={nationalSupportSubjectIds}
                ranges={parseCbeAchievementRanges(nation?.metadata?.cbeAchievementRanges)}
                rangesConfigured={hasValidCbeAchievementRanges(nation?.metadata?.cbeAchievementRanges)}
                showCumulativeDistribution
              />
            ) : null}
            {!analyticsLoading && !nationalCbeRollups.length && !analyticsNotice.startsWith('Could not load') ? (
              <Text style={styles.empty}>No annual end-of-year performance data is available for this nation yet.</Text>
            ) : null}
            {!analyticsLoading && nation?.code ? <CbeJurisdictionAnalytics scopeType="nation" nationCode={nation.code} /> : null}
          </SectionCard>
        );
      case 'followUp':
        return nation?.code ? (
          <LearnerFollowUpDashboard
            scopeType="nation"
            scopeCode={nation.code}
            scopeName={nation.name}
            nationCode={nation.code}
          />
        ) : <Text style={styles.empty}>Load the assigned national office before viewing progress follow-up.</Text>;
      case 'deviations':
        return (
          <NationalDeviationWatchContent
            nationalLearners={nationalLearners}
            learnerCareerMap={learnerCareerMap}
            nationalRegions={nationalRegions}
            nationalCounties={nationalCounties}
            nationalSubCounties={nationalSubCounties}
            nationalSchools={nationalSchools}
            selectedRegionCode={selectedRegionCode}
            selectedCountyCode={selectedCountyCode}
            selectedSubCountyCode={selectedSubCountyCode}
            selectedSchoolCode={selectedSchoolCode}
            selectedLearnerGrade={selectedLearnerGrade}
            setSelectedRegionCode={setSelectedRegionCode}
            setSelectedCountyCode={setSelectedCountyCode}
            setSelectedSubCountyCode={setSelectedSubCountyCode}
            setSelectedSchoolCode={setSelectedSchoolCode}
            setSelectedLearnerGrade={setSelectedLearnerGrade}
            onViewPerformance={async (learner) => {
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
          />
        );
      default:
        return (
          <>
            <SectionCard
              title="National Office"
              subtitle="Choose a national task to begin."
              defaultExpanded={true}
            >
            </SectionCard>

            <SectionCard title="Regions, schools, and affected learners" subtitle="Select a region, county, sub-county, school, and grade to view affected learners." defaultExpanded={false}>
              {!nationalRegions.length ? <Text style={styles.empty}>No regions are available in this nation.</Text> : nationalRegions.map((regionItem) => (
                <TouchableOpacity key={regionItem.id} style={[styles.row, selectedRegionCode === regionItem.code && styles.rowSelected]} onPress={() => setSelectedRegionCode(regionItem.code)} accessibilityState={{ selected: selectedRegionCode === regionItem.code }}>
                  <Text style={styles.rowCode}>{regionItem.code}</Text>
                  <Text style={styles.rowName}>{regionItem.name}</Text>
                </TouchableOpacity>
              ))}
              {selectedRegionCode ? (
                <View style={styles.selectionBlock}>
                  <Text style={styles.selectionTitle}>Counties in {nationalRegions.find((item) => item.code === selectedRegionCode)?.name || selectedRegionCode}</Text>
                  {!nationalCounties.length ? <Text style={styles.empty}>No counties found in this region.</Text> : nationalCounties.map((county) => (
                    <TouchableOpacity key={county.id} style={[styles.schoolButton, selectedCountyCode === county.code && styles.schoolButtonActive]} onPress={() => setSelectedCountyCode(county.code)} accessibilityState={{ selected: selectedCountyCode === county.code }}>
                      <Text style={styles.rowCode}>{county.code}</Text><Text style={styles.rowName}>{county.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {selectedCountyCode ? (
                    <View style={styles.selectionBlock}>
                      <Text style={styles.selectionTitle}>Sub-counties in {nationalCounties.find((item) => item.code === selectedCountyCode)?.name || selectedCountyCode}</Text>
                      {!nationalSubCounties.length ? <Text style={styles.empty}>No sub-counties found in this county.</Text> : nationalSubCounties.map((subCounty) => (
                        <TouchableOpacity key={subCounty.id} style={[styles.schoolButton, selectedSubCountyCode === subCounty.code && styles.schoolButtonActive]} onPress={() => setSelectedSubCountyCode(subCounty.code)} accessibilityState={{ selected: selectedSubCountyCode === subCounty.code }}>
                          <Text style={styles.rowCode}>{subCounty.code}</Text><Text style={styles.rowName}>{subCounty.name}</Text>
                        </TouchableOpacity>
                      ))}
                      {selectedSubCountyCode ? (
                        <View style={styles.selectionBlock}>
                          <Text style={styles.selectionTitle}>Schools in {nationalSubCounties.find((item) => item.code === selectedSubCountyCode)?.name || selectedSubCountyCode}</Text>
                          {!nationalSchools.length ? <Text style={styles.empty}>No schools found in this sub-county.</Text> : nationalSchools.map((school) => (
                            <TouchableOpacity key={school.id} style={[styles.schoolButton, selectedSchoolCode === school.code && styles.schoolButtonActive]} onPress={() => { setSelectedSchoolCode(school.code); setSelectedLearnerGrade(null); }} accessibilityState={{ selected: selectedSchoolCode === school.code }}>
                              <Text style={styles.rowCode}>{school.code}</Text><Text style={styles.rowName}>{school.name}</Text>
                            </TouchableOpacity>
                          ))}
                          {selectedSchoolCode ? <View style={styles.gradeSelector}>{['7', '8', '9', '10', '11', '12'].map((grade) => (
                            <TouchableOpacity key={grade} style={[styles.gradeButton, selectedLearnerGrade === grade && styles.gradeButtonActive]} onPress={() => setSelectedLearnerGrade(grade)} accessibilityState={{ selected: selectedLearnerGrade === grade }}>
                              <Text style={[styles.gradeButtonText, selectedLearnerGrade === grade && styles.gradeButtonTextActive]}>Grade {grade}</Text>
                            </TouchableOpacity>
                          ))}</View> : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </SectionCard>

            <NationalDeviationWatchContent
              nationalLearners={nationalLearners}
              learnerCareerMap={learnerCareerMap}
              nationalRegions={nationalRegions}
              nationalCounties={nationalCounties}
              nationalSubCounties={nationalSubCounties}
              nationalSchools={nationalSchools}
              selectedRegionCode={selectedRegionCode}
              selectedCountyCode={selectedCountyCode}
              selectedSubCountyCode={selectedSubCountyCode}
              selectedSchoolCode={selectedSchoolCode}
              selectedLearnerGrade={selectedLearnerGrade}
              setSelectedRegionCode={setSelectedRegionCode}
              setSelectedCountyCode={setSelectedCountyCode}
              setSelectedSubCountyCode={setSelectedSubCountyCode}
              setSelectedSchoolCode={setSelectedSchoolCode}
              setSelectedLearnerGrade={setSelectedLearnerGrade}
              onViewPerformance={async (learner) => {
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
            />
          </>
        );
    }
  }, [activeScreen, nation, nationalLearners, learnerCareerMap, client, nationalRegions, nationalCounties, nationalSubCounties, nationalSchools, selectedRegionCode, selectedCountyCode, selectedSubCountyCode, selectedSchoolCode, selectedLearnerGrade, nationalCareerSummary, tertiaryInstitutions, tertiaryCourses, nationalCbeRollups, analyticsLoading, analyticsNotice, loadLearnerProfile]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SectionCard title="National Account" subtitle="Your assigned national office details.">
          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color="#1d4ed8" />
              <Text style={styles.loadingText}>Loading your national account...</Text>
            </View>
          ) : null}

          {!isLoading && notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {!isLoading && nation ? (
            <>
              <Text style={styles.heading}>{nation.name}</Text>
              <Text style={styles.meta}>Code: {nation.code}</Text>
              <Text style={styles.meta}>Assigned officer: {nation.assignedOfficerEmail || 'Not set'}</Text>
            </>
          ) : null}
        </SectionCard>

        <SectionCard
          title="National Office"
          subtitle="National administration hub for setup and regional management."
        >
          <View style={styles.buttonRow}>
            {NATIONAL_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={[styles.actionButton, activeScreen === action.key && styles.actionButtonActive]}
                onPress={() => setActiveScreen(action.key)}
              >
                <Text style={[styles.actionButtonText, activeScreen === action.key && styles.actionButtonTextActive]}>
                  {action.title}
                </Text>
                <Text style={[styles.actionButtonDescription, activeScreen === action.key && styles.actionButtonDescriptionActive]}>
                  {action.description}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SectionCard>

        {activeContent}
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
  loadingState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#374151',
    fontSize: 14,
  },
  notice: {
    color: '#b91c1c',
    fontSize: 14,
    marginTop: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  meta: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
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
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  summaryTile: {
    width: '31%',
    minWidth: 110,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 10,
    padding: 12,
  },
  summaryLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  summaryValue: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '800',
  },
  catalogSection: {
    marginTop: 16,
    gap: 8,
  },
  sectionHeaderButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 4,
  },
  expandToggleText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1d4ed8',
    lineHeight: 24,
  },
  catalogRow: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    padding: 10,
  },
  institutionToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  courseListContainer: {
    marginTop: 10,
    gap: 8,
  },
  courseRow: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    padding: 8,
  },
  catalogTitle: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '700',
    marginBottom: 3,
  },
  catalogMeta: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 2,
  },
  careerList: {
    marginTop: 12,
    gap: 6,
  },
  careerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  careerName: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  careerCount: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '800',
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
  buttonRow: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    flexWrap: Platform.OS === 'web' ? 'wrap' : 'nowrap',
    gap: 12,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 14,
    backgroundColor: '#f9fafb',
    padding: 16,
    flexGrow: Platform.OS === 'web' ? 1 : 0,
    flexBasis: Platform.OS === 'web' ? '31%' : undefined,
    minWidth: Platform.OS === 'web' ? 240 : undefined,
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
});
