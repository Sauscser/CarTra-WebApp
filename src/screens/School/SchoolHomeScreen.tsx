import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { generateClient } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import { getLearnerProfile, listOrgHierarchies, listLearnerDocumentResources, listLearnerProfiles } from '../../graphql/queries';
import SectionCard from '../../components/shared/SectionCard';
import ViewPerformance from '../../components/teacher/ViewPerformance';
import LearnerComments from '../../components/shared/LearnerComments';
import SubjectPerformanceGraph from '../../components/shared/SubjectPerformanceGraph';
import SubjectEvidenceActions from '../../components/shared/SubjectEvidenceActions';
import LearnerClusterPerformanceGraph from '../../components/shared/LearnerClusterPerformanceGraph';
import { ScopedCbeAnalyticsSection } from '../../components/shared/ScopedCbeAnalytics';
import LearnerFollowUpDashboard from '../../components/shared/LearnerFollowUpDashboard';
import CourseSubjectPointsGraph from '../../components/shared/CourseSubjectPointsGraph';
import LearnerClusterTrendGraph from '../../components/shared/LearnerClusterTrendGraph';
import { SchoolTeacherSetupContent } from './SchoolTeacherSetupScreen';
import calculateHistoricalClusterSeries, { calculateDeviationPercentage, hasCourseSubjectPointRequirements } from '../../utils/cluster';
import { resolveLearnerCareerTarget } from '../../utils/learnerCareer';

type SchoolScreenKey = 'home' | 'teachers' | 'performance' | 'analytics';

type SchoolEntity = {
  id: string;
  code: string;
  name: string;
  nationCode?: string | null;
  regionCode?: string | null;
  countyCode?: string | null;
  subCountyCode?: string | null;
  assignedOfficerEmail?: string | null;
};

const SCHOOL_ACTIONS: Array<{ key: Exclude<SchoolScreenKey, 'home'>; title: string; description: string }> = [
  {
    key: 'teachers',
    title: 'Add Teachers to School',
    description: 'Create teacher profiles and assign the teacher to this school hierarchy.',
  },
  {
    key: 'performance',
    title: 'School Learner Performance',
    description: 'View cluster points, subject trends, guidance, and e-portfolio files for learners in this school.',
  },
  {
    key: 'analytics',
    title: 'School CBE Analytics',
    description: 'Explore achievement bands and target deviations for learners in this school.',
  },
];

