import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { generateClient } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl } from 'aws-amplify/storage';
import { getLearnerProfile, listGrade12ResultSummaries, listLearnerDocumentResources, listLearnerProfiles, listOrgHierarchies } from '../../graphql/queries';
import SectionCard from '../../components/shared/SectionCard';
import ViewPerformance from '../../components/teacher/ViewPerformance';
import LearnerComments from '../../components/shared/LearnerComments';
import SubjectPerformanceGraph from '../../components/shared/SubjectPerformanceGraph';
import SubjectEvidenceActions from '../../components/shared/SubjectEvidenceActions';
import LearnerClusterPerformanceGraph from '../../components/shared/LearnerClusterPerformanceGraph';
import CourseSubjectPointsGraph from '../../components/shared/CourseSubjectPointsGraph';
import LearnerClusterTrendGraph from '../../components/shared/LearnerClusterTrendGraph';
import CbeJurisdictionAnalytics from '../../components/shared/CbeJurisdictionAnalytics';
import LearnerFollowUpDashboard from '../../components/shared/LearnerFollowUpDashboard';
import JurisdictionTransferManager from '../../components/shared/JurisdictionTransferManager';
import calculateHistoricalClusterSeries, { calculateDeviationPercentage, hasCourseSubjectPointRequirements } from '../../utils/cluster';
import { resolveLearnerCareerTarget } from '../../utils/learnerCareer';
import { SubCountySchoolSetupContent } from './SubCountySchoolSetupScreen';

type SubCountyEntity = {
  id: string;
  code: string;
  name: string;
  nationCode?: string | null;
  regionCode?: string | null;
  countyCode?: string | null;
  assignedOfficerEmail?: string | null;
};

type SchoolEntity = {
  id: string;
  code: string;
  name: string;
  subCountyCode?: string | null;
  assignedOfficerEmail?: string | null;
};

export default function SubCountyHomeScreen() {
  return <SubCountyHomeContent />;
}

