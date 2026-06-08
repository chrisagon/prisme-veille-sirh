import { useState, useEffect, FormEvent, useRef } from "react";
import {
  Sparkles,
  Printer,
  Download,
  Plus,
  Trash,
  Tag,
  AlertTriangle,
  BookOpen,
  Briefcase,
  ExternalLink,
  CheckCircle,
  FileText,
  X,
  Info,
  Calendar,
  Flame,
  LayoutGrid,
  ShieldAlert,
  Save,
  Edit,
  History,
  Check,
  Copy,
  Trophy,
  Award,
  Crown,
  GraduationCap,
  User as UserIcon,
  Lock,
  Mail,
  LogOut,
  Cloud,
  Database,
  ShieldCheck,
  RefreshCw,
  Zap,
  Bell,
  Clock,
  Send
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { defaultReports, VeilleReport } from "./data/defaultReports";
import { HRConseilLogo } from "./components/HRConseilLogo";
import { seedVeilleSourcesIfEmpty } from "./lib/veilleSeed";
import { SourceManager } from "./components/admin/SourceManager";
import {
  auth, 
  db, 
  OperationType, 
  handleFirestoreError, 
  testConnection,
  googleSignIn,
  cachedAccessToken
} from "./lib/firebase";
import { 
  onAuthStateChanged, 
  User, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  GoogleAuthProvider, 
  signInWithPopup 
} from "firebase/auth";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  collection, 
  getDocs, 
  query, 
  where,
  serverTimestamp
} from "firebase/firestore";

function safeHref(url: string | undefined | null, fallback = "https://www.actuel-rh.fr/"): string {
  if (typeof url !== "string" || url.length === 0) return fallback;
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return url;
    return fallback;
  } catch {
    return fallback;
  }
}

const getSourceUrl = (source: string, url?: string): string => {
  if (url && url.trim().length > 0) return url;
  
  const srcLower = source.toLowerCase();
  if (srcLower.includes("actuel-rh") || srcLower.includes("actuel rh")) {
    return "https://www.actuel-rh.fr/rss";
  }
  if (srcLower.includes("parlons rh") || srcLower.includes("parlonsrh")) {
    return "https://www.parlonsrh.com/flux-rss/";
  }
  if (srcLower.includes("centre inffo") || srcLower.includes("centre-inffo")) {
    return "https://www.centre-inffo.fr/centre-inffo/nos-flux-rss";
  }
  if (srcLower.includes("adp") || srcLower.includes("rh info") || srcLower.includes("rhinfo")) {
    return "https://www.fr.adp.com/rhinfo.aspx";
  }
  if (srcLower.includes("rh matin") || srcLower.includes("rhmatin")) {
    return "https://www.rhmatin.com/";
  }
  if (srcLower.includes("newstank") || srcLower.includes("news tank")) {
    return "https://rh.newstank.fr";
  }
  if (srcLower.includes("edrh")) {
    return "https://edrh.fr/flux-rss";
  }
  if (srcLower.includes("mgen")) {
    return "https://recrutement.mgen.fr/offre-de-emploi/tous-les-flux-rss.aspx";
  }
  if (srcLower.includes("ademe")) {
    return "https://recrutement.ademe.fr/offre-de-emploi/tous-les-flux-rss.aspx";
  }
  if (srcLower.includes("talent-soft") || srcLower.includes("talentsoft")) {
    return "https://groupeadp-recrute.talent-soft.com/offre-de-emploi/tous-les-flux-rss.aspx";
  }
  if (srcLower.includes("passerelles")) {
    return "https://passerelles.economie.gouv.fr/offre-de-emploi/tous-les-flux-rss.aspx";
  }
  
  // Default fallback instead of empty
  return "https://www.actuel-rh.fr/rss";
};

const ACCULTURATION_LESSONS = [
  {
    id: "lesson_ia_act",
    title: "Comprendre l'IA Act Européen",
    summary: "L'IA Act classe les systèmes d'IA RH (recrutement, évaluations) comme 'haut risque'. Ils nécessitent des garanties de transparence, de traçabilité et d'absence de biai.",
    points: 40,
    readTime: "1 min",
  },
  {
    id: "lesson_prompting",
    title: "L'Art du Prompting pour DRH",
    summary: "Pour obtenir des analyses fines de profils, cadrez les prompts de l'IA avec un rôle (ex: DRH de transition), un contexte précis et le format de sortie désiré.",
    points: 40,
    readTime: "1 min",
  },
  {
    id: "lesson_rgpd_teams",
    title: "Analyse Sémantique & RGPD",
    summary: "Comparer les humeurs ou prédire le turnover par analyse automatisée du chat d'entreprise (Slack, Teams) exige un consentement transparent et éclairé.",
    points: 40,
    readTime: "1.5 min",
  }
];

const QUIZZES: Record<string, {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}[]> = {
  "2026-w21": [
    {
      question: "Quelle catégorie de risque s'applique aux IA de tri de CV / évaluation selon l'IA Act ?",
      options: [
        "Faible risque (libre d'obligations d'audit)",
        "Haut risque (audits d'explicabilité et de transparence exigés)",
        "Risque minime (auto-évaluation volontaire)"
      ],
      answerIndex: 1,
      explanation: "L'évaluation, la promotion et le recrutement assisté par IA sont classés 'Haut risque', impliquant des contrôles préalables stricts."
    },
    {
      question: "À quoi sert principalement Lucca Copilot dans sa phase d'expérimentation pilote ?",
      options: [
        "Aider les managers en analysant en temps réel les conventions collectives complexes",
        "Rédiger de faux comptes-rendus d'entretien d'embauche",
        "Traduire des textes de droit social en japonais"
      ],
      answerIndex: 0,
      explanation: "Lucca Copilot analyse les règles complexes des conventions collectives pour sécuriser les décisions de congés des managers."
    },
    {
      question: "Quel est l'avertissement de la CNIL concernant les analyses sémantiques sur Teams / Slack ?",
      options: [
        "C'est considéré comme une surveillance illicite sans motif légitime ni consentement",
        "C'est une obligation légale de sécurité pour l'entreprise",
        "C'est réservé uniquement aux entreprises de moins de 50 salariés"
      ],
      answerIndex: 0,
      explanation: "La CNIL qualifie de surveillance illicite l'analyse automatique sans consentement ou motif légitime pour mesurer l'engagement des salariés."
    }
  ],
  "2026-w20": [
    {
      question: "Qu'est-ce que SAP SuccessFactors a intégré pour aider les recruteurs ?",
      options: [
        "Un générateur de salaires automatiques et aléatoires",
        "Des copilotes d'entretien améliorés générant des questions de compétences de manière contextuelle",
        "Un système de pointage biométrique obligatoire"
      ],
      answerIndex: 1,
      explanation: "SAP SuccessFactors propose désormais des aides à l'entretien d'embauche contextuelles optimisées par IA."
    },
    {
      question: "Quelle nouvelle revendication syndicale est apparue récemment en Europe ?",
      options: [
        "L'obligation de travailler à distance le mardi",
        "Le droit à la 'Dé-automatisation délibérée' des parcours de carrière",
        "L'interdiction absolue de toute forme de messageries d'entreprise"
      ],
      answerIndex: 1,
      explanation: "Les syndicats européens réclament le droit légitime de contester ou refuser une gestion de carrière 100% automatisée."
    }
  ]
};

const LIBRARY_SOURCES = [
  { name: "Actuel RH", url: "https://www.actuel-rh.fr/" },
  { name: "Parlons RH", url: "https://www.parlonsrh.com/" },
  { name: "Centre Inffo", url: "https://www.centre-inffo.fr/" },
  { name: "ADP (RH Info)", url: "https://www.fr.adp.com/rhinfo.aspx" },
  { name: "RH Matin", url: "https://www.rhmatin.com/" },
  { name: "News Tank RH", url: "https://rh.newstank.fr" },
  { name: "EDRH", url: "https://edrh.fr/" },
  { name: "MGEN Recrutement", url: "https://recrutement.mgen.fr/" },
  { name: "ADEME", url: "https://recrutement.ademe.fr/" },
  { name: "Talentsoft (Groupe ADP)", url: "https://groupeadp-recrute.talent-soft.com/" },
  { name: "Passerelles", url: "https://passerelles.economie.gouv.fr/" },
];

