import React, { useEffect, useMemo, useRef, useState } from 'react';
import useSessionUser from '../../hooks/useSessionUser';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/api';
import { getUrl, uploadData } from 'aws-amplify/storage';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import awsmobile from '../../aws-exports';
import ViewPerformance from '../../components/teacher/ViewPerformance';
import SectionCard from '../../components/shared/SectionCard';
import SubjectPerformanceGraph from '../../components/shared/SubjectPerformanceGraph';
import LearnerClusterPerformanceGraph from '../../components/shared/LearnerClusterPerformanceGraph';
import calculateHistoricalClusterSeries, { calculateCourseClusterPoints, calculateCourseClusterScoreDetails, calculateDeviationPercentage, calculateTertiaryCourseClusterBenchmarkPoints, evaluateCourseSubjectPointRequirements, getCbeAchievementLevel, getCourseRequirementGroups, getMissingClusterGrades, hasCompleteCourseScoringData, hasCompleteCourseSubjectRequirements, hasCourseSubjectPointRequirements, parseCourseClusterRequirements } from '../../utils/cluster';
import { parseLearnerSupportProfile, resolveLearnerCareerTarget } from '../../utils/learnerCareer';
import { getLearnerResourceUrl, isLearnerVideoResource } from '../../utils/learnerResourceUrl';
import { filterSupportSubjects } from '../../utils/supportSubjects';
import { loadSupportSubjectIds } from '../../hooks/useSupportSubjectFilter';
import {
  createAssessmentRubric,
  createGrade12ResultSummary,
  createLearnerDocumentResource,
  createLearnerEnrollment,
  createLearnerProfile,
  createAcademicRecord,
  createLearnerSubjectPerformance,
  updateGrade12ResultSummary,
  updateLearnerSubjectPerformance,
  updateLearnerEnrollment,
  createUser,
  updateLearnerProfile,
} from '../../graphql/mutations';
import {
  getLearnerProfile,
  getLearnerSubjectPerformance,
  listCoreSubjects,
  listGrade12ResultSummaries,
  listInterventions,
  listJuniorSubjects,
  listLearnerDocumentResources,
  listLearnerEnrollments,
  listLearnerProfiles,
  listSchoolClasses,
  listSNESubjects,
  listSubjects,
  listSupportSubjects,
  listTeacherProfiles,
  listTertiaryCourses,
  listTertiaryInstitutionProfiles,
  listUsers,
} from '../../graphql/queries';

type TeacherContext = {
  id: string;
  userId: string;
  fullName: string;
  nationCode: string;
  regionCode: string;
  countyCode: string;
  subCountyCode: string;
  schoolCode: string;
  tscNumber?: string | null;
};

type AssignedClass = {
  id: string;
  schoolCode: string;
  classCode: string;
  className?: string | null;
  gradeLevel?: string | null;
  academicYear?: string | null;
};

type LearnerRecord = {
  id: string;
  learnerId?: string | null;
  fullName: string;
  assessmentNumber: string;
  gradeLevel?: string | null;
  classCode?: string | null;
  status?: string | null;
};

type LearnerDetails = {
  targetCareer: string;
};

type SubjectCatalogItem = {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  learningAreaCode?: string | null;
};

type LearnerDocumentResourceRecord = {
  id: string;
  learnerId: string;
  relatedSubjectId?: string | null;
  relatedSubjectName?: string | null;
  title: string;
  description?: string | null;
  resourceType: string;
  resourceCategory?: string | null;
  fileKey?: string | null;
  fileName?: string | null;
  externalUrl?: string | null;
  fileType?: string | null;
  fileSizeBytes?: number | null;
  status: string;
  createdAt?: string | null;
};

const ACADEMIC_YEAR = '2026';
const STORAGE_BUCKET = awsmobile.aws_user_files_s3_bucket;

const describeSyncError = (error: unknown): string => {
  if (error instanceof Error) {
    const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
    return cause === undefined
      ? `${error.name}: ${error.message}`
      : `${error.name}: ${error.message}; cause: ${describeSyncError(cause)}`;
  }
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const details = error as {
      name?: unknown;
      message?: unknown;
      errors?: unknown;
      errorType?: unknown;
      path?: unknown;
      extensions?: unknown;
    };
    const toJson = (value: unknown): string => {
      try {
        return JSON.stringify(value);
      } catch {
        return '[unserializable details]';
      }
    };
    const message = typeof details.message === 'string' ? details.message : '';
    const serialized = (() => {
      return toJson(error);
    })();
    const description = [
      typeof details.name === 'string' ? details.name : '',
      message,
      details.errorType ? `errorType=${String(details.errorType)}` : '',
      details.path ? `path=${toJson(details.path)}` : '',
      details.extensions ? `extensions=${toJson(details.extensions)}` : '',
      details.errors ? `errors=${toJson(details.errors)}` : '',
    ].filter(Boolean).join('; ');
    return description || serialized || Object.prototype.toString.call(error);
  }
  return String(error);
};