export default function SchoolHomeScreen() {
  const client = useMemo(() => generateClient(), []);
  const [activeScreen, setActiveScreen] = useState<SchoolScreenKey>('home');
  const [school, setSchool] = useState<SchoolEntity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [selectedPerformanceGrade, setSelectedPerformanceGrade] = useState<string | null>(null);
  const [schoolLearners, setSchoolLearners] = useState<Array<{ id: string; fullName: string; gradeLevel?: string | null; classCode?: string | null; assessmentNumber?: string | null }>>([]);
  const [learnerCareerMap, setLearnerCareerMap] = useState<Record<string, string | null>>({});
  const [selectedLearner, setSelectedLearner] = useState<any | null>(null);
  const [selectedLearnerProfile, setSelectedLearnerProfile] = useState<any | null>(null);
  const [performanceAction, setPerformanceAction] = useState<'viewMenu' | 'viewCluster' | 'viewSubjects' | 'viewGuidance' | 'viewEPortfolio' | null>(null);
  const [learnerDocuments, setLearnerDocuments] = useState<any[]>([]);
  const [performanceSessionId, setPerformanceSessionId] = useState(0);
  const [performanceOpening, setPerformanceOpening] = useState<string | null>(null);
  const profileRequestRef = useRef(0);

  const resetPerformanceModal = () => {
    profileRequestRef.current += 1;
    setPerformanceSessionId((current) => current + 1);
    setPerformanceAction(null);
    setSelectedLearner(null);
    setSelectedLearnerProfile(null);
    setLearnerDocuments([]);
    setPerformanceOpening(null);
  };

  const openPerformanceView = (action: 'viewCluster' | 'viewSubjects' | 'viewGuidance' | 'viewEPortfolio') => {
    setPerformanceOpening(action);
    setPerformanceAction(action);
    setTimeout(() => setPerformanceOpening(null), 150);
  };

  useEffect(() => {
    void loadCurrentSchool();
  }, []);

  useEffect(() => {
    if (school?.code) {
      void loadSchoolLearners();
    }
  }, [school?.code]);

  const loadCurrentSchool = async () => {
    try {
      setIsLoading(true);
      setNotice('');

      const session = await fetchAuthSession();
      const currentEmail = (session.tokens?.idToken?.payload as { email?: string } | undefined)?.email?.trim().toLowerCase();

      if (!currentEmail) {
        setSchool(null);
        setNotice('No signed-in user email was found.');
        setIsLoading(false);
        return;
      }

      console.log('[SchoolHomeScreen] loadCurrentSchool query email:', currentEmail);
      const result = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'school' } }, { assignedOfficerEmail: { eq: currentEmail } }],
          },
          limit: 20,
        },
      });

      console.log('[SchoolHomeScreen] loadCurrentSchool result:', result);
      const payload = result as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const matchedSchool = payload.data?.listOrgHierarchies?.items?.[0];

      if (!matchedSchool) {
        setSchool(null);
        setNotice(`No school is assigned to ${currentEmail}.`);
        setIsLoading(false);
        return;
      }

      setSchool({
        id: matchedSchool.id,
        code: matchedSchool.code,
        name: matchedSchool.name,
        nationCode: matchedSchool.nationCode,
        regionCode: matchedSchool.regionCode,
        countyCode: matchedSchool.countyCode,
        subCountyCode: matchedSchool.subCountyCode,
        assignedOfficerEmail: matchedSchool.assignedOfficerEmail,
      });
    } catch {
      setSchool(null);
      setNotice('Could not load the school dashboard for this account.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadSelectedLearnerCareer = async (learnerId: string) => {
    try {
      const result = await client.graphql({
        query: listLearnerProfiles,
        variables: {
          filter: {
            id: { eq: learnerId },
          },
          limit: 20,
        },
      } as any);

      const payload = result as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const learnerRecord = payload.data?.listLearnerProfiles?.items?.[0];
      const supportProfile = learnerRecord?.supportProfile;
      const savedCareerTarget = await resolveLearnerCareerTarget(client, learnerRecord);

      console.log('[SchoolHomeScreen] career fetch debug', JSON.stringify({
        learnerId,
        rawSupportProfile: supportProfile,
        targetCareer: savedCareerTarget,
        supportProfileType: typeof supportProfile,
      }, null, 2));

      setLearnerCareerMap((current) => ({ ...current, [learnerId]: savedCareerTarget }));
    } catch {
      setLearnerCareerMap((current) => ({ ...current, [learnerId]: null }));
    }
  };

  const loadSchoolLearners = async () => {
    if (!school?.code) return;
    try {
      console.log('[SchoolHomeScreen] loadSchoolLearners schoolCode:', school.code);
      const res = await client.graphql({ query: listLearnerProfiles, variables: { filter: { schoolCode: { eq: school.code } }, limit: 500 } } as any);
      console.log('[SchoolHomeScreen] loadSchoolLearners result:', res);
      const items = (res as any).data?.listLearnerProfiles?.items || [];
      setSchoolLearners(items.map((learner: any) => ({
        id: learner.id,
        fullName: learner.fullName,
        gradeLevel: learner.gradeLevel,
        classCode: learner.classCode,
        assessmentNumber: learner.assessmentNumber,
      })));

      await Promise.all(items.map((learner: any) => loadSelectedLearnerCareer(learner.id)));
    } catch (error) {
      console.warn('loadSchoolLearners failed', error);
      setSchoolLearners([]);
    }
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
        try {
          if (!item?.supportProfile) return null;
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

      console.log('[SchoolHomeScreen] loadLearnerProfile loaded:', JSON.stringify({
        learnerId,
        supportProfilePresent: !!normalized.supportProfile,
        selectedSubjectsCount: Array.isArray(normalized.selectedSubjects) ? normalized.selectedSubjects.length : 0,
        historicalSelectedSubjectsCount: Array.isArray(normalized.historicalSelectedSubjects) ? normalized.historicalSelectedSubjects.length : 0,
      }, null, 2));

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
      console.log('[SchoolHomeScreen] openDocument raw url', rawKey);
      await Linking.openURL(rawKey);
      return;
    }

    if (rawKey.startsWith('s3://')) {
      console.log('[SchoolHomeScreen] openDocument s3 url', rawKey);
      await Linking.openURL(rawKey.replace(/^s3:\/\//, 'https://'));
      return;
    }

    console.log('[SchoolHomeScreen] openDocument storage route', JSON.stringify({
      fileId: resource.id,
      rawKey,
      fileName: resource.fileName || null,
    }, null, 2));

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

  const getHistoricalClusterSeries = (learner: any, profile: any) => {
    const effectiveProfile = profile || null;
    const subjects = (effectiveProfile && effectiveProfile.selectedSubjects) || [];
    return calculateHistoricalClusterSeries(learner, effectiveProfile, subjects);
  };

  const resolveSelectedSubjects = (profile: any) => {
    const source = profile || null;
    const historicalSubjects = Array.isArray(source?.historicalSelectedSubjects) ? source.historicalSelectedSubjects : [];
    let selectedSubjects = Array.isArray(source?.selectedSubjects) ? source.selectedSubjects : [];
    if ((!selectedSubjects || selectedSubjects.length === 0) && source && source.supportProfile) {
      try {
        const parsed = typeof source.supportProfile === 'string' ? JSON.parse(source.supportProfile) : source.supportProfile;
        if (parsed && Array.isArray(parsed.selectedSubjects)) {
          selectedSubjects = parsed.selectedSubjects;
        }
      } catch {
        // ignore malformed supportProfile payloads
      }
    }

    return [...historicalSubjects, ...((Array.isArray(selectedSubjects) ? selectedSubjects : []))];
  };

  const getHistoricalSubjectSeries = (learner: any, profile: any) => {
    const selectedSubjects = resolveSelectedSubjects(profile);
    console.log('[SCHOOL_SUBJECT_DEBUG]', JSON.stringify({
      learnerId: learner?.id,
      learnerGrade: learner?.gradeLevel,
      profileKeys: profile ? Object.keys(profile) : [],
      rawSupportProfile: profile?.supportProfile,
      selectedSubjectsCount: selectedSubjects.length,
      rawSubjects: selectedSubjects.map((subject: any) => ({
        id: subject?.id,
        name: subject?.name,
        code: subject?.code,
        targetMarks: subject?.targetMarks,
        marksScored: subject?.marksScored,
        history: Array.isArray(subject?.history) ? subject.history.map((entry: any) => ({ label: entry?.label, value: entry?.value, target: entry?.target })) : [],
      })),
    }, null, 2));

    if (!Array.isArray(selectedSubjects) || selectedSubjects.length === 0) return [];

    const getSubjectKey = (subject: any) => {
      const identity = String(subject?.id || subject?.code || subject?.name || 'subject').trim();
      return identity.toLowerCase();
    };

    const currentGrade = Number(String(learner?.gradeLevel || '').replace(/\D/g, '')) || 7;
    const subjectMap = new Map<string, { id?: string; name: string; code?: string; history: Array<any>; targetMarks: number | null; marksScored: number | null }>();

    selectedSubjects.forEach((subject: any) => {
      const key = getSubjectKey(subject);
      const existing = subjectMap.get(key);
      const normalized = {
        id: subject?.id || undefined,
        name: subject?.name || subject?.code || 'Unnamed subject',
        code: subject?.code || undefined,
        history: Array.isArray(subject?.history) ? subject.history.slice() : [],
        targetMarks: Number.isFinite(Number(subject?.targetMarks ?? subject?.targetMark)) ? Number(subject.targetMarks ?? subject.targetMark) : null,
        marksScored: Number.isFinite(Number(subject?.marksScored)) ? Number(subject.marksScored) : null,
      };

      if (!existing) {
        subjectMap.set(key, normalized);
        return;
      }

      existing.history = [...existing.history, ...normalized.history];
      if (normalized.targetMarks !== null && (existing.targetMarks === null || normalized.targetMarks > 0)) {
        existing.targetMarks = normalized.targetMarks;
      }
      if (normalized.marksScored !== null) {
        existing.marksScored = normalized.marksScored;
      }
    });

    return Array.from(subjectMap.values()).map((subject) => {
      const history = Array.isArray(subject.history) ? subject.history : [];
      const gradeKeys = Array.from(new Set([
        7,
        8,
        9,
        10,
        11,
        12,
        ...history
          .map((entry: any) => Number(String(entry?.label || '').trim()))
          .filter(Number.isFinite),
        ...(Number.isFinite(currentGrade) ? [currentGrade] : []),
      ]))
        .filter((grade) => grade >= 7 && grade <= 12)
        .sort((left, right) => left - right);

      const values = gradeKeys
        .map((grade) => {
          const entry = history.find((item: any) => String(item?.label) === String(grade));
          const targetMark = Number(
            Number.isFinite(Number(entry?.target)) ? Number(entry.target) :
              (grade === currentGrade ? (Number.isFinite(Number(subject.targetMarks)) ? Number(subject.targetMarks) : 0) : (subject.targetMarks ?? 0)),
          );
          const achieved = Number.isFinite(Number(entry?.value)) ? Number(entry.value) :
            (grade === currentGrade && Number.isFinite(Number(subject.marksScored)) ? Number(subject.marksScored) : NaN);

          if (!Number.isFinite(targetMark) || targetMark <= 0 || !Number.isFinite(achieved)) {
            return null;
          }

          return { label: String(grade), value: achieved, target: targetMark };
        })
        .filter((point): point is { label: string; value: number; target: number } => point !== null);

      if (values.length === 0) return null;
      return { label: subject.name || subject.code || 'Subject', values };
    }).filter((subject): subject is { label: string; values: Array<{ label: string; value: number; target: number }> } => subject !== null);
  };

  const renderLineChart = (
    series: Array<{ label: string; value: number; target?: number }>,
    targetColor: string,
    valueColor: string,
    maxY: number,
    nationalRequirement?: number | null,
  ) => {
    const { width: windowWidth } = require('react-native').Dimensions.get('window');
    const chartWidth = Math.max(300, Math.min(420, windowWidth - 48));
    const chartHeight = 440;
    const paddingLeft = 34;
    const paddingRight = 30;
    const paddingTop = 12;
    const paddingBottom = 42;
    const plotLeft = paddingLeft + 10;
    const plotRight = chartWidth - paddingRight - 10;
    const axisGrades = [7, 8, 9, 10, 11, 12] as const;
    const majorStep = 10;
    const minorStep = 1;
    const chartMaxY = Math.max(maxY ?? 100, ...series.flatMap((point) => [Number(point.value || 0), Number(point.target || 0)]).filter((value) => Number.isFinite(value)), 0, 1);
    const yMajorTicks = Array.from({ length: Math.floor(chartMaxY / majorStep) + 1 }, (_, index) => index * majorStep);
    const yMinorTicks = Array.from({ length: Math.floor(chartMaxY) + 1 }, (_, index) => index * minorStep);

    const gradeToX = (grade: number) => {
      const index = axisGrades.indexOf(grade as (typeof axisGrades)[number]);
      const safeIndex = index >= 0 ? index : 0;
      const plotWidth = Math.max(plotRight - plotLeft, 1);
      return plotLeft + (safeIndex / Math.max(axisGrades.length - 1, 1)) * plotWidth;
    };

    const axisLineY = chartHeight - paddingBottom;
    const valueToY = (value: number) => {
      if (!Number.isFinite(value) || value < 0) {
        return axisLineY;
      }
      const safeValue = Math.min(value, chartMaxY);
      const usableHeight = chartHeight - paddingTop - paddingBottom;
      return axisLineY - (safeValue / Math.max(chartMaxY, 1)) * usableHeight;
    };

    const points = series
      .filter((point) => Number.isFinite(Number(point.label)) && Number(point.label) >= 7 && Number(point.label) <= 12)
      .map((point) => {
        const grade = Number(point.label);
        return {
          label: point.label,
          x: gradeToX(grade),
          valueY: Number.isFinite(Number(point.value)) ? valueToY(Number(point.value)) : null,
          targetY: Number.isFinite(Number(point.target)) ? valueToY(Number(point.target)) : null,
        };
      })
      .filter((point) => point.valueY !== null || point.targetY !== null)
      .sort((left, right) => Number(left.label) - Number(right.label));

    const buildSegments = (items: Array<{ label: string; x: number; y: number }>) => {
      if (!Array.isArray(items) || items.length === 0) {
        return [] as Array<Array<{ label: string; x: number; y: number }>>;
      }

      const segments: Array<Array<{ label: string; x: number; y: number }>> = [];
      let current: Array<{ label: string; x: number; y: number }> = [];

      items.forEach((item) => {
        if (current.length === 0) {
          current = [item];
          return;
        }

        const previousLabel = Number(current[current.length - 1].label);
        const currentLabel = Number(item.label);
        const shouldBreakPhase = previousLabel <= 9 && currentLabel >= 10;
        if (!Number.isFinite(previousLabel) || !Number.isFinite(currentLabel) || currentLabel - previousLabel > 1 || shouldBreakPhase) {
          segments.push(current);
          current = [item];
          return;
        }

        current.push(item);
      });

      if (current.length > 0) {
        segments.push(current);
      }

      return segments;
    };

    const drawPolyline = (color: string, values: Array<{ label: string; x: number; y: number }>, keyPrefix: string) => {
      if (values.length < 2) return null;
      return values.slice(1).map((point, index) => {
        const start = values[index];
        const end = point;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.hypot(dx, dy) || 1;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const thickness = 3;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;

        return (
          <View
            key={`${keyPrefix}-segment-${index}`}
            style={{
              position: 'absolute',
              left: midX - distance / 2,
              top: midY - thickness / 2,
              width: distance,
              height: thickness,
              backgroundColor: color,
              borderRadius: 999,
              transform: [{ rotate: `${angle}deg` }],
            }}
          />
        );
      });
    };

    const targetPoints = points.filter((point) => typeof point.targetY === 'number').map((point) => ({ label: point.label, x: point.x, y: point.targetY ?? axisLineY }));
    const valuePoints = points.filter((point) => typeof point.valueY === 'number').map((point) => ({ label: point.label, x: point.x, y: point.valueY ?? axisLineY }));
    const requirementPoints = typeof nationalRequirement === 'number' && Number.isFinite(nationalRequirement)
      ? [10, 11, 12]
        .filter((grade) => grade >= 10 && grade <= 12)
        .map((grade) => ({ label: String(grade), x: gradeToX(grade), y: valueToY(nationalRequirement) }))
      : [];

    const targetSegments = buildSegments(targetPoints);
    const valueSegments = buildSegments(valuePoints);
    const requirementSegments = buildSegments(requirementPoints);
    const dotSize = 6;

    return (
      <View style={styles.chartCard}>
        <View style={styles.chartLegendRow}>
          <View style={styles.chartLegendItem}><View style={[styles.chartLegendSwatch, { backgroundColor: targetColor }]} /><Text style={styles.chartLegendText}>Target</Text></View>
          <View style={styles.chartLegendItem}><View style={[styles.chartLegendSwatch, { backgroundColor: valueColor }]} /><Text style={styles.chartLegendText}>Achieved</Text></View>
          {requirementPoints.length > 0 ? (
            <View style={styles.chartLegendItem}><View style={[styles.chartLegendSwatch, { backgroundColor: '#22c55e' }]} /><Text style={styles.chartLegendText}>National requirement</Text></View>
          ) : null}
        </View>

        <View style={{ width: chartWidth, height: chartHeight }}>
          {yMinorTicks.map((tick) => {
            const y = valueToY(tick);
            const isMajorTick = tick === 1 || tick % majorStep === 0;
            return (
              <View key={`y-grid-${tick}`} style={{ position: 'absolute', left: paddingLeft, right: paddingRight, top: y, height: 1, backgroundColor: isMajorTick ? '#94a3b8' : '#dbeafe' }} />
            );
          })}

          {yMajorTicks.map((tick) => (
            <Text key={`y-label-${tick}`} style={[styles.chartAxisLabel, { position: 'absolute', left: 6, top: valueToY(tick) - 8, width: paddingLeft - 12, textAlign: 'right', color: '#0f172a' }]}>{tick}</Text>
          ))}

          <View style={{ position: 'absolute', left: plotLeft, right: chartWidth - plotRight, top: axisLineY, height: 1, backgroundColor: '#475569' }} />

          {axisGrades.map((grade) => (
            <View key={`x-grid-${grade}`} style={{ position: 'absolute', top: paddingTop, bottom: paddingBottom, left: gradeToX(grade), width: 1, backgroundColor: '#dbeafe' }} />
          ))}

          <View style={{ position: 'absolute', left: 0, top: 0, width: chartWidth, height: chartHeight }}>
            {targetSegments.map((segment, segmentIndex) => drawPolyline(targetColor, segment, `target-${segmentIndex}`))}
            {valueSegments.map((segment, segmentIndex) => drawPolyline(valueColor, segment, `value-${segmentIndex}`))}
            {requirementSegments.map((segment, segmentIndex) => drawPolyline('#22c55e', segment, `requirement-${segmentIndex}`))}
            {valuePoints.map((point, index) => (
              <View
                key={`value-dot-${index}`}
                style={{
                  position: 'absolute',
                  left: point.x - dotSize / 2,
                  top: point.y - dotSize / 2,
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  backgroundColor: valueColor,
                }}
              />
            ))}
            {targetPoints.map((point, index) => (
              <View
                key={`target-dot-${index}`}
                style={{
                  position: 'absolute',
                  left: point.x - dotSize / 2,
                  top: point.y - dotSize / 2,
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  backgroundColor: targetColor,
                }}
              />
            ))}
          </View>

          <View style={{ position: 'absolute', left: 0, width: chartWidth, bottom: 0 }}>
            {axisGrades.map((grade) => {
              const x = gradeToX(grade);
              return (
                <Text
                  key={`axis-${grade}`}
                  style={{
                    position: 'absolute',
                    left: x - 10,
                    width: 20,
                    textAlign: 'center',
                    color: '#0f172a',
                    fontSize: 12,
                  }}
                >
                  {grade}
                </Text>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  const activeContent =
    activeScreen === 'teachers' ? (
      <SchoolTeacherSetupContent />
    ) : activeScreen === 'performance' ? (
      <SectionCard title="School learner performance" subtitle="View school-wide performance for all learners assigned to this school.">
        <View style={styles.gradeSelector}>
          {['7', '8', '9', '10', '11', '12'].map((grade) => (
            <TouchableOpacity
              key={grade}
              style={[styles.gradeButton, selectedPerformanceGrade === grade && styles.gradeButtonActive]}
              onPress={() => setSelectedPerformanceGrade(grade)}
              accessibilityState={{ selected: selectedPerformanceGrade === grade }}
            >
              <Text style={[styles.gradeButtonText, selectedPerformanceGrade === grade && styles.gradeButtonTextActive]}>Grade {grade}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!schoolLearners.length ? (
          <Text style={styles.placeholder}>No learners are assigned to this school yet.</Text>
        ) : !selectedPerformanceGrade ? (
          <Text style={styles.placeholder}>Select a grade to view its learners.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 720 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator>
            {schoolLearners.filter((learner) => {
              const learnerGrade = String(learner.gradeLevel || learner.classCode || '').replace(/\D/g, '');
              return learnerGrade === selectedPerformanceGrade;
            }).map((learner) => (
              <View key={learner.id} style={styles.learnerRow}>
                <Text style={styles.learnerText}>
                  {learner.fullName} - {learnerCareerMap[learner.id] || 'Career target not set'}
                </Text>
                <Text style={styles.learnerText}>Grade {learner.gradeLevel || 'N/A'} • {learner.classCode || 'N/A'}</Text>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={async () => {
                    setPerformanceOpening('profile');
                    profileRequestRef.current += 1;
                    setPerformanceSessionId((current) => current + 1);
                    setSelectedLearner(learner);
                    setSelectedLearnerProfile(null);
                    setPerformanceAction('viewMenu');
                    const profile = await loadLearnerProfile(learner.id);
                    if (!profile) {
                      setPerformanceOpening(null);
                      Alert.alert('Learner profile unavailable', 'This learner record does not yet contain performance data.');
                      return;
                    }
                    setSelectedLearnerProfile(profile);
                    setPerformanceOpening(null);
                  }}
                >
                  <Text style={styles.actionButtonText}>View performance</Text>
                </TouchableOpacity>
              </View>
            ))}
            {schoolLearners.every((learner) => String(learner.gradeLevel || learner.classCode || '').replace(/\D/g, '') !== selectedPerformanceGrade) ? (
              <Text style={styles.placeholder}>No learners are assigned to Grade {selectedPerformanceGrade}.</Text>
            ) : null}
          </ScrollView>
        )}
      </SectionCard>
    ) : activeScreen === 'analytics' ? (
      <ScopedCbeAnalyticsSection
        scopeType="school"
        scopeCode={school?.code}
        scopeName={school?.name}
        nationCode={school?.nationCode}
        showCumulativeDistribution
      />
    ) : (
      <SectionCard title="School" subtitle="Choose a school task to begin.">
        <Text style={styles.placeholder}>Use the action above to register teachers and maintain the school team.</Text>
      </SectionCard>
    );

  const normalizedSchoolProfile = selectedLearnerProfile && Object.keys(selectedLearnerProfile).length ? selectedLearnerProfile : null;

  const modalContent = performanceAction && selectedLearner ? (
    <Modal transparent visible={!!performanceAction} animationType="slide" onRequestClose={resetPerformanceModal}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' }}>
        <View key={`${performanceSessionId}-${selectedLearner?.id ?? 'school-performance'}`} style={{ margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '90%', position: 'relative' }}>
          <Text style={{ fontWeight: '800', marginBottom: 6 }}>{selectedLearner.fullName}</Text>
          <Text style={{ color: '#6b7280', marginBottom: 8 }}>Grade {selectedLearner.gradeLevel || 'N/A'}</Text>

          {performanceOpening ? (
            <View style={{ position: 'absolute', zIndex: 10, top: 0, right: 0, bottom: 0, left: 0, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <ActivityIndicator size="large" color="#1d4ed8" />
              <Text style={{ marginTop: 12, color: '#1d4ed8', fontWeight: '700', textAlign: 'center' }}>Opening performance data... please wait</Text>
            </View>
          ) : null}

          {!performanceOpening && performanceAction === 'viewMenu' ? (
            <ViewPerformance
              learner={selectedLearner}
              profile={normalizedSchoolProfile || {}}
              targetCareer={learnerCareerMap[selectedLearner.id]}
              onViewCluster={() => openPerformanceView('viewCluster')}
              onViewSubjects={() => openPerformanceView('viewSubjects')}
              onViewGuidance={() => openPerformanceView('viewGuidance')}
            />
          ) : null}

          {!performanceOpening && performanceAction === 'viewCluster' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <LearnerClusterPerformanceGraph learner={selectedLearner} profile={normalizedSchoolProfile || {}} targetCareer={learnerCareerMap[selectedLearner.id]} />
              <View style={{ marginTop: 12 }}>
                <LearnerComments learnerId={selectedLearner.id} currentGrade={selectedLearner.gradeLevel} authorRoleOverride="principal" />
              </View>
            </ScrollView>
          ) : null}

          {!performanceOpening && performanceAction === 'viewSubjects' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <SubjectPerformanceGraph
                learner={selectedLearner}
                profile={normalizedSchoolProfile || selectedLearnerProfile || {}}
                renderSubjectActions={(subject) => (
                  <SubjectEvidenceActions learnerId={selectedLearner.id} subjectId={subject.id} subjectName={subject.label} />
                )}
              />
            </ScrollView>
          ) : null}

          {!performanceOpening && performanceAction === 'viewGuidance' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <LearnerComments learnerId={selectedLearner.id} currentGrade={selectedLearner.gradeLevel} authorRoleOverride="principal" />
            </ScrollView>
          ) : null}

          {performanceAction === 'viewEPortfolio' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700', marginBottom: 8 }}>E-portfolio files</Text>
              {(() => {
                const getItems = async () => {
                  const schoolCode = school?.code || selectedLearnerProfile?.schoolCode || null;
                  const filter = schoolCode ? { and: [{ schoolCode: { eq: schoolCode } }, { learnerId: { eq: selectedLearner.id } }] } : { learnerId: { eq: selectedLearner.id } };
                  const res = await client.graphql({ query: listLearnerDocumentResources, variables: { filter, limit: 200 } } as any);
                  const items = ((res as any).data?.listLearnerDocumentResources?.items || []).map((item: any) => ({
                    id: item.id,
                    learnerId: item.learnerId,
                    title: item.title,
                    description: item.description || null,
                    fileKey: item.fileKey,
                    fileName: item.fileName,
                    fileType: item.fileType || null,
                    status: item.status || 'pending_review',
                  }));
                  setLearnerDocuments(items);
                };
                void getItems();
                return learnerDocuments.length === 0 ? <Text style={{ color: '#6b7280' }}>No e-portfolio files are linked to this learner yet.</Text> : learnerDocuments.map((resource) => (
                  <View key={resource.id} style={{ marginBottom: 10, padding: 8, borderWidth: 1, borderColor: '#eef2ff', borderRadius: 8 }}>
                    <Text style={{ fontWeight: '700' }}>{resource.title || resource.fileName}</Text>
                    <Text style={{ color: '#6b7280', marginBottom: 6 }}>{resource.fileName} • {resource.status}</Text>
                    <TouchableOpacity style={{ padding: 8, backgroundColor: '#eef2ff', borderRadius: 6 }} onPress={() => void openDocument(resource)}>
                      <Text style={{ color: '#1d4ed8', fontWeight: '700' }}>Open</Text>
                    </TouchableOpacity>
                  </View>
                ));
              })()}
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
  ) : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionCard title="School Office" subtitle="School administration hub for staff and classroom assignments.">
          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color="#1d4ed8" />
              <Text style={styles.loadingText}>Loading your school details...</Text>
            </View>
          ) : null}

          {!isLoading && notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {!isLoading && school ? (
            <View style={styles.schoolSummary}>
              <Text style={styles.heading}>{school.name}</Text>
              <Text style={styles.meta}>School code: {school.code}</Text>
              <Text style={styles.meta}>Nation: {school.nationCode || 'N/A'}</Text>
              <Text style={styles.meta}>Region: {school.regionCode || 'N/A'}</Text>
              <Text style={styles.meta}>County: {school.countyCode || 'N/A'}</Text>
              <Text style={styles.meta}>Sub-county: {school.subCountyCode || 'N/A'}</Text>
              <Text style={styles.meta}>Assigned officer: {school.assignedOfficerEmail || 'Not set'}</Text>
            </View>
          ) : null}

          <View style={styles.buttonRow}>
            {SCHOOL_ACTIONS.map((action) => (
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

        {school ? <LearnerFollowUpDashboard
          scopeType="school"
          scopeCode={school.code}
          scopeName={school.name}
          nationCode={school.nationCode || ''}
        /> : null}

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
  schoolSummary: {
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
  placeholder: {
    fontSize: 14,
    color: '#6b7280',
  },
  gradeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
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
  chartCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    padding: 8,
  },
  chartLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  chartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chartLegendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  chartLegendText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '600',
  },
  chartAxisLabel: {
    fontSize: 10,
    color: '#0f172a',
  },
  learnerRow: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  learnerText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
});