export default function App() {
  // Load reports from localStorage or fallback to defaults
  const [reports, setReports] = useState<VeilleReport[]>(() => {
    const saved = localStorage.getItem("veille_reports");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse reports", e);
      }
    }
    return defaultReports;
  });

  const [selectedId, setSelectedId] = useState<string>(() => {
    return reports[0]?.id || "2026-w21";
  });

  const [editMode, setEditMode] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);

  // Sources admin panel (story 1.2)
  const [showSourcesPanel, setShowSourcesPanel] = useState(false);

  // Tag Filter
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // RSS Stats State
  const [rssCounts, setRssCounts] = useState<Record<string, number>>({});
  const [isFetchingRss, setIsFetchingRss] = useState(true);

  // AI Generation parameters
  const [rawText, setRawText] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);

  // Story 3.2 : force-scan admin. Token persistant en localStorage (saisie 1 fois
  // par device), state de scan en cours pour polling auto toutes les 3s.
  const [forceScanToken, setForceScanToken] = useState<string>(
    () => localStorage.getItem("prisme_admin_token") || "",
  );
  const [forceScanInFlight, setForceScanInFlight] = useState(false);
  const [forceScanStatus, setForceScanStatus] = useState<
    null | { scanId: string; weekId: string; runStatus: string; articlesScanned: number | null; articlesKept: number | null; errorMessage: string | null; finishedAt: string | null }
  >(null);

  // Copied status for visual feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Checklist tracking (key is: reportId-actionIndex)
  const [completedActions, setCompletedActions] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem("veille_completed_actions");
    return saved ? JSON.parse(saved) : {};
  });

  // Gamification tracking states
  interface GamificationState {
    completedLessons: string[];
    completedResources: string[];
    completedQuizzes: string[];
    quizScores?: Record<string, number>;
    streak: number;
    pointsOffset: number;
  }

  const [gamification, setGamification] = useState<GamificationState>(() => {
    const saved = localStorage.getItem("veille_gamification");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse gamification state", e);
      }
    }
    return {
      completedLessons: [],
      completedResources: [],
      completedQuizzes: [],
      streak: 5,
      pointsOffset: 0
    };
  });

  // Quiz interactive states
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [activeQuizQuestions, setActiveQuizQuestions] = useState<any[]>([]);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [academyTab, setAcademyTab] = useState<'quiz' | 'lessons' | 'badges' | 'leaderboard'>('quiz');
  
  // Newsletter Subscription & Schedule States
  const [newsletterEnabled, setNewsletterEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("prisme_newsletter_enabled");
    return saved === "true";
  });
  const [newsletterFrequency, setNewsletterFrequency] = useState<'daily' | 'weekly'>(() => {
    return (localStorage.getItem("prisme_newsletter_frequency") as 'daily' | 'weekly') || 'weekly';
  });
  const [newsletterAlias, setNewsletterAlias] = useState<string>(() => {
    return localStorage.getItem("prisme_newsletter_alias") || "";
  });
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleSendTestNewsletter = async () => {
    if (!currentUser || !currentUser.email) {
      showToast("❌ Veuillez vous connecter pour envoyer un test.");
      return;
    }

    setIsSendingTestEmail(true);
    try {
      const emailContent = `<h1>Extrait test de newsletter</h1><p>Ceci est un test d'envoi automatique via l'alias PRISME.</p>`;
        
      const res = await fetch("/api/newsletter/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: currentUser.email,
          subject: "Test Newsletter Prisme",
          html: emailContent,
          fromOverride: newsletterAlias || undefined
        })
      });

      if (!res.ok) {
        throw new Error("L'envoi a échoué.");
      }

      showToast(`✉️ Extrait Test envoyé avec succès à ${currentUser.email} !`);
    } catch (e: any) {
      console.error(e);
      showToast("⚠️ Erreur lors de l'envoi du test: " + e.message);
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  // Firebase Auth & Sync States
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const isSyncingRef = useRef(false);

  // Real Leaderboard State
  interface RealLeaderboardPlayer {
    uid: string;
    name: string;
    score: number;
    avatar: string;
  }
  const [realUsersLeaderboard, setRealUsersLeaderboard] = useState<RealLeaderboardPlayer[]>([]);

  // Authenticate user changes & load user's data from Firestore
  useEffect(() => {
    testConnection(); // Ensure connection check on initially booting
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      
      if (user) {
        // Start live profile database sync for the user
        setSyncStatus('syncing');
        isSyncingRef.current = true;
        let syncStep = "init";
        try {
          syncStep = "getDoc user";
          const userDocRef = doc(db, "users", user.uid);
          const userDocSnap = await getDoc(userDocRef);
          
          if (userDocSnap.exists()) {
            syncStep = "parse user";
            const data = userDocSnap.data();
            // Load and merge gamification and actions progress from Firestore
            setGamification({
              completedLessons: data.completedLessons || [],
              completedResources: data.completedResources || [],
              completedQuizzes: data.completedQuizzes || [],
              quizScores: data.quizScores || {},
              streak: data.streak || 5,
              pointsOffset: 0
            });
            if (data.completedActions) {
              setCompletedActions(data.completedActions);
            }
            if (data.newsletterEnabled !== undefined) {
              setNewsletterEnabled(data.newsletterEnabled);
              localStorage.setItem("prisme_newsletter_enabled", String(data.newsletterEnabled));
            }
            if (data.newsletterFrequency !== undefined) {
              setNewsletterFrequency(data.newsletterFrequency);
              localStorage.setItem("prisme_newsletter_frequency", data.newsletterFrequency);
            }
            if (data.newsletterAlias !== undefined) {
              setNewsletterAlias(data.newsletterAlias);
              localStorage.setItem("prisme_newsletter_alias", data.newsletterAlias);
            }
            showToast(`☁️ Données synchronisées ! Ravie de vous revoir !`);
          } else {
            syncStep = "setDoc initialProfile";
            // Check if we should inherit local data or start fresh
            // Clear local storage if it probably belonged to someone else? 
            // In this version, we save the guest progress to the new account.
            const initialProfile = {
              uid: user.uid,
              email: user.email || "",
              streak: gamification.streak || 5,
              completedLessons: gamification.completedLessons || [],
              completedResources: gamification.completedResources || [],
              completedQuizzes: gamification.completedQuizzes || [],
              quizScores: gamification.quizScores || {},
              completedActions: completedActions || {},
              newsletterEnabled: newsletterEnabled,
              newsletterFrequency: newsletterFrequency,
              newsletterAlias: newsletterAlias,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };
            await setDoc(userDocRef, initialProfile);
            showToast("✨ Bienvenue ! Votre progression locale est désormais sauvegardée en ligne.");
          }

          syncStep = "getDocs users";
          try {
            const usersQuery = query(collection(db, "users"));
            const usersSnapshot = await getDocs(usersQuery);
            const fetchedPlayers: RealLeaderboardPlayer[] = [];
            usersSnapshot.forEach(docSnap => {
              const uData = docSnap.data();
              const pActions = uData.completedActions ? Number(Object.values(uData.completedActions).filter(Boolean).length) * 50 : 0;
              const pLessons = Number(uData.completedLessons?.length || 0) * 40;
              const pRes = Number(uData.completedResources?.length || 0) * 25;
              const pQuizComp = Number(uData.completedQuizzes?.length || 0) * 100;
              const pQuizScores = uData.quizScores ? Number(Object.values(uData.quizScores).reduce((sum: number, s: any) => sum + (Number(s) * 50), 0)) : 0;
              const pTotal = 120 + pActions + pLessons + pRes + pQuizComp + pQuizScores;
              
              const initials = (uData.email || "?").substring(0, 2).toUpperCase();
              const namePart = (uData.email || "Utilisateur").split('@')[0];
              
              fetchedPlayers.push({
                uid: uData.uid,
                name: namePart,
                score: pTotal,
                avatar: initials
              });
            });
            setRealUsersLeaderboard(fetchedPlayers);
          } catch(e) {
             console.error("Could not fetch real users for leaderboard:", e);
          }

          syncStep = "getDocs reports";
          // Fetch all reports generated (for all users)
          const reportsQuery = query(collection(db, "reports"));
          const querySnapshot = await getDocs(reportsQuery);
          const userReports: VeilleReport[] = [];
          
          querySnapshot.forEach((docSnap) => {
            const docData = docSnap.data();
            // Convert to VeilleReport type
            userReports.push({
              id: docData.id,
              week: docData.week,
              top3: docData.top3 || [],
              actualites: docData.actualites || [],
              mouvements: docData.mouvements || [],
              reglementation: docData.reglementation || [],
              chiffre: docData.chiffre || { value: "", text: "", source: "" },
              signalFaible: docData.signalFaible || { title: "", description: "" },
              ressources: docData.ressources || [],
              actions: docData.actions || []
            });
          });

          // Sort reports descending by id (e.g., 2026-w25 > 2026-w24)
          userReports.sort((a, b) => b.id.localeCompare(a.id));

          if (userReports.length > 0) {
            setReports((prev) => {
              // Prepend custom reports but filter duplicates by ID
              const existingIds = prev.map(r => r.id);
              const uniqueUserReports = userReports.filter(ur => !existingIds.includes(ur.id));
              const combined = [...uniqueUserReports, ...prev];
              // Give priority to newer ones over older ones
              combined.sort((a, b) => b.id.localeCompare(a.id));
              return combined;
            });
            setSelectedId(userReports[0].id);
          }

          setSyncStatus('synced');

          // Seed initial des sources de veille (CAP-1) — admin uniquement
          if (
            user.email === "christof.thomas@gmail.com" ||
            user.email?.toLowerCase().includes("admin")
          ) {
            void seedVeilleSourcesIfEmpty();
          }
        } catch (err) {
          console.error(`Error during Firestore synchronising (step: ${syncStep}):`, err);
          setSyncStatus('error');
          showToast("⚠️ Erreur de synchronisation avec la base de données.");
        } finally {
          isSyncingRef.current = false;
        }
      } else {
        setSyncStatus('idle');
      }
    });

    return () => unsubscribe();
  }, []);

  // Update Firestore when progress changes (debounce by 1.2s to save quota)
  useEffect(() => {
    if (!currentUser || isSyncingRef.current) return;

    const syncUserData = async () => {
      try {
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
          streak: gamification.streak || 5,
          completedLessons: gamification.completedLessons || [],
          completedResources: gamification.completedResources || [],
          completedQuizzes: gamification.completedQuizzes || [],
          quizScores: gamification.quizScores || {},
          completedActions: completedActions || {},
          newsletterEnabled: newsletterEnabled,
          newsletterFrequency: newsletterFrequency,
          newsletterAlias: newsletterAlias,
          updatedAt: serverTimestamp()
        });
        setSyncStatus('synced');
      } catch (err) {
        console.error("Failed to update user profile in Firestore (updateDoc):", err);
        setSyncStatus('error');
      }
    };

    const delayDebounceFn = setTimeout(() => {
      syncUserData();
    }, 1200);

    return () => clearTimeout(delayDebounceFn);
  }, [gamification, completedActions, newsletterEnabled, newsletterFrequency, newsletterAlias, currentUser]);

  // Save changes locally in localStorage (as reactive fallback & prompt load)
  useEffect(() => {
    localStorage.setItem("veille_reports", JSON.stringify(reports));
  }, [reports]);

  // Fetch RSS stats for Bibliothèque de Sources
  useEffect(() => {
    const fetchRssStats = async () => {
      try {
        const sourcesUrls = LIBRARY_SOURCES.map(source => getSourceUrl(source.name, source.url));
        const res = await fetch("/api/rss-stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: sourcesUrls })
        });
        if (res.ok) {
          const data = await res.json();
          // Map back to the name or original URL
          const newCounts: Record<string, number> = {};
          LIBRARY_SOURCES.forEach(source => {
            const feedUrl = getSourceUrl(source.name, source.url);
            newCounts[source.name] = data.counts?.[feedUrl] || 0;
          });
          setRssCounts(newCounts);
        }
      } catch (err) {
        console.error("Failed to fetch RSS stats:", err);
      } finally {
        setIsFetchingRss(false);
      }
    };
    
    fetchRssStats();
  }, []);

  useEffect(() => {
    localStorage.setItem("veille_completed_actions", JSON.stringify(completedActions));
  }, [completedActions]);

  useEffect(() => {
    localStorage.setItem("veille_gamification", JSON.stringify(gamification));
  }, [gamification]);

  useEffect(() => {
    localStorage.setItem("prisme_newsletter_enabled", String(newsletterEnabled));
  }, [newsletterEnabled]);

  useEffect(() => {
    localStorage.setItem("prisme_newsletter_frequency", newsletterFrequency);
  }, [newsletterFrequency]);

  useEffect(() => {
    localStorage.setItem("prisme_newsletter_alias", newsletterAlias);
  }, [newsletterAlias]);

  // Determine if the current user is an administrator
  const isAdmin = !!(currentUser && (
    currentUser.email === "christof.thomas@gmail.com" ||
    currentUser.email?.toLowerCase().includes("admin")
  ));

  useEffect(() => {
    if (!isAdmin) {
      setEditMode(false);
    }
  }, [isAdmin]);

  // Find active report safely
  const activeReport = reports.find((r) => r.id === selectedId) || reports[0];

  // Synchroniser les questions du quizz de la semaine active
  useEffect(() => {
    setSelectedAnswers({});
    setCurrentQuestionIdx(0);
    setQuizScore(null);
    setQuizSubmitted(false);
    
    if (activeReport) {
      if (QUIZZES[activeReport.id]) {
        setActiveQuizQuestions(QUIZZES[activeReport.id]);
      } else {
        const mainTheme = activeReport.week || "cette semaine";
        setActiveQuizQuestions([
          {
            question: `Selon les données de ${mainTheme}, quel est le thème central traité en priorité ?`,
            options: [
              "La conformité réglementaire de l'IA (IA Act européen) et l'atténuation des biais",
              "L'utilisation d'IA générative pour rédiger des blagues de bureau",
              "La création d'un système de pointage vidéo continu sans accord syndical"
            ],
            answerIndex: 0,
            explanation: "La conformité éthique, le RGPD et l'IA Act constituent l'épine dorsale de l'intelligence de veille."
          },
          {
            question: "Quelle est la recommandation clé concernant l'usage interne de l'IA générative ?",
            options: [
              "Chaque collaborateur peut librement y envoyer des données de salariés non masquées",
              "Il faut impérativement encadrer l'IA par une charte sécurisée et préserver la validation humaine",
              "L'IA doit valider seule la paie sans aucune surveillance de l'équipe comptable"
            ],
            answerIndex: 1,
            explanation: "Les plateformes exigent une charte stricte d'acculturation et un contrôle humain à 100% sur les décisions critiques."
          }
        ]);
      }
    }
  }, [selectedId, activeReport]);

  const pointsFromActions = Number(Object.values(completedActions).filter(Boolean).length) * 50;
  const pointsFromLessons = Number(gamification.completedLessons?.length || 0) * 40;
  const pointsFromResources = Number(gamification.completedResources?.length || 0) * 25;
  const pointsFromQuizzesComp = Number(gamification.completedQuizzes?.length || 0) * 100;
  const pointsFromQuizzesScores = gamification.quizScores ? Number(Object.values(gamification.quizScores).reduce((sum: number, s: any) => sum + (Number(s) * 50), 0)) : 0;
  const pointsFromQuizzes = pointsFromQuizzesComp + pointsFromQuizzesScores;
  const totalPoints = 120 + pointsFromActions + pointsFromLessons + pointsFromResources + pointsFromQuizzes;

  const streakDays = gamification.streak || 5;

  const fakeLeaderboardPlayers = [
    { name: "Sophie Bertrand (Manager Conseil SIRH)", score: 1250, isUser: false, avatar: "SB" },
    { name: "Thomas Dubois (Consultant Senior)", score: 850, isUser: false, avatar: "TD" },
    { name: "Vous (Consultant SIRH)", score: totalPoints, isUser: true, avatar: "VS" },
    { name: "Pauline Lefebvre (Consultante GPT/SIRH)", score: 480, isUser: false, avatar: "PL" },
    { name: "Alexis Moreau (Consultant Junior)", score: 255, isUser: false, avatar: "AM" }
  ];

  let leaderboardPlayers = fakeLeaderboardPlayers;
  if (currentUser && realUsersLeaderboard.length > 0) {
    leaderboardPlayers = realUsersLeaderboard.map(p => ({
      name: p.uid === currentUser.uid ? `Vous (${p.name})` : p.name,
      score: p.uid === currentUser.uid ? totalPoints : p.score,
      isUser: p.uid === currentUser.uid,
      avatar: p.avatar
    }));
    // Determine if fake users should be merged as baseline or pure list of actual users. Let's do pure actual users, but add fake users if less than 3 reals.
    if (leaderboardPlayers.length === 1) {
       leaderboardPlayers = [...leaderboardPlayers, ...fakeLeaderboardPlayers.filter(p => !p.isUser)];
    }
  } else if (!currentUser) {
    leaderboardPlayers = fakeLeaderboardPlayers;
  }

  const sortedLeaderboard = [...leaderboardPlayers].sort((a, b) => b.score - a.score);
  const userRankIndex = sortedLeaderboard.findIndex((player) => player.isUser) + 1;

  const badgesList = [
    {
      id: "novice",
      title: "Éclaireur Novice",
      desc: "Atteindre 150 points d'acculturation IA.",
      unlocked: totalPoints >= 150,
      icon: GraduationCap,
      color: "text-blue-400 bg-blue-500/10 border-blue-500/20"
    },
    {
      id: "ethique",
      title: "Gardien IA Act",
      desc: "Valider votre première action recommandée.",
      unlocked: Object.values(completedActions).filter(Boolean).length >= 1,
      icon: ShieldAlert,
      color: "text-amber-400 bg-amber-500/10 border-amber-500/30"
    },
    {
      id: "reader",
      title: "Rat de Bibliothèque",
      desc: "Fidéliser votre apprentissage avec 2 lectures de ressources.",
      unlocked: (gamification.completedResources?.length || 0) >= 2,
      icon: BookOpen,
      color: "text-purple-400 bg-purple-500/10 border-purple-500/30"
    },
    {
      id: "quizzer",
      title: "Aigle de la Veille",
      desc: "Compléter haut la main un Quizz de veille hebdomadaire.",
      unlocked: (gamification.completedQuizzes?.length || 0) >= 1,
      icon: Trophy,
      color: "text-green-400 bg-green-500/10 border-green-500/30"
    },
    {
      id: "supremer",
      title: "Stratège Suprême",
      desc: "Trôner à plus de 500 points au tableau d'honneur.",
      unlocked: totalPoints >= 500,
      icon: Crown,
      color: "text-pink-400 bg-pink-500/10 border-pink-500/30"
    }
  ];

  // If no reports somehow, create structured fallback
  const handleAddNewEmpty = () => {
    const newReport: VeilleReport = {
      id: "report-" + Date.now(),
      week: "Semaine du " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
      top3: [
        "Faite marquant numéro 1 à personnaliser ou générer via IA.",
        "Deuxième fait marquant clé sur l'évolution du marché ou de la réglementation.",
        "Troisième élément prospectif concernant l'intégration de technologies IA."
      ],
      actualites: [
        {
          title: "Nouvel événement technologique majeur",
          source: "Source Officielle",
          date: new Date().toLocaleDateString("fr-FR"),
          summary: "Résumé de la tendance ou annonce stratégique RH sous format condensé de plusieurs lignes.",
          impact: "Quels sont les impacts directs pour un DSI et un DRH de façon pragmatique ?",
          tags: ["marché", "recrutement"]
        }
      ],
      mouvements: [
        {
          title: "Exemple d'éditeur",
          details: "Nouvelles options d'onboarding conversationnel assisté par modèle de langage.",
          category: "Fonctionnalité"
        }
      ],
      reglementation: [
        {
          title: "Directive européenne IA",
          detail: "Point de vigilance concernant la conformité éthique nécessaire du scoring.",
          type: "IA Act"
        }
      ],
      chiffre: {
        value: "50%",
        text: "Exemple de taux de satisfaction ou d'utilisation de l'intelligence artificielle générative dans les processus de gestion administrative.",
        source: "Sondage RH 2026"
      },
      signalFaible: {
        title: "Tendance montante",
        description: "Analyse prospective des nouveaux besoins d'acculturation technologique d'équipe."
      },
      ressources: [
        {
          title: "Livre blanc : IA, Éthique et SI RH",
          duration: "Lecture 15 min",
          type: "Rapport"
        }
      ],
      actions: [
        {
          title: "Organiser une session d'information",
          detail: "Présenter les résultats de la veille technologique à la direction générale."
        }
      ]
    };

    setReports([newReport, ...reports]);
    setSelectedId(newReport.id);
    setEditMode(true); // switch automatically to refine

    // Store in Firestore if signed in
    if (currentUser) {
      const dbReportRef = doc(db, "reports", newReport.id);
      setDoc(dbReportRef, {
        id: newReport.id,
        ownerId: currentUser.uid,
        week: newReport.week,
        top3: newReport.top3,
        actualites: newReport.actualites,
        mouvements: newReport.mouvements,
        reglementation: newReport.reglementation,
        chiffre: newReport.chiffre,
        signalFaible: newReport.signalFaible,
        ressources: newReport.ressources,
        actions: newReport.actions,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }).catch(err => {
        handleFirestoreError(err, OperationType.CREATE, `reports/${newReport.id}`);
      });
    }
  };

  const handleDeleteReport = async (idToDelete: string) => {
    const filtered = reports.filter((r) => r.id !== idToDelete);
    setReports(filtered);
    if (selectedId === idToDelete && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    }

    // Sync delete with Firestore if authenticated
    if (currentUser) {
      const dbReportRef = doc(db, "reports", idToDelete);
      deleteDoc(dbReportRef).catch(err => {
        console.error("Failed to delete from firestore", err);
      });
    }
    showToast("🗑️ Rapport supprimé");
  };

  // Safe updater for active report attributes
  const updateActiveReport = (updatedFields: Partial<VeilleReport>) => {
    if (!activeReport) return;
    const nextReports = reports.map((r) => {
      if (r.id === activeReport.id) {
        const nr = { ...r, ...updatedFields };
        // Sync report update to Firestore if user is authenticated and is custom report
        if (currentUser && nr.id.startsWith("report-")) {
          const dbReportRef = doc(db, "reports", nr.id);
          setDoc(dbReportRef, {
            id: nr.id,
            ownerId: currentUser.uid,
            week: nr.week,
            top3: nr.top3,
            actualites: nr.actualites,
            mouvements: nr.mouvements,
            reglementation: nr.reglementation,
            chiffre: nr.chiffre,
            signalFaible: nr.signalFaible,
            ressources: nr.ressources,
            actions: nr.actions,
            createdAt: serverTimestamp(), // since our firestore.rules requires incoming().createdAt == existing().createdAt, let's omit or send with merge setup
            updatedAt: serverTimestamp()
          }, { merge: true }).catch(err => {
            console.error("Firestore update failed:", err);
          });
        }
        return nr;
      }
      return r;
    });
    setReports(nextReports);
  };

  const handleForceAutoGenerate = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    try {
      showToast("⏳ Génération automatique de la semaine en cours...");
      const res = await fetch("/api/veille/auto-generate");
      if (!res.ok) throw new Error("Erreur serveur lors de la génération automatique.");
      const data = await res.json();
      if (!data.success || !data.report) throw new Error("Format de réponse invalide.");
      
      const newReport = data.report;
      
      let finalId = newReport.id;

      // Check if it already exists slightly
      if (!reports.some(r => r.id === newReport.id)) {
        setReports(prev => {
          const combined = [newReport, ...prev];
          combined.sort((a,b) => b.id.localeCompare(a.id));
          return combined;
        });
      }
      setSelectedId(newReport.id);
      
      if (currentUser) {
        const dbReportRef = doc(db, "reports", newReport.id);
        await setDoc(dbReportRef, {
          id: newReport.id,
          ownerId: currentUser.uid,
          week: newReport.week,
          top3: newReport.top3,
          actualites: newReport.actualites,
          mouvements: newReport.mouvements,
          reglementation: newReport.reglementation,
          chiffre: newReport.chiffre,
          signalFaible: newReport.signalFaible,
          ressources: newReport.ressources,
          actions: newReport.actions,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      showToast("✨ Veille hebdomadaire générée et diffusée !");
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || "Erreur de génération automatique");
      showToast("⚠️ " + (err.message || "Erreur"));
    } finally {
      setIsGenerating(false);
    }
  };

  // AI Generator Submit
  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    setIsGenerating(true);
    setGenerationError(null);
    setIsSimulated(false);

    try {
      const response = await fetch("/api/veille/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText, customInstructions }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || "Erreur réseau ou réponse invalide de l'API");
      }

      const data = await response.json();
      if (data.report) {
        const generated: VeilleReport = {
          ...data.report,
          id: "report-" + Date.now(),
        };
        // Add parsed report to state
        setReports([generated, ...reports]);
        setSelectedId(generated.id);
        setIsSimulated(!!data.simulated);
        setShowGenerator(false);
        setRawText("");
        setCustomInstructions("");

        // Store Custom Generated Report in Firestore if signed in
        if (currentUser) {
          const dbReportRef = doc(db, "reports", generated.id);
          setDoc(dbReportRef, {
            id: generated.id,
            ownerId: currentUser.uid,
            week: generated.week,
            top3: generated.top3,
            actualites: generated.actualites,
            mouvements: generated.mouvements,
            reglementation: generated.reglementation,
            chiffre: generated.chiffre,
            signalFaible: generated.signalFaible,
            ressources: generated.ressources,
            actions: generated.actions,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }).catch(err => {
            handleFirestoreError(err, OperationType.CREATE, `reports/${generated.id}`);
          });
        }
      } else {
        throw new Error("Structure de rapport incorrecte");
      }
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || "Impossible de générer la veille");
    } finally {
      setIsGenerating(false);
    }
  };

  // Story 3.2 : handler "Forcer le scan" admin. Fire-and-forget : on lance
  // le scan via POST /api/veille/force-scan (réponse 200 immédiat avec scanId),
  // puis on poll GET /api/veille/scan-status/:scanId toutes les 3s jusqu'à
  // status terminal (success | failed). Affiche un toast d'arrivée.
  // AC : token requis (saisi dans la barre admin), pas d'auth via cookie/session.
  const handleForceScan = async () => {
    if (!forceScanToken) {
      showToast("🔑 Token admin requis pour forcer un scan.");
      return;
    }
    setForceScanInFlight(true);
    setForceScanStatus(null);
    try {
      const res = await fetch("/api/veille/force-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${forceScanToken}`,
        },
      });
      if (res.status === 401) {
        showToast("🚫 Token admin invalide.");
        return;
      }
      if (res.status === 429) {
        showToast("⏱️ Rate limit atteint, réessaie dans 1 min.");
        return;
      }
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        showToast(`⚠️ Scan déjà en cours (${data.existingScanId ?? "?"}).`);
        return;
      }
      if (res.status === 503) {
        showToast("🛑 Firestore indispo côté serveur, réessaie plus tard.");
        return;
      }
      if (!res.ok) {
        showToast(`❌ Erreur HTTP ${res.status} au lancement du scan.`);
        return;
      }
      const data = await res.json() as { scanId: string; weekId: string };
      showToast(`🚀 Scan ${data.scanId.slice(0, 12)}… lancé pour ${data.weekId}.`);
      // Polling toutes les 3s jusqu'à status terminal.
      const poll = async (): Promise<void> => {
        try {
          const r = await fetch(`/api/veille/scan-status/${data.scanId}`, {
            headers: { Authorization: `Bearer ${forceScanToken}` },
          });
          if (!r.ok) {
            // 404 = doc pas encore créé par createScanRun (race), on continue.
            // 503 = Firestore indispo transitoire, on continue.
            if (r.status !== 404 && r.status !== 503) {
              const txt = await r.text();
              console.warn("[force-scan] poll error", r.status, txt);
            }
          } else {
            const run = await r.json() as {
              scanId: string;
              weekId: string;
              runStatus: string;
              articlesScanned: number | null;
              articlesKept: number | null;
              errorMessage: string | null;
              finishedAt: string | null;
            };
            setForceScanStatus(run);
            if (run.runStatus === "running") {
              setTimeout(poll, 3000);
              return;
            }
            // Status terminal.
            setForceScanInFlight(false);
            if (run.runStatus === "success") {
              const kept = run.articlesKept ?? 0;
              const scanned = run.articlesScanned ?? 0;
              showToast(
                kept > 0
                  ? `✅ Scan OK : ${scanned} articles scannés, ${kept} retenus dans le rapport.`
                  : `✅ Scan OK : ${scanned} articles, mais aucun retenu (semaine vide).`,
              );
            } else if (run.runStatus === "failed") {
              showToast(`❌ Scan échoué : ${run.errorMessage ?? "erreur inconnue"}.`);
            }
            return;
          }
        } catch (e) {
          console.warn("[force-scan] poll crashed", e);
        }
        setTimeout(poll, 3000);
      };
      void poll();
    } catch (err: any) {
      console.error("[force-scan] launch crashed", err);
      showToast(`❌ Erreur réseau : ${err?.message ?? "inconnue"}`);
      setForceScanInFlight(false);
    }
  };

  // Persistance du token admin (1 saisie par device, pas de re-prompt).
  const updateForceScanToken = (value: string) => {
    setForceScanToken(value);
    try {
      if (value) localStorage.setItem("prisme_admin_token", value);
      else localStorage.removeItem("prisme_admin_token");
    } catch {
      // localStorage indispo (mode privé Safari) → on garde en mémoire, c'est tout.
    }
  };

  // Toggle checklist actions
  const toggleAction = (index: number) => {
    const key = `${activeReport.id}-${index}`;
    const willBeCompleted = !completedActions[key];
    setCompletedActions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    if (willBeCompleted) {
      showToast("🚀 Action de veille validée ! +50 PTS d'acculturation !");
    } else {
      showToast("Action décochée !");
    }
  };

  const getCompletedCount = () => {
    if (!activeReport) return 0;
    return activeReport.actions.filter((_, idx) => completedActions[`${activeReport.id}-${idx}`]).length;
  };

  // Helper to extract unique tags for navigation filtering
  const getAllUniqueTags = () => {
    const tagsSet = new Set<string>();
    activeReport?.actualites?.forEach((item) => {
      item.tags?.forEach((t) => tagsSet.add(t.toLowerCase()));
    });
    return Array.from(tagsSet);
  };

  const filteredActualites = activeReport?.actualites?.filter((item) => {
    if (!selectedTag) return true;
    return item.tags?.some((t) => t.toLowerCase() === selectedTag.toLowerCase());
  }) || [];

  const handlePrint = () => {
    window.print();
  };

  const copyToClipboard = () => {
    if (!activeReport) return;
    
    // Construct beautifully indented text fallback
    let text = `📡 VEILLE IA & SIRH — ${activeReport.week.toUpperCase()}\n\n`;
    text += `🔥 TOP 3 DES INFORMATIONS CLÉS :\n`;
    activeReport.top3.forEach((item, idx) => {
      text += `${idx + 1}. ${item}\n`;
    });
    
    text += `\n📰 ACTUALITÉS & INNOVATIONS :\n`;
    activeReport.actualites.forEach((item) => {
      text += `- ${item.title} | ${item.source} (${item.date})\n  Résumé : ${item.summary}\n  Impact RH : ${item.impact}\n  Tags : [${item.tags.join("] [")}]\n\n`;
    });

    text += `🏢 MOUVEMENTS DES ACTEURS DU MARCHÉ :\n`;
    activeReport.mouvements.forEach((item) => {
      text += `- [${item.category}] ${item.title} : ${item.details}\n`;
    });

    text += `\n⚖️ RÉGLEMENTAIRE & ÉTHIQUE :\n`;
    activeReport.reglementation.forEach((item) => {
      text += `- [${item.type}] ${item.title} : ${item.detail}\n`;
    });

    text += `\n📊 CHIFFRE DE LA SEMAINE :\n`;
    text += `${activeReport.chiffre.value} - ${activeReport.chiffre.text} (Source: ${activeReport.chiffre.source})\n`;

    text += `\n🔮 SIGNAL FAIBLE :\n`;
    text += `${activeReport.signalFaible.title} : ${activeReport.signalFaible.description}\n`;

    text += `\n✅ ACTIONS RECOMMANDÉES :\n`;
    activeReport.actions.forEach((item, idx) => {
      let meta = "";
      if (item.confidentiality || item.criticality) {
        const parts = [];
        if (item.confidentiality) parts.push(`Sécurité: ${item.confidentiality}`);
        if (item.criticality) parts.push(`Criticité: ${item.criticality}`);
        meta = ` [${parts.join(", ")}]`;
      }
      text += `${idx + 1}. ${item.title} : ${item.detail}${meta}\n`;
    });

    text += `\n--- © 2026 Veille IA & SIRH Tracker`;

    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(activeReport.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthError(null);
    setAuthLoading(true);

    try {
      if (authMode === "signup") {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        showToast("🎉 Compte créé ! Vos progrès sont sauvegardés.");
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
        showToast("🔓 Connexion réussie ! Vos données sont synchronisées.");
      }
      setShowAuthModal(false);
    } catch (err: any) {
      console.error(err);
      let frenchError = "Une erreur est survenue lors de l'identification.";
      if (err.code === "auth/email-already-in-use") {
        frenchError = "Cette adresse email est déjà associée à un compte.";
      } else if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
        frenchError = "Identifiants invalides. Veuillez réessayer.";
      } else if (err.code === "auth/weak-password") {
        frenchError = "Le mot de passe doit contenir au moins 6 caractères.";
      } else if (err.code === "auth/invalid-email") {
        frenchError = "L'adresse email saisie est incorrecte.";
      }
      setAuthError(frenchError);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await googleSignIn();
      showToast("🔐 Connexion Google réussie !");
      setShowAuthModal(false);
    } catch (err: any) {
      console.error(err);
      if (err.code === "auth/operation-not-allowed") {
        setAuthError("Erreur : La connexion par Google n'est pas activée. Veuillez l'activer dans la console Firebase (Authentication > Modes de connexion > Google).");
      } else if (err.code === "auth/popup-closed-by-user") {
        // User just closed the popup, don't show a giant error
        setAuthError(null);
      } else {
        setAuthError("Connexion Google annulée ou indisponible.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  // Pre-fill prompt generator to help users
  const insertSampleText = (type: string) => {
    if (type === "workday") {
      setRawText(`Workday a dévoilé lors de sa conférence européenne Q2 2026 ses futurs agents d'IA générative connectés aux flux Microsoft Teams. Les employés pourront valider leurs congés parentaux et même ajuster à la voix leurs objectifs de performance directement dans Teams. Les syndicats s'interrogent sur les horaires de travail masqués par l'instantanéité des réponses. 

D'autre part, la CNIL a publié un avertissement sévère le 19 mai 2026 concernant l'utilisation non consentie de modèles d'analyse de tonalité sur les messages de chat d'entreprise pour prédire le turnover. L'autorité exige un consentement lucide pour chaque traitement.`);
    } else if (type === "lucca") {
      setRawText(`L'éditeur SIRH français Lucca prépare le lancement généralisé de son moteur d'aide juridique 'Lucca Copilot'. Ce dernier traite les demandes de récupération, RTT ou congés exceptionnels complexes en les comparant à un référentiel de 80 conventions collectives françaises pour souligner les anomalies de paie ou risques légaux avant validation par le manager.

Par ailleurs, un baromètre Gartner publié la semaine dernière révèle que 74% des DRH placent l'IA générative comme priorité SI majeure en 2026, mais décrient un déficit de formation d'acculturation technique généralisé (18% se sentent équipés juridiquement).`);
    } else {
      setRawText(`ADP explore le rachat d'une pépite spécialisée dans l'évaluation équitable pour s'armer face à l'entrée en vigueur de l'IA Act européen cet été pour les outils d'aide au recrutement d'équipe. La pépite nationale HumaniAI propose un bouclier tiers d'explicabilité pour les scores algorithmiques.`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col p-4 md:p-6 transition-colors duration-300">
      
      {/* Toast Notifications */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 border bg-gradient-to-br from-slate-850 to-slate-900 border-sky-500/60 shadow-2xl text-slate-100 rounded-xl px-4 py-3 text-xs tracking-wide flex items-center gap-2.5 animate-bounce max-w-sm">
          <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
          <span className="font-semibold text-slate-200">{toastMessage}</span>
        </div>
      )}

      {/* Simulation Banner */}
      {isSimulated && (
        <div className="no-print bg-amber-500/20 border border-amber-500/40 text-amber-300 px-4 py-2.5 rounded-lg mb-4 text-xs flex justify-between items-center">
          <span className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Mode Simulation intelligent :</strong> L'API Key n'étant pas configurée, le système a synthétisé un rapport pré-calculé ultra-réaliste pour Mai 2026.
            </span>
          </span>
          <button 
            onClick={() => setIsSimulated(false)}
            className="text-amber-400 font-bold hover:underline"
          >
            Masquer
          </button>
        </div>
      )}

      {/* Header Section */}
      <header className="flex flex-col md:flex-row md:justify-between md:items-center border-b border-slate-800 pb-5 mb-6 gap-4">
        {/* Title Details */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shadow-lg shadow-hr-navy/20 border border-slate-800 shrink-0 select-none p-1.5 transition hover:scale-105">
            <HRConseilLogo size={42} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight uppercase text-white flex items-center gap-1.5" id="app-title">
                🔮 PRISME
              </h1>
              <span className="no-print hidden sm:inline-block text-[9px] bg-hr-navy/30 text-hr-green-light px-2.5 py-0.5 rounded-full border border-hr-green/30 font-mono tracking-wider font-extrabold uppercase">
                HRConseil
              </span>
            </div>
            <p className="text-slate-400 text-xs tracking-wider uppercase mt-0.5 flex items-center gap-1.5">
              <span>Veille technologique & stratégique • Conseil SIRH</span>
              <span className="text-slate-650 font-bold">•</span>
              <span className="text-hr-green-light font-bold lowercase tracking-normal">{activeReport?.week || "Option active"}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="no-print flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Week selector dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1.5 rounded-lg border border-slate-700">
            <History className="w-3.5 h-3.5 text-slate-400 ml-1" />
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setEditMode(false);
                setSelectedTag(null);
              }}
              className="bg-transparent text-xs text-slate-200 focus:outline-none pr-2 font-medium cursor-pointer"
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id} className="bg-slate-800 text-slate-200">
                  {r.week}
                </option>
              ))}
            </select>
          </div>

          {isAdmin && (
            <>
              <button
                onClick={handleAddNewEmpty}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition"
                title="Créer une trame vide à éditer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Créer Trame</span>
              </button>

              <button
                onClick={() => setEditMode(!editMode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
                  editMode
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                }`}
              >
                {editMode ? <Save className="w-3.5 h-3.5 text-amber-400" /> : <Edit className="w-3.5 h-3.5" />}
                <span>{editMode ? "Verrouiller Édition" : "Éditer le rapport"}</span>
              </button>

              <button
                onClick={handleForceAutoGenerate}
                disabled={isGenerating}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-indigo-600/20 border border-indigo-500/25 transition cursor-pointer disabled:opacity-50"
                title="Forcer la génération Cron automatique"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Cron Auto (Hebdo)</span>
              </button>

              {/* Story 3.2 : bouton "Forcer Scan" + input token admin. Token
                  persisté en localStorage (clé `prisme_admin_token`) pour éviter
                  de le redemander à chaque clic. Badge status live sous le bouton. */}
              <input
                type="password"
                value={forceScanToken}
                onChange={(e) => updateForceScanToken(e.target.value)}
                placeholder="Token admin"
                aria-label="Token admin (force-scan)"
                className="bg-slate-900/80 border border-slate-700 hover:border-slate-600 focus:border-hr-green focus:outline-none text-slate-200 placeholder:text-slate-500 px-2 py-1.5 rounded-lg text-xs w-32 transition"
                title="VEILLE_ADMIN_TOKEN — saisi 1 fois, persisté en localStorage"
              />
              <button
                onClick={handleForceScan}
                disabled={forceScanInFlight || !forceScanToken}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 border border-emerald-500/25 transition cursor-pointer disabled:opacity-50"
                title="Forcer un scan immédiat (toutes sources, ignore le cron hebdo)"
              >
                <Zap className={`w-3.5 h-3.5 ${forceScanInFlight ? "animate-pulse" : ""}`} />
                <span className="hidden sm:inline">{forceScanInFlight ? "Scan…" : "Forcer Scan"}</span>
              </button>
              {forceScanStatus && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    forceScanStatus.runStatus === "success"
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : forceScanStatus.runStatus === "failed"
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                      : "bg-slate-700/60 text-slate-300 border border-slate-600"
                  }`}
                  title={`scanId=${forceScanStatus.scanId} weekId=${forceScanStatus.weekId}`}
                >
                  {forceScanStatus.runStatus}
                  {forceScanStatus.runStatus === "success" && forceScanStatus.articlesScanned != null && (
                    <> · {forceScanStatus.articlesScanned} sc.</>
                  )}
                  {forceScanStatus.runStatus === "success" && forceScanStatus.articlesKept != null && (
                    <>, {forceScanStatus.articlesKept} gardés</>
                  )}
                </span>
              )}

              <button
                onClick={() => setShowGenerator(!showGenerator)}
                className="bg-hr-green hover:bg-hr-green-light text-[#002233] px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-hr-green/20 border border-hr-green/25 transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                <span className="hidden sm:inline">Générer avec IA</span>
              </button>
            </>
          )}

          <button
            onClick={copyToClipboard}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded-lg border border-slate-700 flex items-center justify-center transition"
            title="Copier le rapport complet au presse-papiers"
          >
            {copiedId === activeReport?.id ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>

          <button
            onClick={handlePrint}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded-lg border border-slate-700 flex items-center justify-center transition"
            title="Imprimer ou Exporter en PDF"
          >
            <Printer className="w-4 h-4" />
          </button>

          {isAdmin && reports.length > 1 && (
            <button
              onClick={() => handleDeleteReport(activeReport.id)}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 p-1.5 rounded-lg border border-red-500/30 flex items-center justify-center transition"
              title="Supprimer cette semaine"
            >
              <Trash className="w-4 h-4" />
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => setShowSourcesPanel(!showSourcesPanel)}
              className={`p-1.5 rounded-lg border flex items-center justify-center transition ${
                showSourcesPanel
                  ? "bg-teal-500/20 text-teal-300 border-teal-500/40"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
              }`}
              title="Gérer les sources de veille"
              aria-label="Ouvrir le panneau des sources de veille"
            >
              <Database className="w-4 h-4" />
            </button>
          )}

          {/* User Profile Connected Menu or Signup Button */}
          {currentUser ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-700">
              <div className="flex flex-col items-end hidden sm:flex max-w-[125px] md:max-w-none">
                <span className="text-[10px] md:text-[11px] font-semibold text-slate-200 truncate flex items-center gap-1">
                  {currentUser.email}
                  {isAdmin ? (
                    <span className="text-[8px] bg-indigo-500/20 text-indigo-300 px-1 rounded font-mono font-bold border border-indigo-500/25">Admin</span>
                  ) : (
                    <span className="text-[8px] bg-slate-800 text-slate-400 px-1 rounded font-mono font-medium border border-slate-700">Lecteur</span>
                  )}
                </span>
                <span className="text-[9px] text-green-400 font-mono flex items-center gap-1">
                  <Cloud className="w-2.5 h-2.5 animate-pulse" /> Synchro Active {syncStatus === 'syncing' && <RefreshCw className="w-2 h-2 animate-spin" />}
                </span>
              </div>
              <button
                onClick={() => {
                  signOut(auth);
                  localStorage.removeItem("veille_gamification");
                  localStorage.removeItem("veille_completed_actions");
                  setGamification({ completedLessons: [], completedResources: [], completedQuizzes: [], streak: 5, pointsOffset: 0 });
                  setCompletedActions({});
                  setRealUsersLeaderboard([]);
                  showToast("👋 Déconnecté avec succès ! Mode local activé.");
                }}
                className="bg-slate-800 hover:bg-slate-700 hover:text-red-400 text-slate-300 p-1.5 rounded-lg border border-slate-700 flex items-center justify-center transition cursor-pointer"
                title="Se déconnecter de votre compte Cloud"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="pl-1.5 border-l border-slate-700/60 flex items-center">
              <button
                onClick={() => {
                  setAuthError(null);
                  setAuthEmail("");
                  setAuthPassword("");
                  setShowAuthModal(true);
                }}
                className="bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold border border-indigo-500/40 flex items-center gap-1.5 shadow-lg shadow-indigo-650/5 transition cursor-pointer"
                title="Se connecter ou créer un compte pour synchroniser vos rapports et points"
              >
                <UserIcon className="w-3.5 h-3.5" />
                <span>Créer un Compte / S'identifier</span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Interactive tag sidebar filter panel */}
      {activeReport?.actualites?.length > 0 && (
        <div className="no-print flex items-center flex-wrap gap-2 mb-4 bg-slate-800/20 p-2 rounded-xl border border-slate-800 text-xs">
          <span className="text-slate-400 ml-1 font-medium flex items-center gap-1">
            <Tag className="w-3 h-3 text-hr-green-light" />
            Filtrer les actualités par thème :
          </span>
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-2.5 py-0.5 rounded-md font-medium transition cursor-pointer ${
              selectedTag === null
                ? "bg-hr-green text-slate-950 font-bold shadow-sm shadow-hr-green/20"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Tout ({activeReport.actualites.length})
          </button>
          {getAllUniqueTags().map((tag) => {
            const count = activeReport.actualites.filter((act) => act.tags?.some((t) => t.toLowerCase() === tag)).length;
            return (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`px-2.5 py-0.5 rounded-md font-medium transition flex items-center gap-1 cursor-pointer ${
                  selectedTag === tag
                    ? "bg-hr-green text-slate-950 font-bold shadow-sm shadow-hr-green/20"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                #{tag} <span className="text-[10px] opacity-75">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Generator Overlay Panel */}
      {showGenerator && (
        <div className="no-print bg-slate-800 rounded-xl border border-slate-700 p-5 mb-6 shadow-xl transition-all duration-300">
          <div className="flex justify-between items-center pb-3 border-b border-slate-700 mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-sky-400" />
              <h3 className="font-bold text-slate-200">Générer un Rapport de Veille avec l'IA</h3>
            </div>
            <button
              onClick={() => setShowGenerator(false)}
              className="text-slate-400 hover:text-slate-200 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-widest">
                  1. Coller les flux ou notes à analyser
                </label>
                <div className="flex gap-2">
                  <span className="text-[10px] text-slate-500 my-auto">Gabarits rapides :</span>
                  <button
                    type="button"
                    onClick={() => insertSampleText("workday")}
                    className="text-[10px] bg-slate-900 hover:bg-slate-950 text-sky-400 px-2 py-0.5 rounded border border-slate-700 font-mono"
                  >
                    Actu Workday & CNIL
                  </button>
                  <button
                    type="button"
                    onClick={() => insertSampleText("lucca")}
                    className="text-[10px] bg-slate-900 hover:bg-slate-950 text-sky-400 px-2 py-0.5 rounded border border-slate-700 font-mono"
                  >
                    Lucca & Gartner
                  </button>
                  <button
                    type="button"
                    onClick={() => insertSampleText("adp")}
                    className="text-[10px] bg-slate-900 hover:bg-slate-950 text-sky-400 px-2 py-0.5 rounded border border-slate-700 font-mono"
                  >
                    ADP x HumaniAI
                  </button>
                </div>
              </div>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Exple: Workday et Microsoft lancent d'importantes mises à jour de leur intégration... La CNIL rappelle à l'ordre sur la surveillance..."
                rows={5}
                required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500 text-slate-200 placeholder-slate-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5 text-slate-300 uppercase tracking-widest">
                2. Consignes de cadrage ou requêtes (Optionnel)
              </label>
              <input
                type="text"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Exple: Mettre l'accent sur les outils de paie ou la réglementation éthique..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500 text-slate-200 placeholder-slate-500"
              />
            </div>

            {generationError && (
              <div className="bg-red-900/40 border border-red-500/30 text-red-200 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{generationError}</span>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRawText("");
                  setCustomInstructions("");
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold transition"
              >
                Vider
              </button>
              <button
                type="submit"
                disabled={isGenerating || !rawText.trim()}
                className="px-5 py-2 bg-hr-green hover:bg-hr-green-light text-slate-950 font-bold rounded-lg text-xs flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                    <span>Structuration en cours...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-slate-900" />
                    <span>Lancer l'analyse du rapport</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Grid View */}
      {activeReport ? (
        <main className="grid grid-cols-1 md:grid-cols-12 gap-6 flex-grow font-sans">
          
          {/* Left Sidebar: Market & Regulatory & Resources (3 cols / 12) */}
          <aside className="md:col-span-3 flex flex-col gap-6">

            {/* Gamification Hub - Académie de l'Acculturation */}
            <div className="bg-slate-800/60 p-4 rounded-xl border border-hr-green/20 relative overflow-hidden print:hidden glow-card shrink-0">
              <div className="absolute right-0 top-0 w-24 h-24 bg-hr-green/5 rounded-full blur-2xl pointer-events-none" />
              
              {/* Card Title & Streak */}
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="text-xs font-bold text-hr-green-light uppercase tracking-widest flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-hr-green shrink-0" />
                    Académie de Veille
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Acculturation active & Compétences IA</p>
                </div>
                <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  <Flame className="w-3.5 h-3.5 animate-pulse text-amber-500" />
                  <span>{streakDays} jours</span>
                </div>
              </div>

              {/* Progress Level */}
              <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-700/60 mb-3">
                <div className="flex justify-between items-center mb-1 text-xs">
                  <span className="font-semibold text-slate-200">
                    {totalPoints < 150 ? "Niveau 1 : Novice" : totalPoints < 300 ? "Niveau 2 : Explorateur" : totalPoints < 500 ? "Niveau 3 : Praticien Éthique" : "Niveau 4 : Expert Conseil SIRH"}
                  </span>
                  <span className="font-bold text-hr-green-light font-mono text-[13px]">{totalPoints} PTS</span>
                </div>
                
                {/* Level Progress Bar */}
                <div className="w-full bg-slate-900/95 h-1.5 rounded-full overflow-hidden border border-slate-700/50">
                  <div 
                    className="bg-gradient-to-r from-hr-navy-light to-hr-green h-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (totalPoints / 600) * 100)}%` }}
                  />
                </div>
                
                <p className="text-[9px] text-slate-500 mt-1">
                  Rang actuel : <strong className="text-slate-300 font-semibold">#{userRankIndex}e</strong> de la co-op Conseil SIRH
                </p>

                {/* Score breakdown metrics */}
                <div className="mt-2 pt-1.5 border-t border-slate-800/60 grid grid-cols-2 gap-x-2 gap-y-1 text-[8.5px] text-slate-400 font-mono">
                  <div className="flex justify-between">
                    <span>✅ Actions:</span>
                    <strong className="text-green-400">+{pointsFromActions} PTS</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>📚 Cours:</span>
                    <strong className="text-hr-green-light">+{pointsFromLessons} PTS</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>🏆 Quizz:</span>
                    <strong className="text-amber-400">+{pointsFromQuizzes} PTS</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>📖 Lectures:</span>
                    <strong className="text-indigo-400">+{pointsFromResources} PTS</strong>
                  </div>
                </div>
              </div>

              {/* Academy Tabs Navigation */}
              <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-900/70 rounded-lg mb-3 border border-slate-800 text-[9px] font-medium text-center">
                <button
                  type="button"
                  onClick={() => setAcademyTab('quiz')}
                  className={`py-1 rounded cursor-pointer transition ${academyTab === 'quiz' ? 'bg-hr-green text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Quizz
                </button>
                <button
                  type="button"
                  onClick={() => setAcademyTab('lessons')}
                  className={`py-1 rounded cursor-pointer transition ${academyTab === 'lessons' ? 'bg-hr-green text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Cours
                </button>
                <button
                  type="button"
                  onClick={() => setAcademyTab('badges')}
                  className={`py-1 rounded cursor-pointer transition ${academyTab === 'badges' ? 'bg-hr-green text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Badges
                </button>
                <button
                  type="button"
                  onClick={() => setAcademyTab('leaderboard')}
                  className={`py-1 rounded cursor-pointer transition ${academyTab === 'leaderboard' ? 'bg-hr-green text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Rangs
                </button>
              </div>

              {/* Academy Tab Area */}
              <div className="min-h-[170px] flex flex-col justify-between">
                {academyTab === 'quiz' && (
                  <div className="space-y-3.5 text-left w-full">
                    {gamification.completedQuizzes.includes(activeReport.id) ? (
                      <div className="py-6 text-center text-slate-300 flex flex-col items-center justify-center">
                        <Trophy className="w-9 h-9 text-amber-400 animate-bounce mb-2" />
                        <h5 className="font-bold text-xs text-green-400">Quizz accompli ! (+100 PTS)</h5>
                        <p className="text-[10px] text-slate-400 px-3 mt-1 leading-relaxed">Félicitations ! Vos compétences de veille stratégique de cette semaine sont au sommet.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setGamification(prev => ({
                              ...prev,
                              completedQuizzes: prev.completedQuizzes.filter(id => id !== activeReport.id)
                            }));
                            setQuizSubmitted(false);
                          }}
                          className="mt-4 text-[9px] bg-slate-900 hover:bg-slate-950 border border-slate-705 px-2 py-1 rounded text-slate-400 hover:text-slate-200 font-medium"
                        >
                          Recommencer le quizz
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activeQuizQuestions.length > 0 ? (
                          <>
                            {(() => {
                              const item = activeQuizQuestions[currentQuestionIdx];
                              if (!item) return null;
                              
                              return (
                                <div className="space-y-1.5">
                                  <div className="flex justify-between text-[9px] text-slate-400 font-mono tracking-wider">
                                    <span>QUESTION {currentQuestionIdx + 1}/{activeQuizQuestions.length}</span>
                                    <span className="text-sky-450 font-bold">+100 PTS</span>
                                  </div>
                                  <p className="text-[11px] font-semibold text-slate-200 leading-snug">
                                    {item.question}
                                  </p>
                                  
                                  <div className="space-y-1 pt-1 w-full">
                                    {item.options.map((option: string, optIdx: number) => {
                                      const isSelected = selectedAnswers[currentQuestionIdx] === optIdx;
                                      return (
                                        <button
                                          key={optIdx}
                                          type="button"
                                          onClick={() => {
                                            if (quizSubmitted) return;
                                            setSelectedAnswers(prev => ({ ...prev, [currentQuestionIdx]: optIdx }));
                                          }}
                                          className={`w-full text-left p-1.5 rounded text-[10px] border transition cursor-pointer leading-tight ${
                                            isSelected 
                                              ? "bg-sky-500/10 border-sky-400 text-slate-100 font-medium" 
                                              : "bg-slate-900/50 hover:bg-slate-900 border-slate-800 text-slate-400"
                                          }`}
                                        >
                                          {option}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <div className="flex justify-between items-center pt-1">
                                    <span className="text-[9px] text-slate-500 italic">
                                      {selectedAnswers[currentQuestionIdx] !== undefined ? "Choix sélectionné" : "Faites un choix"}
                                    </span>
                                    
                                    {selectedAnswers[currentQuestionIdx] !== undefined && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (currentQuestionIdx + 1 < activeQuizQuestions.length) {
                                            setCurrentQuestionIdx(prev => prev + 1);
                                          } else {
                                            let correctCount = 0;
                                            activeQuizQuestions.forEach((q, i) => {
                                              if (selectedAnswers[i] === q.answerIndex) {
                                                correctCount++;
                                              }
                                            });
                                            setQuizScore(correctCount);
                                            setQuizSubmitted(true);
                                            
                                            setGamification(prev => {
                                              const currentScore = prev.quizScores?.[activeReport.id] || 0;
                                              const newScores = { ...prev.quizScores };
                                              if (correctCount > currentScore) {
                                                newScores[activeReport.id] = correctCount;
                                              }
                                              
                                              const updates: any = { quizScores: newScores };
                                              
                                              if (correctCount === activeQuizQuestions.length && !prev.completedQuizzes.includes(activeReport.id)) {
                                                updates.completedQuizzes = [...prev.completedQuizzes, activeReport.id];
                                              }
                                              
                                              return { ...prev, ...updates };
                                            });

                                            if (correctCount === activeQuizQuestions.length) {
                                              showToast("🏆 Quizz réussi sans faute ! +100 PTS bonus !");
                                            } else {
                                              showToast(`Quizz terminé : ${correctCount}/${activeQuizQuestions.length} correctes. Points ajoutés !`);
                                            }
                                          }
                                        }}
                                        className="bg-sky-500 text-slate-950 font-bold px-2.5 py-1 rounded text-[9px] hover:bg-sky-400 transition"
                                      >
                                        {currentQuestionIdx + 1 < activeQuizQuestions.length ? "Suivant ›" : "Valider le quizz"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </>
                        ) : (
                          <p className="text-xs text-slate-400 italic">Aucune question disponible.</p>
                        )}

                        {quizSubmitted && quizScore !== null && (
                          <div className="mt-2 bg-slate-900/60 p-2 rounded border border-slate-700/60 text-[10px] text-slate-300 space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="font-bold">Résultats :</span>
                              <span className={`font-mono text-[11px] font-black ${quizScore === activeQuizQuestions.length ? "text-green-400" : "text-amber-450"}`}>
                                {quizScore} / {activeQuizQuestions.length} correct{quizScore > 1 ? "s" : ""}
                              </span>
                            </div>
                            <p className="leading-snug opacity-85">
                              {quizScore === activeQuizQuestions.length 
                                ? "Félicitations ! Sans-faute !" 
                                : "Erreur commise. Relisez le rapport de veille et recommencez !"}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAnswers({});
                                setCurrentQuestionIdx(0);
                                setQuizSubmitted(false);
                                setQuizScore(null);
                              }}
                              className="text-[9px] underline text-sky-455 hover:text-sky-300 block pt-0.5"
                            >
                              Faire un autre essai ?
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {academyTab === 'lessons' && (
                  <div className="space-y-2 text-left w-full">
                    <p className="text-[9px] text-slate-400">Validez des micro-leçons réglementaires :</p>
                    <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
                      {ACCULTURATION_LESSONS.map((lesson) => {
                        const isDone = gamification.completedLessons.includes(lesson.id);
                        return (
                          <div key={lesson.id} className="p-2 rounded bg-slate-900/40 border border-slate-800 flex flex-col justify-between">
                            <div>
                              <div className="flex justify-between items-center mb-0.5">
                                <span className={`text-[10px] font-bold ${isDone ? "text-slate-500 line-through" : "text-sky-300"}`}>
                                  {lesson.title}
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono">{lesson.readTime}</span>
                              </div>
                              <p className="text-[9px] text-slate-400 leading-relaxed mb-1.5">
                                {lesson.summary}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                let nextLessons = [...gamification.completedLessons];
                                if (isDone) {
                                  nextLessons = nextLessons.filter(id => id !== lesson.id);
                                  showToast("Compétence décochée");
                                } else {
                                  nextLessons.push(lesson.id);
                                  showToast(`🎉 Niveau d'accréditation atteint ! +40 PTS !`);
                                }
                                setGamification(prev => ({ ...prev, completedLessons: nextLessons }));
                              }}
                              className={`w-full text-center py-0.5 mt-0.5 rounded text-[9px] font-bold transition border cursor-pointer ${
                                isDone 
                                  ? "bg-sky-500/10 border-sky-500/20 text-sky-400" 
                                  : "bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-305"
                              }`}
                            >
                              {isDone ? "Validé ✓ +40 PTS" : "Marquer comme assimilé"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {academyTab === 'badges' && (
                  <div className="space-y-2 text-left w-full">
                    <p className="text-[9px] text-slate-400 mb-1">Afficher vos badges d'expertise :</p>
                    <div className="grid grid-cols-2 gap-1.5 max-h-[165px] overflow-y-auto pr-1">
                      {badgesList.map((badge) => {
                        const IconComponent = badge.icon;
                        return (
                          <div 
                            key={badge.id}
                            className={`p-1.5 rounded border flex flex-col items-center text-center justify-between transition relative group ${
                              badge.unlocked 
                                ? badge.color
                                : "bg-slate-900/30 border-slate-800/80 text-slate-550 filter grayscale"
                            }`}
                            title={badge.desc}
                          >
                            <div className="p-0.5 rounded bg-black/10 mb-1">
                              <IconComponent className="w-4 h-4 shrink-0" />
                            </div>
                            <span className="text-[8px] font-bold tracking-tight leading-tight mb-0.5">
                              {badge.title}
                            </span>
                            <span className="text-[7.5px] text-slate-500 font-mono tracking-wide leading-none">
                              {badge.unlocked ? "Gagné ✓" : "Verrouillé"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {academyTab === 'leaderboard' && (
                  <div className="space-y-1 w-full text-left">
                    <p className="text-[9px] text-slate-400 mb-1.5">Tableau d'honneur Co-Op Conseil SIRH :</p>
                    <div className="space-y-1 max-h-[155px] overflow-y-auto pr-1">
                      {sortedLeaderboard.map((player, idx) => (
                        <div 
                          key={player.name}
                          className={`flex items-center justify-between p-1 rounded text-[9.5px] border transition ${
                            player.isUser 
                              ? "bg-sky-500/15 border-sky-500/40 font-bold text-sky-300" 
                              : "bg-slate-900/30 border-transparent text-slate-400 text-slate-350"
                          }`}
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="font-mono text-slate-500 font-bold text-[9px] w-3 text-center">{idx + 1}</span>
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center font-bold text-[8px] flex-shrink-0 ${player.isUser ? "bg-sky-500 text-slate-950" : "bg-slate-850 text-slate-300"}`}>
                              {player.avatar}
                            </div>
                            <span className="truncate max-w-[115px] block">{player.name}</span>
                          </div>
                          <span className={`font-mono flex-shrink-0 ${player.isUser ? "text-sky-450 font-bold" : "text-slate-400 font-semibold"}`}>{player.score} PTS</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Programmation de la Newsletter */}
            <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/80 relative overflow-hidden print:hidden shrink-0 flex flex-col gap-3">
              <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
              
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Bell className="w-4 h-4 text-indigo-400 shrink-0" />
                    Diffusion & Newsletter
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Programmer l'envoi automatisé</p>
                </div>
                {currentUser && (
                  <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded-full ${newsletterEnabled ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-slate-900 text-slate-500 border border-slate-800'}`}>
                    {newsletterEnabled ? "ACTIVE" : "INACTIVE"}
                  </span>
                )}
              </div>

              {!currentUser ? (
                <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-700/60">
                  <p className="text-[10px] text-slate-400 leading-relaxed mb-2.5">
                    🔒 <strong className="text-slate-200">Option Réservée</strong> : Connectez-vous avec votre adresse e-mail pour programmer la réception automatique de la veille.
                  </p>
                  <button
                    onClick={() => {
                      setAuthError(null);
                      setAuthEmail("");
                      setAuthPassword("");
                      setShowAuthModal(true);
                    }}
                    className="w-full bg-indigo-650/40 hover:bg-indigo-600/50 text-indigo-200 hover:text-white py-1.5 rounded text-[10px] font-bold border border-indigo-500/30 transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <UserIcon className="w-3 h-3" />
                    <span>Créer un compte / S'identifier</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Enabled/Disabled toggle */}
                  <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded-lg border border-slate-800/80">
                    <span className="text-[11px] font-medium text-slate-200">Recevoir par email</span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextValue = !newsletterEnabled;
                        setNewsletterEnabled(nextValue);
                        showToast(nextValue ? "🔔 Abonnement configuré avec succès !" : "🔕 Envois automatiques suspendus.");
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${newsletterEnabled ? 'bg-green-500' : 'bg-slate-700'}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${newsletterEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>

                  {newsletterEnabled && (
                    <div className="space-y-2.5 animate-fadeIn">
                      <div>
                        <label className="block text-[9px] text-slate-400 uppercase tracking-wider mb-1">Fréquence préférée</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setNewsletterFrequency('daily');
                              showToast("📅 Fréquence définie : Quotidienne (Une fois par jour)");
                            }}
                            className={`py-1 rounded text-[10px] font-bold border cursor-pointer transition ${newsletterFrequency === 'daily' ? 'bg-slate-950 text-indigo-400 border-indigo-500/40 font-bold' : 'bg-slate-900/30 text-slate-500 border-transparent hover:text-slate-350'}`}
                          >
                            Quotidienne
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNewsletterFrequency('weekly');
                              showToast("📅 Fréquence définie : Hebdomadaire (Une fois par semaine)");
                            }}
                            className={`py-1 rounded text-[10px] font-bold border cursor-pointer transition ${newsletterFrequency === 'weekly' ? 'bg-slate-950 text-indigo-400 border-indigo-500/40 font-bold' : 'bg-slate-900/30 text-slate-500 border-transparent hover:text-slate-350'}`}
                          >
                            Hebdomadaire
                          </button>
                        </div>
                      </div>

                      {isAdmin && (
                        <div>
                          <label className="block text-[9px] text-slate-400 uppercase tracking-wider mb-1">
                            Alias d'envoi (Optionnel)
                          </label>
                          <input
                            type="text"
                            value={newsletterAlias}
                            onChange={(e) => setNewsletterAlias(e.target.value)}
                            placeholder="ex: Newsletter PRISME <newsletter.prisme@hrconseil.net>"
                            className="w-full bg-slate-900/50 border border-slate-700/60 rounded p-1.5 text-[10px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                          />
                          <p className="text-[8px] text-slate-500 mt-1.5 leading-snug">
                            Les e-mails seront envoyés depuis le serveur SMTP configuré. Assurez-vous que l'alias est autorisé par votre hébergeur (ex: OVH).
                          </p>
                        </div>
                      )}

                      <div className="p-2 bg-slate-900/30 rounded border border-slate-800/60 flex gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                        <div className="text-[9px] text-slate-400 leading-normal">
                          {newsletterFrequency === 'daily' ? (
                            <span>Chaque matin à <strong className="text-slate-300">8h30</strong>, la nouvelle veille extraite ce jour-là sera automatiquement expédiée à : <br/><strong className="text-indigo-350">{currentUser.email}</strong></span>
                          ) : (
                            <span>Chaque lundi à <strong className="text-slate-300">8h30</strong>, le rapport de veille de la semaine active sera synthétisé et envoyé à : <br/><strong className="text-indigo-350">{currentUser.email}</strong></span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSendTestNewsletter}
                    disabled={isSendingTestEmail}
                    className="w-full bg-slate-900 hover:bg-slate-950 text-slate-300 hover:text-white py-1.5 rounded text-[10px] font-bold border border-slate-700 hover:border-slate-600 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isSendingTestEmail ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                        <span>Compilation et envoi...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3 h-3 text-slate-400" />
                        <span>M'envoyer un extrait test</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            
            {/* Acteurs & Marché */}
            <section className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex flex-col print-card">
              <div className="flex justify-between items-center border-b border-slate-700 pb-2.5 mb-3">
                <h3 className="text-xs font-bold text-sky-400 uppercase tracking-tighter flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5 text-sky-400" />
                  🏢 Marché & Acteurs
                </h3>
                {editMode && (
                  <button
                    onClick={() => {
                      const nextMouvements = [
                        ...(activeReport.mouvements || []),
                        { title: "Nouvel Acteur", details: "Détails de l'actualité", category: "Fonctionnalité" }
                      ];
                      updateActiveReport({ mouvements: nextMouvements });
                    }}
                    className="text-[10px] bg-slate-900 text-sky-400 px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1"
                  >
                    <Plus className="w-2.5 h-2.5" /> Ajouter
                  </button>
                )}
              </div>

              {activeReport.mouvements?.length > 0 ? (
                <ul className="space-y-4 flex-grow">
                  {activeReport.mouvements.map((item, index) => (
                    <li key={index} className="border-l-2 border-sky-600 pl-3 relative group">
                      {editMode ? (
                        <div className="space-y-1 pr-6 pt-1">
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) => {
                              const list = [...activeReport.mouvements];
                              list[index].title = e.target.value;
                              updateActiveReport({ mouvements: list });
                            }}
                            className="bg-slate-950 text-xs font-semibold px-1.5 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <input
                            type="text"
                            value={item.category}
                            onChange={(e) => {
                              const list = [...activeReport.mouvements];
                              list[index].category = e.target.value;
                              updateActiveReport({ mouvements: list });
                            }}
                            className="bg-slate-950 text-[10px] text-sky-300 px-1.5 py-0.2 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <textarea
                            value={item.details}
                            rows={2}
                            onChange={(e) => {
                              const list = [...activeReport.mouvements];
                              list[index].details = e.target.value;
                              updateActiveReport({ mouvements: list });
                            }}
                            className="bg-slate-950 text-[11px] text-slate-300 px-1.5 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs font-bold text-slate-200">{item.title}</p>
                          <span className="text-[10px] text-sky-400 font-mono font-semibold uppercase">{item.category}</span>
                          <p className="text-[11px] text-slate-400 leading-snug mt-1">{item.details}</p>
                        </div>
                      )}

                      {editMode && (
                        <button
                          onClick={() => {
                            const list = activeReport.mouvements.filter((_, i) => i !== index);
                            updateActiveReport({ mouvements: list });
                          }}
                          className="absolute right-0 top-0 text-red-400 hover:text-red-300 p-1 rounded"
                          title="Supprimer l'acteur"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 italic">Aucun mouvement d'acteur indiqué.</p>
              )}
            </section>

            {/* Réglementaire & Éthique */}
            <section className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex flex-col print-card">
              <div className="flex justify-between items-center border-b border-slate-700 pb-2.5 mb-3">
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-tighter flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  ⚖️ Réglementaire & Éthique
                </h3>
                {editMode && (
                  <button
                    onClick={() => {
                      const nextReg = [
                        ...(activeReport.reglementation || []),
                        { title: "Point réglementaire", detail: "Exigences du RGPD ou IA Act", type: "IA Act" }
                      ];
                      updateActiveReport({ reglementation: nextReg });
                    }}
                    className="text-[10px] bg-slate-900 text-amber-400 px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1"
                  >
                    <Plus className="w-2.5 h-2.5" /> Ajouter
                  </button>
                )}
              </div>

              <div className="space-y-4 flex-grow">
                {activeReport.reglementation?.map((item, index) => (
                  <div key={index} className="bg-slate-900/50 p-3 rounded border border-slate-750 relative group">
                    {editMode ? (
                      <div className="space-y-1.5 pr-6">
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => {
                            const list = [...activeReport.reglementation];
                            list[index].title = e.target.value;
                            updateActiveReport({ reglementation: list });
                          }}
                          className="bg-slate-950 text-xs font-semibold px-1.5 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <input
                          type="text"
                          value={item.type}
                          onChange={(e) => {
                            const list = [...activeReport.reglementation];
                            list[index].type = e.target.value;
                            updateActiveReport({ reglementation: list });
                          }}
                          className="bg-slate-950 text-[10px] text-amber-300 px-1.5 py-0.2 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <textarea
                          value={item.detail}
                          rows={3}
                          onChange={(e) => {
                            const list = [...activeReport.reglementation];
                            list[index].detail = e.target.value;
                            updateActiveReport({ reglementation: list });
                          }}
                          className="bg-slate-950 text-[11px] text-slate-300 px-1.5 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                    ) : (
                      <>
                        <span className="text-[9px] bg-amber-400/10 text-amber-400 px-2 py-0.5 rounded border border-amber-400/20 font-mono font-bold uppercase tracking-wider block w-max mb-1">
                          {item.type}
                        </span>
                        <p className="text-xs font-bold text-slate-200 mb-1">{item.title}</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed font-sans">{item.detail}</p>
                      </>
                    )}

                    {editMode && (
                      <button
                        onClick={() => {
                          const list = activeReport.reglementation.filter((_, i) => i !== index);
                          updateActiveReport({ reglementation: list });
                        }}
                        className="absolute right-1 top-1 text-red-400 hover:text-red-300 p-1"
                        title="Supprimer la règle"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Bibliothèque de Sources */}
            <section className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 flex flex-col print-card">
              <div className="flex justify-between items-center border-b border-slate-700 pb-2.5 mb-3">
                <h3 className="text-xs font-bold text-teal-400 uppercase tracking-tighter flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-teal-400" />
                  📚 Bibliothèque de Sources
                  {isFetchingRss && <RefreshCw className="w-3 h-3 animate-spin text-slate-500 ml-1" />}
                </h3>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {LIBRARY_SOURCES.map((source, index) => {
                  const unreadCount = rssCounts[source.name] || 0;
                  return (
                    <a
                      key={index}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex justify-between items-center bg-slate-900/50 hover:bg-slate-800 p-2 rounded border border-slate-700/60 transition group cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-300 group-hover:text-teal-300 transition">
                          {source.name}
                        </span>
                        {unreadCount > 0 && (
                          <span className="inline-flex items-center justify-center bg-teal-500/20 text-teal-300 border border-teal-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-full" title="Nouveaux articles">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-teal-400 transition" />
                    </a>
                  );
                })}
              </div>
            </section>
          </aside>

          {/* Center Content: Top 3 & News Feed (6 cols / 12) */}
          <div className="md:col-span-6 flex flex-col gap-6">
            
            {/* Top 3 Section */}
            <section className="bg-slate-900 grid grid-cols-3 gap-3">
              {activeReport.top3?.map((fact, index) => (
                <div 
                  key={index} 
                  className={`border p-3 rounded-xl flex flex-col justify-between print-card relative group ${
                    index === 0 
                      ? "bg-sky-600/10 border-sky-500/40" 
                      : index === 1
                      ? "bg-purple-600/10 border-purple-500/40"
                      : "bg-pink-600/10 border-pink-500/40"
                  }`}
                >
                  <div className="flex items-start gap-2.5 text-left">
                    <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border select-none shrink-0 ${
                      index === 0
                        ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
                        : index === 1
                        ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                        : "bg-pink-500/10 border-pink-500/30 text-pink-400"
                    }`}>
                      0{index + 1}
                    </span>
                    <div className="flex-grow min-w-0">
                      {editMode ? (
                        <textarea
                          value={fact}
                          rows={3}
                          onChange={(e) => {
                            const list = [...activeReport.top3];
                            list[index] = e.target.value;
                            updateActiveReport({ top3: list });
                          }}
                          className="bg-slate-950 text-[10px] text-slate-200 p-1 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      ) : (
                        <p className="text-[10.5px] font-medium leading-normal text-slate-200">
                          {fact}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {editMode && (
                    <div className="mt-1 text-right">
                      <span className="text-[9px] text-slate-500">Modifier</span>
                    </div>
                  )}
                </div>
              ))}
            </section>

            {/* Innovations Feed */}
            <section className="bg-slate-800 p-5 rounded-xl border border-slate-700 flex-grow flex flex-col print-card">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3 mb-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Flame className="w-4 h-4 text-sky-400 animate-pulse" />
                  📰 Actualités & Innovations {selectedTag && <span className="text-sky-400 text-xs lowercase">({selectedTag})</span>}
                </h3>
                {editMode && (
                  <button
                    onClick={() => {
                      const nextActualites = [
                        ...(activeReport.actualites || []),
                        {
                          title: "Nouveau titre d'actualité",
                          source: "Presse / Cabinet",
                          date: "Mai 2026",
                          summary: "Résumé factuel synthétique des changements.",
                          impact: "Impact pour le DRH / DSI.",
                          tags: ["recrutement"],
                          url: ""
                        }
                      ];
                      updateActiveReport({ actualites: nextActualites });
                    }}
                    className="text-[10px] bg-slate-905 text-sky-400 px-2.5 py-1 rounded border border-slate-700 flex items-center gap-1 hover:bg-slate-900 transition"
                  >
                    <Plus className="w-3 h-3" /> Ajouter Actualité
                  </button>
                )}
              </div>

              {filteredActualites.length > 0 ? (
                <div className="space-y-6 flex-grow">
                  {filteredActualites.map((item, index) => {
                    // Match visual accent line based on tag patterns
                    let accentColor = "bg-sky-500";
                    if (item.tags?.some(t => t.toLowerCase() === "recrutement")) accentColor = "bg-purple-500";
                    if (item.tags?.some(t => t.toLowerCase() === "paie")) accentColor = "bg-green-500";
                    if (item.tags?.some(t => t.toLowerCase() === "éthique" || t.toLowerCase() === "juridique")) accentColor = "bg-amber-500";

                    return (
                      <article key={index} className="flex gap-4 relative group border-b border-slate-800/60 pb-5 last:border-0 last:pb-0">
                        <div className={`w-1 h-20 ${accentColor} flex-shrink-0 rounded-full`} />
                        <div className="flex flex-col flex-grow">
                          
                          {editMode ? (
                            <div className="space-y-2 pr-8">
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  value={item.title}
                                  placeholder="Titre de l'actualité"
                                  onChange={(e) => {
                                    const list = [...activeReport.actualites];
                                    list[index].title = e.target.value;
                                    updateActiveReport({ actualites: list });
                                  }}
                                  className="bg-slate-950 text-xs font-bold px-1.5 py-1 rounded border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500 col-span-2 text-sky-400"
                                />
                                <input
                                  type="text"
                                  value={item.source}
                                  placeholder="Source"
                                  onChange={(e) => {
                                    const list = [...activeReport.actualites];
                                    list[index].source = e.target.value;
                                    updateActiveReport({ actualites: list });
                                  }}
                                  className="bg-slate-950 text-[11px] px-1.5 py-1 rounded border border-slate-700 focus:outline-none"
                                />
                                <input
                                  type="text"
                                  value={item.date}
                                  placeholder="Date"
                                  onChange={(e) => {
                                    const list = [...activeReport.actualites];
                                    list[index].date = e.target.value;
                                    updateActiveReport({ actualites: list });
                                  }}
                                  className="bg-slate-950 text-[11px] px-1.5 py-1 rounded border border-slate-700 focus:outline-none"
                                />
                              </div>

                              <textarea
                                value={item.summary}
                                rows={2}
                                placeholder="Résumé"
                                onChange={(e) => {
                                    const list = [...activeReport.actualites];
                                    list[index].summary = e.target.value;
                                    updateActiveReport({ actualites: list });
                                }}
                                className="bg-slate-950 text-xs text-slate-300 px-1.5 py-1 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                              />

                              <textarea
                                value={item.impact}
                                rows={2}
                                placeholder="Impact potentiel"
                                onChange={(e) => {
                                    const list = [...activeReport.actualites];
                                    list[index].impact = e.target.value;
                                    updateActiveReport({ actualites: list });
                                }}
                                className="bg-slate-950 text-xs text-slate-300 px-1.5 py-1 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                              />

                              <input
                                type="text"
                                value={item.tags?.join(", ")}
                                placeholder="Tags séparés par des virgules"
                                onChange={(e) => {
                                  const list = [...activeReport.actualites];
                                  list[index].tags = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
                                  updateActiveReport({ actualites: list });
                                }}
                                className="bg-slate-950 text-[11px] px-1.5 py-1 rounded w-full border border-slate-700 text-slate-400"
                              />

                              <input
                                type="text"
                                value={item.url || ""}
                                placeholder="URL Source de l'information (ex: https://...)"
                                onChange={(e) => {
                                  const list = [...activeReport.actualites];
                                  list[index].url = e.target.value;
                                  updateActiveReport({ actualites: list });
                                }}
                                className="bg-slate-950 text-[11px] px-1.5 py-1 rounded w-full border border-slate-700 text-sky-450 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h5 className="text-sm font-bold text-sky-300 hover:text-sky-200 transition">
                                  {item.title}
                                </h5>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {item.source} • {item.date}
                                </span>
                              </div>

                              <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                                {item.summary}
                              </p>

                              {item.impact && (
                                <div className="mt-2 bg-slate-900/40 p-2.5 rounded border border-slate-800/80 text-xs text-slate-300">
                                  <span className="font-bold text-sky-400 mr-1">💡 Impact HR :</span>
                                  {item.impact}
                                </div>
                              )}

                              <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
                                <div className="flex flex-wrap gap-1.5">
                                  {item.tags?.map((tag) => (
                                    <button
                                      key={tag}
                                      onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                      className="text-[9px] font-semibold bg-slate-755 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-400 hover:text-white transition uppercase"
                                    >
                                      #{tag}
                                    </button>
                                  ))}
                                </div>

                                {currentUser ? (
                                  item.url ? (
                                    <a
                                      href={safeHref(item.url)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 hover:underline transition bg-sky-950/40 border border-sky-900/50 hover:border-sky-500/40 px-2.5 py-1 rounded"
                                    >
                                      <span>En savoir plus</span>
                                      <span className="text-[10px]">↗</span>
                                    </a>
                                  ) : (
                                    <span className="text-[10px] text-slate-500 italic">
                                      Source non spécifiée
                                    </span>
                                  )
                                ) : (
                                  <div 
                                    onClick={() => {
                                      setAuthError(null);
                                      setAuthEmail("");
                                      setAuthPassword("");
                                      setShowAuthModal(true);
                                    }}
                                    className="cursor-pointer text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-950/20 hover:bg-indigo-950/40 px-2 py-1 rounded border border-indigo-500/10 hover:border-indigo-500/30 transition shadow-inner" 
                                    title="Connectez-vous pour dévoiler le lien source original"
                                  >
                                    <Lock className="w-3 h-3 text-indigo-400" />
                                    <span>Source réservée abonnés</span>
                                  </div>
                                )}
                              </div>
                            </>
                          )}

                          {editMode && (
                            <button
                              onClick={() => {
                                const list = activeReport.actualites.filter((_, i) => i !== index);
                                updateActiveReport({ actualites: list });
                              }}
                              className="absolute right-0 top-0 text-red-400 hover:text-red-300 p-1 bg-slate-900/50 rounded"
                              title="Supprimer cette actualité"
                            >
                              <Trash className="w-4 h-4" />
                            </button>
                          )}

                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="py-10 text-center text-slate-500 text-xs">
                  Aucun article trouvé pour le filtre "{selectedTag}".
                </div>
              )}
            </section>
          </div>

          {/* Right Sidebar: Stats & Actions (3 cols / 12) */}
          <aside className="md:col-span-3 flex flex-col gap-6">
            
            {/* Chiffre de la semaine HERO CARD */}
            <section className="bg-sky-600 p-6 rounded-xl text-slate-900 hover:scale-[1.01] transition-all duration-300 flex flex-col justify-between shadow-xl print-card relative">
              {editMode ? (
                <div className="space-y-2 text-slate-900">
                  <span className="text-[10px] uppercase font-bold text-slate-800 block">Modifier le Chiffre</span>
                  <input
                    type="text"
                    value={activeReport.chiffre?.value || ""}
                    onChange={(e) => {
                      const updated = { ...activeReport.chiffre, value: e.target.value };
                      updateActiveReport({ chiffre: updated });
                    }}
                    className="bg-white/90 text-slate-900 text-3xl font-black rounded p-1 w-full"
                    placeholder="74%"
                  />
                  <textarea
                    value={activeReport.chiffre?.text || ""}
                    rows={3}
                    onChange={(e) => {
                      const updated = { ...activeReport.chiffre, text: e.target.value };
                      updateActiveReport({ chiffre: updated });
                    }}
                    className="bg-white/90 text-slate-900 text-xs rounded p-1.5 w-full"
                    placeholder="des DRH prioritent l'IA..."
                  />
                  <input
                    type="text"
                    value={activeReport.chiffre?.source || ""}
                    onChange={(e) => {
                      const updated = { ...activeReport.chiffre, source: e.target.value };
                      updateActiveReport({ chiffre: updated });
                    }}
                    className="bg-white/90 text-slate-900 text-[10px] rounded p-1 w-full"
                    placeholder="Source: Gartner"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-2 block font-mono">
                      Chiffre de la semaine
                    </span>
                    <h2 className="text-5xl font-black mb-3 tracking-tighter text-slate-950">
                      {activeReport.chiffre?.value || "N/A"}
                    </h2>
                    <p className="text-xs font-semibold leading-relaxed text-slate-900">
                      {activeReport.chiffre?.text}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-sky-700/30">
                    <p className="text-[9px] opacity-75 italic block">
                      Source : {activeReport.chiffre?.source || "Inconnue"}
                    </p>
                  </div>
                </>
              )}
            </section>

            {/* Recommended Actions CHECKLIST */}
            <section className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col justify-between print-card">
              <div>
                <div className="flex justify-between items-center border-b border-slate-700 pb-2.5 mb-3">
                  <h3 className="text-xs font-bold text-green-400 uppercase tracking-tighter flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    ✅ Actions Recommandées
                  </h3>
                  {editMode && (
                    <button
                      onClick={() => {
                        const list = [
                          ...(activeReport.actions || []),
                          { title: "Nouvelle action recommandée", detail: "Procéder à l'étape suivante." }
                        ];
                        updateActiveReport({ actions: list });
                      }}
                      className="text-[9px] bg-slate-900 text-green-400 px-1 py-0.2 rounded border border-slate-700 flex items-center gap-1"
                    >
                      <Plus className="w-2.5 h-2.5" /> Ajouter
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                {activeReport.actions?.length > 0 && (
                  <div className="mb-4 bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-green-400 h-full transition-all duration-300"
                      style={{
                        width: `${(getCompletedCount() / activeReport.actions.length) * 100}%`
                      }}
                    />
                  </div>
                )}

                {activeReport.actions?.length > 0 ? (
                  <ul className="space-y-4">
                    {activeReport.actions.map((act, index) => {
                      const isDone = !!completedActions[`${activeReport.id}-${index}`];
                      return (
                        <li key={index} className="flex items-start gap-3 relative group">
                          {/* Checkbox selector */}
                          <button
                            onClick={() => toggleAction(index)}
                            className={`w-5 h-5 rounded flex items-center justify-center font-bold text-xs shrink-0 cursor-pointer border transition-colors ${
                              isDone
                                ? "bg-green-500 text-slate-950 border-green-500"
                                : "bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-600"
                            }`}
                          >
                            {isDone ? "✓" : index + 1}
                          </button>

                          <div className="flex-grow">
                            {editMode ? (
                              <div className="space-y-1.5 pr-6">
                                <input
                                  type="text"
                                  value={act.title}
                                  onChange={(e) => {
                                    const list = [...activeReport.actions];
                                    list[index].title = e.target.value;
                                    updateActiveReport({ actions: list });
                                  }}
                                  className="bg-slate-950 text-xs font-bold px-1.5 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-green-400"
                                />
                                <textarea
                                  value={act.detail}
                                  rows={2}
                                  onChange={(e) => {
                                    const list = [...activeReport.actions];
                                    list[index].detail = e.target.value;
                                    updateActiveReport({ actions: list });
                                  }}
                                  className="bg-slate-950 text-[11px] text-slate-300 px-1.5 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-green-400"
                                />
                                <div className="grid grid-cols-2 gap-2 pt-0.5">
                                  <div>
                                    <label className="block text-[8px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Confidentialité</label>
                                    <select
                                      value={act.confidentiality || ""}
                                      onChange={(e) => {
                                        const list = [...activeReport.actions];
                                        list[index].confidentiality = e.target.value || undefined;
                                        updateActiveReport({ actions: list });
                                      }}
                                      className="bg-slate-950 text-[10px] text-slate-300 px-1 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-green-400 cursor-pointer"
                                    >
                                      <option value="">Non spécifiée</option>
                                      <option value="Publique">Publique</option>
                                      <option value="Interne">Interne Web</option>
                                      <option value="Confidentiel">Confidentiel RH</option>
                                      <option value="Secret">Secret DSI / Comex</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[8px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Criticité</label>
                                    <select
                                      value={act.criticality || ""}
                                      onChange={(e) => {
                                        const list = [...activeReport.actions];
                                        list[index].criticality = e.target.value || undefined;
                                        updateActiveReport({ actions: list });
                                      }}
                                      className="bg-slate-950 text-[10px] text-slate-300 px-1 py-0.5 rounded w-full border border-slate-700 focus:outline-none focus:ring-1 focus:ring-green-400 cursor-pointer"
                                    >
                                      <option value="">Non spécifiée</option>
                                      <option value="Faible">Faible</option>
                                      <option value="Moyenne">Moyenne</option>
                                      <option value="Haute">Haute</option>
                                      <option value="Critique">Critique</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className={`text-xs font-bold ${isDone ? "line-through text-slate-500" : "text-slate-200"}`}>
                                  {act.title}
                                </p>
                                <p className={`text-[11px] leading-relaxed mt-0.5 ${isDone ? "line-through text-slate-500" : "text-slate-400"}`}>
                                  {act.detail}
                                </p>
                                {/* Confidentiality and Criticality badges */}
                                {(act.confidentiality || act.criticality) && (
                                  <div className="flex flex-wrap gap-1.5 mt-1.5 overflow-hidden">
                                    {act.confidentiality && (
                                      <span className={`text-[9px] font-semibold px-2 py-0.2 rounded border select-none tracking-tight flex items-center gap-1 leading-none ${
                                        act.confidentiality === "Publique"
                                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                          : act.confidentiality === "Interne"
                                          ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                          : act.confidentiality === "Confidentiel"
                                          ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                                          : act.confidentiality === "Secret"
                                          ? "bg-red-500/10 border-red-500/30 text-red-400"
                                          : "bg-slate-500/10 border-slate-500/30 text-slate-400"
                                      }`}>
                                        🔒 {act.confidentiality}
                                      </span>
                                    )}
                                    {act.criticality && (
                                      <span className={`text-[9px] font-semibold px-2 py-0.2 rounded border select-none tracking-tight flex items-center gap-1 leading-none ${
                                        act.criticality === "Faible"
                                          ? "bg-slate-500/10 border-slate-500/30 text-slate-400"
                                          : act.criticality === "Moyenne"
                                          ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                                          : act.criticality === "Haute"
                                          ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
                                          : act.criticality === "Critique"
                                          ? "bg-rose-500/10 border-rose-500/30 text-rose-400 font-bold"
                                          : "bg-slate-500/10 border-slate-500/30 text-slate-400"
                                      }`}>
                                        ⚠️ {act.criticality}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {editMode && (
                            <button
                              onClick={() => {
                                const list = activeReport.actions.filter((_, i) => i !== index);
                                updateActiveReport({ actions: list });
                              }}
                              className="absolute right-0 top-0 text-red-400 hover:text-red-300 p-0.5 bg-slate-900/40 rounded"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500 italic">Aucune recommandation.</p>
                )}
              </div>

              {activeReport.actions?.length > 0 && (
                <div className="border-t border-slate-700/50 mt-4 pt-3 text-[10px] text-slate-400">
                  Avancement : {getCompletedCount()} / {activeReport.actions.length} action(s) validée(s)
                </div>
              )}
            </section>

            {/* Signal Faible */}
            <section className="bg-slate-900/80 p-3.5 rounded-xl border border-dashed border-slate-650 flex flex-col print-card">
              <span className="text-[10px] font-bold text-slate-400 mb-1 tracking-widest uppercase font-mono block">
                🔮 Signal Faible
              </span>
              {editMode ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={activeReport.signalFaible?.title || ""}
                    onChange={(e) => {
                      const updated = { ...activeReport.signalFaible, title: e.target.value };
                      updateActiveReport({ signalFaible: updated });
                    }}
                    className="bg-slate-950 text-xs text-slate-200 font-semibold rounded p-1 w-full"
                    placeholder="Titre du signal"
                  />
                  <textarea
                    value={activeReport.signalFaible?.description || ""}
                    rows={2}
                    onChange={(e) => {
                      const updated = { ...activeReport.signalFaible, description: e.target.value };
                      updateActiveReport({ signalFaible: updated });
                    }}
                    className="bg-slate-950 text-[11px] text-slate-350 rounded p-1 w-full"
                    placeholder="Description du signal..."
                  />
                </div>
              ) : (
                <>
                  <p className="text-xs font-bold text-slate-200 mb-1">{activeReport.signalFaible?.title}</p>
                  <p className="text-[11px] text-slate-400 italic leading-relaxed">
                    {activeReport.signalFaible?.description}
                  </p>
                </>
              )}
            </section>

            {/* À lire / À voir (Resources catalog) */}
            {activeReport.ressources?.length > 0 && (
              <section className="bg-slate-800/40 p-3.5 rounded-xl border border-slate-800/70 print-card">
                <div className="flex justify-between items-center border-b border-slate-700/50 pb-1.5 mb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5 text-sky-400 font-bold" />
                    📚 À lire / À voir
                  </span>
                  {editMode && (
                    <button
                      onClick={() => {
                        const list = [
                          ...(activeReport.ressources || []),
                          { title: "Ressource stratégique", duration: "Lecture 5 min", type: "Guide", url: "" }
                        ];
                        updateActiveReport({ ressources: list });
                      }}
                      className="text-[9px] text-sky-400"
                    >
                      + Ajouter
                    </button>
                  )}
                </div>

                <ul className="space-y-2.5">
                  {activeReport.ressources.map((res, index) => (
                    <li key={index} className="flex gap-2 relative">
                      <div className="w-1.5 h-1.5 bg-sky-500 rounded-full mt-1.5 shrink-0" />
                      <div className="flex-grow pr-4">
                        {editMode ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={res.title}
                              onChange={(e) => {
                                const list = [...activeReport.ressources];
                                list[index].title = e.target.value;
                                updateActiveReport({ ressources: list });
                              }}
                              className="bg-slate-950 text-[10px] text-slate-200 rounded p-0.5 w-full"
                            />
                            <div className="grid grid-cols-2 gap-1">
                              <input
                                type="text"
                                value={res.duration}
                                onChange={(e) => {
                                  const list = [...activeReport.ressources];
                                  list[index].duration = e.target.value;
                                  updateActiveReport({ ressources: list });
                                }}
                                className="bg-slate-950 text-[9px] text-slate-400 rounded p-0.5 w-full"
                              />
                              <input
                                type="text"
                                value={res.type}
                                onChange={(e) => {
                                  const list = [...activeReport.ressources];
                                  list[index].type = e.target.value;
                                  updateActiveReport({ ressources: list });
                                }}
                                className="bg-slate-950 text-[9px] text-slate-400 rounded p-0.5 w-full"
                              />
                            </div>
                            <input
                              type="text"
                              value={res.url || ""}
                              placeholder="URL de la ressource (ex: https://...)"
                              onChange={(e) => {
                                const list = [...activeReport.ressources];
                                list[index].url = e.target.value;
                                updateActiveReport({ ressources: list });
                              }}
                              className="bg-slate-950 text-[9px] text-slate-400 rounded p-0.5 w-full mt-1"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-slate-300 font-medium leading-tight">
                              {res.title}
                            </p>
                            <div className="flex items-center justify-between gap-2 mt-1">
                              <span className="text-[9px] text-slate-500 font-mono">
                                {res.type} • {res.duration}
                              </span>
                              {currentUser ? (
                                (res.url || "https://www.actuel-rh.fr/") ? (
                                  <a
                                    href={safeHref(res.url, "https://www.actuel-rh.fr/")}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-[9.5px] font-bold text-sky-400 hover:text-sky-300 hover:underline transition bg-sky-950/35 border border-sky-900/30 hover:border-sky-500/30 px-1.5 py-0.5 rounded"
                                  >
                                    <span>En savoir plus</span>
                                    <span className="text-[8px]">↗</span>
                                  </a>
                                ) : (
                                  <span className="text-[9px] text-slate-600 italic">
                                    Source non spécifiée
                                  </span>
                                )
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAuthError(null);
                                    setAuthEmail("");
                                    setAuthPassword("");
                                    setShowAuthModal(true);
                                  }}
                                  className="text-[9px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-950/20 hover:bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-500/10 hover:border-indigo-500/30 transition cursor-pointer"
                                  title="Connectez-vous pour dévoiler le lien de la ressource"
                                >
                                  <Lock className="w-2.5 h-2.5 text-indigo-400" />
                                  <span>Lien réservé</span>
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {editMode && (
                        <button
                          onClick={() => {
                            const list = activeReport.ressources.filter((_, i) => i !== index);
                            updateActiveReport({ ressources: list });
                          }}
                          className="absolute right-0 top-0 text-red-400 hover:text-red-300"
                        >
                          <Trash className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

          </aside>

          {isAdmin && showSourcesPanel && (
            <div className="lg:col-span-2 mt-2">
              <SourceManager />
            </div>
          )}
        </main>
      ) : (
        <div className="p-10 text-center bg-slate-800 rounded-xl border border-slate-700 text-slate-400 text-sm">
          {isAdmin ? (
            "Aucun rapport chargé. Cliquez sur « Créer Trame » pour commencer !"
          ) : (
            "Aucun rapport chargé. Veuillez vous connecter avec un compte administrateur pour initialiser la veille technologique."
          )}
        </div>
      )}

      {/* Footer Info */}
      <footer className="mt-8 pt-5 border-t border-slate-800 flex flex-col sm:flex-row justify-between text-[10px] text-slate-500 uppercase tracking-widest gap-2">
        <span>Usage Interne & Équipe Évolution (Consultants SIRH)</span>
        <span>© 2026 - HRConseil PRISME Unit</span>
        <span>Réf. Interne : SIRH-VEILLE-{activeReport?.id || "N/A"}</span>
      </footer>

      {/* Account Registration & Cloud Sync Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { if (!authLoading) setShowAuthModal(false); }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
              id="auth-backdrop"
            />

            {/* Modal Dialog Card */}
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative w-full max-w-lg z-10 overflow-hidden font-sans"
              id="auth-card"
            >
              {/* Corner Close Button */}
              <button
                onClick={() => setShowAuthModal(false)}
                disabled={authLoading}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-full hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Title Header */}
              <div className="flex items-center gap-3.5 mb-5 border-b border-slate-800 pb-4">
                <div className="w-10 h-10 bg-indigo-500/10 border border-indigo-500/30 rounded-lg flex items-center justify-center text-indigo-400">
                  <Database className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100 uppercase tracking-tight">
                    {authMode === "signup" ? "Créer un Compte Cloud" : "Authentification & Synchro"}
                  </h3>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                    Sauvegardez vos rapports & progression de veille
                  </p>
                </div>
              </div>

              {/* Account Creation benefits panel */}
              <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-xl p-3.5 mb-5 text-xs text-indigo-200">
                <h4 className="font-semibold flex items-center gap-1.5 mb-1.5 text-indigo-300">
                  <ShieldCheck className="w-4 h-4 text-indigo-450" /> Pourquoi s'enregistrer ?
                </h4>
                <ul className="space-y-1 text-[11px] text-slate-300">
                  <li className="flex items-start gap-1">
                    <span className="text-indigo-400 mt-0.5">•</span>
                    <span><strong>Progression Sécurisée :</strong> Conservez vos points d'acculturation et badges.</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="text-indigo-400 mt-0.5">•</span>
                    <span><strong>Persistance des Rapports :</strong> Stockez vos veilles générées de façon permanente.</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="text-indigo-400 mt-0.5">•</span>
                    <span><strong>Tableau d'Honneur :</strong> Synchros en temps réel pour le classement (Leaderboard).</span>
                  </li>
                </ul>
              </div>

              {/* Mode Selection Tabs */}
              <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-lg mb-5 border border-slate-800 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => { setAuthMode("login"); setAuthError(null); }}
                  className={`py-2 rounded-lg transition cursor-pointer ${authMode === "login" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Se connecter
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode("signup"); setAuthError(null); }}
                  className={`py-2 rounded-lg transition cursor-pointer ${authMode === "signup" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Créer un compte
                </button>
              </div>

              {/* Error Box display */}
              {authError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-xs mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="font-medium">{authError}</span>
                </div>
              )}

              {/* Auth Input Fields Form */}
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                    Adresse Email
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                      <Mail className="w-4 h-4" />
                    </span>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="votre.nom@entreprise.fr"
                      required
                      disabled={authLoading}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-650 outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1.5">
                    Mot de passe
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                      <Lock className="w-4 h-4" />
                    </span>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      disabled={authLoading}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-650 outline-none transition"
                    />
                  </div>
                </div>

                {/* Primary Trigger Auth Button */}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg text-xs transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2.5 shadow-lg shadow-indigo-600/10"
                >
                  {authLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Traitement sécurisé...</span>
                    </>
                  ) : (
                    <>
                      <Database className="w-4 h-4 text-white/90" />
                      <span>{authMode === "signup" ? "S'enregistrer maintenant" : "Ouvrir ma session"}</span>
                    </>
                  )}
                </button>

                {/* divider separator */}
                <div className="flex items-center gap-3.5 text-[10px] text-slate-500 my-4">
                  <span className="h-px bg-slate-800 flex-grow" />
                  <span className="uppercase tracking-widest">ou continuer avec</span>
                  <span className="h-px bg-slate-800 flex-grow" />
                </div>

                {/* Google Auth Federated Popup Login */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={authLoading}
                  className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-200 font-semibold py-2 px-4 rounded-lg text-xs flex items-center justify-center gap-2.5 transition cursor-pointer"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>S'identifier avec Google (Gmail)</span>
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