function SubCountyHomeContent() {
  const client = useMemo(() => generateClient(), []);
  const [subCounty, setSubCounty] = useState<SubCountyEntity | null>(null);
  const [schools, setSchools] = useState<SchoolEntity[]>([]);
  const [subCountyLearners, setSubCountyLearners] = useState<Array<{ id: string; fullName: string; gradeLevel?: string | null; classCode?: string | null; assessmentNumber?: string | null; schoolCode?: string | null }>>([]);
  const [selectedSchoolCode, setSelectedSchoolCode] = useState<string | null>(null);
  const [selectedLearnerGrade, setSelectedLearnerGrade] = useState<string | null>(null);
  const [learnerCareerMap, setLearnerCareerMap] = useState<Record<string, string | null>>({});
  const [selectedLearner, setSelectedLearner] = useState<any | null>(null);
  const [selectedLearnerProfile, setSelectedLearnerProfile] = useState<any | null>(null);
  const [performanceAction, setPerformanceAction] = useState<'viewMenu' | 'viewCluster' | 'viewSubjects' | 'viewGuidance' | 'viewEPortfolio' | null>(null);
  const [learnerDocuments, setLearnerDocuments] = useState<any[]>([]);
  const [performanceSessionId, setPerformanceSessionId] = useState(0);
  const [grade12Summaries, setGrade12Summaries] = useState<Array<any>>([]);
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
    void loadCurrentSubCounty();
  }, []);

  useEffect(() => {
    if (subCounty?.code) {
      void loadSubCountyLearners();
    }
  }, [subCounty?.code]);

  useEffect(() => {
    if (subCounty?.code && schools.length > 0) {
      void loadSubCountyGrade12Summaries();
    } else if (subCounty?.code && schools.length === 0) {
      setGrade12Summaries([]);
    }
  }, [subCounty?.code, schools.length]);

  const loadCurrentSubCounty = async () => {
    try {
      setIsLoading(true);
      setNotice('');

      const session = await fetchAuthSession();
      const currentEmail = (session.tokens?.idToken?.payload as { email?: string } | undefined)?.email?.trim().toLowerCase();

      if (!currentEmail) {
        setNotice('No signed-in user email was found.');
        setSubCounty(null);
        setSchools([]);
        return;
      }

      const subCountyResult = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'subCounty' } }, { assignedOfficerEmail: { eq: currentEmail } }],
          },
          limit: 20,
        },
      });

      const subCountyPayload = subCountyResult as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const matchedSubCounty = subCountyPayload.data?.listOrgHierarchies?.items?.[0];

      if (!matchedSubCounty) {
        setSubCounty(null);
        setSchools([]);
        setNotice(`No sub-county is assigned to ${currentEmail}.`);
        return;
      }

      const nextSubCounty: SubCountyEntity = {
        id: matchedSubCounty.id,
        code: matchedSubCounty.code,
        name: matchedSubCounty.name,
        nationCode: matchedSubCounty.nationCode,
        regionCode: matchedSubCounty.regionCode,
        countyCode: matchedSubCounty.countyCode,
        assignedOfficerEmail: matchedSubCounty.assignedOfficerEmail,
      };

      setSubCounty(nextSubCounty);

      const schoolResult = await client.graphql({
        query: listOrgHierarchies,
        variables: {
          filter: {
            and: [{ entityType: { eq: 'school' } }, { subCountyCode: { eq: nextSubCounty.code } }],
          },
          limit: 100,
        },
      });

      const schoolPayload = schoolResult as { data?: { listOrgHierarchies?: { items?: Array<any> } } };
      const mappedSchools = (schoolPayload.data?.listOrgHierarchies?.items || [])
        .filter((item: any) => Boolean(item?.id && item?.code && item?.name))
        .map((item: any) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          subCountyCode: item.subCountyCode,
          assignedOfficerEmail: item.assignedOfficerEmail,
        }));

      setSchools(mappedSchools);
      setSelectedSchoolCode(null);
      setSelectedLearnerGrade(null);
    } catch {
      setSubCounty(null);
      setSchools([]);
      setNotice('Could not load the sub-county dashboard for this account.');
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

  const loadSubCountyGrade12Summaries = async () => {
    if (!subCounty?.code) {
      setGrade12Summaries([]);
      return;
    }

    try {
      const result = await client.graphql({
        query: listGrade12ResultSummaries,
        variables: { limit: 200 },
      } as any);

      const schoolCodes = new Set((schools || []).map((school: any) => school.code).filter(Boolean));
      const items = ((result as any).data?.listGrade12ResultSummaries?.items || [])
        .filter((item: any) => item?.id && item?.learnerId && item?.schoolCode && schoolCodes.has(String(item.schoolCode)))
        .sort((left: any, right: any) => new Date(right.recordedAt || right.updatedAt || 0).getTime() - new Date(left.recordedAt || left.updatedAt || 0).getTime());

      setGrade12Summaries(items);
    } catch (error) {
      console.warn('loadSubCountyGrade12Summaries failed', error);
      setGrade12Summaries([]);
    }
  };

  const getLatestClusterAssessment = (learner: any, profile: any) => {
    const clusterSeries = getHistoricalClusterSeries(learner, profile || {});
    if (!Array.isArray(clusterSeries) || clusterSeries.length === 0) {
      return null;
    }

    const lastEntry = [...clusterSeries].sort((left, right) => Number(left.label) - Number(right.label)).at(-1);
    if (!lastEntry) {
      return null;
    }

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

  const loadSubCountyLearners = async () => {
    if (!subCounty?.code) return;
    try {
      const res = await client.graphql({
        query: listLearnerProfiles,
        variables: { filter: { subCountyCode: { eq: subCounty.code } }, limit: 500 },
      } as any);

      const items = (res as any).data?.listLearnerProfiles?.items || [];
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
        const includeLearner = !!lastAssessment && lastAssessment.deviation < -20;

        console.log('[SubCountyHomeScreen] learner last grade cluster check', JSON.stringify({
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

      setSubCountyLearners(filteredItems.map((learner: any) => ({
        id: learner.id,
        fullName: learner.fullName,
        gradeLevel: learner.gradeLevel,
        classCode: learner.classCode,
        assessmentNumber: learner.assessmentNumber,
        schoolCode: learner.schoolCode,
      })));

      await Promise.all(filteredItems.map((learner: any) => loadSelectedLearnerCareer(learner.id)));
    } catch (error) {
      console.warn('loadSubCountyLearners failed', error);
      setSubCountyLearners([]);
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
      console.log('[SubCountyHomeScreen] openDocument raw url', rawKey);
      await Linking.openURL(rawKey);
      return;
    }

    if (rawKey.startsWith('s3://')) {
      console.log('[SubCountyHomeScreen] openDocument s3 url', rawKey);
      await Linking.openURL(rawKey.replace(/^s3:\/\//, 'https://'));
      return;
    }

    console.log('[SubCountyHomeScreen] openDocument storage route', JSON.stringify({
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
    if (!Array.isArray(selectedSubjects) || selectedSubjects.length === 0) return [];

    const getSubjectKey = (subject: any) => String(subject?.id || subject?.code || subject?.name || 'subject').trim().toLowerCase();
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
    const chartWidth = Math.max(280, Math.min(420, windowWidth - 72));
    const chartHeight = 520;
    const paddingLeft = 28;
    const paddingRight = 32;
    const paddingTop = 12;
    const paddingBottom = 42;
    const axisGrades = [7, 8, 9, 10, 11, 12] as const;
    const majorStep = 10;
    const minorStep = 1;
    const chartMaxY = Math.max(maxY ?? 100, ...series.flatMap((point) => [Number(point.value || 0), Number(point.target || 0)]).filter((value) => Number.isFinite(value)), 0, 1);
    const yMajorTicks = Array.from({ length: Math.floor(chartMaxY / majorStep) + 1 }, (_, index) => index * majorStep);
    const yMinorTicks = Array.from({ length: Math.floor(chartMaxY) + 1 }, (_, index) => index * minorStep);

    const gradeToX = (grade: number) => {
      const index = axisGrades.indexOf(grade as (typeof axisGrades)[number]);
      const safeIndex = index >= 0 ? index : 0;
      return paddingLeft + (safeIndex / Math.max(axisGrades.length - 1, 1)) * (chartWidth - paddingLeft - paddingRight);
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

          <View style={{ position: 'absolute', left: paddingLeft, right: paddingRight, top: axisLineY, height: 1, backgroundColor: '#475569' }} />

          {axisGrades.map((grade) => (
            <View key={`x-grid-${grade}`} style={{ position: 'absolute', top: paddingTop, bottom: paddingBottom, left: gradeToX(grade), width: 1, backgroundColor: '#dbeafe' }} />
          ))}

          <View style={{ position: 'absolute', left: 0, top: 0, width: chartWidth, height: chartHeight }}>
            {targetSegments.map((segment, segmentIndex) => drawPolyline(targetColor, segment, `target-${segmentIndex}`))}
            {valueSegments.map((segment, segmentIndex) => drawPolyline(valueColor, segment, `value-${segmentIndex}`))}
            {requirementSegments.map((segment, segmentIndex) => drawPolyline('#22c55e', segment, `requirement-${segmentIndex}`))}
            {valuePoints.map((point, index) => (
              <View key={`value-dot-${index}`} style={{ position: 'absolute', left: point.x - dotSize / 2, top: point.y - dotSize / 2, width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: valueColor }} />
            ))}
            {targetPoints.map((point, index) => (
              <View key={`target-dot-${index}`} style={{ position: 'absolute', left: point.x - dotSize / 2, top: point.y - dotSize / 2, width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: targetColor }} />
            ))}
          </View>
        </View>
      </View>
    );
  };

  const modalContent = performanceAction && selectedLearner ? (
    <Modal transparent visible={!!performanceAction} animationType="slide" onRequestClose={resetPerformanceModal}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' }}>
        <View key={`${performanceSessionId}-${selectedLearner?.id ?? 'subcounty-performance'}`} style={{ margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '90%' }}>
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
              <View style={{ marginTop: 12 }}>
                <LearnerComments learnerId={selectedLearner.id} currentGrade={selectedLearner.gradeLevel} authorRoleOverride="subCounty" />
              </View>
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
              <LearnerComments learnerId={selectedLearner.id} currentGrade={selectedLearner.gradeLevel} authorRoleOverride="subCounty" />
            </ScrollView>
          ) : null}

          {performanceAction === 'viewEPortfolio' ? (
            <ScrollView style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700', marginBottom: 8 }}>E-portfolio files</Text>
              {(() => {
                const getItems = async () => {
                  const learnerSchoolCode = selectedLearnerProfile?.schoolCode || (selectedLearner as any)?.schoolCode || null;
                  const baseFilter = {
                    and: [
                      { learnerId: { eq: selectedLearner.id } },
                      { resourceCategory: { eq: 'e_portfolio' } },
                    ],
                  } as any;

                  const filter = learnerSchoolCode
                    ? { and: [{ schoolCode: { eq: learnerSchoolCode } }, ...baseFilter.and] }
                    : baseFilter;

                  const res = await client.graphql({ query: listLearnerDocumentResources, variables: { filter, limit: 200 } } as any);
                  const items = ((res as any).data?.listLearnerDocumentResources?.items || [])
                    .filter((item: any) => item?.id && item?.learnerId && item?.fileKey)
                    .map((item: any) => ({
                      id: item.id,
                      learnerId: item.learnerId,
                      title: item.title,
                      description: item.description || null,
                      resourceType: item.resourceType || 'document',
                      resourceCategory: item.resourceCategory || null,
                      fileKey: item.fileKey,
                      fileName: item.fileName,
                      fileType: item.fileType || null,
                      fileSizeBytes: typeof item.fileSizeBytes === 'number' ? item.fileSizeBytes : null,
                      status: item.status || 'pending_review',
                      createdAt: item.createdAt || null,
                    }))
                    .filter((item: any) => !item.resourceCategory || item.resourceCategory === 'e_portfolio')
                    .sort((left: any, right: any) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

                  setLearnerDocuments(items);
                };

                if (!learnerDocuments.length) {
                  void getItems();
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
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionCard title="Sub-county Office" subtitle="Assigned sub-county details and school management.">
          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color="#1d4ed8" />
              <Text style={styles.loadingText}>Loading your sub-county dashboard...</Text>
            </View>
          ) : null}

          {!isLoading && notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {!isLoading && subCounty ? (
            <View style={styles.summary}>
              <Text style={styles.heading}>{subCounty.name}</Text>
              <Text style={styles.meta}>Code: {subCounty.code}</Text>
              <Text style={styles.meta}>County: {subCounty.countyCode || 'N/A'}</Text>
              <Text style={styles.meta}>Region: {subCounty.regionCode || 'N/A'}</Text>
              <Text style={styles.meta}>Nation: {subCounty.nationCode || 'N/A'}</Text>
              <Text style={styles.meta}>Assigned officer: {subCounty.assignedOfficerEmail || 'Not set'}</Text>
            </View>
          ) : null}
        </SectionCard>

        {subCounty ? <CbeJurisdictionAnalytics
          scopeType="subCounty"
          scopeCode={subCounty.code}
          scopeName={subCounty.name}
          nationCode={subCounty.nationCode}
        /> : null}
        {subCounty?.nationCode ? <LearnerFollowUpDashboard
          scopeType="subCounty"
          scopeCode={subCounty.code}
          scopeName={subCounty.name}
          nationCode={subCounty.nationCode}
        /> : null}

        <SectionCard title="Schools in this sub-county" subtitle="All schools linked to your assigned sub-county.">
          {!isLoading && schools.length === 0 ? (
            <Text style={styles.empty}>No schools are assigned to this sub-county yet.</Text>
          ) : null}

          {schools.map((school) => (
            <TouchableOpacity
              key={school.id}
              style={[styles.row, selectedSchoolCode === school.code && styles.rowSelected]}
              onPress={() => {
                setSelectedSchoolCode(school.code);
                setSelectedLearnerGrade(null);
              }}
              accessibilityState={{ selected: selectedSchoolCode === school.code }}
            >
              <Text style={styles.rowCode}>{school.code}</Text>
              <Text style={styles.rowName}>{school.name}</Text>
              <Text style={styles.rowMeta}>{school.assignedOfficerEmail || 'No principal assigned'}</Text>
            </TouchableOpacity>
          ))}
          {selectedSchoolCode ? (
            <View style={styles.gradeSelector}>
              {['7', '8', '9', '10', '11', '12'].map((grade) => (
                <TouchableOpacity
                  key={grade}
                  style={[styles.gradeButton, selectedLearnerGrade === grade && styles.gradeButtonActive]}
                  onPress={() => setSelectedLearnerGrade(grade)}
                  accessibilityState={{ selected: selectedLearnerGrade === grade }}
                >
                  <Text style={[styles.gradeButtonText, selectedLearnerGrade === grade && styles.gradeButtonTextActive]}>Grade {grade}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Learners in this sub-county" subtitle="View learner performance for all learners assigned to this sub-county.">
          {!subCountyLearners.length ? (
            <Text style={styles.empty}>No learners are assigned to this sub-county yet.</Text>
          ) : !selectedSchoolCode ? (
            <Text style={styles.empty}>Select a school above to view its learners.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 720 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator>
              {!selectedLearnerGrade ? (
                <Text style={styles.empty}>Select a grade to view learners in {schools.find((school) => school.code === selectedSchoolCode)?.name || selectedSchoolCode}.</Text>
              ) : null}
              {subCountyLearners.filter((learner) => {
                const learnerGrade = String(learner.gradeLevel || learner.classCode || '').replace(/\D/g, '');
                return learner.schoolCode === selectedSchoolCode && learnerGrade === selectedLearnerGrade;
              }).map((learner) => (
                <View key={learner.id} style={styles.learnerRow}>
                  <Text style={styles.learnerText}>{learner.fullName} - {learnerCareerMap[learner.id] || 'Career target not set'}</Text>
                  <Text style={styles.learnerMeta}>{schools.find((school) => school.code === learner.schoolCode)?.name || learner.schoolCode || 'School N/A'} • {learner.schoolCode || 'Registration code N/A'}</Text>
                  <Text style={styles.learnerMeta}>Grade {learner.gradeLevel || learner.classCode || 'N/A'} • Class {learner.classCode || 'N/A'}</Text>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={async () => {
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
                    <Text style={styles.actionButtonText}>View performance</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {selectedLearnerGrade && !subCountyLearners.some((learner) => {
                const learnerGrade = String(learner.gradeLevel || learner.classCode || '').replace(/\D/g, '');
                return learner.schoolCode === selectedSchoolCode && learnerGrade === selectedLearnerGrade;
              }) ? <Text style={styles.empty}>No learners matching this school and grade.</Text> : null}
            </ScrollView>
          )}
        </SectionCard>

        <SectionCard title="Grade 12 result summary pool" subtitle="Latest automatically captured Grade 12 outcomes for this sub-county.">
          {!grade12Summaries.length ? (
            <Text style={styles.empty}>No Grade 12 result summaries have been created for this sub-county yet.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {grade12Summaries.slice(0, 12).map((summary: any) => (
                <View key={summary.id} style={{ borderWidth: 1, borderColor: '#dbeafe', borderRadius: 10, padding: 12, backgroundColor: '#f8fafc' }}>
                  <Text style={{ fontWeight: '700', color: '#111827' }}>{summary.institutionName || 'Institution not set'} • {summary.courseName || 'Course not set'}</Text>
                  <Text style={{ color: '#374151', fontSize: 12, marginTop: 4 }}>
                    Learner: {summary.learnerId || 'Unknown'} • School: {summary.schoolCode || 'N/A'} • Grade: {summary.gradeLevel || '12'}
                  </Text>
                  <Text style={{ color: '#374151', fontSize: 12, marginTop: 4 }}>
                    Course score: {summary.finalAggregatePoints ?? 'N/A'}
                  </Text>
                  <Text style={{ color: '#374151', fontSize: 12, marginTop: 4 }}>
                    Status: {summary.resultStatus || 'not_assessed'} • Placement: {summary.placementStatus || 'not_configured'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </SectionCard>
        {subCounty ? <JurisdictionTransferManager scope="subCounty" scopeCodes={{ nationCode: subCounty.nationCode || '', regionCode: subCounty.regionCode || '', countyCode: subCounty.countyCode || '', subCountyCode: subCounty.code }} /> : null}
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
  summary: {
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
  gradeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
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
  actionButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  chartCard: {
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  chartLegendRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
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
  },
  chartAxisLabel: {
    fontSize: 10,
    color: '#475569',
  },
});