export default function TeacherHomeScreen() {
  const client = useMemo(() => generateClient(), []);
  const { sessionUser } = useSessionUser();
  const logAwsError = (scope: string, error: unknown, extra?: Record<string, unknown>) => {
    const typed = error as {
      name?: string;
      message?: string;
      errors?: Array<{ message?: string; errorType?: string; path?: string[] }>;
      recoverySuggestion?: string;
      stack?: string;
    };

    const payload = {
      scope,
      name: typed?.name || 'UnknownError',
      message: typed?.message || String(error),
      graphqlErrors: typed?.errors || [],
      recoverySuggestion: typed?.recoverySuggestion || null,
      extra: extra || null,
    };

    console.log('[EPORTFOLIO_DEBUG]', JSON.stringify(payload, null, 2));
  };
  const [teacherContext, setTeacherContext] = useState<TeacherContext | null>(null);
  const [assignedClasses, setAssignedClasses] = useState<AssignedClass[]>([]);
  const [selectedClassCode, setSelectedClassCode] = useState('');
  const [learners, setLearners] = useState<LearnerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSubject, setSavingSubject] = useState(false);
  const [notice, setNotice] = useState('');
  const [fullName, setFullName] = useState('');
  const [assessmentNumber, setAssessmentNumber] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [gender, setGender] = useState('');
  const selectAssignedClass = (classItem: AssignedClass | null) => {
    setSelectedClassCode(classItem?.classCode || '');
    if (!classItem) {
      setGradeLevel('');
      return;
    }

    const configuredGrade = String(classItem.gradeLevel || '').trim();
    const grade = configuredGrade.match(/\d+/)?.[0]
      || String(classItem.className || classItem.classCode || '').match(/\d+/)?.[0]
      || configuredGrade;
    setGradeLevel(grade);
  };
  const [learnerDetails, setLearnerDetails] = useState<LearnerDetails>({
    targetCareer: '',
  });
  const [parentNationalId, setParentNationalId] = useState('');
  const [showLearnerDetails, setShowLearnerDetails] = useState(false);
  const [subjectIntroVisible, setSubjectIntroVisible] = useState(false);
  const [subjectIntroLearner, setSubjectIntroLearner] = useState<LearnerRecord | null>(null);
  const [subjectModalVisible, setSubjectModalVisible] = useState(false);
  const [selectedLearnerForSubjects, setSelectedLearnerForSubjects] = useState<LearnerRecord | null>(null);
  const resetPerformanceModal = () => {
    setPerformanceSessionId((current) => current + 1);
    setPerformanceAction(null);
    setPerformanceLearner(null);
    setActiveGraphLearnerId(null);
    setSelectedPerformanceSubject(null);
    setPerformanceMarksInput('');
    setLearnerDocumentMap({});
    setLearnerGuidanceMap({});
    setEvidenceViewer(null);
    setVideoLinkModalVisible(false);
    setVideoLinkSubject(null);
  };
  const [learnerSubjectsMap, setLearnerSubjectsMap] = useState<
    Record<string, Array<{ id: string; name: string; code?: string; category?: string | null; targetMarks?: number | null; marksScored?: number | null }>>
  >({});
  const [learnerProfileMap, setLearnerProfileMap] = useState<Record<string, any>>({});
  const [learnerCareerMap, setLearnerCareerMap] = useState<Record<string, string | null>>({});
  const [performanceLearner, setPerformanceLearner] = useState<LearnerRecord | null>(null);
  const [activeGraphLearnerId, setActiveGraphLearnerId] = useState<string | null>(null);
  const [performanceAction, setPerformanceAction] = useState<'menu' | 'viewMenu' | 'subject' | 'cluster' | 'rubric' | 'viewCluster' | 'viewSubjects' | 'viewGuidance' | 'viewEPortfolio' | null>(null);
  const [pendingLearnerConfirmation, setPendingLearnerConfirmation] = useState<{ learner: LearnerRecord; action: 'view' | 'update' } | null>(null);
  const [performanceSessionId, setPerformanceSessionId] = useState(0);
  const [selectedPerformanceSubject, setSelectedPerformanceSubject] = useState<{ id: string; name: string; code?: string; category?: string | null; targetMarks?: number | null; marksScored?: number | null } | null>(null);
  const [performanceMarksInput, setPerformanceMarksInput] = useState('');
  const [promotionModalVisible, setPromotionModalVisible] = useState(false);
  const [promotionLearner, setPromotionLearner] = useState<LearnerRecord | null>(null);
  const [promotionGradeInput, setPromotionGradeInput] = useState('');
  const [careerTargetModalVisible, setCareerTargetModalVisible] = useState(false);
  const [careerTargetLearner, setCareerTargetLearner] = useState<LearnerRecord | null>(null);
  const [careerTargetInput, setCareerTargetInput] = useState('');
  const [careerPickerVisible, setCareerPickerVisible] = useState(false);
  const [courseFilterInstitution, setCourseFilterInstitution] = useState('');
  const [courseFilterCourseName, setCourseFilterCourseName] = useState('');
  const [careerOptions, setCareerOptions] = useState<Array<{
    id: string;
    institutionId: string | null;
    institutionName: string | null;
    courseName: string;
    clusterRequirements?: { version: 1 | 2 | 3; pointScale?: 'CBE_8'; requiredSubjectIds?: string[]; alternativeSubjectIds?: string[]; subjectSequence?: Array<{ subjectId: string; subjectName?: string; operator: 'AND' | 'OR'; minimumPoints?: number }> } | null;
  }>>([]);
  const [careerOptionsLoading, setCareerOptionsLoading] = useState(false);
  const [selectedCareerId, setSelectedCareerId] = useState<string | null>(null);
  const filteredCareerOptions = useMemo(() => {
    const institutionQuery = courseFilterInstitution.trim().toLowerCase();
    const courseQuery = courseFilterCourseName.trim().toLowerCase();

    return careerOptions.filter((career) => {
      const institutionMatches = !institutionQuery || (career.institutionName || '').toLowerCase().includes(institutionQuery);
      const courseMatches = !courseQuery || career.courseName.toLowerCase().includes(courseQuery);
      return institutionMatches && courseMatches && hasCompleteCourseScoringData(career.clusterRequirements);
    });
  }, [careerOptions, courseFilterInstitution, courseFilterCourseName]);
  const [promotingLearner, setPromotingLearner] = useState(false);
  const [resettingCareerTarget, setResettingCareerTarget] = useState(false);
  const [resettingSubjectTargets, setResettingSubjectTargets] = useState(false);
  const [expandedSubjectsLearnerId, setExpandedSubjectsLearnerId] = useState<string | null>(null);
  const [learnerGuidanceMap, setLearnerGuidanceMap] = useState<Record<string, Array<{ id: string; note: string; authorRole?: string | null; authorDisplayName?: string | null; schoolGrade?: string | null; createdAt?: string | null }>>>({});
  const [subjectPerformanceDrafts, setSubjectPerformanceDrafts] = useState<Record<string, string>>({});
  const [learnerClusterPointsMap, setLearnerClusterPointsMap] = useState<Record<string, number>>({});
  const [learnerDocumentMap, setLearnerDocumentMap] = useState<Record<string, LearnerDocumentResourceRecord[]>>({});
  const [rubricTitle, setRubricTitle] = useState('');
  const [rubricDescription, setRubricDescription] = useState('');
  const [rubricCriteriaText, setRubricCriteriaText] = useState('');
  const [savingRubric, setSavingRubric] = useState(false);
  const [savingPerformance, setSavingPerformance] = useState(false);
  const [savingSubjectMap, setSavingSubjectMap] = useState<Record<string, boolean>>({});
  const [calculatingClusterPoints, setCalculatingClusterPoints] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [openingDocumentId, setOpeningDocumentId] = useState('');
  const [documentDebugMessage, setDocumentDebugMessage] = useState('');
  const [videoLinkModalVisible, setVideoLinkModalVisible] = useState(false);
  const [videoLinkSubject, setVideoLinkSubject] = useState<{ id: string; name: string } | null>(null);
  const [videoLinkInput, setVideoLinkInput] = useState('');
  const [videoTitleInput, setVideoTitleInput] = useState('');
  const [savingVideoLink, setSavingVideoLink] = useState(false);
  const [evidenceViewer, setEvidenceViewer] = useState<{ subjectId: string; subjectName: string; kind: 'document' | 'video' } | null>(null);
  const [subjectGroups, setSubjectGroups] = useState<Array<{ title: string; items: SubjectCatalogItem[] }>>([]);
  const [subjectGroupsLoading, setSubjectGroupsLoading] = useState(false);
  const [subjectSelectionStep, setSubjectSelectionStep] = useState<'category' | 'subjects' | 'details'>('category');
  const [selectedSubjectCategory, setSelectedSubjectCategory] = useState<'Junior Secondary' | 'Senior Secondary' | 'Vocational SNE' | ''>('');
  const [selectedSubjectCandidate, setSelectedSubjectCandidate] = useState<SubjectCatalogItem | null>(null);
  const [subjectFilterQuery, setSubjectFilterQuery] = useState('');
  const [targetMarksInput, setTargetMarksInput] = useState('');
  const [courseTargetMarkDrafts, setCourseTargetMarkDrafts] = useState<Record<string, string>>({});
  const [subjectAssignmentBlockReason, setSubjectAssignmentBlockReason] = useState('');

  useEffect(() => {
    void loadTeacherContext();
  }, [client]);

  useEffect(() => {
    void loadCareerOptions();
  }, [client]);

  const loadCareerOptions = async () => {
    try {
      setCareerOptionsLoading(true);
      const [coursesResult, institutionsResult, subjectsResult, coreSubjectsResult, supportSubjectsResult] = await Promise.all([
        client.graphql({
          query: listTertiaryCourses,
          variables: { limit: 500 },
        }),
        client.graphql({
          query: listTertiaryInstitutionProfiles,
          variables: { limit: 500 },
        }),
        client.graphql({ query: listSubjects, variables: { limit: 500 } }),
        client.graphql({ query: listCoreSubjects, variables: { limit: 500 } }),
        client.graphql({ query: listSupportSubjects, variables: { limit: 500 } }),
      ]);

      const coursePayload = coursesResult as { data?: { listTertiaryCourses?: { items?: Array<any> } } };
      const institutionPayload = institutionsResult as { data?: { listTertiaryInstitutionProfiles?: { items?: Array<any> } } };
      const subjectNameById = [
        ...((subjectsResult as any).data?.listSubjects?.items || []),
        ...((coreSubjectsResult as any).data?.listCoreSubjects?.items || []),
        ...((supportSubjectsResult as any).data?.listSupportSubjects?.items || []),
      ].reduce((map: Record<string, string>, subject: any) => {
        if (subject?.id) map[String(subject.id)] = String(subject.name || subject.code || subject.id);
        return map;
      }, {});

      const institutions = (institutionPayload.data?.listTertiaryInstitutionProfiles?.items || []).reduce((map: Record<string, string>, item: any) => {
        if (item?.id) {
          map[String(item.id)] = String(item.institutionName || 'Unknown institution').trim();
        }
        return map;
      }, {});

      const items = (coursePayload.data?.listTertiaryCourses?.items || [])
        .filter((item: any) => typeof item?.courseName === 'string' && item.courseName.trim())
        .slice()
        .sort((a: any, b: any) => String(a.courseName).localeCompare(String(b.courseName)));

      const mapped = items.map((item: any) => ({
        id: String(item.id),
        institutionId: item?.institutionId ? String(item.institutionId) : null,
        institutionName: item?.institutionId ? (institutions[String(item.institutionId)] || null) : null,
        courseName: String(item.courseName).trim(),
        clusterRequirements: item.clusterRequirements ? (() => {
          const parsed = typeof item.clusterRequirements === 'string' ? JSON.parse(item.clusterRequirements) : item.clusterRequirements;
          const normalized = parseCourseClusterRequirements(parsed);
          if (!normalized?.subjectSequence) return parsed;
          return {
            ...normalized,
            subjectSequence: normalized.subjectSequence.map((requirement) => ({
              ...requirement,
              subjectName: subjectNameById[String(requirement.subjectId)] || String(requirement.subjectId),
            })),
          };
        })() : null,
      }));

      setCareerOptions(mapped);
    } catch (error) {
      console.warn('[CAREER_OPTIONS_LOAD_FAILED]', error);
      setCareerOptions([]);
    } finally {
      setCareerOptionsLoading(false);
    }
  };

  const loadTeacherContext = async () => {
    try {
      setLoading(true);
      setNotice('');

      const session = await fetchAuthSession();
      const sessionEmail = (
        (session.tokens?.idToken?.payload as { email?: string } | undefined)?.email ||
        (session.tokens?.accessToken?.payload as { username?: string } | undefined)?.username ||
        ''
      )
        .trim()
        .toLowerCase();

      if (!sessionEmail) {
        const currentUser = await getCurrentUser();
        const fallbackEmail = currentUser.username || '';
        if (!fallbackEmail) {
          throw new Error('No signed-in teacher email was found.');
        }
      }

      const userQuery = await client.graphql({
        query: listUsers,
        variables: {
          filter: {
            email: { eq: sessionEmail },
          },
          limit: 20,
        },
      });

      const userPayload = userQuery as { data?: { listUsers?: { items?: Array<any> } } };
      const userRecord = userPayload.data?.listUsers?.items?.[0];

      if (!userRecord?.id) {
        throw new Error('Your teacher account could not be matched to a user record.');
      }

      const teacherQuery = await client.graphql({
        query: listTeacherProfiles,
        variables: {
          filter: {
            userId: { eq: userRecord.id },
          },
          limit: 20,
        },
      });

      const teacherPayload = teacherQuery as { data?: { listTeacherProfiles?: { items?: Array<any> } } };
      const teacherRecord = teacherPayload.data?.listTeacherProfiles?.items?.[0];

      if (!teacherRecord?.id) {
        throw new Error('No teacher profile was found for this account.');
      }

      const teacher: TeacherContext = {
        id: teacherRecord.id,
        userId: teacherRecord.userId,
        fullName: teacherRecord.fullName,
        nationCode: teacherRecord.nationCode,
        regionCode: teacherRecord.regionCode,
        countyCode: teacherRecord.countyCode,
        subCountyCode: teacherRecord.subCountyCode,
        schoolCode: teacherRecord.schoolCode,
        tscNumber: teacherRecord.tscNumber,
      };

      setTeacherContext(teacher);

      const classesQuery = await client.graphql({
        query: listSchoolClasses,
        variables: {
          filter: {
            and: [{ schoolCode: { eq: teacher.schoolCode } }, { teacherIds: { contains: teacher.id } }],
          },
          limit: 200,
        },
      });

      const classPayload = classesQuery as { data?: { listSchoolClasses?: { items?: Array<any> } } };
      const assigned = (classPayload.data?.listSchoolClasses?.items || [])
        .filter((item: any) => item?.schoolCode === teacher.schoolCode)
        .map((item: any) => ({
          id: item.id,
          schoolCode: item.schoolCode,
          classCode: item.classCode,
          className: item.className,
          gradeLevel: item.gradeLevel,
          academicYear: item.academicYear,
        }));

      const unique = assigned.filter(
        (item, index, array) => array.findIndex((candidate) => candidate.classCode === item.classCode) === index,
      ).sort((left, right) => {
        const gradeOf = (item: AssignedClass) => {
          const gradeText = String(item.gradeLevel || item.classCode || item.className || '');
          const grade = Number(gradeText.match(/\d+/)?.[0]);
          return Number.isFinite(grade) ? grade : Number.POSITIVE_INFINITY;
        };
        const gradeDifference = gradeOf(left) - gradeOf(right);
        if (gradeDifference !== 0) return gradeDifference;
        return String(left.className || left.classCode || '').localeCompare(String(right.className || right.classCode || ''), undefined, { numeric: true });
      });

      setAssignedClasses(unique);

      if (unique.length > 0) {
        selectAssignedClass(unique[0]);
      } else {
        selectAssignedClass(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load your teacher class data.';
      setNotice(message);
      setTeacherContext(null);
      setAssignedClasses([]);
      selectAssignedClass(null);
    } finally {
      setLoading(false);
    }
  };

  const loadClassLearners = async (classCode: string) => {
    if (!teacherContext || !classCode) {
      setLearners([]);
      setLearnerDocumentMap({});
      return;
    }

    try {
      const result = await client.graphql({
        query: listLearnerProfiles,
        variables: {
          filter: {
            and: [
              { schoolCode: { eq: teacherContext.schoolCode } },
              { classCode: { eq: classCode } },
            ],
          },
          limit: 200,
        },
      });

      const payload = result as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const mapped = (payload.data?.listLearnerProfiles?.items || []).map((item: any) => ({
        id: item.id,
        learnerId: item.learnerId || item.id,
        fullName: item.fullName,
        assessmentNumber: item.assessmentNumber,
        gradeLevel: item.gradeLevel,
        classCode: item.classCode,
        status: item.status,
      }));

      const boundaryLearners = mapped.filter((learner) => ['9', '10'].includes(String(learner.gradeLevel || '').replace(/\D/g, '')));
      if (boundaryLearners.length > 0) {
        console.log('[TEACHER_GRADE_BOUNDARY] roster loaded', {
          selectedClassCode: classCode,
          learners: boundaryLearners.map(({ id, learnerId, gradeLevel, classCode: learnerClassCode }) => ({
            id,
            learnerId,
            gradeLevel,
            classCode: learnerClassCode,
          })),
        });
      }

      setLearners(mapped);
      await Promise.all([
        ...mapped.map((learner) => loadSelectedLearnerSubjects(learner.id)),
        loadClassLearnerDocuments(classCode),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load class learners.';
      setNotice(message);
      setLearners([]);
      setLearnerDocumentMap({});
    }
  };

  const assessmentNumberExists = async (value: string) => {
    const normalizedAssessmentNumber = value.trim();
    let nextToken: string | null = null;

    do {
      const result = await client.graphql({
        query: listLearnerProfiles,
        variables: {
          filter: { assessmentNumber: { eq: normalizedAssessmentNumber } },
          limit: 500,
          nextToken,
        },
      }) as {
        data?: { listLearnerProfiles?: { items?: Array<{ id?: string }>; nextToken?: string | null } };
        errors?: Array<{ message?: string }>;
      };
      if (result.errors?.length) {
        throw new Error(result.errors.map((error) => error.message || 'Unknown GraphQL error').join('; '));
      }

      const connection = result.data?.listLearnerProfiles;
      if (!connection) throw new Error('The learner assessment-number lookup response was empty.');
      if ((connection.items || []).some((learner) => Boolean(learner?.id))) return true;
      nextToken = connection.nextToken || null;
    } while (nextToken);

    return false;
  };

  useEffect(() => {
    if (selectedClassCode) {
      void loadClassLearners(selectedClassCode);
    }
  }, [selectedClassCode, teacherContext]);

  useEffect(() => {
    if (!subjectModalVisible || !selectedLearnerForSubjects) return;

    const rosterLearner = learners.find((learner) => learner.id === selectedLearnerForSubjects.id);
    const selectedGrade = String(selectedLearnerForSubjects.gradeLevel || '').replace(/\D/g, '');
    if (!['9', '10'].includes(selectedGrade)) return;

    console.log('[TEACHER_GRADE_BOUNDARY] assignment panel grade', {
      learnerId: selectedLearnerForSubjects.id,
      selectedLearnerGrade: selectedLearnerForSubjects.gradeLevel,
      rosterLearnerGrade: rosterLearner?.gradeLevel || null,
      selectedLearnerClassCode: selectedLearnerForSubjects.classCode || null,
      rosterLearnerClassCode: rosterLearner?.classCode || null,
      selectedClassCode,
      displayedAssignmentGrade: selectedLearnerForSubjects.gradeLevel || rosterLearner?.gradeLevel || null,
    });
  }, [subjectModalVisible, selectedLearnerForSubjects, learners, selectedClassCode]);

  const loadSelectedLearnerSubjects = async (learnerId: string) => {
    try {
      const result = await client.graphql({
        query: listLearnerProfiles,
        variables: {
          filter: {
            id: { eq: learnerId },
          },
          limit: 20,
        },
      });

      const payload = result as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const learnerRecord = payload.data?.listLearnerProfiles?.items?.[0];
      const supportProfile = learnerRecord?.supportProfile;
      const savedCareerTarget = await resolveLearnerCareerTarget(client, learnerRecord);
      setLearnerCareerMap((current) => ({ ...current, [learnerId]: savedCareerTarget }));
      const parsedProfile = parseLearnerSupportProfile(supportProfile);

      if (!parsedProfile) {
        setLearnerProfileMap((current) => ({ ...current, [learnerId]: {} }));
        setLearnerSubjectsMap((current) => ({ ...current, [learnerId]: [] }));
        return;
      }

      const selectedSubjects = Array.isArray(parsedProfile?.selectedSubjects) ? parsedProfile.selectedSubjects : [];

      console.log('[DEBUG_SUPPORT_PROFILE]', JSON.stringify({
        learnerId,
        gradeLevel: learnerRecord?.gradeLevel,
        selectedSubjectsCount: selectedSubjects.length,
        historicalSelectedSubjectsCount: Array.isArray(parsedProfile?.historicalSelectedSubjects) ? parsedProfile.historicalSelectedSubjects.length : 0,
        selectedSubjects: selectedSubjects.map((subject: any) => ({ name: subject?.name, targetMarks: subject?.targetMarks, marksScored: subject?.marksScored, history: Array.isArray(subject?.history) ? subject.history : [] })),
        historicalSelectedSubjects: Array.isArray(parsedProfile?.historicalSelectedSubjects) ? parsedProfile.historicalSelectedSubjects.map((subject: any) => ({ name: subject?.name, targetMarks: subject?.targetMarks, marksScored: subject?.marksScored, history: Array.isArray(subject?.history) ? subject.history : [] })) : [],
        targetCareer: savedCareerTarget,
      }, null, 2));

      const mappedSubjects = selectedSubjects.map((item: any) => ({
        id: item?.id || `${item?.code || item?.name || 'subject'}-${Math.random()}`,
        name: item?.name || 'Unnamed subject',
        code: item?.code || undefined,
        category: item?.category || null,
        targetMarks: item?.targetMarks ?? null,
        marksScored: item?.marksScored ?? null,
      }));

      setLearnerProfileMap((current) => ({ ...current, [learnerId]: parsedProfile }));
      setLearnerSubjectsMap((current) => ({ ...current, [learnerId]: mappedSubjects }));
    } catch {
      setLearnerSubjectsMap((current) => ({ ...current, [learnerId]: [] }));
    }
  };

  const loadClassLearnerDocuments = async (classCode: string) => {
    if (!teacherContext || !classCode) {
      setLearnerDocumentMap({});
      return;
    }

    try {
      const result = await client.graphql({
        query: listLearnerDocumentResources,
        variables: {
          filter: {
            and: [
              { schoolCode: { eq: teacherContext.schoolCode } },
              { classCode: { eq: classCode } },
            ],
          },
          limit: 500,
        },
      });

      const payload = result as { data?: { listLearnerDocumentResources?: { items?: Array<any> } } };
      const items = (payload.data?.listLearnerDocumentResources?.items || [])
        .filter((item: any) => item?.id && item?.learnerId && (item?.fileKey || item?.externalUrl))
        .map((item: any) => ({
          id: item.id,
          learnerId: item.learnerId,
          relatedSubjectId: item.relatedSubjectId || null,
          relatedSubjectName: item.relatedSubjectName || null,
          title: item.title,
          description: item.description || null,
          resourceType: item.resourceType || 'document',
          resourceCategory: item.resourceCategory || null,
          fileKey: item.fileKey,
          fileName: item.fileName,
          externalUrl: item.externalUrl || null,
          fileType: item.fileType || null,
          fileSizeBytes: typeof item.fileSizeBytes === 'number' ? item.fileSizeBytes : null,
          status: item.status || 'pending_review',
          createdAt: item.createdAt || null,
        }))
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

      const grouped = items.reduce<Record<string, LearnerDocumentResourceRecord[]>>((accumulator, item) => {
        if (!accumulator[item.learnerId]) {
          accumulator[item.learnerId] = [];
        }
        accumulator[item.learnerId].push(item);
        return accumulator;
      }, {});

      setLearnerDocumentMap(grouped);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load learner documents.';
      setNotice(message);
      setLearnerDocumentMap({});
    }
  };

  const loadLearnerGuidance = async (learnerId: string) => {
    if (!learnerId) {
      return;
    }

    try {
      const result = await client.graphql({
        query: listInterventions,
        variables: {
          filter: {
            learnerId: { eq: learnerId },
          },
          limit: 200,
        },
      } as any);

      const rows = (result as any).data?.listInterventions?.items || [];
      const userIds = Array.from(new Set(rows.map((row: any) => row.authorUserId).filter(Boolean)));
      let usersMap: Record<string, any> = {};

      if (userIds.length > 0) {
        try {
          const usersResult = await client.graphql({
            query: listUsers,
            variables: {
              filter: { id: { in: userIds } },
              limit: 200,
            },
          } as any);
          const users = (usersResult as any).data?.listUsers?.items || [];
          usersMap = users.reduce((acc: Record<string, any>, user: any) => {
            if (user && user.id) acc[user.id] = user;
            return acc;
          }, {} as Record<string, any>);
        } catch {
          usersMap = {};
        }
      }

      const mapped = rows
        .map((row: any) => ({
          id: row.id,
          note: row.note || 'No comment text available.',
          authorRole: row.authorRole || 'Unknown',
          authorDisplayName: row.authorUserId ? (usersMap[row.authorUserId]?.fullName || usersMap[row.authorUserId]?.email || row.authorUserId) : (row.authorRole || 'Unknown'),
          schoolGrade: row.jurisdictionCode || null,
          createdAt: row.createdAt || null,
        }))
        .sort((left: any, right: any) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

      setLearnerGuidanceMap((current) => ({
        ...current,
        [learnerId]: mapped,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load guidance comments.';
      setNotice(message);
      setLearnerGuidanceMap((current) => ({
        ...current,
        [learnerId]: [],
      }));
    }
  };

  const loadLearnerDocuments = async (learnerId: string) => {
    if (!teacherContext || !learnerId) {
      return;
    }

    try {
      console.log('[EPORTFOLIO_DEBUG] loadLearnerDocuments:start', JSON.stringify({ learnerId, schoolCode: teacherContext.schoolCode }));
      const result = await client.graphql({
        query: listLearnerDocumentResources,
        variables: {
          filter: {
            and: [
              { schoolCode: { eq: teacherContext.schoolCode } },
              { learnerId: { eq: learnerId } },
            ],
          },
          limit: 500,
        },
      });

      const payload = result as { data?: { listLearnerDocumentResources?: { items?: Array<any> } } };
      const items = (payload.data?.listLearnerDocumentResources?.items || [])
        .filter((item: any) => item?.id && item?.learnerId && (item?.fileKey || item?.externalUrl))
        .map((item: any) => ({
          id: item.id,
          learnerId: item.learnerId,
          relatedSubjectId: item.relatedSubjectId || null,
          relatedSubjectName: item.relatedSubjectName || null,
          title: item.title,
          description: item.description || null,
          resourceType: item.resourceType || 'document',
          resourceCategory: item.resourceCategory || null,
          fileKey: item.fileKey,
          fileName: item.fileName,
          externalUrl: item.externalUrl || null,
          fileType: item.fileType || null,
          fileSizeBytes: typeof item.fileSizeBytes === 'number' ? item.fileSizeBytes : null,
          status: item.status || 'pending_review',
          createdAt: item.createdAt || null,
        }))
        .filter((item) => !item.resourceCategory || item.resourceCategory === 'e_portfolio')
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

      setLearnerDocumentMap((current) => ({
        ...current,
        [learnerId]: items,
      }));
      console.log('[EPORTFOLIO_DEBUG] loadLearnerDocuments:success', {
        learnerId,
        loadedItems: items.length,
        documentCount: items.filter((item) => !item.externalUrl && item.resourceType !== 'video').length,
        videoCount: items.filter(isLearnerVideoResource).length,
        subjectIds: [...new Set(items.map((item) => item.relatedSubjectId).filter(Boolean))],
      });
      setDocumentDebugMessage(`Loaded ${items.length} e-portfolio file(s) for learner.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load learner e-portfolio files.';
      console.error('[EPORTFOLIO_DEBUG] loadLearnerDocuments:failed', { learnerId, message, error });
      setNotice(message);
      setDocumentDebugMessage(`Load failed: ${message}`);
      logAwsError('loadLearnerDocuments', error, { learnerId, selectedClassCode });
    }
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) {
      return 'Size unavailable';
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDocumentTimestamp = (value?: string | null) => {
    if (!value) {
      return 'Date unavailable';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Date unavailable';
    }

    const pad = (part: number) => String(part).padStart(2, '0');
    return `${parsed.getFullYear()}/${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())}/${pad(parsed.getHours())}/${pad(parsed.getMinutes())}/${pad(parsed.getSeconds())}`;
  };

  const pickAndUploadLearnerDocument = async (learner: LearnerRecord, subject: { id: string; name: string }) => {
    if (!teacherContext) {
      setNotice('Teacher context is not ready for document upload.');
      return;
    }

    try {
      setUploadingDocument(true);
      setDocumentDebugMessage('Opening file picker...');
      console.log('[EPORTFOLIO_DEBUG] upload:start', JSON.stringify({ learnerId: learner.id, classCode: learner.classCode || selectedClassCode }));

      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: '*/*',
      });

      if (picked.canceled || !picked.assets?.length) {
        setDocumentDebugMessage('Upload cancelled from picker.');
        console.log('[EPORTFOLIO_DEBUG] upload:cancelled');
        return;
      }

      const asset = picked.assets[0];
      setDocumentDebugMessage(`Selected ${asset.name}. Uploading to storage...`);
      const uploadTitle = `${subject.name}: ${asset.name.replace(/\.[^.]+$/, '') || 'evidence'}`;
      const sanitizedName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const relativeKey = `eportfolio/${teacherContext.schoolCode}/${learner.id}/${Date.now()}-${sanitizedName}`;
      const fileKey = `protected/${relativeKey}`;
      console.log('[EPORTFOLIO_DEBUG] upload:selected', JSON.stringify({
        name: asset.name,
        mimeType: asset.mimeType || null,
        size: asset.size || null,
        relativeKey,
      }));
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      await uploadData({
        path: fileKey,
        data: blob,
        options: {
          contentType: asset.mimeType || 'application/octet-stream',
          metadata: {
            learnerId: learner.id,
            classCode: learner.classCode || selectedClassCode,
            resourceCategory: 'e_portfolio',
          },
        },
      }).result;
      setDocumentDebugMessage('Storage upload complete. Saving metadata...');
      console.log('[EPORTFOLIO_DEBUG] upload:storageSuccess', JSON.stringify({ fileKey, relativeKey }));

      const createResult = await client.graphql({
        query: createLearnerDocumentResource,
        variables: {
          input: {
            learnerId: learner.id,
            relatedSubjectId: subject.id,
            relatedSubjectName: subject.name,
            schoolCode: teacherContext.schoolCode,
            classCode: learner.classCode || selectedClassCode || null,
            uploadedByUserId: teacherContext.userId,
            uploadedByRole: 'teacher',
            resourceType: asset.mimeType?.startsWith('image/') ? 'image' : 'document',
            resourceCategory: 'e_portfolio',
            title: uploadTitle,
            description: null,
            s3Bucket: STORAGE_BUCKET,
            fileKey,
            fileName: asset.name,
            fileType: asset.mimeType || null,
            fileSizeBytes: typeof asset.size === 'number' ? asset.size : null,
            checksum: null,
            relatedCompetencyId: null,
            relatedCoreValueId: null,
            relatedAssessmentId: null,
            relatedObservationId: null,
            isPublished: false,
            status: 'pending_review',
            metadata: JSON.stringify({
              source: 'teacher_documents',
              resourceCategory: 'e_portfolio',
              relatedSubjectId: subject.id,
              relatedSubjectName: subject.name,
            }),
          },
        },
      });

      const createPayload = createResult as { data?: { createLearnerDocumentResource?: any } };
      const created = createPayload.data?.createLearnerDocumentResource;
      console.log('[EPORTFOLIO_DEBUG] upload:metadataCreateResult', JSON.stringify({
        createdId: created?.id || null,
        learnerId: created?.learnerId || learner.id,
        category: created?.resourceCategory || 'e_portfolio',
      }));
      if (created?.id) {
        const createdRecord: LearnerDocumentResourceRecord = {
          id: created.id,
          learnerId: created.learnerId,
          relatedSubjectId: created.relatedSubjectId || subject.id,
          relatedSubjectName: created.relatedSubjectName || subject.name,
          title: created.title,
          description: created.description || null,
          resourceType: created.resourceType || 'document',
          resourceCategory: created.resourceCategory || null,
          fileKey: created.fileKey,
          fileName: created.fileName,
          externalUrl: created.externalUrl || null,
          fileType: created.fileType || null,
          fileSizeBytes: typeof created.fileSizeBytes === 'number' ? created.fileSizeBytes : null,
          status: created.status || 'pending_review',
          createdAt: created.createdAt || null,
        };

        setLearnerDocumentMap((current) => {
          const existing = current[learner.id] || [];
          return {
            ...current,
            [learner.id]: [createdRecord, ...existing.filter((item) => item.id !== createdRecord.id)],
          };
        });
      }

      setDocumentDebugMessage('Metadata saved. Refreshing learner files...');
      await loadLearnerDocuments(learner.id);
      setNotice(`${asset.name} was added as ${subject.name} evidence for ${learner.fullName}.`);
      setDocumentDebugMessage(`Upload successful: ${asset.name}`);
      console.log('[EPORTFOLIO_DEBUG] upload:success', JSON.stringify({ learnerId: learner.id, fileName: asset.name }));
    } catch (error) {
      const graphqlError = error as { errors?: Array<{ message?: string }>; message?: string } | undefined;
      const extractedMessage = graphqlError?.errors?.[0]?.message || graphqlError?.message || 'Could not upload the learner document.';
      setNotice(extractedMessage);
      setDocumentDebugMessage(`Upload failed: ${extractedMessage}`);
      logAwsError('pickAndUploadLearnerDocument', error, {
        learnerId: learner.id,
        classCode: learner.classCode || selectedClassCode,
        schoolCode: teacherContext.schoolCode,
        bucket: STORAGE_BUCKET,
      });
    } finally {
      setUploadingDocument(false);
    }
  };

  const confirmUploadForSubject = (learner: LearnerRecord, subject: { id: string; name: string }) => {
    Alert.alert(
      'Upload subject evidence',
      `This adds a document to ${learner.fullName}'s e-files for ${subject.name}. The document will appear under this subject in performance view.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose document', onPress: () => void pickAndUploadLearnerDocument(learner, subject) },
      ],
    );
  };

  const openVideoLinkForm = (subject: { id: string; name: string }) => {
    setVideoLinkSubject(subject);
    setVideoTitleInput(`${subject.name} video`);
    setVideoLinkInput('');
    setVideoLinkModalVisible(true);
  };

  const saveVideoLink = async () => {
    if (!teacherContext || !performanceLearner || !videoLinkSubject) return;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(videoLinkInput.trim());
    } catch {
      setNotice('Enter a valid video URL starting with https://.');
      return;
    }
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
      setNotice('Video links must use http:// or https://.');
      return;
    }

    try {
      setSavingVideoLink(true);
      const result = await client.graphql({
        query: createLearnerDocumentResource,
        variables: {
          input: {
            learnerId: performanceLearner.id,
            relatedSubjectId: videoLinkSubject.id,
            relatedSubjectName: videoLinkSubject.name,
            schoolCode: teacherContext.schoolCode,
            classCode: performanceLearner.classCode || selectedClassCode || null,
            uploadedByUserId: teacherContext.userId,
            uploadedByRole: 'teacher',
            resourceType: 'video',
            resourceCategory: 'e_portfolio',
            title: videoTitleInput.trim() || `${videoLinkSubject.name} video`,
            description: null,
            externalUrl: parsedUrl.toString(),
            isPublished: false,
            status: 'pending_review',
            metadata: JSON.stringify({ source: 'teacher_subject_video', resourceCategory: 'e_portfolio' }),
          },
        },
      });
      const created = (result as { data?: { createLearnerDocumentResource?: any } }).data?.createLearnerDocumentResource;
      if (created?.id) {
        const record: LearnerDocumentResourceRecord = {
          id: created.id,
          learnerId: created.learnerId,
          relatedSubjectId: created.relatedSubjectId || videoLinkSubject.id,
          relatedSubjectName: created.relatedSubjectName || videoLinkSubject.name,
          title: created.title,
          description: created.description || null,
          resourceType: 'video',
          resourceCategory: 'e_portfolio',
          fileKey: null,
          fileName: null,
          externalUrl: created.externalUrl || parsedUrl.toString(),
          fileType: null,
          fileSizeBytes: null,
          status: created.status || 'pending_review',
          createdAt: created.createdAt || new Date().toISOString(),
        };
        setLearnerDocumentMap((current) => ({
          ...current,
          [performanceLearner.id]: [record, ...(current[performanceLearner.id] || []).filter((item) => item.id !== record.id)],
        }));
      }
      setVideoLinkModalVisible(false);
      setNotice(`Video link saved under ${videoLinkSubject.name}.`);
    } catch (error) {
      const graphqlError = error as { errors?: Array<{ message?: string }>; message?: string } | undefined;
      const message = graphqlError?.errors?.[0]?.message || graphqlError?.message || 'Could not save this video link.';
      console.error('[EPORTFOLIO_DEBUG] save-video-link:failed', {
        learnerId: performanceLearner.id,
        subjectId: videoLinkSubject.id,
        message,
      });
      setNotice(message);
    } finally {
      setSavingVideoLink(false);
    }
  };

  const openLearnerDocument = async (resource: LearnerDocumentResourceRecord) => {
    const externalUrl = getLearnerResourceUrl(resource.externalUrl, resource.fileKey);
    const storedUrl = externalUrl?.toString() || resource.fileKey;
    console.log('[EPORTFOLIO_DEBUG] open:pressed', {
      resourceId: resource.id,
      linkSource: externalUrl ? (resource.externalUrl ? 'externalUrl' : 'fileKey') : null,
      hasFileKey: Boolean(resource.fileKey),
      platform: Platform.OS,
    });
    let openStage = 'prepare';
    let webWindow: Window | null = null;
    try {
      setOpeningDocumentId(resource.id);
      if (externalUrl) {
        openStage = 'open-external-url';
        const url = externalUrl;
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const openedWindow = window.open(url.toString(), '_blank');
          if (!openedWindow) {
            setNotice('Your browser blocked the new tab. Allow pop-ups for CarTra and try again.');
            return;
          }
          openedWindow.opener = null;
        } else {
          await Linking.openURL(url.toString());
        }
        console.log('[EPORTFOLIO_DEBUG] open:external-url', { resourceId: resource.id });
        return;
      }
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        webWindow = window.open('about:blank', '_blank');
        if (!webWindow) {
          setNotice('Your browser blocked the new tab. Allow pop-ups for CarTra and try again.');
          return;
        }
      }
      if (!resource.fileKey) throw new Error('This resource has no document file attached.');
      openStage = 'get-signed-url';
      console.log('[EPORTFOLIO_DEBUG] open:get-url:start', { resourceId: resource.id });
      const signed = await getUrl({
        path: resource.fileKey,
        options: {
          validateObjectExistence: true,
          expiresIn: 900,
        },
      });

      console.log('[EPORTFOLIO_DEBUG] open:get-url:success', { resourceId: resource.id });
      openStage = 'navigate-to-resource';
      if (webWindow) webWindow.location.replace(signed.url.toString());
      else await Linking.openURL(signed.url.toString());
      console.log('[EPORTFOLIO_DEBUG] open:success', { resourceId: resource.id });
    } catch (error) {
      webWindow?.close();
      const message = error instanceof Error ? error.message : 'Could not open the selected document.';
      const safeMessage = message.replace(/https?:\/\/[^\s'"]+/gi, '[URL redacted]');
      console.error('[EPORTFOLIO_DEBUG] open:failed', {
        resourceId: resource.id,
        stage: openStage,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        message: safeMessage,
      });
      setNotice(safeMessage);
    } finally {
      setOpeningDocumentId('');
    }
  };

  const openSubjectCategoryModal = async (learner: LearnerRecord) => {
    const originalGrade = String(learner.gradeLevel || '').replace(/\D/g, '');
    if (['9', '10'].includes(originalGrade)) {
      console.log('[TEACHER_GRADE_BOUNDARY] opening subject assignment', {
        learnerId: learner.id,
        profileGrade: learner.gradeLevel || null,
        effectiveAssignmentGrade: learner.gradeLevel || null,
        learnerClassCode: learner.classCode || null,
        selectedClassCode,
      });
    }

    setSelectedLearnerForSubjects(learner);
    setSelectedSubjectCandidate(null);
    setTargetMarksInput('');
    setSubjectGroups([]);
    setSubjectGroupsLoading(false);
    setSelectedSubjectCategory('');
    setSubjectSelectionStep('category');
    setCourseTargetMarkDrafts({});
    setSubjectAssignmentBlockReason('');
    setSubjectFilterQuery('');
    setSubjectModalVisible(true);
    if (Number(String(learner.gradeLevel || '').replace(/\D/g, '')) >= 10) {
      await syncSeniorCourseSubjects(learner);
    } else {
      await loadSelectedLearnerSubjects(learner.id);
    }
  };

  const syncSeniorCourseSubjects = async (learner: LearnerRecord) => {
    setSubjectGroupsLoading(true);
    try {
      const profileResult: any = await client.graphql({
        query: getLearnerProfile,
        variables: { id: learner.id },
      } as any);
      if (profileResult.errors?.length) {
        throw new Error(profileResult.errors.map((error: any) => error.message || 'Unknown GraphQL error').join('; '));
      }
      let learnerRecord = profileResult.data?.getLearnerProfile;
      if (!learnerRecord?.id) {
        const candidateFilters = [
          ...(learner.learnerId ? [{ learnerId: { eq: learner.learnerId } }] : []),
          ...(learner.assessmentNumber && teacherContext?.schoolCode && learner.classCode
            ? [{ and: [{ schoolCode: { eq: teacherContext.schoolCode } }, { classCode: { eq: learner.classCode } }, { assessmentNumber: { eq: learner.assessmentNumber } }] }]
            : []),
        ];
        for (const filter of candidateFilters) {
          const fallbackResult: any = await client.graphql({
            query: listLearnerProfiles,
            variables: { filter, limit: 20 },
          } as any);
          if (fallbackResult.errors?.length) {
            throw new Error(fallbackResult.errors.map((error: any) => error.message || 'Unknown GraphQL error').join('; '));
          }
          learnerRecord = fallbackResult.data?.listLearnerProfiles?.items?.find((item: any) =>
            item?.id && item?.schoolCode === teacherContext?.schoolCode && item?.assessmentNumber === learner.assessmentNumber,
          );
          if (learnerRecord?.id) break;
        }
      }
      if (!learnerRecord?.id) throw new Error('Learner profile could not be loaded.');

      const currentProfile = parseLearnerSupportProfile(learnerRecord.supportProfile) || {};
      const careerId = String(currentProfile.targetCareerId || currentProfile.selectedCareerId || learnerRecord.selectedCareerId || '');
      const careerName = String(currentProfile.targetCareer || currentProfile.targetCareerName || '').trim().toLowerCase();
      const selectedCareer = careerOptions.find((career) =>
        (careerId && career.id === careerId) || (careerName && career.courseName.trim().toLowerCase() === careerName),
      );
      const requirements = parseCourseClusterRequirements(selectedCareer?.clusterRequirements || currentProfile.clusterRequirements);
      const requiredItems = requirements?.subjectSequence || [];
      if (!hasCompleteCourseScoringData(requirements)) {
        const message = 'Subjects cannot be attached yet. This course is missing saved national CBE score ranges or the tertiary seven-best minimum. Ask the National Officer to save all eight ranges and the tertiary officer to complete the course scoring requirements.';
        setSubjectAssignmentBlockReason(message);
        setNotice(message);
        return;
      }
      if (requiredItems.length === 0) {
        const message = `${learner.fullName}'s selected course has no configured subject requirements. Ask the tertiary officer to complete the course setup before attaching subjects.`;
        setSubjectAssignmentBlockReason(message);
        setNotice(message);
        return;
      }

      const [coreResult, supportResult, electiveResult] = await Promise.all([
        client.graphql({ query: listCoreSubjects, variables: { limit: 500 } }),
        client.graphql({ query: listSupportSubjects, variables: { limit: 500 } }),
        client.graphql({ query: listSubjects, variables: { limit: 500 } }),
      ]);
      const catalog = [
        ...((coreResult as any).data?.listCoreSubjects?.items || []).map((item: any) => ({ ...item, category: 'Core subjects' })),
        ...((supportResult as any).data?.listSupportSubjects?.items || []).map((item: any) => ({ ...item, category: 'Support subjects' })),
        ...((electiveResult as any).data?.listSubjects?.items || []).map((item: any) => ({ ...item, category: 'Electives' })),
      ].filter((item: any, index: number, items: any[]) => item?.id && item?.name && items.findIndex((candidate) => candidate?.id === item.id) === index);
      const catalogById = new Map<string, any>(catalog.map((item: any) => [String(item.id), item]));
      const missingCourseSubjects = requiredItems.filter((requirement) => {
        const item = catalogById.get(String(requirement.subjectId));
        return !item?.id || !String(item.code || '').trim() || !String(item.name || '').trim();
      });
      if (missingCourseSubjects.length > 0) {
        const message = `Subjects cannot be attached because course subject details are missing from the National Catalog: ${missingCourseSubjects.map((item) => item.subjectName || item.subjectId).join(', ')}. Ask the National Officer to complete each subject's code and name.`;
        setSubjectAssignmentBlockReason(message);
        setNotice(message);
        return;
      }
      const existingSubjects = Array.isArray(currentProfile.selectedSubjects) ? currentProfile.selectedSubjects : [];
      const existingById = new Map<string, any>(existingSubjects.map((item: any) => [String(item?.id || ''), item]));
      const requiredSubjects = requiredItems
        .map((requirement) => {
          const subjectId = String(requirement.subjectId);
          const subject = catalogById.get(subjectId);
          const existing = existingById.get(subjectId);
          return {
            ...existing,
            id: subjectId,
            code: subject?.code || existing?.code || subjectId,
            name: subject?.name || existing?.name || requirement.subjectName || subjectId,
            category: subject?.category || existing?.category || 'Course requirements',
            learningAreaCode: subject?.learningAreaCode || existing?.learningAreaCode || null,
            courseRequirementMinimumPoints: requirement.minimumPoints ?? null,
            courseRequirementOperator: requirement.operator,
            targetMarks: existing?.targetMarks ?? null,
            marksScored: existing?.marksScored ?? null,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const requiredIds = new Set(requiredSubjects.map((item) => item.id));
      const additionalSubjects = existingSubjects.filter((item: any) => !requiredIds.has(String(item?.id || '')));
      const nextSubjects = [...requiredSubjects, ...additionalSubjects];
      const nextProfile = {
        ...currentProfile,
        targetCareer: currentProfile.targetCareer || selectedCareer?.courseName || null,
        targetCareerId: currentProfile.targetCareerId || selectedCareer?.id || learnerRecord.selectedCareerId || null,
        targetInstitutionId: currentProfile.targetInstitutionId || selectedCareer?.institutionId || null,
        targetInstitutionName: currentProfile.targetInstitutionName || selectedCareer?.institutionName || null,
        clusterRequirements: selectedCareer?.clusterRequirements || currentProfile.clusterRequirements || null,
        excludedCourseSubjectIds: [],
        selectedSubjects: nextSubjects,
      };

      await client.graphql({
        query: updateLearnerProfile,
        variables: { input: { id: learnerRecord.id, supportProfile: JSON.stringify(nextProfile) } },
      });
      setLearnerProfileMap((current) => ({ ...current, [learner.id]: nextProfile }));
      setLearnerSubjectsMap((current) => ({
        ...current,
        [learner.id]: nextSubjects.map((item: any) => ({
          id: String(item.id),
          name: String(item.name || item.code || 'Unnamed subject'),
          code: item.code || undefined,
          category: item.category || null,
          targetMarks: item.targetMarks ?? null,
          marksScored: item.marksScored ?? null,
        })),
      }));
      setCourseTargetMarkDrafts(Object.fromEntries(requiredSubjects.map((subject: any) => [
        String(subject.id), subject.targetMarks === null || subject.targetMarks === undefined ? '' : String(subject.targetMarks),
      ])));
      setNotice(`Course-required subjects for ${selectedCareer?.courseName || learner.fullName} are loaded. Enter target marks before adding other subjects.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load course-required learner subjects.';
      setSubjectAssignmentBlockReason(`Subjects cannot be attached because the course scoring and required subject data could not be verified. ${message}`);
      setNotice(message);
    } finally {
      setSubjectGroupsLoading(false);
    }
  };

  const saveSeniorCourseTargets = async (learner: LearnerRecord) => {
    const profile = learnerProfileMap[learner.id] || {};
    const supportProfile = parseLearnerSupportProfile(profile.supportProfile) || profile;
    const configuredRequirements = parseCourseClusterRequirements(supportProfile.clusterRequirements)?.subjectSequence || [];
    const learnerSubjects = Array.isArray(supportProfile.selectedSubjects) ? supportProfile.selectedSubjects : [];
    const requiredItems = configuredRequirements;
    const nextTargets = new Map<string, number>();

    for (const requirement of requiredItems) {
      const rawValue = String(courseTargetMarkDrafts[requirement.subjectId] || '').trim();
      const target = Number(rawValue);
      if (!rawValue || !Number.isFinite(target) || target < 0 || target > 100) {
        Alert.alert('Target marks required', 'Enter a target mark from 0 to 100 for each course-required subject before adding other subjects.');
        return;
      }
      nextTargets.set(requirement.subjectId, target);
    }

    if (nextTargets.size === 0) {
      setNotice('No course-required subjects are currently assigned to this learner.');
      return;
    }

    try {
      setSavingSubject(true);
      const learnerProfileId = String(profile.id || learner.id);
      const currentProfile = supportProfile;
      const existingSubjects = Array.isArray(currentProfile.selectedSubjects) ? currentProfile.selectedSubjects : learnerSubjects;
      const currentRequirements = parseCourseClusterRequirements(currentProfile.clusterRequirements)?.subjectSequence || configuredRequirements;
      const existingById = new Map<string, any>(existingSubjects.map((subject: any) => [String(subject?.id || subject?.code || ''), subject]));
      const requiredSubjects = currentRequirements.map((requirement) => {
        const subjectId = String(requirement.subjectId);
        const existing = existingById.get(subjectId);
        return {
          ...existing,
          id: subjectId,
          code: existing?.code || subjectId,
          name: existing?.name || requirement.subjectName || subjectId,
          category: existing?.category || 'Course requirements',
          learningAreaCode: existing?.learningAreaCode || null,
          courseRequirementMinimumPoints: requirement.minimumPoints ?? existing?.courseRequirementMinimumPoints ?? null,
          courseRequirementOperator: requirement.operator,
          targetMarks: nextTargets.get(subjectId),
          marksScored: existing?.marksScored ?? null,
        };
      });
      const savedRequiredIds = new Set(requiredSubjects.map((subject) => subject.id));
      const updatedSubjects = [
        ...requiredSubjects,
        ...existingSubjects.filter((subject: any) => !savedRequiredIds.has(String(subject?.id || subject?.code || ''))),
      ];
      const nextProfile = { ...currentProfile, excludedCourseSubjectIds: [], selectedSubjects: updatedSubjects };

      const updateResult = await client.graphql({
        query: updateLearnerProfile,
        variables: { input: { id: learnerProfileId, supportProfile: JSON.stringify(nextProfile) } },
      });
      const updatedRecord = (updateResult as any).data?.updateLearnerProfile;
      if (!updatedRecord?.id) throw new Error('The learner profile update was not confirmed by the server.');
      const confirmedProfile = parseLearnerSupportProfile(updatedRecord.supportProfile) || nextProfile;
      const confirmedSubjects = Array.isArray(confirmedProfile.selectedSubjects) ? confirmedProfile.selectedSubjects : updatedSubjects;
      const missingSavedTargets = requiredItems.filter((requirement) => {
        const subject = confirmedSubjects.find((item: any) => String(item?.id || item?.code || '') === requirement.subjectId);
        const target = Number(subject?.targetMarks);
        return subject?.targetMarks === null || subject?.targetMarks === undefined || !Number.isFinite(target) || target < 0 || target > 100;
      });
      if (missingSavedTargets.length > 0) throw new Error('The server response did not include every course-required target mark.');

      const factSyncFailures: Array<{ subject: string; stage: string; message: string }> = [];
      const syncLearner = {
        ...profile,
        ...learner,
        id: learnerProfileId,
        supportProfile: { ...confirmedProfile, selectedSubjects: confirmedSubjects },
      };
      for (const requirement of currentRequirements) {
        const subject = confirmedSubjects.find((item: any) => String(item?.id || item?.code || '') === String(requirement.subjectId));
        if (!subject) continue;
        let syncStage = 'preparing annual reporting fact';
        try {
          await syncLearnerSubjectPerformance(syncLearner, subject, { includeAchievedMark: false });
        } catch (syncError) {
          const subjectName = String(subject.name || subject.code || requirement.subjectId);
          const message = describeSyncError(syncError);
          const causeText = message.toLowerCase();
          syncStage = causeText.includes('annual cluster fact')
            ? 'annual cluster fact sync'
            : causeText.includes('annual fact lookup')
              ? 'annual fact lookup'
              : causeText.includes('annual fact create')
                ? 'annual fact create'
                : causeText.includes('annual fact update')
                  ? 'annual fact update'
                  : syncStage;
          factSyncFailures.push({ subject: subjectName, stage: syncStage, message });
          console.warn('[NATIONAL_TARGET_FACT_SYNC_FAILED]', { subject: subjectName, stage: syncStage, message, learnerId: learner.id, error: syncError });
        }
      }

      setLearnerProfileMap((current) => ({ ...current, [learner.id]: confirmedProfile }));
      setLearnerSubjectsMap((current) => ({
        ...current,
        [learner.id]: confirmedSubjects.map((subject: any) => ({
          id: String(subject.id),
          name: String(subject.name || subject.code || 'Unnamed subject'),
          code: subject.code || undefined,
          category: subject.category || null,
          targetMarks: subject.targetMarks ?? null,
          marksScored: subject.marksScored ?? null,
        })),
      }));
      const failedSubjects = factSyncFailures.map((failure) => failure.subject);
      const factSyncMessages = Array.from(new Set(factSyncFailures.map((failure) => `${failure.stage}: ${failure.message}`)));
      const factSyncNotice = factSyncFailures.length
        ? ` National reporting sync failed for ${failedSubjects.join(', ')}: ${factSyncMessages.join('; ')}. Save the targets again to retry.`
        : '';
      setNotice(`Course-required target marks saved. You can now add other subjects.${factSyncNotice}`);
      Alert.alert(
        factSyncFailures.length ? 'Targets saved; reporting sync incomplete' : 'Course targets saved',
        `The required subjects and target marks were saved. You can now add other subjects.${factSyncNotice}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save course-required target marks.';
      setNotice(message);
      Alert.alert('Course targets not saved', message);
    } finally {
      setSavingSubject(false);
    }
  };

  const getSeniorCourseTargetState = (learnerId: string) => {
    const profile = learnerProfileMap[learnerId] || {};
    const supportProfile = parseLearnerSupportProfile(profile.supportProfile) || profile;
    const configuredRequirements = parseCourseClusterRequirements(supportProfile.clusterRequirements)?.subjectSequence || [];
    const subjects = learnerSubjectsMap[learnerId] || [];
    const requiredSubjects = configuredRequirements.map((requirement) => ({
      requirement,
      subject: subjects.find((item) => item.id === requirement.subjectId),
    }));
    const targetsSaved = requiredSubjects.length === 0 || requiredSubjects.every(({ subject }) => {
      const target = Number(subject?.targetMarks);
      return subject?.targetMarks !== null && subject?.targetMarks !== undefined && Number.isFinite(target) && target >= 0 && target <= 100;
    });

    return { requirements: requiredSubjects, requiredSubjects, targetsSaved };
  };

  const loadCategorySubjects = async (
    category: 'Junior Secondary' | 'Senior Secondary' | 'Vocational SNE',
    learner: LearnerRecord | null = selectedLearnerForSubjects,
  ) => {
    if (!learner) {
      return;
    }

    setSubjectGroups([]);
    setSubjectGroupsLoading(true);

    try {
      if (category === 'Junior Secondary') {
        const result = await client.graphql({
          query: listJuniorSubjects,
          variables: { limit: 200 },
        });

        const payload = result as { data?: { listJuniorSubjects?: { items?: Array<any> } } };
        const items = (payload.data?.listJuniorSubjects?.items || [])
          .filter((item: any) => item?.id && item?.name)
          .map((item: any) => ({
            id: item.id,
            code: item.code || 'JNR',
            name: item.name,
            learningAreaCode: item.learningAreaCode,
            category: 'Junior Secondary',
          }));

        setSubjectGroups([{ title: 'Junior Secondary subjects', items }]);
        return;
      }

      if (category === 'Senior Secondary') {
        const [coreResult, supportResult, electiveResult] = await Promise.all([
          client.graphql({ query: listCoreSubjects, variables: { limit: 200 } }),
          client.graphql({ query: listSupportSubjects, variables: { limit: 200 } }),
          client.graphql({ query: listSubjects, variables: { limit: 200 } }),
        ]);

        const corePayload = coreResult as { data?: { listCoreSubjects?: { items?: Array<any> } } };
        const supportPayload = supportResult as { data?: { listSupportSubjects?: { items?: Array<any> } } };
        const electivesPayload = electiveResult as { data?: { listSubjects?: { items?: Array<any> } } };

        const coreItems = (corePayload.data?.listCoreSubjects?.items || [])
          .filter((item: any) => item?.id && item?.name)
          .map((item: any) => ({
            id: item.id,
            code: item.code || 'CORE',
            name: item.name,
            category: 'Core subjects',
          }));

        const supportItems = (supportPayload.data?.listSupportSubjects?.items || [])
          .filter((item: any) => item?.id && item?.name)
          .map((item: any) => ({
            id: item.id,
            code: item.code || 'SUPP',
            name: item.name,
            category: 'Support subjects',
          }));

        const electives = (electivesPayload.data?.listSubjects?.items || [])
          .filter((item: any) => item?.id && item?.name)
          .map((item: any) => ({
            id: item.id,
            code: item.code || 'ELEC',
            name: item.name,
            category: 'Electives',
          }));

        const organizedElectives = electives.filter((item) => item.name).length > 0 ? electives : [];

        const normalizedElectiveTitle = 'Electives';

        setSubjectGroups([
          { title: 'Core subjects', items: coreItems },
          { title: 'Support subjects', items: supportItems },
          { title: normalizedElectiveTitle, items: organizedElectives },
        ]);
        return;
      }

      const result = await client.graphql({
        query: listSNESubjects,
        variables: { limit: 200 },
      });

      const payload = result as { data?: { listSNESubjects?: { items?: Array<any> } } };
      const items = (payload.data?.listSNESubjects?.items || [])
        .filter((item: any) => item?.id && item?.name)
        .map((item: any) => ({
          id: item.id,
          code: item.code || 'SNE',
          name: item.name,
          learningAreaCode: item.learningAreaCode,
          category: 'Vocational SNE',
        }));

      setSubjectGroups([{ title: 'Vocational SNE subjects', items }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the subject catalog.';
      setNotice(message);
      setSubjectGroups([{ title: 'Unable to load subjects', items: [] }]);
    } finally {
      setSubjectGroupsLoading(false);
    }
  };

  const removeSubjectFromLearner = async (learnerId: string, subjectId: string) => {
    try {
      const learnerQuery = await client.graphql({
        query: listLearnerProfiles,
        variables: {
          filter: {
            id: { eq: learnerId },
          },
          limit: 20,
        },
      });

      const learnerPayload = learnerQuery as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const learnerRecord = learnerPayload.data?.listLearnerProfiles?.items?.[0];

      if (!learnerRecord?.id) {
        throw new Error('Learner record could not be found for removal.');
      }

      const currentProfile = (() => {
        if (!learnerRecord.supportProfile) return {};
        if (typeof learnerRecord.supportProfile === 'string') {
          try {
            return JSON.parse(learnerRecord.supportProfile);
          } catch {
            return {};
          }
        }
        return typeof learnerRecord.supportProfile === 'object' ? learnerRecord.supportProfile : {};
      })();

      const existingSubjects = Array.isArray(currentProfile.selectedSubjects) ? currentProfile.selectedSubjects : [];
      const nextSubjects = existingSubjects.filter((item: any) => String(item?.id || '') !== String(subjectId));
      const isCourseSubject = (parseCourseClusterRequirements(currentProfile.clusterRequirements)?.subjectSequence || [])
        .some((requirement) => String(requirement.subjectId) === String(subjectId));

      const updateResult: any = await client.graphql({
        query: updateLearnerProfile,
        variables: {
          input: {
            id: learnerRecord.id,
            supportProfile: JSON.stringify({
              ...currentProfile,
              selectedSubjects: nextSubjects,
              excludedCourseSubjectIds: [],
            }),
          },
        },
      });
      if (updateResult.errors?.length) {
        throw new Error(updateResult.errors.map((error: any) => error.message || 'Unknown GraphQL error').join('; '));
      }
      if (!updateResult.data?.updateLearnerProfile?.id) {
        throw new Error('The learner profile update was not confirmed by the server.');
      }

      if (isCourseSubject) {
        setCourseTargetMarkDrafts((current) => ({ ...current, [subjectId]: '' }));
      }
      await loadSelectedLearnerSubjects(learnerId);
      setNotice('Subject removed from learner.');
    } catch (error) {
      const graphqlError = error as { errors?: Array<{ message?: string }>; message?: string } | undefined;
      const extractedMessage = graphqlError?.errors?.[0]?.message || graphqlError?.message || 'Could not remove the subject from the learner.';
      setNotice(extractedMessage);
    }
  };

  const addSubjectToLearner = async (subject: SubjectCatalogItem, targetMarks?: string) => {
    if (!selectedLearnerForSubjects) {
      setNotice('No learner was selected for subject assignment.');
      return;
    }

    const gradeNumber = Number(String(selectedLearnerForSubjects.gradeLevel || '').replace(/\D/g, '')) || 0;
    if (!String(subject.id || '').trim() || !String(subject.code || '').trim() || !String(subject.name || '').trim()) {
      Alert.alert('Subject details missing', 'This subject is missing its catalog ID, code, or name. Ask the National Officer to complete the subject record before attaching it.');
      return;
    }
    const targetValue = String(targetMarks || '').trim();
    const parsedTarget = Number(targetValue);
    if (!targetValue || !Number.isFinite(parsedTarget) || parsedTarget < 0 || parsedTarget > 100) {
      Alert.alert('Target marks required', 'Enter a target mark from 0 to 100 before attaching this subject.');
      return;
    }

    setSavingSubject(true);

    try {
      const learnerQuery = await client.graphql({
        query: listLearnerProfiles,
        variables: {
          filter: {
            id: { eq: selectedLearnerForSubjects.id },
          },
          limit: 20,
        },
      });

      const learnerPayload = learnerQuery as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const learnerRecord = learnerPayload.data?.listLearnerProfiles?.items?.[0];

      if (!learnerRecord?.id) {
        throw new Error('Learner record could not be found for subject assignment.');
      }

      const currentProfile = (() => {
        if (!learnerRecord.supportProfile) {
          return {};
        }

        if (typeof learnerRecord.supportProfile === 'string') {
          try {
            return JSON.parse(learnerRecord.supportProfile);
          } catch {
            return {};
          }
        }

        return typeof learnerRecord.supportProfile === 'object' ? learnerRecord.supportProfile : {};
      })();

      const existingSubjects = Array.isArray((currentProfile as any).selectedSubjects)
        ? (currentProfile as any).selectedSubjects
        : [];

      if (gradeNumber >= 10) {
        const courseRequirements = parseCourseClusterRequirements(currentProfile.clusterRequirements);
        if (!hasCompleteCourseScoringData(courseRequirements)) {
          const message = 'This learner cannot receive attached subjects yet. The selected course is missing saved national CBE score ranges, the tertiary seven-best minimum, or complete cluster requirements. Complete those records first.';
          setSubjectAssignmentBlockReason(message);
          Alert.alert('Course scoring data missing', message);
          return;
        }
        const requiredIds = new Set((courseRequirements?.subjectSequence || []).map((item) => item.subjectId));
        if (requiredIds.has(String(subject.id))) {
          Alert.alert('Course-required subject', `${subject.name} is managed in the learner's course-required target list.`);
          return;
        }
      }

      const alreadyExists = existingSubjects.some((item: any) => {
        const currentId = String(item?.id || '').trim();
        const incomingId = String(subject.id || '').trim();
        const currentName = String(item?.name || '').trim().toLowerCase();
        const incomingName = String(subject.name || '').trim().toLowerCase();
        return currentId === incomingId || currentName === incomingName;
      });

      if (alreadyExists) {
        Alert.alert(
          'Subject already assigned',
          `${subject.name} is already assigned to ${selectedLearnerForSubjects.fullName}.`,
          [
            {
              text: 'OK',
              onPress: () => {
                setSubjectModalVisible(false);
                setSelectedLearnerForSubjects(null);
                setSelectedSubjectCandidate(null);
                setSelectedSubjectCategory('');
                setSubjectGroups([]);
                setTargetMarksInput('');
              },
            },
          ],
        );
        return;
      }

      const normalizedSubject = {
        id: subject.id,
        code: subject.code,
        name: subject.name,
        category: subject.category || selectedSubjectCategory || null,
        learningAreaCode: subject.learningAreaCode || null,
        targetMarks: parsedTarget,
        marksScored: null,
      };

      const nextSubjects = [...existingSubjects, normalizedSubject];

      const supportProfilePayload = {
        ...currentProfile,
        excludedCourseSubjectIds: [],
        selectedSubjects: nextSubjects,
      };

      const jsonSafeSupportProfile = JSON.stringify(supportProfilePayload);
      console.log('supportProfile payload for subject update:', jsonSafeSupportProfile);

      await client.graphql({
        query: updateLearnerProfile,
        variables: {
          input: {
            id: learnerRecord.id,
            supportProfile: jsonSafeSupportProfile,
          },
        },
      });

      setNotice(`${subject.name} was added to ${selectedLearnerForSubjects.fullName}.`);
      if (selectedLearnerForSubjects?.id) {
        await loadSelectedLearnerSubjects(selectedLearnerForSubjects.id);
      }
      if (Number(String(selectedLearnerForSubjects.gradeLevel || learnerRecord.gradeLevel || '').replace(/\D/g, '')) >= 10) {
        setSelectedSubjectCandidate(null);
        setSelectedSubjectCategory('');
        setSubjectSelectionStep('category');
        setTargetMarksInput('');
      } else {
        setSubjectModalVisible(false);
        setSelectedLearnerForSubjects(null);
        setSelectedSubjectCandidate(null);
        setSelectedSubjectCategory('');
        setSubjectGroups([]);
        setTargetMarksInput('');
      }
    } catch (error) {
      const graphqlError = error as { errors?: Array<{ message?: string }>; message?: string } | undefined;
      const extractedMessage = graphqlError?.errors?.[0]?.message || graphqlError?.message || 'Could not assign the subject to the learner.';
      console.error('Subject assignment failed:', error);
      setNotice(extractedMessage);
    } finally {
      setSavingSubject(false);
    }
  };

  const calculateLearnerClusterPoints = (learner: LearnerRecord, clusterRequirements?: unknown): number | null => {
    if (!hasCompleteCourseScoringData(clusterRequirements)) return null;
    const subjects = learnerSubjectsMap[learner.id] || [];
    const attempted = subjects
      .filter((subject) => typeof subject.marksScored === 'number' && !Number.isNaN(subject.marksScored))
      .map((subject) => ({
        ...subject,
        marksScored: Number(subject.marksScored || 0),
      }));

    const grade = Number(String(learner.gradeLevel || '').replace(/\D/g, '')) || 0;
    if (grade < 10 || attempted.length === 0) {
      return null;
    }

    return calculateCourseClusterPoints(attempted, clusterRequirements);
  };

  const syncGrade12ResultSummaryForLearner = async (learnerRecord: any) => {
    try {
      const gradeNumber = Number(String(learnerRecord?.gradeLevel || '').replace(/\D/g, '')) || 0;
      if (gradeNumber !== 12) {
        return;
      }

      const supportProfile = (() => {
        if (!learnerRecord?.supportProfile) return {};
        if (typeof learnerRecord.supportProfile === 'string') {
          try {
            return JSON.parse(learnerRecord.supportProfile);
          } catch {
            return {};
          }
        }
        return typeof learnerRecord.supportProfile === 'object' ? learnerRecord.supportProfile : {};
      })();

      const selectedCareerId = supportProfile?.targetCareerId || learnerRecord?.selectedCareerId || supportProfile?.selectedCareerId || null;
      const targetCareerName = typeof supportProfile?.targetCareer === 'string' ? supportProfile.targetCareer.trim() : null;
      const institutionId = supportProfile?.targetInstitutionId || supportProfile?.institutionId || null;
      const institutionName = typeof supportProfile?.targetInstitutionName === 'string' ? supportProfile.targetInstitutionName.trim() : null;
      const selectedCareer = careerOptions.find((career) => career.id === selectedCareerId || career.courseName === targetCareerName);
      const selectedRequirements = selectedCareer?.clusterRequirements || supportProfile?.clusterRequirements;
      const hasSubjectRequirements = hasCompleteCourseScoringData(selectedRequirements);
      const subjectPointsStatus = evaluateCourseSubjectPointRequirements(
        learnerSubjectsMap[learnerRecord.id] || [],
        selectedRequirements,
      );
      const nextCbeClusterPoints = calculateLearnerClusterPoints({
        id: learnerRecord.id,
        learnerId: learnerRecord.learnerId || learnerRecord.id,
        fullName: learnerRecord.fullName || 'Learner',
        assessmentNumber: learnerRecord.assessmentNumber || '',
        gradeLevel: learnerRecord.gradeLevel || '12',
        classCode: learnerRecord.classCode || '',
        status: learnerRecord.status || 'active',
      }, selectedRequirements);
      const hasCourseRequirement = hasSubjectRequirements && subjectPointsStatus !== null;
      const wasTargetCareerReached = hasCourseRequirement ? subjectPointsStatus : null;
      const aggregateGap = null;
      const resultStatus = hasCourseRequirement ? (wasTargetCareerReached ? 'met_target' : 'below_target') : 'not_assessed';
      const placementStatus = hasCourseRequirement ? (wasTargetCareerReached ? 'eligible' : 'pending') : 'not_configured';

      const summaryInput = {
        learnerId: learnerRecord.id,
        schoolCode: learnerRecord.schoolCode,
        countyCode: learnerRecord.countyCode || null,
        regionCode: learnerRecord.regionCode || null,
        nationCode: learnerRecord.nationCode || '',
        academicYear: ACADEMIC_YEAR,
        gradeLevel: String(learnerRecord.gradeLevel || '12'),
        targetCareerId: selectedCareerId,
        targetCareerName: targetCareerName || null,
        pathwayId: supportProfile?.pathwayId || null,
        pathwayName: supportProfile?.pathwayName || null,
        finalAggregatePoints: nextCbeClusterPoints,
        requiredAggregatePoints: null,
        aggregateGap,
        resultStatus,
        wasTargetCareerReached,
        placementStatus,
        institutionId,
        institutionName,
        courseId: selectedCareerId,
        courseName: targetCareerName || null,
        recordedByUserId: teacherContext?.userId || teacherContext?.id || learnerRecord.createdByTeacherId || learnerRecord.id,
        recordedAt: new Date().toISOString(),
        status: 'active',
      };

      const existingQuery = await client.graphql({
        query: listGrade12ResultSummaries,
        variables: {
          filter: {
            and: [
              { learnerId: { eq: learnerRecord.id } },
              { academicYear: { eq: ACADEMIC_YEAR } },
            ],
          },
          limit: 20,
        },
      });

      const existingPayload = existingQuery as { data?: { listGrade12ResultSummaries?: { items?: Array<any> } } };
      const existingSummary = existingPayload.data?.listGrade12ResultSummaries?.items?.[0];

      if (existingSummary?.id) {
        await client.graphql({
          query: updateGrade12ResultSummary,
          variables: {
            input: {
              id: existingSummary.id,
              ...summaryInput,
            },
          },
        });
        return;
      }

      await client.graphql({
        query: createGrade12ResultSummary,
        variables: {
          input: summaryInput,
        },
      });
    } catch (error) {
      console.warn('[GRADE12_RESULT_SUMMARY_SYNC_FAILED]', error);
    }
  };

  const syncLearnerSubjectPerformance = async (
    learner: any,
    subject: any,
    options: { includeAchievedMark?: boolean } = {},
  ) => {
    const gradeLevel = Number(String(learner?.gradeLevel || '').replace(/\D/g, ''));
    const learnerId = String(learner?.id || '').trim();
    const subjectId = String(subject?.id || subject?.code || '').trim();
    if (!learnerId || !subjectId || !Number.isInteger(gradeLevel) || gradeLevel < 1) return;

    const schoolCode = String(learner?.schoolCode || teacherContext?.schoolCode || '').trim();
    const learnerClassCode = String(learner?.classCode || selectedClassCode || '').trim();
    const academicYear = String(learner?.academicYear || assignedClasses.find((classItem) => classItem.classCode === learnerClassCode)?.academicYear || new Date().getFullYear()).trim();
    if (!schoolCode || !academicYear) throw new Error('The learner school and class academic year must be configured before reporting sync.');

    const termOrCycle = 'EndOfYear';
    const id = `${learnerId}#${gradeLevel}#${subjectId}#${academicYear}#EOY`;
    const profile = parseLearnerSupportProfile(learner?.supportProfile) || {};
    const achievedMark = subject?.marksScored === null || subject?.marksScored === undefined || subject?.marksScored === ''
      ? null
      : Number(subject.marksScored);
    const input: Record<string, any> = {
      id,
      learnerId,
      subjectId,
      subjectName: String(subject?.name || subject?.code || subjectId),
      gradeLevel,
      academicYear,
      termOrCycle,
      nationCode: learner.nationCode || teacherContext?.nationCode,
      regionCode: learner.regionCode || teacherContext?.regionCode,
      countyCode: learner.countyCode || teacherContext?.countyCode,
      subCountyCode: learner.subCountyCode || teacherContext?.subCountyCode,
      schoolCode,
      targetMark: subject?.targetMarks !== null &&
        subject?.targetMarks !== undefined &&
        subject?.targetMarks !== '' &&
        Number.isFinite(Number(subject.targetMarks))
        ? Number(subject.targetMarks)
        : null,
      targetCareerId: learner.selectedCareerId || profile.targetCareerId || profile.selectedCareerId || null,
      courseRequirementsSnapshot: profile.clusterRequirements ? JSON.stringify(profile.clusterRequirements) : null,
      nationGradeKey: `${String(learner.nationCode || teacherContext?.nationCode || '').trim().toUpperCase()}#${gradeLevel}`,
    };
    if (options.includeAchievedMark !== false) {
      input.achievedMark = achievedMark !== null && Number.isFinite(achievedMark) && achievedMark >= 0
        ? achievedMark
        : null;
    }

    const upsertFact = async (factInput: Record<string, any>) => {
      let existingResult: any;
      try {
        existingResult = await client.graphql({
          query: getLearnerSubjectPerformance,
          variables: { id: factInput.id },
        } as any);
      } catch (error) {
        throw new Error(`Annual fact lookup failed: ${describeSyncError(error)}`);
      }
      if (existingResult.errors?.length) {
        throw new Error(`Annual fact lookup failed: ${describeSyncError({ errors: existingResult.errors })}`);
      }

      const existingFact = existingResult.data?.getLearnerSubjectPerformance;
      let mutationResult: any;
      const mutationName = existingFact ? 'update' : 'create';
      try {
        mutationResult = await client.graphql({
          query: existingFact ? updateLearnerSubjectPerformance : createLearnerSubjectPerformance,
          variables: { input: factInput },
        } as any);
      } catch (error) {
        throw new Error(`Annual fact ${mutationName} failed: ${describeSyncError(error)}`);
      }
      if (mutationResult.errors?.length) {
        throw new Error(`Annual fact ${mutationName} failed: ${describeSyncError({ errors: mutationResult.errors })}`);
      }
      const savedFact = existingFact
        ? mutationResult.data?.updateLearnerSubjectPerformance
        : mutationResult.data?.createLearnerSubjectPerformance;
      if (!savedFact?.id) {
        throw new Error(`Annual fact ${mutationName} returned no saved record for ${factInput.subjectName || factInput.id}.`);
      }
    };

    await upsertFact(input);

    if (gradeLevel < 10) return;
    const selectedSubjects = filterSupportSubjects(
      Array.isArray(profile.selectedSubjects) ? profile.selectedSubjects : [],
      await loadSupportSubjectIds(),
    );
    const requirements = parseCourseClusterRequirements(profile.clusterRequirements);
    const achievedSubjects = selectedSubjects
      .filter((item: any) => item?.marksScored !== null && item?.marksScored !== undefined && Number.isFinite(Number(item.marksScored)))
      .map((item: any) => ({ id: String(item.id || item.code), marksScored: Number(item.marksScored) }));
    const targetSubjects = selectedSubjects
      .filter((item: any) => item?.targetMarks !== null && item?.targetMarks !== undefined && Number.isFinite(Number(item.targetMarks)))
      .map((item: any) => ({ id: String(item.id || item.code), marksScored: Number(item.targetMarks) }));
    const achievedCluster = calculateCourseClusterScoreDetails(achievedSubjects, requirements);
    const targetCluster = calculateCourseClusterScoreDetails(targetSubjects, requirements);
    const tertiaryBenchmark = calculateTertiaryCourseClusterBenchmarkPoints(requirements);

    try {
      const clusterFact: Record<string, any> = {
        ...input,
        id: `${learnerId}#${gradeLevel}#__ANNUAL_CLUSTER__#${academicYear}#EOY`,
        subjectId: '__ANNUAL_CLUSTER__',
        subjectName: 'Annual course cluster',
        targetMark: targetCluster?.points ?? null,
        tertiaryBenchmark: tertiaryBenchmark ?? null,
        courseRequirementsSnapshot: requirements ? JSON.stringify(requirements) : null,
      };
      if (options.includeAchievedMark !== false) {
        clusterFact.achievedMark = achievedCluster?.points ?? null;
      }
      await upsertFact(clusterFact);
    } catch (error) {
      throw new Error(`Annual cluster fact sync failed: ${describeSyncError(error)}`);
    }
  };

  const updateSubjectPerformance = async (learnerId: string, subjectId: string, marksScored: number) => {
    try {
      setSavingPerformance(true);
      setSavingSubjectMap((m) => ({ ...m, [subjectId]: true }));

      const learnerQuery = await client.graphql({
        query: listLearnerProfiles,
        variables: { filter: { id: { eq: learnerId } }, limit: 20 },
      });

      const learnerPayload = learnerQuery as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const learnerRecord = learnerPayload.data?.listLearnerProfiles?.items?.[0];

      if (!learnerRecord?.id) {
        throw new Error('Learner record could not be found for performance update.');
      }

      const currentProfile = (() => {
        if (!learnerRecord.supportProfile) return {};
        if (typeof learnerRecord.supportProfile === 'string') {
          try {
            return JSON.parse(learnerRecord.supportProfile);
          } catch {
            return {};
          }
        }
        return typeof learnerRecord.supportProfile === 'object' ? learnerRecord.supportProfile : {};
      })();

      const existingSubjects = Array.isArray(currentProfile.selectedSubjects) ? currentProfile.selectedSubjects : [];
      const currentGrade = Number(String(learnerRecord.gradeLevel || '').replace(/\D/g, '')) || 7;
      const updatedSubjects = existingSubjects.map((item: any) => {
        if (String(item?.id || '').trim() !== String(subjectId || '').trim()) {
          return item;
        }

        const nextSubject = {
          ...item,
          marksScored: Number.isFinite(marksScored) ? marksScored : 0,
        };

        const history = Array.isArray(item?.history) ? item.history.slice() : [];
        const entry = {
          label: String(currentGrade),
          value: Number.isFinite(marksScored) ? Number(marksScored) : 0,
          achievedRecorded: true,
          target: Number.isFinite(Number(item?.targetMarks)) && Number(item.targetMarks) > 0 ? Number(item.targetMarks) : undefined,
        };
        const existingIndex = history.findIndex((entryItem: any) => String(entryItem?.label) === String(currentGrade));
        if (existingIndex >= 0) {
          history[existingIndex] = entry;
        } else {
          history.push(entry);
        }

        return {
          ...nextSubject,
          history,
        };
      });

      await client.graphql({
        query: updateLearnerProfile,
        variables: {
          input: {
            id: learnerRecord.id,
            supportProfile: JSON.stringify({ ...currentProfile, selectedSubjects: updatedSubjects }),
          },
        },
      });

      let reportingSyncFailed = false;
      try {
        const updatedSubject = updatedSubjects.find((item: any) => String(item?.id || '') === String(subjectId));
        await syncLearnerSubjectPerformance({ ...learnerRecord, supportProfile: { ...currentProfile, selectedSubjects: updatedSubjects } }, updatedSubject);
      } catch (syncError) {
        reportingSyncFailed = true;
        console.warn('[NATIONAL_PERFORMANCE_FACT_SYNC_FAILED]', syncError);
      }

      await loadSelectedLearnerSubjects(learnerId);
      setNotice(reportingSyncFailed
        ? 'Performance saved to the learner profile, but the national reporting record could not be synchronized. Save the mark again to retry.'
        : `Performance updated for ${selectedPerformanceSubject?.name || 'the selected subject'}.`);
      // keep the teacher in the subject-update view; update the draft value for the subject
      setSubjectPerformanceDrafts((current) => ({ ...current, [subjectId]: String(marksScored) }));
      setPerformanceMarksInput('');
      const subjectName = (learnerSubjectsMap[learnerId] || []).find((s) => s.id === subjectId)?.name || 'the subject';
      Alert.alert('Performance updated', `${subjectName} updated to ${marksScored}.`);
    } catch (error) {
      const graphqlError = error as { errors?: Array<{ message?: string }>; message?: string } | undefined;
      const extractedMessage = graphqlError?.errors?.[0]?.message || graphqlError?.message || 'Could not update the learner performance.';
      Alert.alert('Performance update failed', extractedMessage);
    } finally {
      setSavingPerformance(false);
      setSavingSubjectMap((m) => ({ ...m, [subjectId]: false }));
    }
  };

  const saveRubricForLearner = async (learner: LearnerRecord) => {
    if (!teacherContext || !learner.id) {
      Alert.alert('Rubric not saved', 'Teacher or learner context is missing.');
      return;
    }

    if (!rubricTitle.trim()) {
      Alert.alert('Rubric title required', 'Please enter a rubric title before saving.');
      return;
    }

    try {
      setSavingRubric(true);

      const criteria = rubricCriteriaText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 12);

      const rubricConfig = {
        title: rubricTitle.trim(),
        description: rubricDescription.trim() || 'Teacher-authored learner rubric',
        criteria,
        columns: ['Emerging', 'Developing', 'Proficient', 'Exemplary'],
        createdBy: teacherContext.fullName,
      };

      await client.graphql({
        query: createAssessmentRubric,
        variables: {
          input: {
            learnerId: learner.id,
            teacherId: teacherContext.id,
            schoolCode: teacherContext.schoolCode,
            classCode: learner.classCode || selectedClassCode,
            rubricType: 'learner_rubric',
            title: rubricTitle.trim(),
            description: rubricDescription.trim() || 'Teacher-authored learner rubric',
            academicYear: ACADEMIC_YEAR,
            termOrCycle: 'Term 1',
            status: 'active',
            rubricConfigJson: JSON.stringify(rubricConfig),
          },
        },
      });

      setRubricTitle('');
      setRubricDescription('');
      setRubricCriteriaText('');
      setPerformanceAction('menu');
      setNotice(`Rubric saved for ${learner.fullName}.`);
      Alert.alert('Rubric saved', `The rubric for ${learner.fullName} was created successfully.`);
    } catch (error) {
      const graphqlError = error as { errors?: Array<{ message?: string }>; message?: string } | undefined;
      const extractedMessage = graphqlError?.errors?.[0]?.message || graphqlError?.message || 'Could not save the learner rubric.';
      Alert.alert('Rubric save failed', extractedMessage);
    } finally {
      setSavingRubric(false);
    }
  };

  const saveCalculatedClusterPoints = async (learner: LearnerRecord) => {
    try {
      setCalculatingClusterPoints(true);

      const subjects = learnerSubjectsMap[learner.id] || [];
      const attempted = subjects.filter((subject) => typeof subject.marksScored === 'number' && !Number.isNaN(subject.marksScored));

      if (attempted.length === 0) {
        Alert.alert('No marks available', 'Add at least one subject mark before calculating cluster points.');
        return;
      }

      const learnerQuery = await client.graphql({
        query: listLearnerProfiles,
        variables: { filter: { id: { eq: learner.id } }, limit: 20 },
      });

      const learnerPayload = learnerQuery as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
      const learnerRecord = learnerPayload.data?.listLearnerProfiles?.items?.[0];

      if (!learnerRecord?.id) {
        throw new Error('Learner record could not be found for cluster point calculation.');
      }

      const currentProfile = (() => {
        if (!learnerRecord.supportProfile) return {};
        if (typeof learnerRecord.supportProfile === 'string') {
          try {
            return JSON.parse(learnerRecord.supportProfile);
          } catch {
            return {};
          }
        }
        return typeof learnerRecord.supportProfile === 'object' ? learnerRecord.supportProfile : {};
      })();

      const selectedCareer = careerOptions.find((career) => {
        const targetCareerId = currentProfile?.targetCareerId || currentProfile?.selectedCareerId;
        return career.id === targetCareerId || career.courseName === currentProfile?.targetCareer;
      });
      const requirements = selectedCareer?.clusterRequirements || currentProfile?.clusterRequirements;
      if (!hasCompleteCourseScoringData(requirements)) {
        Alert.alert('Course scoring data missing', 'This course needs complete cluster subject minima, the tertiary seven-best minimum, and valid saved national CBE mark ranges before a cluster score can be calculated.');
        return;
      }
      const nextClusterPoints = calculateLearnerClusterPoints(learner, requirements);
      if (nextClusterPoints === null) {
        Alert.alert('Cluster score unavailable', 'Marks are still missing for one or more required course subject groups. No score was saved.');
        return;
      }

      const gradeNumber = Number(String(learnerRecord.gradeLevel || '').replace(/\D/g, '')) || 0;
      if (gradeNumber === 12) {
        await syncGrade12ResultSummaryForLearner({
          ...learnerRecord,
          supportProfile: JSON.stringify(currentProfile),
        });
      }

      await loadSelectedLearnerSubjects(learner.id);
      setLearnerClusterPointsMap((current) => ({ ...current, [learner.id]: nextClusterPoints }));
      setNotice(`Cluster points for ${learner.fullName} were updated to ${nextClusterPoints}.`);
      Alert.alert('Cluster points updated', `Cluster points for ${learner.fullName} are now ${nextClusterPoints}.`);
      setPerformanceAction(null);
      setPerformanceLearner(null);
    } catch (error) {
      const graphqlError = error as { errors?: Array<{ message?: string }>; message?: string } | undefined;
      const extractedMessage = graphqlError?.errors?.[0]?.message || graphqlError?.message || 'Could not calculate the learner cluster points.';
      Alert.alert('Cluster point update failed', extractedMessage);
    } finally {
      setCalculatingClusterPoints(false);
    }
  };

  const GRADE_AXIS = [7, 8, 9, 10, 11, 12] as const;

  const getHistoricalClusterSeries = (learner: LearnerRecord) => {
    const currentSubjects = learnerSubjectsMap[learner.id] || [];
    const supportProfile = learnerProfileMap[learner.id] || { selectedSubjects: currentSubjects, historicalSelectedSubjects: [] };
    const series = calculateHistoricalClusterSeries(
      learner,
      {
        ...supportProfile,
        selectedSubjects: Array.isArray(supportProfile?.selectedSubjects) ? supportProfile.selectedSubjects : currentSubjects,
        historicalSelectedSubjects: Array.isArray(supportProfile?.historicalSelectedSubjects) ? supportProfile.historicalSelectedSubjects : [],
      },
      currentSubjects,
    );
    try {
      const numericValues = series.map((s: any) => (Number.isFinite(Number(s.value)) ? Number(s.value) : NaN)).filter(Number.isFinite);
      const domain = { min: numericValues.length ? Math.min(...numericValues) : NaN, max: numericValues.length ? Math.max(...numericValues) : NaN };
      console.log('[DEBUG_CLUSTER_SERIES]', JSON.stringify({
        learnerId: learner.id,
        learnerFullName: learner.fullName,
        currentGrade: learner.gradeLevel,
        activeGraphLearnerId,
        supportProfileKeys: Object.keys(supportProfile || {}),
        historicalSelectedSubjects: Array.isArray(supportProfile?.historicalSelectedSubjects) ? supportProfile.historicalSelectedSubjects.map((subject: any) => ({ name: subject?.name, history: Array.isArray(subject?.history) ? subject.history : [] })) : [],
        currentSubjects: currentSubjects.map((subject: any) => ({ name: subject?.name, history: Array.isArray((subject as any)?.history) ? (subject as any).history : [] })),
        series,
        domain,
      }, null, 2));
    } catch (err) {
      console.log('[DEBUG_CLUSTER_SERIES]', JSON.stringify({ learnerId: learner.id, learnerFullName: learner.fullName, activeGraphLearnerId, series }, null, 2));
    }

    return series;
  };

  const beginPerformanceAction = (learner: LearnerRecord, action: 'view' | 'update') => {
    const title = action === 'view' ? 'View learner performance' : 'Update learner performance';
    console.log('[TEACHER_ACTION_DEBUG]', {
      event: 'performance action confirmed',
      action,
      learnerId: learner.id,
      learnerName: learner.fullName,
      platform: Platform.OS,
    });
    setPendingLearnerConfirmation(null);
    setPerformanceSessionId((current) => current + 1);
    setPerformanceAction(null);
    setPerformanceLearner(null);
    setActiveGraphLearnerId(learner.id);
    setSelectedPerformanceSubject(null);
    setPerformanceMarksInput('');
    setLearnerDocumentMap({});
    setLearnerGuidanceMap({});
    setPerformanceLearner(learner);
    setPerformanceAction(action === 'view' ? 'viewMenu' : 'menu');
    setNotice(`${title} for ${learner.fullName} is ready to ${action === 'view' ? 'view' : 'update'}.`);
  };

  const promptLearnerAction = (learner: LearnerRecord, action: 'view' | 'update' | 'addSubject' | 'promote' | 'updateCareerTarget') => {
    console.log('[TEACHER_ACTION_DEBUG]', {
      event: 'learner action pressed',
      action,
      learnerId: learner.id,
      learnerName: learner.fullName,
      grade: learner.gradeLevel,
      platform: Platform.OS,
    });
    if (action === 'promote') {
      const currentGrade = Number(String(learner.gradeLevel || '').replace(/\D/g, '')) || 7;
      setPromotionLearner(learner);
      setPromotionGradeInput(String(Math.min(12, currentGrade + 1)));
      setCareerTargetModalVisible(false);
      setCareerTargetLearner(null);
      setCareerTargetInput('');
      setPromotionModalVisible(true);
      return;
    }

    if (action === 'updateCareerTarget') {
      const gradeNumber = Number(String(learner.gradeLevel || '').replace(/\D/g, '')) || 0;
      if (gradeNumber < 7 || gradeNumber > 9) {
        Alert.alert(
          'Career locked',
          `Career targets can only be changed for learners in Grades 7, 8, and 9. This learner is in Grade ${learner.gradeLevel || 'Not set'}, so changes are not allowed.`,
        );
        return;
      }

      setCareerTargetLearner(learner);
      const currentCareer = learnerCareerMap[learner.id] || '';
      setCareerTargetInput(currentCareer);
      setPromotionModalVisible(false);
      setPromotionLearner(null);
      setPromotionGradeInput('');
      setCareerTargetModalVisible(true);
      return;
    }
    const actionMap = {
      view: {
        title: 'View learner performance',
        message: `This opens the learner performance view for ${learner.fullName}.`,
        confirmText: 'Open',
      },
      update: {
        title: 'Update learner performance',
        message: `This opens the performance update flow for ${learner.fullName}.`,
        confirmText: 'Proceed',
      },
      addSubject: {
        title: 'Add learner subject',
        message: `This lets you add a subject to ${learner.fullName}.`,
        confirmText: 'Proceed',
      },
    } as const;

    const config = actionMap[action];

    if (action === 'addSubject') {
      setSubjectIntroLearner(learner);
      setSubjectIntroVisible(true);
      return;
    }

    if (action === 'view' || action === 'update') {
      if (Platform.OS === 'web') {
        setPendingLearnerConfirmation({ learner, action });
        return;
      }

      const title = action === 'view' ? 'View learner performance' : 'Update learner performance';
      const message = action === 'view'
        ? `This opens the learner performance view for ${learner.fullName}.`
        : `This opens the performance update flow for ${learner.fullName}.`;
      const confirmText = action === 'view' ? 'Open' : 'Proceed';
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: confirmText,
          onPress: () => beginPerformanceAction(learner, action),
        },
      ]);
      return;
    }

    Alert.alert(config.title, config.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: config.confirmText,
        onPress: () => {
          setNotice(`${config.title} for ${learner.fullName} is ready to open.`);
        },
      },
    ]);
  };

  const handleCreateLearner = async () => {
    if (!teacherContext || !selectedClassCode) {
      setNotice('Please select a class before adding a learner.');
      return;
    }

    if (!gradeLevel.trim()) {
      setNotice('Please select the learner grade level before continuing.');
      Alert.alert('Missing grade level', 'Please select the learner grade level before continuing.');
      return;
    }

    if (!fullName.trim()) {
      setNotice('Please enter the learner full name.');
      Alert.alert('Missing learner name', 'Please enter the learner full name.');
      return;
    }

    if (!assessmentNumber.trim()) {
      setNotice('Please enter the learner assessment number.');
      Alert.alert('Missing assessment number', 'Please enter the learner assessment number.');
      return;
    }

    const normalizedCareerName = learnerDetails.targetCareer.trim();
    if (!normalizedCareerName) {
      setNotice('Please select the learner target career from the approved list.');
      Alert.alert('Missing target career', 'Please select the learner target career from the approved list.');
      return;
    }

    const selectedCareer = careerOptions.find((career) =>
      career.id === selectedCareerId || career.courseName.trim().toLowerCase() === normalizedCareerName.toLowerCase(),
    );

    if (!selectedCareer) {
      setNotice('The selected career was not found in the national list. Please choose a valid career option.');
      Alert.alert('Invalid career selection', 'The selected career was not found in the national list. Please choose a valid career option.');
      return;
    }

    if (!hasCompleteCourseScoringData(selectedCareer.clusterRequirements)) {
      setNotice('This course cannot be assigned because required CBE scoring data is missing.');
      Alert.alert('Course scoring data missing', 'This course needs complete subject groups, a tertiary-set seven-best minimum, and all eight saved national CBE score ranges before it can be assigned. Ask the National Officer and tertiary officer to complete the missing data.');
      return;
    }

    if (!gender.trim()) {
      setNotice('Please choose the learner gender.');
      Alert.alert('Missing gender', 'Please choose the learner gender.');
      return;
    }

    if (!parentNationalId.trim()) {
      setNotice('Please enter the Parent/Guardian national ID.');
      Alert.alert('Missing parent national ID', 'Please enter the Parent/Guardian national ID.');
      return;
    }

    try {
      setSaving(true);
      setNotice('');

      const safeAssessment = assessmentNumber.trim();
      if (await assessmentNumberExists(safeAssessment)) {
        const message = `Assessment number "${safeAssessment}" is already assigned to another learner. Each learner must have a unique assessment number.`;
        setNotice(message);
        Alert.alert('Duplicate assessment number', message);
        return;
      }
      const dedupedEmail = `${safeAssessment.toLowerCase().replace(/\s+/g, '')}.${selectedClassCode.toLowerCase()}@cartra.local`;

      const userResult = await client.graphql({
        query: createUser,
        variables: {
          input: {
            email: dedupedEmail,
            phoneNumber: null,
            role: 'learner',
            status: 'active',
            fullName: fullName.trim(),
          },
        },
      });

      const userPayload = userResult as { data?: { createUser?: { id?: string } } };
      const createdUserId = userPayload.data?.createUser?.id;
      if (!createdUserId) {
        throw new Error('Learner user record could not be created.');
      }

      const supportProfilePayload = {
        targetCareer: selectedCareer.courseName,
        targetCareerId: selectedCareer.id,
        targetInstitutionId: selectedCareer.institutionId ?? null,
        targetInstitutionName: selectedCareer.institutionName ?? null,
        clusterRequirements: selectedCareer.clusterRequirements ?? null,
      };

      const supportProfileValue = Object.values(supportProfilePayload).some((value) => value !== null && value !== undefined && value !== '')
        ? JSON.stringify(supportProfilePayload)
        : null;

      console.log('Creating learner payload:', JSON.stringify({
        userId: createdUserId,
        learnerId: `${teacherContext.schoolCode}-${selectedClassCode}-${safeAssessment}`,
        fullName: fullName.trim(),
        assessmentNumber: safeAssessment,
        gender: gender.trim() || null,
        gradeLevel: gradeLevel.trim() || null,
        nationCode: teacherContext.nationCode,
        regionCode: teacherContext.regionCode,
        countyCode: teacherContext.countyCode,
        subCountyCode: teacherContext.subCountyCode,
        schoolCode: teacherContext.schoolCode,
        classCode: selectedClassCode,
        parentNationalId: parentNationalId.trim() || null,
        supportProfile: supportProfileValue,
        status: 'active',
        createdByTeacherId: teacherContext.id,
      }));

      const learnerCreate = await client.graphql({
        query: createLearnerProfile,
        variables: {
          input: {
            userId: createdUserId,
            learnerId: `${teacherContext.schoolCode}-${selectedClassCode}-${safeAssessment}`,
            fullName: fullName.trim(),
            assessmentNumber: safeAssessment,
            gender: gender.trim() || null,
            gradeLevel: gradeLevel.trim() || null,
            nationCode: teacherContext.nationCode,
            regionCode: teacherContext.regionCode,
            countyCode: teacherContext.countyCode,
            subCountyCode: teacherContext.subCountyCode,
            schoolCode: teacherContext.schoolCode,
            classCode: selectedClassCode,
            parentNationalId: parentNationalId.trim() || null,
            supportProfile: supportProfileValue,
            selectedCareerId: selectedCareer.id,
            status: 'active',
            createdByTeacherId: teacherContext.id,
          },
        },
      });

      const learnerPayload = learnerCreate as { data?: { createLearnerProfile?: { id?: string } } };
      const createdLearnerId = learnerPayload.data?.createLearnerProfile?.id;

      if (createdLearnerId) {
        await client.graphql({
          query: createLearnerEnrollment,
          variables: {
            input: {
              learnerId: createdLearnerId,
              schoolCode: teacherContext.schoolCode,
              classCode: selectedClassCode,
              academicYear: ACADEMIC_YEAR,
              termOrCycle: 'Term 1',
              enrollmentStatus: 'active',
            },
          },
        });
      }

      setFullName('');
      setAssessmentNumber('');
      setGradeLevel('');
      setGender('');
      setLearnerDetails({
        targetCareer: '',
      });
      setParentNationalId('');
      setShowLearnerDetails(false);
      setNotice('Learner added successfully to the class.');
      Alert.alert('Learner added', 'The learner was added successfully to the class.');
      await loadClassLearners(selectedClassCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not add learner.';
      console.error('Could not add learner:', error);
      setNotice(message);
      Alert.alert('Could not add learner', message);
    } finally {
      setSaving(false);
    }
  };

  const findLearnerProfileRecord = async (learner: LearnerRecord) => {
    const candidateFilters = [
      { id: { eq: learner.id } },
      ...(learner.learnerId ? [{ learnerId: { eq: learner.learnerId } }] : []),
      ...(learner.assessmentNumber && teacherContext?.schoolCode && learner.classCode
        ? [{ and: [{ schoolCode: { eq: teacherContext.schoolCode } }, { classCode: { eq: learner.classCode } }, { assessmentNumber: { eq: learner.assessmentNumber } }] }]
        : []),
    ];

    for (const filter of candidateFilters) {
      try {
        const learnerQuery = await client.graphql({
          query: listLearnerProfiles,
          variables: { filter, limit: 20 },
        });

        const learnerPayload = learnerQuery as { data?: { listLearnerProfiles?: { items?: Array<any> } } };
        const match = learnerPayload.data?.listLearnerProfiles?.items?.[0];
        if (match?.id) {
          return match;
        }
      } catch (error) {
        console.warn('[PROMOTE_LEARNER_LOOKUP_FAILED]', error);
      }
    }

    return null;
  };

  const getPromotionGradeTransition = (learner: LearnerRecord, gradeInput: string) => {
    const currentGrade = Number(String(learner.gradeLevel || '').replace(/\D/g, '')) || 7;
    const enteredNextGrade = Number(String(gradeInput || '').trim());
    const nextGrade = Number.isFinite(enteredNextGrade) && enteredNextGrade >= 7 && enteredNextGrade <= 12
      ? enteredNextGrade
      : Math.min(12, currentGrade + 1);
    return { currentGrade, nextGrade };
  };

  const handlePromoteLearner = async (learner: LearnerRecord) => {
    if (!teacherContext || !learner.id) {
      setNotice('Teacher context or learner missing.');
      return;
    }

    try {
      setPromotingLearner(true);
      setNotice('Promoting learner...');

      const { currentGrade, nextGrade } = getPromotionGradeTransition(learner, promotionGradeInput);

      const learnerRecord = await findLearnerProfileRecord(learner);
      if (!learnerRecord?.id) throw new Error('Learner profile not found');

      const parsedSupportProfile = (() => {
        if (!learnerRecord.supportProfile) return {};
        if (typeof learnerRecord.supportProfile === 'string') {
          try { return JSON.parse(learnerRecord.supportProfile); } catch { return {}; }
        }
        return typeof learnerRecord.supportProfile === 'object' ? learnerRecord.supportProfile : {};
      })();

      await client.graphql({
        query: createAcademicRecord,
        variables: {
          input: {
            learnerId: learnerRecord.id,
            academicYear: ACADEMIC_YEAR,
            termOrCycle: 'PromotionSnapshot',
            targetValues: null,
            achievedValues: null,
            subjectBreakdown: null,
            competencyBreakdown: null,
            deviationPercent: null,
            escalationLevel: null,
            escalationStatus: 'snapshot',
          },
        },
      });

      const enrollmentsQuery = await client.graphql({ query: listLearnerEnrollments, variables: { filter: { learnerId: { eq: learnerRecord.id } }, limit: 20 } });
      const enrollmentsPayload = enrollmentsQuery as { data?: { listLearnerEnrollments?: { items?: Array<any> } } };
      const activeEnrollment = (enrollmentsPayload.data?.listLearnerEnrollments?.items || []).find((e: any) => e.enrollmentStatus === 'active');
      if (activeEnrollment?.id) {
        await client.graphql({ query: updateLearnerEnrollment, variables: { input: { id: activeEnrollment.id, promotedToNextClass: true, enrollmentStatus: 'promoted' } } });
      }

      const priorSubjects = Array.isArray(parsedSupportProfile.selectedSubjects) ? parsedSupportProfile.selectedSubjects : [];
      const historicalSubjects = Array.isArray(parsedSupportProfile.historicalSelectedSubjects) ? parsedSupportProfile.historicalSelectedSubjects : [];

      const mergedHistoryMap = new Map<string, any>();
      const registerSubject = (subject: any) => {
        const key = String(subject?.code || subject?.name || subject?.id || 'subject').trim().toLowerCase();
        const merged = mergedHistoryMap.get(key) || {
          ...subject,
          name: subject?.name || subject?.code || 'Unnamed subject',
          code: subject?.code || undefined,
          history: Array.isArray(subject?.history) ? subject.history.slice() : [],
          marksScored: null,
          targetMarks: null,
        };

        const history = Array.isArray(merged.history) ? merged.history.slice() : [];
        const currentGradeValue = Number(String(learnerRecord.gradeLevel || '').replace(/\D/g, '')) || currentGrade;

        const hasGradeAttempt = history.some((entry: any) =>
          String(entry?.label) === String(currentGradeValue) && entry?.achievedRecorded === true,
        );
        const recordedMark = subject?.marksScored;
        const numericMark = Number(recordedMark);
        if (
          recordedMark !== null &&
          recordedMark !== undefined &&
          recordedMark !== '' &&
          Number.isFinite(numericMark) &&
          numericMark >= 0 &&
          (numericMark > 0 || hasGradeAttempt)
        ) {
          const entry = {
            label: String(currentGradeValue),
            value: numericMark,
            achievedRecorded: true,
            target: Number.isFinite(Number(subject?.targetMarks)) && Number(subject.targetMarks) > 0 ? Number(subject.targetMarks) : undefined,
          };
          const index = history.findIndex((existingEntry: any) => String(existingEntry?.label) === String(currentGradeValue));
          if (index >= 0) {
            history[index] = entry;
          } else {
            history.push(entry);
          }
        }

        merged.history = history;
        mergedHistoryMap.set(key, merged);
      };

      historicalSubjects.forEach(registerSubject);
      priorSubjects.forEach(registerSubject);

      const preservedHistoricalSubjects = Array.from(mergedHistoryMap.values()).map((subject: any) => ({
        ...subject,
        history: Array.isArray(subject.history) ? subject.history : [],
        marksScored: null,
        targetMarks: null,
      }));

      const nextSupportProfile = {
        ...parsedSupportProfile,
        targetCareer: null,
        selectedSubjects: [],
        historicalSelectedSubjects: preservedHistoricalSubjects,
      };

      await client.graphql({ query: createLearnerEnrollment, variables: { input: { learnerId: learnerRecord.id, schoolCode: learnerRecord.schoolCode, classCode: String(nextGrade), academicYear: ACADEMIC_YEAR, termOrCycle: 'Term 1', enrollmentStatus: 'active' } } });
      const profileUpdateResult = await client.graphql({
        query: updateLearnerProfile,
        variables: { input: { id: learnerRecord.id, gradeLevel: String(nextGrade), classCode: String(nextGrade), supportProfile: JSON.stringify(nextSupportProfile) } },
      }) as { data?: { updateLearnerProfile?: { gradeLevel?: string | null; classCode?: string | null } } };
      if ([9, 10].includes(currentGrade) || [9, 10].includes(nextGrade)) {
        console.log('[TEACHER_GRADE_BOUNDARY] promotion profile update', {
          learnerId: learnerRecord.id,
          rosterGradeBeforePromotion: learner.gradeLevel || null,
          profileGradeBeforePromotion: learnerRecord.gradeLevel || null,
          requestedNextGrade: nextGrade,
          persistedGrade: profileUpdateResult.data?.updateLearnerProfile?.gradeLevel || null,
          persistedClassCode: profileUpdateResult.data?.updateLearnerProfile?.classCode || null,
        });
      }

      setPromotionModalVisible(false);
      setPromotionLearner(null);
      setPromotionGradeInput('');
      setNotice(`${learner.fullName} promoted to Grade ${nextGrade}. Career and subject targets were reset for the next class.`);
      Alert.alert('Promotion complete', `${learner.fullName} was promoted to Grade ${nextGrade}. Career and subject targets were reset for the next class.`);
      await loadClassLearners(selectedClassCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Promotion failed';
      setNotice(message);
      Alert.alert('Promotion failed', message);
    } finally {
      setPromotingLearner(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={styles.screenLoadingText}>Loading your teacher class details...</Text>
      </View>
    );
  }

  if (!teacherContext) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{notice || 'Teacher context could not be loaded.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionCard title="Teacher Dashboard" subtitle="Manage your assigned class and add learners to it.">
        <Text style={styles.teacherName}>{teacherContext.fullName}</Text>
        <Text style={styles.metaText}>School: {teacherContext.schoolCode}</Text>
        <Text style={styles.metaText}>TSC: {teacherContext.tscNumber || 'Not set'}</Text>
        <Text style={styles.metaText}>Hierarchy: {teacherContext.nationCode} / {teacherContext.regionCode} / {teacherContext.countyCode} / {teacherContext.subCountyCode}</Text>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </SectionCard>

      <SectionCard title="My Classes">
        {assignedClasses.length === 0 ? (
          <Text style={styles.empty}>No assigned classes were found for this teacher yet.</Text>
        ) : (
          <View style={styles.classRow}>
            {assignedClasses.map((classItem) => (
              <TouchableOpacity
                key={classItem.id}
                style={[styles.classButton, selectedClassCode === classItem.classCode && styles.classButtonActive]}
                onPress={() => selectAssignedClass(classItem)}
              >
                <Text style={[styles.classButtonText, selectedClassCode === classItem.classCode && styles.classButtonTextActive]}>
                  {classItem.className || `Grade ${classItem.classCode}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </SectionCard>

      <SectionCard title={selectedClassCode ? `Add learner to ${selectedClassCode}` : 'Add learner to class'}>
        {!showLearnerDetails ? (
          <>
            <Text style={styles.fieldLabel}>Select assigned class</Text>
            {assignedClasses.length === 0 ? (
              <Text style={styles.empty}>No assigned classes are available for this teacher yet.</Text>
            ) : (
              <View style={styles.gradeGrid}>
                {assignedClasses.map((classItem) => (
                  <TouchableOpacity
                    key={classItem.id}
                    style={[styles.gradeChip, selectedClassCode === classItem.classCode && styles.gradeChipSelected]}
                    onPress={() => {
                      selectAssignedClass(classItem);
                      setShowLearnerDetails(true);
                    }}
                  >
                    <Text style={[styles.gradeChipText, selectedClassCode === classItem.classCode && styles.gradeChipTextSelected]}>
                      {classItem.className || `Grade ${classItem.classCode}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={styles.fieldLabel}>Selected grade: {gradeLevel}</Text>

            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.genderRow}>
              {['Male', 'Female'].map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.genderOption, gender === option && styles.genderOptionSelected]}
                  onPress={() => setGender(option)}
                >
                  <Text style={[styles.genderOptionText, gender === option && styles.genderOptionTextSelected]}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Learner full name"
              placeholderTextColor="#6b7280"
            />
            <TextInput
              style={styles.input}
              value={assessmentNumber}
              onChangeText={setAssessmentNumber}
              placeholder="Assessment number"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.fieldLabel}>Target career</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setCareerPickerVisible(true)}
              disabled={careerOptionsLoading}
            >
              <Text style={[styles.dropdownText, !learnerDetails.targetCareer && styles.placeholderText]}>
                {careerOptionsLoading ? 'Loading approved careers...' : learnerDetails.targetCareer || 'Select career from national list'}
              </Text>
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              value={parentNationalId}
              onChangeText={setParentNationalId}
              placeholder="Parent/Guardian national ID"
              placeholderTextColor="#6b7280"
              autoCapitalize="characters"
            />

            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setShowLearnerDetails(false);
                  setGender('');
                  setLearnerDetails({
                    targetCareer: '',
                  });
                  setParentNationalId('');
                  setFullName('');
                  setAssessmentNumber('');
                }}
              >
                <Text style={styles.secondaryButtonText}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.primaryButton} onPress={() => void handleCreateLearner()} disabled={saving || !selectedClassCode}>
                <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Add learner to class'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </SectionCard>

      <Modal
        transparent
        visible={pendingLearnerConfirmation !== null}
        animationType="fade"
        onRequestClose={() => setPendingLearnerConfirmation(null)}
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>
              {pendingLearnerConfirmation?.action === 'view' ? 'View learner performance' : 'Update learner performance'}
            </Text>
            <Text style={styles.dialogText}>
              {pendingLearnerConfirmation
                ? pendingLearnerConfirmation.action === 'view'
                  ? `This opens the learner performance view for ${pendingLearnerConfirmation.learner.fullName}.`
                  : `This opens the performance update flow for ${pendingLearnerConfirmation.learner.fullName}.`
                : ''}
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setPendingLearnerConfirmation(null)}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => {
                  if (pendingLearnerConfirmation) {
                    beginPerformanceAction(pendingLearnerConfirmation.learner, pendingLearnerConfirmation.action);
                  }
                }}
              >
                <Text style={styles.primaryButtonText}>
                  {pendingLearnerConfirmation?.action === 'view' ? 'Open' : 'Proceed'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={promotionModalVisible} animationType="fade" onRequestClose={() => {
        setPromotionModalVisible(false);
        setPromotionLearner(null);
        setPromotionGradeInput('');
      }}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Promote learner</Text>
            <Text style={styles.dialogText}>
              {promotionLearner
                ? (() => {
                  const { currentGrade, nextGrade } = getPromotionGradeTransition(promotionLearner, promotionGradeInput);
                  return `Promote from Grade ${currentGrade} to Grade ${nextGrade}.`;
                })()
                : 'Select a learner to promote.'}
            </Text>

            <Text style={styles.fieldLabel}>Next class / grade</Text>
            <TextInput
              style={styles.input}
              value={promotionGradeInput}
              onChangeText={setPromotionGradeInput}
              placeholder="e.g. 9"
              keyboardType="numeric"
              placeholderTextColor="#6b7280"
            />

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setPromotionModalVisible(false);
                  setPromotionLearner(null);
                  setPromotionGradeInput('');
                }}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryButton, promotingLearner && styles.primaryButtonDisabled]}
                onPress={() => {
                  if (!promotionLearner || promotingLearner) return;
                  void handlePromoteLearner(promotionLearner);
                }}
                disabled={promotingLearner}
              >
                <View style={styles.buttonContentRow}>
                  {promotingLearner ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                  <Text style={styles.primaryButtonText}>{promotingLearner ? 'Promoting...' : 'Okay'}</Text>
                </View>
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>

      <Modal transparent visible={careerTargetModalVisible} animationType="fade" onRequestClose={() => {
        setCareerTargetModalVisible(false);
        setCareerTargetLearner(null);
        setCareerTargetInput('');
        setSelectedCareerId(null);
      }}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Set learner career target</Text>
            <Text style={styles.dialogText}>
              Update the current career target for {careerTargetLearner?.fullName || 'this learner'}.
            </Text>

            <Text style={styles.fieldLabel}>Career target</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setCareerPickerVisible(true)}
              disabled={careerOptionsLoading}
            >
              <Text style={[styles.dropdownText, !careerTargetInput && styles.placeholderText]}>
                {careerOptionsLoading ? 'Loading approved careers...' : careerTargetInput || 'Select career from national list'}
              </Text>
            </TouchableOpacity>

            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setCareerTargetModalVisible(false);
                  setCareerTargetLearner(null);
                  setCareerTargetInput('');
                }}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryButton, resettingCareerTarget && styles.primaryButtonDisabled]}
                onPress={() => {
                  if (!careerTargetLearner || resettingCareerTarget) return;

                  const gradeNumber = Number(String(careerTargetLearner.gradeLevel || '').replace(/\D/g, '')) || 0;
                  if (gradeNumber < 7 || gradeNumber > 9) {
                    Alert.alert(
                      'Career locked',
                      `Career targets can only be changed for learners in Grades 7, 8, and 9. This learner is in Grade ${careerTargetLearner.gradeLevel || 'Not set'}, so changes are not allowed.`,
                    );
                    return;
                  }

                  const nextCareer = careerTargetInput.trim();
                  if (!nextCareer) {
                    Alert.alert('Career target required', 'Please select the learner career target from the approved list before saving.');
                    return;
                  }

                  const selectedCareer = careerOptions.find((career) =>
                    career.id === selectedCareerId || career.courseName.trim().toLowerCase() === nextCareer.toLowerCase(),
                  );

                  if (!selectedCareer) {
                    Alert.alert('Invalid career selection', 'The selected career was not found in the national list. Please choose a valid career option.');
                    return;
                  }

                  if (!hasCompleteCourseScoringData(selectedCareer.clusterRequirements)) {
                    Alert.alert('Course scoring data missing', 'This course needs complete subject groups, a tertiary-set seven-best minimum, and all eight saved national CBE score ranges before it can be assigned. Ask the National Officer and tertiary officer to complete the missing data.');
                    return;
                  }

                  void (async () => {
                    try {
                      setResettingCareerTarget(true);
                      const learnerRecord = await findLearnerProfileRecord(careerTargetLearner);
                      if (!learnerRecord?.id) throw new Error('Learner record could not be found.');

                      const currentProfile = (() => {
                        if (!learnerRecord.supportProfile) return {};
                        if (typeof learnerRecord.supportProfile === 'string') {
                          try { return JSON.parse(learnerRecord.supportProfile); } catch { return {}; }
                        }
                        return typeof learnerRecord.supportProfile === 'object' ? learnerRecord.supportProfile : {};
                      })();

                      const nextProfile = {
                        ...currentProfile,
                        targetCareer: selectedCareer.courseName,
                        targetCareerId: selectedCareer.id,
                        targetInstitutionId: selectedCareer.institutionId ?? null,
                        targetInstitutionName: selectedCareer.institutionName ?? null,
                        clusterRequirements: selectedCareer.clusterRequirements ?? null,
                      };

                      await client.graphql({ query: updateLearnerProfile, variables: { input: { id: learnerRecord.id, selectedCareerId: selectedCareer.id, supportProfile: JSON.stringify(nextProfile) } } });
                      setLearnerCareerMap((current) => ({ ...current, [careerTargetLearner.id]: selectedCareer.courseName }));
                      setNotice(`${careerTargetLearner.fullName}'s career target was saved as ${selectedCareer.courseName}.`);
                      Alert.alert('Career target saved', `${careerTargetLearner.fullName}'s career target is now ${selectedCareer.courseName}.`);
                      setCareerTargetModalVisible(false);
                      setCareerTargetLearner(null);
                      setCareerTargetInput('');
                      setSelectedCareerId(null);
                    } catch (error) {
                      const message = error instanceof Error ? error.message : 'Could not update the career target.';
                      setNotice(message);
                      Alert.alert('Update failed', message);
                    } finally {
                      setResettingCareerTarget(false);
                    }
                  })();
                }}
                disabled={resettingCareerTarget}
              >
                <View style={styles.buttonContentRow}>
                  {resettingCareerTarget ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                  <Text style={styles.primaryButtonText}>{resettingCareerTarget ? 'Saving...' : 'Save career target'}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={careerPickerVisible} animationType="slide" onRequestClose={() => {
        setCareerPickerVisible(false);
        setCourseFilterInstitution('');
        setCourseFilterCourseName('');
      }}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Approved programmes</Text>
            <Text style={styles.dialogText}>Select the institution-owned programme to apply its required subject groups and minimum points.</Text>

            <Text style={styles.fieldLabel}>Institution name</Text>
            <TextInput
              style={styles.input}
              value={courseFilterInstitution}
              onChangeText={setCourseFilterInstitution}
              placeholder="Filter by institution"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.fieldLabel}>Course name</Text>
            <TextInput
              style={styles.input}
              value={courseFilterCourseName}
              onChangeText={setCourseFilterCourseName}
              placeholder="Filter by course name"
              placeholderTextColor="#6b7280"
            />

            <ScrollView style={styles.optionList} contentContainerStyle={styles.optionListContent}>
              {careerOptionsLoading ? (
                <View style={styles.centeredRow}><ActivityIndicator size="small" color="#1d4ed8" /><Text style={styles.optionHint}>Loading programmes...</Text></View>
              ) : filteredCareerOptions.length === 0 ? (
                <Text style={styles.optionHint}>No assignable courses match these filters. A course needs complete cluster subject data, a tertiary-set seven-best minimum, and all eight saved national CBE ranges. Ask the National Officer or tertiary officer to complete the missing setup.</Text>
              ) : (
                filteredCareerOptions.map((career) => (
                  <TouchableOpacity
                    key={career.id}
                    style={[styles.optionRow, selectedCareerId === career.id && styles.optionRowSelected]}
                    onPress={() => {
                      setSelectedCareerId(career.id);
                      setCareerTargetInput(career.courseName);
                      setLearnerDetails((current) => ({ ...current, targetCareer: career.courseName }));
                      setCareerPickerVisible(false);
                      setCourseFilterInstitution('');
                      setCourseFilterCourseName('');
                    }}
                  >
                    <Text style={styles.optionTitle}>{career.courseName}</Text>
                    <Text style={styles.optionMeta}>{career.institutionName || 'Unknown institution'}</Text>
                    {career.clusterRequirements?.subjectSequence?.length ? (
                      <View style={styles.courseRequirementsSummary}>
                        <Text style={styles.optionMeta}>
                          {getCourseRequirementGroups(career.clusterRequirements).length} required subject groups · score scale up to {8 * getCourseRequirementGroups(career.clusterRequirements).length} points
                        </Text>
                        <Text style={styles.optionRequirementsText}>
                          {getCourseRequirementGroups(career.clusterRequirements).map((group) => group.map((requirement) => {
                            const displayRequirement = requirement as typeof requirement & { subjectName?: string };
                            return `${displayRequirement.subjectName || requirement.subjectId}: ${Number.isInteger(requirement.minimumPoints) ? `${requirement.minimumPoints} ${getCbeAchievementLevel(Number(requirement.minimumPoints))}` : 'minimum not set'}`;
                          }).join(' OR ')).join('  ·  ')}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => {
                setCareerPickerVisible(false);
                setCourseFilterInstitution('');
                setCourseFilterCourseName('');
              }}>
                <Text style={styles.secondaryButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={subjectIntroVisible} animationType="fade" onRequestClose={() => setSubjectIntroVisible(false)}>
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Add learner subject</Text>
            <Text style={styles.dialogText}>
              This lets you attach a subject to {subjectIntroLearner?.fullName || 'this learner'}.
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setSubjectIntroVisible(false);
                  setSubjectIntroLearner(null);
                }}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => {
                  if (subjectIntroLearner) {
                    void openSubjectCategoryModal(subjectIntroLearner);
                    setSubjectIntroLearner(null);
                    setSubjectIntroVisible(false);
                  }
                }}
              >
                <Text style={styles.primaryButtonText}>Proceed</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SectionCard title={selectedClassCode ? `Learners in ${selectedClassCode}` : 'Learners'}>
        {learners.length === 0 ? (
          <Text style={styles.empty}>No learners have been added to this class yet.</Text>
        ) : (
          learners.map((learner) => (
            <View key={learner.id} style={styles.learnerRow}>
              <View style={styles.learnerLineRow}>
                <Text style={[styles.learnerName, { flexShrink: 1 }]}>{learner.fullName} - {learnerCareerMap[learner.id] || 'Career target not set'}</Text>
                <View style={styles.learnerActions}>
                  <TouchableOpacity
                    accessibilityLabel={`View learner performance for ${learner.fullName}`}
                    style={styles.iconButton}
                    onPress={() => promptLearnerAction(learner, 'view')}
                  >
                    <Text style={styles.iconText}>◌</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.learnerLineRow}>
                <Text style={[styles.metaText, styles.learnerMetaText]}>Assessment: Grade {learner.gradeLevel || 'Not set'} • Assessment no: {learner.assessmentNumber || 'Not set'}</Text>
                <View style={styles.learnerActions}>
                  <TouchableOpacity
                    accessibilityLabel={`Update learner performance for ${learner.fullName}`}
                    style={styles.iconButton}
                    onPress={() => promptLearnerAction(learner, 'update')}
                  >
                    <Text style={styles.iconText}>✎</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.learnerLineRow}>
                <Text style={[styles.metaText, styles.learnerMetaText]}>Grade {learner.gradeLevel || 'Not set'}: Status: {learner.status || 'active'}</Text>
                <View style={styles.learnerActions}>
                <TouchableOpacity
                  accessibilityLabel={`Add subject to ${learner.fullName}`}
                  style={styles.iconButton}
                  onPress={() => promptLearnerAction(learner, 'addSubject')}
                >
                  <Text style={styles.iconText}>＋</Text>
                </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityLabel={`Update career target for ${learner.fullName}`}
                    style={styles.iconButton}
                    onPress={() => promptLearnerAction(learner, 'updateCareerTarget')}
                  >
                    <Text style={styles.iconText}>✦</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityLabel={`Promote ${learner.fullName}`}
                    style={styles.iconButton}
                    onPress={() => promptLearnerAction(learner, 'promote')}
                  >
                    <Text style={styles.iconText}>⬆</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.subjectSummaryBox}>
                <View style={styles.learnerLineRow}>
                  <Text style={styles.subjectSummaryTitle}>Subjects</Text>
                  <TouchableOpacity
                    accessibilityLabel={expandedSubjectsLearnerId === learner.id ? `Hide subjects for ${learner.fullName}` : `Show subjects for ${learner.fullName}`}
                    style={styles.iconButton}
                    onPress={() => setExpandedSubjectsLearnerId((current) => current === learner.id ? null : learner.id)}
                  >
                    <Text style={styles.iconText}>{expandedSubjectsLearnerId === learner.id ? '◉' : '◌'}</Text>
                  </TouchableOpacity>
                </View>
                {expandedSubjectsLearnerId === learner.id ? (
                  (learnerSubjectsMap[learner.id] || []).length === 0 ? (
                    <Text style={styles.empty}>No subjects added yet.</Text>
                  ) : (
                    <View style={styles.subjectSummaryList}>
                      {(learnerSubjectsMap[learner.id] || []).map((subject) => (
                        <AddedSubjectBadge
                          key={subject.id}
                          subject={subject}
                          onRemove={() => void removeSubjectFromLearner(learner.id, subject.id)}
                          removeLabel={`Remove ${subject.name} from ${learner.fullName}`}
                        />
                      ))}
                    </View>
                  )
                ) : null}
              </View>

              {performanceLearner?.id === learner.id && performanceAction ? (
                <View key={`${performanceSessionId}-${performanceLearner?.id ?? 'teacher-performance'}`} style={styles.inlineSubjectSheet}>
                  <Text style={styles.modalTitle}>
                    {performanceAction === 'viewMenu' || performanceAction === 'viewCluster' || performanceAction === 'viewSubjects' || performanceAction === 'viewGuidance' || performanceAction === 'viewEPortfolio'
                      ? `View performance for ${learner.fullName}`
                      : `Update performance for ${learner.fullName}`}
                  </Text>
                  <Text style={styles.modalSubtitle}>Grade {learner.gradeLevel || 'Not set'}</Text>

                  {performanceAction === 'viewMenu' ? (
                    <ViewPerformance
                      learner={learner}
                      profile={learnerProfileMap[learner.id] || {}}
                      targetCareer={learnerCareerMap[learner.id]}
                      onViewCluster={() => setPerformanceAction('viewCluster')}
                      onViewSubjects={() => {
                        void loadLearnerDocuments(learner.id);
                        setPerformanceAction('viewSubjects');
                      }}
                      onViewGuidance={() => {
                        void loadLearnerGuidance(learner.id);
                        setPerformanceAction('viewGuidance');
                      }}
                    />
                  ) : null}

                  {performanceAction === 'menu' || performanceAction === null ? (
                    <View style={styles.categoryList}>
                      <TouchableOpacity
                        style={styles.categoryButton}
                        onPress={() => {
                          setPerformanceAction('subject');
                          setSelectedPerformanceSubject(null);
                          setPerformanceMarksInput('');
                        }}
                      >
                        <Text style={styles.categoryButtonText}>Update subject performance</Text>
                      </TouchableOpacity>

                      {!(sessionUser && sessionUser.groups.includes('teacher')) && (
                        <TouchableOpacity
                          style={styles.categoryButton}
                          onPress={() => setPerformanceAction('rubric')}
                        >
                          <Text style={styles.categoryButtonText}>Create rubric</Text>
                        </TouchableOpacity>
                      )}

                      {Number(String(learner.gradeLevel || '').replace(/\D/g, '')) === 12 ? (
                        <TouchableOpacity
                          style={styles.categoryButton}
                          onPress={() => void saveCalculatedClusterPoints(learner)}
                          disabled={calculatingClusterPoints}
                        >
                          <Text style={styles.categoryButtonText}>
                            {calculatingClusterPoints
                              ? 'Calculating cluster points...'
                              : `Calculate cluster points${typeof learnerClusterPointsMap[learner.id] === 'number' ? ` (${learnerClusterPointsMap[learner.id]})` : ''}`}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}

                  {performanceAction === 'subject' ? (
                    <View style={styles.subjectListBox}>
                      <Text style={styles.subjectListTitle}>Subjects to update</Text>
                      {(learnerSubjectsMap[learner.id] || []).length === 0 ? (
                        <Text style={styles.empty}>No subjects have been assigned to this learner yet.</Text>
                      ) : (
                        <View style={styles.subjectSummaryList}>
                          {(learnerSubjectsMap[learner.id] || []).map((subject) => {
                            const draftValue = subjectPerformanceDrafts[subject.id] ?? String(subject.marksScored ?? '');

                            return (
                              <View key={subject.id} style={styles.subjectPerformanceRow}>
                                <View style={styles.subjectPerformanceInfo}>
                                  <Text style={styles.subjectItemCode}>{subject.code || 'SUBJ'}</Text>
                                  <Text style={styles.subjectItemName}>{subject.name}</Text>
                                  <Text style={styles.subjectItemMeta}>Current: {subject.marksScored ?? 0}</Text>
                                </View>

                                <View style={styles.subjectPerformanceUpdateBox}>
                                  <TextInput
                                    style={styles.subjectPerformanceInput}
                                    value={draftValue}
                                    onChangeText={(value) => {
                                      setSubjectPerformanceDrafts((current) => ({ ...current, [subject.id]: value }));
                                    }}
                                    placeholder="Marks"
                                    keyboardType="numeric"
                                    placeholderTextColor="#6b7280"
                                  />

                                  <TouchableOpacity
                                    style={[styles.inlineSaveButton, savingSubjectMap[subject.id] && styles.primaryButtonDisabled]}
                                    onPress={() => {
                                      const numericValue = Number(draftValue);
                                      if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                                        Alert.alert('Invalid mark', 'Marks scored must be a valid number between 0 and 100.');
                                        return;
                                      }

                                      void updateSubjectPerformance(learner.id, subject.id, numericValue);
                                    }}
                                    disabled={!!savingSubjectMap[subject.id]}
                                    accessibilityLabel={`Refresh marks for ${subject.name}`}
                                  >
                                    {savingSubjectMap[subject.id]
                                      ? <ActivityIndicator size="small" color="#1d4ed8" />
                                      : <Ionicons name="refresh-outline" size={18} color="#1d4ed8" />}
                                  </TouchableOpacity>
                                </View>
                                <View style={styles.subjectEvidenceActions}>
                                  <TouchableOpacity
                                    style={styles.subjectEvidenceButton}
                                    onPress={() => confirmUploadForSubject(learner, { id: subject.id, name: subject.name })}
                                    disabled={uploadingDocument}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Upload e-file for ${subject.name}`}
                                  >
                                    <Ionicons name="document-attach-outline" size={19} color="#1d4ed8" />
                                    <Text style={styles.subjectEvidenceButtonText}>Document</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.subjectEvidenceButton}
                                    onPress={() => openVideoLinkForm({ id: subject.id, name: subject.name })}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Add video link for ${subject.name}`}
                                  >
                                    <Ionicons name="videocam-outline" size={19} color="#b91c1c" />
                                    <Text style={styles.subjectEvidenceButtonText}>Video</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  ) : null}

                  {performanceAction === 'rubric' ? (
                    <View style={styles.subjectListBox}>
                      <Text style={styles.subjectListTitle}>Create learner rubric</Text>

                      <ScrollView
                        style={styles.rubricScrollView}
                        contentContainerStyle={styles.rubricScrollContent}
                        showsVerticalScrollIndicator
                        nestedScrollEnabled
                      >
                        <Text style={styles.detailLabel}>Rubric title</Text>
                        <TextInput
                          style={styles.subjectPerformanceInput}
                          value={rubricTitle}
                          onChangeText={setRubricTitle}
                          placeholder="e.g. Practical Skills Rubric"
                          placeholderTextColor="#6b7280"
                        />

                        <Text style={styles.detailLabel}>Description</Text>
                        <TextInput
                          style={[styles.subjectPerformanceInput, { minHeight: 52, textAlignVertical: 'top' }]}
                          value={rubricDescription}
                          onChangeText={setRubricDescription}
                          placeholder="Short description"
                          placeholderTextColor="#6b7280"
                          multiline
                        />

                        <Text style={styles.detailLabel}>Criteria</Text>
                        <TextInput
                          style={[styles.subjectPerformanceInput, { minHeight: 90, textAlignVertical: 'top' }]}
                          value={rubricCriteriaText}
                          onChangeText={setRubricCriteriaText}
                          placeholder="One criterion per line"
                          placeholderTextColor="#6b7280"
                          multiline
                        />

                        <View style={styles.detailActions}>
                          <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={() => setPerformanceAction('menu')}
                          >
                            <Text style={styles.secondaryButtonText}>Back</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.primaryButton, savingRubric && styles.primaryButtonDisabled]}
                            onPress={() => void saveRubricForLearner(learner)}
                            disabled={savingRubric}
                          >
                            <View style={styles.buttonContentRow}>
                              {savingRubric ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                              <Text style={styles.primaryButtonText}>{savingRubric ? 'Saving...' : 'Save rubric'}</Text>
                            </View>
                          </TouchableOpacity>
                        </View>
                      </ScrollView>
                    </View>
                  ) : null}

                  {performanceAction === 'viewGuidance' ? (
                    <View style={styles.subjectListBox}>
                      <Text style={styles.subjectListTitle}>Guidance & comments</Text>
                      {(() => {
                        const guidanceEntries = learnerGuidanceMap[learner.id] || [];
                        if (guidanceEntries.length === 0) {
                          return <Text style={styles.empty}>No guidance comments have been added for this learner yet.</Text>;
                        }

                        const formatRole = (role?: string | null) => {
                          if (!role) return 'Unknown';
                          const roleLabels: Record<string, string> = {
                            parent: 'Parent',
                            teacher: 'Teacher',
                            principal: 'Principal',
                            subCountyOfficer: 'Sub County Director',
                            countyOfficer: 'County Director',
                            regionalOfficer: 'Regional Director',
                            nationalOfficer: 'National Officer',
                          };
                          return roleLabels[role] || role;
                        };

                        return (
                          <View style={styles.linkedDocumentList}>
                            {guidanceEntries.map((entry) => (
                              <View key={entry.id} style={styles.linkedDocumentCard}>
                                <Text style={styles.linkedDocumentTitle}>{formatRole(entry.authorRole)}</Text>
                                <Text style={styles.linkedDocumentMeta}>{entry.authorDisplayName || 'Unknown author'}</Text>
                                <Text style={styles.linkedDocumentMeta}>Grade: {entry.schoolGrade || 'Not set'}</Text>
                                {entry.createdAt ? (
                                  <Text style={styles.linkedDocumentMeta}>Time: {new Date(entry.createdAt).toLocaleString()}</Text>
                                ) : null}
                                <Text style={[styles.linkedDocumentDescription, { marginTop: 8 }]}>{entry.note}</Text>
                              </View>
                            ))}
                          </View>
                        );
                      })()}
                    </View>
                  ) : null}

                  {performanceAction === 'viewEPortfolio' ? (
                    <View style={styles.subjectListBox}>
                      <Text style={styles.subjectListTitle}>View learner e-files</Text>
                      <Text style={styles.metaText}>Resources loaded: {(learnerDocumentMap[learner.id] || []).length}</Text>
                      {(learnerDocumentMap[learner.id] || []).length === 0 ? (
                        <Text style={styles.empty}>No e-portfolio files are linked to this learner yet.</Text>
                      ) : (
                        <View style={styles.linkedDocumentList}>
                          {(learnerDocumentMap[learner.id] || []).map((resource) => (
                            <View key={resource.id} style={styles.linkedDocumentCard}>
                              <View style={styles.linkedDocumentHeader}>
                                <View style={styles.linkedDocumentTextBlock}>
                                  <Text style={styles.linkedDocumentTitle}>{resource.title}</Text>
                                  <Text style={styles.linkedDocumentMeta}>{isLearnerVideoResource(resource) ? 'Video link' : 'E-portfolio document'} • {resource.status}</Text>
                                  <Text style={styles.linkedDocumentMeta}>{resource.relatedSubjectName || 'Unassigned subject'}</Text>
                                </View>
                                <TouchableOpacity
                                  style={styles.inlineSaveButton}
                                  onPress={() => void openLearnerDocument(resource)}
                                  disabled={openingDocumentId === resource.id}
                                >
                                  <Text style={styles.inlineSaveButtonText}>{openingDocumentId === resource.id ? '…' : 'Open'}</Text>
                                </TouchableOpacity>
                              </View>

                              {resource.description ? <Text style={styles.linkedDocumentDescription}>{resource.description}</Text> : null}

                              {resource.fileName ? <Text style={styles.linkedDocumentMeta}>{resource.fileName} • {formatFileSize(resource.fileSizeBytes)} • {formatDocumentTimestamp(resource.createdAt)}</Text> : null}
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Modal
                transparent
                visible={performanceLearner?.id === learner.id && (performanceAction === 'viewCluster' || performanceAction === 'viewSubjects')}
                animationType="slide"
                onRequestClose={resetPerformanceModal}
              >
                <View style={styles.graphModalBackdrop}>
                  <View key={`${performanceSessionId}-${performanceLearner?.id ?? 'teacher-graph'}`} style={styles.graphModalCard}>
                    <View style={styles.graphModalHeader}>
                      <Text style={styles.graphModalTitle}>
                        {performanceAction === 'viewCluster' ? 'Cluster performance by grade' : 'Subject performance trend'}
                      </Text>
                      <TouchableOpacity
                        style={styles.graphCloseButton}
                        onPress={resetPerformanceModal}
                      >
                        <Text style={styles.graphCloseButtonText}>Close</Text>
                      </TouchableOpacity>
                    </View>

                    {performanceAction === 'viewCluster' ? (
                      <ScrollView style={styles.graphModalScroll} contentContainerStyle={styles.graphModalContent}>
                        <LearnerClusterPerformanceGraph
                          learner={learner}
                          profile={{
                            ...(learnerProfileMap[learner.id] || {}),
                            selectedSubjects: Array.isArray(learnerProfileMap[learner.id]?.selectedSubjects)
                              ? learnerProfileMap[learner.id].selectedSubjects
                              : learnerSubjectsMap[learner.id] || [],
                          }}
                          targetCareer={learnerCareerMap[learner.id]}
                        />

                        {/* Learner comments shown below the cluster chart */}
                        <View style={{ marginTop: 12 }}>
                          {/* lazy-load comments component */}
                          <React.Suspense fallback={null}>
                            {/* @ts-ignore dynamic import for component already added */}
                            {(() => {
                              const C = require('../../components/shared/LearnerComments').default;
                              return <C learnerId={learner.id} />;
                            })()}
                          </React.Suspense>
                        </View>
                      </ScrollView>
                    ) : null}

                    {performanceAction === 'viewSubjects' ? (
                      <ScrollView style={styles.graphModalScroll} contentContainerStyle={styles.graphModalContent}>
                        <SubjectPerformanceGraph
                          learner={learner}
                          profile={{
                            ...(learnerProfileMap[learner.id] || {}),
                            selectedSubjects: Array.isArray(learnerProfileMap[learner.id]?.selectedSubjects)
                              ? learnerProfileMap[learner.id].selectedSubjects
                              : learnerSubjectsMap[learner.id] || [],
                          }}
                          renderSubjectActions={(subject) => {
                            const learnerSubject = (learnerSubjectsMap[learner.id] || []).find((item) =>
                              (subject.id && item.id === subject.id) || item.name === subject.label || item.code === subject.code,
                            );
                            const subjectId = subject.id || learnerSubject?.id || '';
                            const subjectResources = (learnerDocumentMap[learner.id] || []).filter((resource) => resource.relatedSubjectId === subjectId);
                            const documentCount = subjectResources.filter((resource) => !isLearnerVideoResource(resource)).length;
                            const videoCount = subjectResources.filter(isLearnerVideoResource).length;
                            const openSubjectResources = (kind: 'document' | 'video') => {
                              console.log('[EPORTFOLIO_DEBUG] subject-resource-button:pressed', {
                                kind,
                                learnerId: learner.id,
                                subjectId,
                                subjectName: subject.label,
                                loadedResourceCount: subjectResources.length,
                                documentCount,
                                videoCount,
                                platform: Platform.OS,
                              });
                              setEvidenceViewer({ subjectId, subjectName: subject.label, kind });
                            };
                            return (
                                <View style={styles.subjectEvidenceActions}>
                                  <TouchableOpacity
                                    style={styles.subjectEvidenceButton}
                                    onPress={() => openSubjectResources('document')}
                                    disabled={!subjectId}
                                    accessibilityRole="button"
                                    accessibilityLabel={`View ${documentCount} documents for ${subject.label}`}
                                  >
                                    <Ionicons name="document-text-outline" size={18} color="#1d4ed8" />
                                    <Text style={[styles.subjectEvidenceButtonText, !documentCount && styles.subjectEvidenceButtonDisabled]}>Documents ({documentCount})</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.subjectEvidenceButton}
                                    onPress={() => openSubjectResources('video')}
                                    disabled={!subjectId}
                                    accessibilityRole="button"
                                    accessibilityLabel={`View ${videoCount} videos for ${subject.label}`}
                                  >
                                    <Ionicons name="videocam-outline" size={18} color="#b91c1c" />
                                    <Text style={[styles.subjectEvidenceButtonText, !videoCount && styles.subjectEvidenceButtonDisabled]}>Videos ({videoCount})</Text>
                                  </TouchableOpacity>
                                </View>
                            );
                          }}
                        />
                      </ScrollView>
                    ) : null}
                  </View>
                </View>
              </Modal>

              <Modal
                transparent
                visible={videoLinkModalVisible && performanceLearner?.id === learner.id}
                animationType="fade"
                onRequestClose={() => setVideoLinkModalVisible(false)}
              >
                <View style={styles.dialogBackdrop}>
                  <View style={styles.dialogCard}>
                    <Text style={styles.dialogTitle}>Add subject video link</Text>
                    <Text style={styles.dialogText}>Paste a video link from YouTube or another video site under {videoLinkSubject?.name || 'this subject'}.</Text>
                    <Text style={styles.detailLabel}>Video title</Text>
                    <TextInput
                      style={styles.subjectPerformanceInput}
                      value={videoTitleInput}
                      onChangeText={setVideoTitleInput}
                      placeholder="Video title"
                      placeholderTextColor="#444"
                    />
                    <Text style={styles.detailLabel}>Video URL</Text>
                    <TextInput
                      style={styles.subjectPerformanceInput}
                      value={videoLinkInput}
                      onChangeText={setVideoLinkInput}
                      placeholder="https://www.youtube.com/watch?v=..."
                      placeholderTextColor="#444"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                    />
                    <View style={styles.dialogActions}>
                      <TouchableOpacity style={styles.secondaryButton} onPress={() => setVideoLinkModalVisible(false)}>
                        <Text style={styles.secondaryButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.primaryButton, savingVideoLink && styles.primaryButtonDisabled]} onPress={() => void saveVideoLink()} disabled={savingVideoLink}>
                        <View style={styles.buttonContentRow}>
                          {savingVideoLink ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                          <Text style={styles.primaryButtonText}>{savingVideoLink ? 'Saving...' : 'Save video'}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>

              <Modal
                transparent
                visible={Boolean(evidenceViewer && performanceLearner?.id === learner.id)}
                animationType="fade"
                onRequestClose={() => setEvidenceViewer(null)}
              >
                <View style={styles.dialogBackdrop}>
                  <View style={[styles.dialogCard, styles.evidenceViewerCard]}>
                    <Text style={styles.dialogTitle}>{evidenceViewer?.kind === 'video' ? 'Subject videos' : 'Subject documents'}</Text>
                    <Text style={styles.dialogText}>{evidenceViewer?.subjectName}</Text>
                    <ScrollView style={styles.evidenceViewerList}>
                      {(() => {
                        const resources = (learnerDocumentMap[learner.id] || [])
                          .filter((resource) => resource.relatedSubjectId === evidenceViewer?.subjectId)
                          .filter((resource) => evidenceViewer?.kind === 'video' ? isLearnerVideoResource(resource) : !isLearnerVideoResource(resource));
                        if (resources.length === 0) {
                          return <Text style={styles.empty}>No {evidenceViewer?.kind === 'video' ? 'videos' : 'documents'} are linked to this subject yet.</Text>;
                        }
                        return resources.map((resource) => (
                          <View key={resource.id} style={styles.linkedDocumentCard}>
                            <View style={styles.linkedDocumentHeader}>
                              <View style={styles.linkedDocumentTextBlock}>
                                <Text style={styles.linkedDocumentTitle}>{resource.title}</Text>
                                <Text style={styles.linkedDocumentMeta}>{formatDocumentTimestamp(resource.createdAt)}</Text>
                              </View>
                              <TouchableOpacity style={styles.inlineSaveButton} onPress={() => void openLearnerDocument(resource)} disabled={openingDocumentId === resource.id}>
                                <Ionicons name={evidenceViewer?.kind === 'video' ? 'play-outline' : 'open-outline'} size={18} color="#ffffff" />
                                <Text style={styles.inlineSaveButtonText}>{openingDocumentId === resource.id ? '…' : 'Open'}</Text>
                              </TouchableOpacity>
                            </View>
                            {resource.description ? <Text style={styles.linkedDocumentDescription}>{resource.description}</Text> : null}
                            {resource.fileName ? <Text style={styles.linkedDocumentMeta}>{resource.fileName} • {formatFileSize(resource.fileSizeBytes)}</Text> : null}
                          </View>
                        ));
                      })()}
                    </ScrollView>
                    <View style={styles.dialogActions}>
                      <TouchableOpacity style={styles.secondaryButton} onPress={() => setEvidenceViewer(null)}>
                        <Text style={styles.secondaryButtonText}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>

              {selectedLearnerForSubjects?.id === learner.id && subjectModalVisible ? (
                <View style={styles.inlineSubjectSheet}>
                  <Text style={styles.modalTitle}>Add subject to {selectedLearnerForSubjects?.fullName || 'learner'}</Text>
                  <Text style={styles.modalSubtitle}>Grade {selectedLearnerForSubjects?.gradeLevel || 'Not set'}</Text>

                  {(() => {
                    const assignmentGrade = selectedLearnerForSubjects?.gradeLevel || learner.gradeLevel;
                    const gradeNumber = Number(String(assignmentGrade || '').replace(/\D/g, '')) || 0;
                    const targetState = getSeniorCourseTargetState(learner.id);
                    if (gradeNumber < 10 || targetState.requirements.length === 0 || targetState.targetsSaved) return null;

                    return (
                      <View style={styles.subjectListBox}>
                        <Text style={styles.subjectListTitle}>Course cluster subjects · target marks</Text>
                        {targetState.requiredSubjects.map(({ requirement, subject }) => {
                          const subjectId = requirement.subjectId;
                          const subjectName = subject?.name || requirement.subjectName || subjectId;
                          return (
                            <View key={subjectId} style={styles.courseTargetRow}>
                              <View style={styles.courseTargetInfo}>
                                <Text style={styles.subjectBadgeText}>{subjectName}{subject?.code ? ` (${subject.code})` : ''}</Text>
                                <Text style={styles.subjectBadgeMeta}>
                                  {requirement.operator === 'OR' ? 'Course alternative' : 'Course required'}
                                  {Number.isInteger(requirement.minimumPoints) ? ` · minimum ${requirement.minimumPoints} CBE points` : ''}
                                </Text>
                              </View>
                              <TextInput
                                style={[styles.subjectPerformanceInput, styles.courseTargetInput, { fontWeight: 'bold', color: '#222' }]}
                                value={courseTargetMarkDrafts[subjectId] ?? (subject?.targetMarks === null || subject?.targetMarks === undefined ? '' : String(subject.targetMarks))}
                                onChangeText={(value) => setCourseTargetMarkDrafts((current) => ({ ...current, [subjectId]: value }))}
                                placeholder="Enter target marks"
                                placeholderTextColor="#444"
                                keyboardType="numeric"
                              />
                            </View>
                          );
                        })}
                        <TouchableOpacity
                          style={[styles.primaryButton, savingSubject && styles.primaryButtonDisabled]}
                          onPress={() => void saveSeniorCourseTargets(learner)}
                          disabled={savingSubject}
                        >
                          <View style={styles.buttonContentRow}>
                            {savingSubject ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                            <Text style={styles.primaryButtonText}>{savingSubject ? 'Saving...' : 'Save course target marks'}</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}

                  <View style={styles.subjectListBox}>
                    <Text style={styles.subjectListTitle}>Already added subjects</Text>
                    {(learnerSubjectsMap[learner.id] || []).length === 0 ? (
                      <Text style={styles.empty}>{subjectGroupsLoading ? 'Loading course-required subjects...' : 'No subjects added yet.'}</Text>
                    ) : (
                      (learnerSubjectsMap[learner.id] || []).map((subject) => {
                        const profile = learnerProfileMap[learner.id] || {};
                        const supportProfile = parseLearnerSupportProfile(profile.supportProfile) || profile;
                        const requiredItem = parseCourseClusterRequirements(supportProfile.clusterRequirements)?.subjectSequence
                          ?.find((item) => item.subjectId === subject.id);
                        return (
                          <AddedSubjectBadge
                            key={subject.id}
                            subject={subject}
                            requirementType={requiredItem ? (requiredItem.operator === 'OR' ? 'alternative' : 'mandatory') : undefined}
                            minimumPoints={requiredItem?.minimumPoints}
                            onRemove={() => Alert.alert(
                              'Remove subject?',
                              requiredItem
                                ? `Remove ${subject.name} from ${selectedLearnerForSubjects?.fullName || 'this learner'}? It will no longer be assigned to this learner, but it remains a requirement of the selected course.`
                                : `Remove ${subject.name} from ${selectedLearnerForSubjects?.fullName || 'this learner'}?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Remove', style: 'destructive', onPress: () => void removeSubjectFromLearner(learner.id, subject.id) },
                              ],
                            )}
                            removeLabel={`Remove ${subject.name} from ${selectedLearnerForSubjects?.fullName || 'learner'}`}
                          />
                        );
                      })
                    )}
                  </View>

                  {subjectAssignmentBlockReason ? (
                    <Text style={styles.empty}>{subjectAssignmentBlockReason}</Text>
                  ) : Number(String(selectedLearnerForSubjects?.gradeLevel || learner.gradeLevel || '').replace(/\D/g, '')) >= 10 &&
                    getSeniorCourseTargetState(learner.id).requirements.length > 0 &&
                    !getSeniorCourseTargetState(learner.id).targetsSaved ? (
                    <Text style={styles.empty}>Save target marks for every course-required subject to unlock additional subjects.</Text>
                  ) : subjectSelectionStep === 'category' ? (
                    <View style={styles.categoryList}>
                      {(() => {
                        const grade = String(selectedLearnerForSubjects?.gradeLevel || learner.gradeLevel || '').trim();
                        const normalizedGrade = grade.replace(/\D/g, '');
                        const options = ['Senior Secondary', 'Junior Secondary', 'Vocational SNE'];

                        if (['7', '8', '9'].includes(normalizedGrade)) {
                          return ['Junior Secondary'];
                        }

                        if (['10', '11', '12'].includes(normalizedGrade)) {
                          return ['Senior Secondary'];
                        }

                        return options;
                      })().map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={styles.categoryButton}
                          onPress={() => {
                            const nextCategory = option as 'Senior Secondary' | 'Junior Secondary' | 'Vocational SNE';
                            setSelectedSubjectCategory(nextCategory);
                            setSubjectSelectionStep('subjects');
                            void loadCategorySubjects(nextCategory, learner);
                          }}
                        >
                          <Text style={styles.categoryButtonText}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : subjectSelectionStep === 'subjects' ? (
                    <View>
                      <TextInput
                        style={[styles.input, { fontWeight: 'bold', color: '#222' }]}
                        value={subjectFilterQuery}
                        onChangeText={setSubjectFilterQuery}
                        placeholder="Search subjects by name or code"
                        placeholderTextColor="#444"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    {subjectGroupsLoading ? (
                      <View style={styles.loadingBox}>
                        <ActivityIndicator size="small" color="#1d4ed8" />
                        <Text style={styles.modalLoadingText}>Loading subjects...</Text>
                      </View>
                    ) : subjectGroups.length === 0 ? (
                      <Text style={styles.empty}>No subjects are available for this selection yet.</Text>
                    ) : (
                      <ScrollView
                        style={styles.subjectList}
                        contentContainerStyle={styles.subjectListContent}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                      >
                        {subjectGroups.map((group) => {
                          const normalizedGroupTitle = group.title === 'Electives' || /PATHWAY|pathway/i.test(group.title)
                            ? 'Electives'
                            : group.title;
                          const assignedSubjects = learnerSubjectsMap[learner.id] || [];
                          const filterQuery = subjectFilterQuery.trim().toLowerCase();
                          const availableSubjects = group.items.filter((subject) => !assignedSubjects.some((assigned) =>
                            assigned.id === subject.id || assigned.name.trim().toLowerCase() === subject.name.trim().toLowerCase(),
                          )).filter((subject) => !filterQuery || `${subject.name} ${subject.code}`.toLowerCase().includes(filterQuery));

                          return (
                            <View key={normalizedGroupTitle || group.title} style={styles.subjectGroup}>
                              <Text style={styles.subjectGroupTitle}>{normalizedGroupTitle}</Text>
                              {availableSubjects.length === 0 ? (
                                <Text style={styles.empty}>{filterQuery ? 'No unassigned subjects match that name or code.' : 'No subjects in this category yet.'}</Text>
                              ) : (
                                availableSubjects.map((subject) => (
                                  <TouchableOpacity
                                    key={`${normalizedGroupTitle}-${subject.id}`}
                                    style={styles.subjectItem}
                                    onPress={() => {
                                      setSelectedSubjectCandidate(subject);
                                      setSubjectSelectionStep('details');
                                      setTargetMarksInput('');
                                    }}
                                  >
                                    <Text style={styles.subjectItemCode}>{subject.code}</Text>
                                    <Text style={styles.subjectItemName}>{subject.name}</Text>
                                  </TouchableOpacity>
                                ))
                              )}
                            </View>
                          );
                        })}
                      </ScrollView>
                    )}
                    </View>
                  ) : (
                    <View>
                      <Text style={styles.detailLabel}>Selected subject</Text>
                      <Text style={styles.subjectDetailName}>{selectedSubjectCandidate?.name || 'Subject'}</Text>

                      <Text style={styles.detailLabel}>Target marks</Text>
                      <TextInput
                        style={styles.input}
                        value={targetMarksInput}
                        onChangeText={setTargetMarksInput}
                        placeholder="Target marks"
                        keyboardType="numeric"
                        placeholderTextColor="#6b7280"
                      />

                      <View style={styles.detailActions}>
                        <TouchableOpacity
                          style={styles.secondaryButton}
                          onPress={() => {
                            setSelectedSubjectCandidate(null);
                            setTargetMarksInput('');
                            setSubjectSelectionStep('subjects');
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>Back</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.primaryButton, savingSubject && styles.primaryButtonDisabled]}
                          onPress={() => {
                            if (!selectedSubjectCandidate) {
                              setNotice('Please select a subject before saving.');
                              return;
                            }
                            void addSubjectToLearner(selectedSubjectCandidate, targetMarksInput);
                          }}
                          disabled={savingSubject}
                        >
                          <View style={styles.buttonContentRow}>
                            {savingSubject ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                            <Text style={styles.primaryButtonText}>{savingSubject ? 'Saving...' : 'Save subject'}</Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => {
                      setSubjectModalVisible(false);
                      setSelectedLearnerForSubjects(null);
                      setSelectedSubjectCandidate(null);
                      setSelectedSubjectCategory('');
                      setSubjectGroups([]);
                      setTargetMarksInput('');
                      setSubjectSelectionStep('category');
                    }}
                  >
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ))
        )}
      </SectionCard>

    </ScrollView>
  );
}

function AddedSubjectBadge({
  subject,
  requirementType,
  minimumPoints,
  onRemove,
  removeLabel,
}: {
  subject: { name: string; code?: string; targetMarks?: number | null };
  requirementType?: 'alternative' | 'mandatory';
  minimumPoints?: number;
  onRemove?: () => void;
  removeLabel: string;
}) {
  const metadata = requirementType
    ? `${requirementType === 'alternative' ? 'Alternative' : 'Mandatory'}${Number.isInteger(minimumPoints) ? ` · Min ${minimumPoints} CBE pts` : ''}${typeof subject.targetMarks === 'number' ? ` · Target ${subject.targetMarks}` : ''}`
    : typeof subject.targetMarks === 'number' ? `Target: ${subject.targetMarks}` : 'Target not set';

  return (
    <View style={styles.subjectBadge}>
      <View style={styles.subjectBadgeContent}>
        <Text numberOfLines={1} style={styles.subjectBadgeText}>
          {subject.name}{subject.code ? ` (${subject.code})` : ''}
        </Text>
        <Text numberOfLines={1} style={styles.subjectBadgeMeta}>{metadata}</Text>
      </View>
      {onRemove ? (
        <TouchableOpacity accessibilityLabel={removeLabel} style={styles.removeSubjectButton} onPress={onRemove}>
          <Text style={styles.removeSubjectButtonText}>×</Text>
        </TouchableOpacity>
      ) : requirementType ? (
        <View style={styles.requiredSubjectMarker}>
          <Text style={styles.requiredSubjectMarkerText}>✓</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f3f4f6',
  },
  screenLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#374151',
  },
  modalLoadingText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 15,
    color: '#b91c1c',
    fontWeight: '700',
    textAlign: 'center',
  },
  teacherName: {
    fontSize: 21,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#4b5563',
    marginTop: 4,
  },
  notice: {
    marginTop: 12,
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '600',
  },
  classRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  classButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  classButtonActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  classButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  classButtonTextActive: {
    color: '#ffffff',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gradeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  gradeChip: {
    minWidth: 54,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  gradeChipSelected: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  gradeChipText: {
    fontWeight: '700',
    color: '#374151',
  },
  gradeChipTextSelected: {
    color: '#ffffff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#ffffff',
    color: '#111827',
    marginBottom: 10,
  },
  dropdownText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    paddingVertical: 2,
  },
  placeholderText: {
    color: '#6b7280',
    fontWeight: '500',
  },
  centeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  optionList: {
    maxHeight: 300,
    minHeight: 120,
    marginTop: 10,
  },
  optionListContent: {
    paddingBottom: 8,
    gap: 8,
  },
  optionHint: {
    fontSize: 13,
    color: '#4b5563',
    fontWeight: '600',
  },
  optionRow: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f9fafb',
  },
  optionRowSelected: {
    borderColor: '#1d4ed8',
    backgroundColor: '#eff6ff',
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  optionMeta: {
    fontSize: 12,
    color: '#4b5563',
    marginTop: 4,
    fontWeight: '600',
  },
  courseRequirementsSummary: {
    marginTop: 4,
  },
  optionRequirementsText: {
    marginTop: 4,
    color: '#334155',
    fontSize: 12,
    lineHeight: 17,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  genderOption: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  genderOptionSelected: {
    backgroundColor: '#dbeafe',
    borderColor: '#1d4ed8',
  },
  genderOptionText: {
    color: '#374151',
    fontWeight: '700',
  },
  genderOptionTextSelected: {
    color: '#1d4ed8',
  },
  formActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
  },
  evidenceViewerCard: {
    maxHeight: '82%',
  },
  evidenceViewerList: {
    maxHeight: 380,
    marginBottom: 12,
  },
  dialogTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  dialogText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#374151',
    marginBottom: 18,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#111827',
    fontWeight: '700',
  },
  primaryButton: {
    flex: 2,
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  empty: {
    color: '#6b7280',
    fontSize: 14,
  },
  learnerRow: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
    marginTop: 8,
  },
  learnerLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  learnerMetaText: {
    flexShrink: 1,
    flex: 1,
  },
  learnerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  learnerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    flexShrink: 1,
    flex: 1,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 0,
  },
  iconText: {
    color: '#1d4ed8',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  inlineSubjectSheet: {
    marginTop: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#4b5563',
    marginBottom: 12,
  },
  categoryList: {
    gap: 10,
    marginBottom: 12,
  },
  categoryButton: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  categoryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  subjectSummaryBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    marginBottom: 6,
  },
  subjectSummaryTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1f2937',
    marginBottom: 8,
  },
  subjectSummaryList: {
    gap: 6,
  },
  subjectListBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  subjectListTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1f2937',
    marginBottom: 8,
  },
  subjectBadge: {
    backgroundColor: '#e0f2fe',
    borderRadius: 10,
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subjectBadgeContent: { flex: 1, minWidth: 0, gap: 2 },
  subjectBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  subjectBadgeMeta: {
    fontSize: 11,
    color: '#1d4ed8',
    fontWeight: '700',
  },
  requiredSubjectMarker: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center' },
  requiredSubjectMarkerText: { color: '#1d4ed8', fontSize: 12, fontWeight: '800' },
  courseTargetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  courseTargetInfo: {
    flex: 1,
    gap: 2,
  },
  courseTargetInput: {
    width: 88,
    marginTop: 0,
  },
  removeSubjectButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  removeSubjectButtonText: {
    color: '#b91c1c',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 16,
  },
  subjectList: {
    maxHeight: 260,
    minHeight: 180,
  },
  subjectListContent: {
    paddingBottom: 8,
  },
  chartCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    alignItems: 'center',
  },
  chartLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 10,
  },
  chartLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chartLegendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 4,
  },
  chartLegendText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
  chartRows: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    gap: 8,
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 32,
  },
  chartBarsWrap: {
    width: '100%',
    height: 88,
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
  },
  chartTargetBar: {
    width: '100%',
    borderRadius: 4,
    opacity: 0.7,
  },
  chartValueBar: {
    width: '100%',
    borderRadius: 4,
  },
  chartLabel: {
    marginTop: 6,
    fontSize: 10,
    color: '#374151',
    fontWeight: '700',
    textAlign: 'center',
  },
  chartAxisLabel: {
    fontSize: 10,
    color: '#374151',
    fontWeight: '700',
  },
  graphModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  graphModalCard: {
    width: '100%',
    maxWidth: 520,
    height: '90%',
    backgroundColor: '#f8fafc',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  graphModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  graphModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  graphCloseButton: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  graphCloseButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  graphModalScroll: {
    flex: 1,
  },
  graphModalContent: {
    paddingBottom: 24,
    gap: 8,
  },
  summaryCard: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    padding: 8,
    marginBottom: 10,
  },
  summaryTitle: {
    fontSize: 11,
    color: '#1e40af',
    fontWeight: '700',
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '800',
  },
  chartSection: {
    marginBottom: 12,
  },
  chartSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  linkedDocumentList: {
    marginTop: 14,
    gap: 10,
  },
  linkedDocumentCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  linkedDocumentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  linkedDocumentTextBlock: {
    flex: 1,
    gap: 2,
  },
  linkedDocumentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  linkedDocumentMeta: {
    fontSize: 12,
    color: '#4b5563',
    fontWeight: '600',
  },
  linkedDocumentDescription: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  rubricScrollView: {
    maxHeight: 360,
    minHeight: 220,
  },
  rubricScrollContent: {
    paddingBottom: 8,
    gap: 4,
  },
  subjectGroup: {
    marginBottom: 14,
  },
  subjectGroupTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1f2937',
    marginBottom: 8,
  },
  subjectItem: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
    marginBottom: 8,
  },
  subjectItemCode: {
    fontWeight: '800',
    color: '#1d4ed8',
    fontSize: 12,
  },
  subjectItemName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginTop: 2,
  },
  subjectItemMeta: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  subjectPerformanceRow: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  subjectPerformanceInfo: {
    flex: 1,
    minWidth: 0,
  },
  subjectPerformanceUpdateBox: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4,
    width: 72,
  },
  subjectEvidenceActions: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  subjectEvidenceButton: {
    minHeight: 34,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
  },
  subjectEvidenceButtonText: {
    color: '#1e293b',
    fontSize: 12,
    fontWeight: '700',
  },
  subjectEvidenceButtonDisabled: {
    color: '#94a3b8',
  },
  subjectPerformanceInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: '#f9fafb',
    color: '#111827',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    minHeight: 28,
  },
  inlineSaveButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineSaveButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginTop: 8,
    marginBottom: 6,
  },
  subjectDetailName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  closeButton: {
    marginTop: 16,
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    fontWeight: '700',
    color: '#111827',
  },
});
