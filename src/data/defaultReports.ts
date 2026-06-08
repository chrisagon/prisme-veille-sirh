export interface VeilleReport {
  id: string;
  week: string;
  top3: string[];
  actualites: {
    title: string;
    source: string;
    date: string;
    summary: string;
    impact: string;
    tags: string[];
    url?: string;
  }[];
  mouvements: {
    title: string;
    details: string;
    category: string;
  }[];
  reglementation: {
    title: string;
    detail: string;
    type: string;
  }[];
  chiffre: {
    value: string;
    text: string;
    source: string;
  } | null;
  signalFaible: {
    title: string;
    description: string;
  } | null;
  ressources: {
    title: string;
    duration: string;
    type: string;
    url?: string;
  }[];
  actions: {
    title: string;
    detail: string;
    confidentiality?: string;
    criticality?: string;
  }[];
}

export const defaultReports: VeilleReport[] = [
  {
    id: "2026-w21",
    week: "Semaine du 21 Mai 2026",
    top3: [
      "L'IA Act européen bouscule la gouvernance SIRH : L'approche de la mise en conformité stricte pour les systèmes d'IA classés « à haut risque » (recrutement, évaluation, promotion) pousse les DSI et DRH à exiger de leurs éditeurs des audits d'explicabilité et de transparence algorithmique.",
      "Généralisation des « Agents » RH autonomes : Les éditeurs dépassent le stade des chatbots conversationnels passifs pour lancer des agents capables d'orchestrer des processus RH complexes de bout en bout (comme la validation automatisée d'absences complexes).",
      "L'analytique prédictive sous haute surveillance : La montée de l'analyse sémantique des échanges (Slack, Teams) pour anticiper le turn-over ou le désengagement suscite de fortes tensions éthiques, incitant les régulateurs européens à durcir les contrôles."
    ],
    actualites: [
      {
        title: "Déploiement pilote de « Lucca Copilot » pour la gestion des temps et des absences",
        source: "Communiqué Lucca / RH Info",
        date: "18 Mai 2026",
        summary: "L'éditeur français de SIRH Lucca déploie actuellement auprès d'un panel de clients pilotes un assistant génératif capable d'analyser en temps réel les conventions collectives complexes. L'objectif est d'aider les managers à évaluer instantanément la légitimité juridique et l'impact opérationnel de demandes de congés spécifiques (ex. congé de proche aidant, événements familiaux complexes).",
        impact: "Réduction du temps de validation pour les managers et sécurisation réglementaire de la paie sans nécessiter d'intervention systématique de l'équipe RH.",
        tags: ["gestion des temps", "automatisation", "marché"],
        url: "https://www.lucca.fr/logiciels-rh/conges-absences"
      },
      {
        title: "Généralisation de la pré-qualification de premier niveau par IA asynchrone",
        source: "HR Tech Outlook",
        date: "15 Mai 2026",
        summary: "Les grandes plateformes de recrutement intègrent désormais des agents d'IA capables de mener des entretiens de pré-sélection par écrit de manière asynchrone et structurée. Ces outils évaluent à la fois les compétences techniques et comportementales des candidats sur des postes volumiques ou pénuriques avant de transmettre le dossier à un recruteur humain.",
        impact: "Accélération majeure du time-to-hire (temps de recrutement), mais risque accru de biais algorithmiques si les modèles de sélection ne sont pas audités de manière indépendante.",
        tags: ["recrutement", "IA générative", "éthique"],
        url: "https://www.hrtechoutlook.com"
      },
      {
        title: "Workday et Microsoft renforcent le concept de « Zero Context Switching »",
        source: "Workday Blog / Tech News",
        date: "14 Mai 2026",
        summary: "Les deux géants annoncent une mise à jour de leur intégration permettant d'effectuer la quasi-totalité des actions courantes du SIRH (demandes de congés, modifications d'objectifs, consultation de fiches de paie) directement dans l'interface de Microsoft Teams grâce à l'IA de Copilot. L'utilisateur n'a plus besoin de se connecter à l'application Workday.",
        impact: "Amélioration drastique de l'expérience collaborateur et augmentation significative du taux d'adoption du SIRH par les équipes opérationnelles.",
        tags: ["marché", "expérience collaborateur"],
        url: "https://blog.workday.com"
      },
      {
        title: "Cegid GEPP : Cartographie dynamique et génération autonome de fiches de poste",
        source: "Cegid Press Release",
        date: "16 Mai 2026",
        summary: "Cegid déploie de nouvelles fonctionnalités d'IA générative pour cartographier dynamiquement les écarts de compétences et rédiger automatiquement des descriptions de postes alignées sur les évolutions technologiques du marché.",
        impact: "Maintien d'un référentiel de compétences à jour en temps réel et simplification du travail des recruteurs et managers de proximité.",
        tags: ["analytique", "marché"],
        url: "https://www.cegid.com/fr/solutions/portail-rh"
      },
      {
        title: "Cornerstone OnDemand présente son tuteur de formation personnalisé par IA",
        source: "Cornerstone HR Blog",
        date: "15 Mai 2026",
        summary: "Un compagnon apprenant basé sur LLM guide l'employé pas à pas dans sa montée en compétences, s'adaptant à ses préférences d'apprentissage tout en répondant aux plans stratégiques de l'entreprise.",
        impact: "Optimisation de l'acculturation technologique d'équipe et réduction de la charge administrative des services de formation interne.",
        tags: ["analytique", "expérience collaborateur"],
        url: "https://www.cornerstoneondemand.com/fr"
      },
      {
        title: "Rapports RH en langage naturel simplifiés via Microsoft 365 Copilot",
        source: "Microsoft Solutions Office",
        date: "13 Mai 2026",
        summary: "Cette extension permet aux administrateurs SIRH et partenaires d'extraire des rapports d'analyse d'engagement de l'année à partir de requêtes simples et d'identifier de manière anonyme des tensions au sein des directions.",
        impact: "Aide à la prise de décision rapide des DRH pour anticiper le désengagement sans compromettre la vie privée ou les règles de RGPD.",
        tags: ["analytique", "éthique"],
        url: "https://news.microsoft.com"
      },
      {
        title: "Module d'équité salariale et d'audit de transparence par Factorial SIRH",
        source: "Factorial Blog / RH Magazine",
        date: "12 Mai 2026",
        summary: "Factorial lance un outil d'accompagnement d'équité basé sur des modèles statistiques avancés qui comparent automatiquement l'égalité des salaires entre genres et types de postes pour anticiper les réglementations européennes.",
        impact: "Mise en conformité rapide avec les futures obligations de transparence des rémunérations et réduction du risque de sanctions juridiques.",
        tags: ["paie", "juridique", "éthique"],
        url: "https://factorial.fr"
      }
    ],
    mouvements: [
      {
        title: "Cegid - Cartographie Dynamique des Compétences",
        details: "Intègre des fonctionnalités d'IA pour le Skill Mapping. Le système analyse l'historique de formation et les évaluations pour suggérer des parcours de formation individualisés et combler les écarts constatés au sein des équipes.",
        category: "Fonctionnalité"
      },
      {
        title: "ADP - Rumeurs d'acquisition dans l'audit algorithmique",
        details: "Rumeurs de rachat d'une startup spécialisée dans l'audit algorithmique de recrutement par un grand acteur de la paie (ADP), afin de proposer nativement un outil de certification de conformité face à l'IA Act.",
        category: "Partenariat / Acquisition"
      },
      {
        title: "HumaniAI - Garde-fous d'éthique algorithmique",
        details: "Startup européenne à surveiller. Développe des filtres d'évaluation (shields) permettant aux entreprises d'auditer de manière neutre et indépendante l'éthique des algorithmes RH tiers qu'elles utilisent.",
        category: "Startup à surveiller"
      }
    ],
    reglementation: [
      {
        title: "Exigences strictes de l'IA Act européen",
        detail: "Tout algorithme utilisé pour le tri de CV, l'évaluation ou l'attribution de promotions doit faire l'objet d'une analyse d'impact sur les droits fondamentaux et garantir une explicabilité totale des décisions à la demande de l'employé.",
        type: "IA Act"
      },
      {
        title: "CNIL : Rappel sur l'analyse sémantique sans consentement",
        detail: "Le régulateur français multiplie les mises en garde concernant l'analyse sémantique automatique des outils comme Slack ou Teams pour mesurer l'engagement. C'est considéré comme de la surveillance illicite sans motif légitime.",
        type: "CNIL / RGPD"
      }
    ],
    chiffre: {
      value: "74%",
      text: "74% des DRH estiment que l'intégration de l'IA générative dans leur SIRH est leur priorité numéro un pour optimiser la productivité administrative. Cependant, seuls 18% considèrent que leurs équipes disposent des compétences nécessaires pour s'en servir de manière éthique et sécurisée.",
      source: "Rapport prospectif Gartner 'Future of HR' 2026"
    },
    signalFaible: {
      title: "Le « Reverse Matching » collaborateur",
      description: "Apparition d'outils d'IA personnels utilisés par les candidats pour scanner et auditer la culture réelle, l'équité salariale et l'historique social des employeurs à partir de données publiques, inversant l'asymétrie habituelle de l'entretien de recrutement."
    },
    ressources: [
      {
        title: "Guide pratique ANDRH : Mettre son SIRH en conformité avec l'IA Act : Étape par étape",
        duration: "Lecture 12 min",
        type: "Guide",
        url: "https://www.andrh.fr/media/guide-pratique-ia-act-sirh.pdf"
      },
      {
        title: "Rapport d'analyse Sopra Steria Next : L'ère des agents RH autonomes : vers la fin du portail SIRH ?",
        duration: "Rapport PDF",
        type: "Rapport",
        url: "https://www.soprasterianext.com/publications/rapport-agents-rh-autonomes.pdf"
      }
    ],
    actions: [
      {
        title: "Proposer une offre d'audit de conformité Recrutement/ATS",
        detail: "Proposer de rédiger et d'administrer auprès des éditeurs de vos clients un questionnaire de validation de conformité IA Act (explications claires des modèles de scoring and de déduction)."
      },
      {
        title: "Construire un kit méthodologique 'Charte IA SIRH client'",
        detail: "Mettre à disposition des consultants un canevas de Charte d'usage de l'IA pour encadrer la sécurité des données d'employés et réaffirmer le contrôle humain obligatoire."
      },
      {
        title: "Packager une offre d'acculturation 'IA Literacy'",
        detail: "Concevoir un catalogue de modules de montée en compétences (Prompt Engineering appliqué au SIRH) à revendre à nos clients sous forme d'ateliers interactifs."
      }
    ]
  },
  {
    id: "2026-w20",
    week: "Semaine du 14 Mai 2026",
    top3: [
      "SAP SuccessFactors intègre des copilotes d'entretien améliorés permettant de formuler en temps réel des questions contextuelles de compétences.",
      "Les syndicats européens publient une charte réclamant le droit à la 'Dé-automatisation délibérée' des parcours de carrière gérés par IA.",
      "Workday annonce un chiffre d'affaires record stimulé par ses nouvelles extensions d'IA prédictive pour l'aide à la rétention des talents."
    ],
    actualites: [
      {
        title: "SAP lance son module d'évaluation des compétences sous assistance IA",
        source: "SAP Newsroom",
        date: "11 Mai 2026",
        summary: "Le géant du SIRH présente une fonctionnalité qui compare automatiquement les performances des employés à l'état de l'art du marché afin de recommander des pistes personnalisées de formation.",
        impact: "Simplification radicale de la gestion prévisionnelle des emplois et des compétences (GEPP) pour les grandes structures.",
        tags: ["analytique", "marché"],
        url: "https://news.sap.com"
      },
      {
        title: "Proposition de législation pour le 'Droit au recruteur humain'",
        source: "Le Monde / Liaisons Sociales",
        date: "08 Mai 2026",
        summary: "Un groupe de députés français prépare une proposition de loi visant à interdire de refuser un candidat sans qu'un humain n'ait formellement étudié sa candidature.",
        impact: "Modifie la structure juridique des processus ATS intégrant du pré-filtrage par IA.",
        tags: ["recrutement", "éthique", "juridique"],
        url: "https://www.lemonde.fr"
      },
      {
        title: "Lucca acquiert une start-up d'optimisation d'onboarding vocal assisté",
        source: "Les Échos / RH Hebdo",
        date: "10 Mai 2026",
        summary: "Dans l'optique de renforcer sa suite d'onboarding, Lucca intègre des solutions de synthèse et d'analyse vocale pour accompagner les compagnons IA lors des premières configurations de profils.",
        impact: "Réduction des erreurs d'inscription lors de l'onboarding et des demandes auprès du support informatique ou RH.",
        tags: ["marché", "expérience collaborateur"],
        url: "https://www.lesechos.fr"
      },
      {
        title: "ADP Link déploit de nouvelles fonctions de correction prédictive DSN",
        source: "ADP Actualités",
        date: "09 Mai 2026",
        summary: "ADP intègre de l'apprentissage automatique dans sa suite de paie complexe pour identifier automatiquement les anomalies dans les déclarations DSN avant envoi aux organismes officiels.",
        impact: "Évite de coûteux redressements de cotisations sociales pour les grands comptes et fluidifie le cycle de paye.",
        tags: ["paie", "automatisation"],
        url: "https://www.fr.adp.com"
      },
      {
        title: "OpenAI s'associe à Workday pour une intégration native de GPT-5",
        source: "OpenAI Communications",
        date: "07 Mai 2026",
        summary: "Un accord de collaboration permet de faire fonctionner les modèles les plus avancés d'OpenAI sur le cloud privé de Workday, pour garantir une sécurité hermétique des données des salariés.",
        impact: "Permet de générer des plans de mobilité de carrière ultra-précis sans fuite de données nominatives.",
        tags: ["marché", "éthique"],
        url: "https://openai.com"
      },
      {
        title: "Rapport DARES : 35% des DRH sous-estiment l'anxiété liée à l'automatisation",
        source: "Ministère du Travail / DARES",
        date: "06 Mai 2026",
        summary: "Une large étude de la DARES souligne que la rapidité de déploiement de l'IA générative crée un sentiment de perte de contrôle et d'insécurité professionnelle chez les gestionnaires administratifs des entreprises.",
        impact: "Nécessité de coupler tout projet technique d'intégration d'IA avec un solide protocole de gestion du changement (Change Management).",
        tags: ["expérience collaborateur", "éthique"],
        url: "https://dares.travail-emploi.gouv.fr"
      },
      {
        title: "Accord historique de régulation sectorielle de l'IA dans l'industrie métallurgique",
        source: "Liasons Sociales",
        date: "05 Mai 2026",
        summary: "Les partenaires sociaux de la métallurgie s'accordent sur des limites concernant le monitoring comportemental invisible et garantissent un niveau d'acculturation technolgique inclusif pour tous les âges.",
        impact: "Définit un cadre de dialogue social clair et sécurise les déploiements d'outils d'évaluation automatique.",
        tags: ["juridique", "éthique"],
        url: "https://www.liaisons-sociales.fr"
      }
    ],
    mouvements: [
      {
        title: "SAP SuccessFactors Expansion",
        details: "Mise à jour majeure de la suite de gestion des carrières avec un copilote d'entretien.",
        category: "Fonctionnalité"
      },
      {
        title: "HiBob - Levée de fonds additionnelle",
        details: "Bob lève 150M$ pour accélérer le développement d'agents autonomes conversationnels pour le selfcare des employés.",
        category: "Partenariat / Acquisition"
      }
    ],
    reglementation: [
      {
        title: "Explicabilité des algorithmes de promotion locale",
        detail: "La Cour de Justice européenne confirme que les salariés ont le droit de connaître le scoring exact attribué par une IA d'évaluation interne.",
        type: "IA Act"
      }
    ],
    chiffre: {
      value: "45%",
      text: "45% des grandes entreprises européennes ont inclus une clause de transparence des algorithmes dans leurs derniers contrats d'achat SIRH.",
      source: "Rapport d'enquête IDC Q1 2026"
    },
    signalFaible: {
      title: "La négociation salariale guidée par agent autonome",
      description: "Certains cadres expérimentés utilisent des agents d'IA négociateurs pour mener les pré-entretiens d'embauche et calibrer au centime près l'offre globale d'avantages."
    },
    ressources: [
       {
         title: "L'éthique de l'IA RH au prisme de la négociation collective",
         duration: "Vidéo 10 min",
         type: "Vidéo",
         url: "https://www.youtube.com/watch?v=exemple_video_ia_rh"
       }
     ],
    actions: [
      {
        title: "Intégrer une clause d'audit IA dans l'Assistance Maîtrise d'Ouvrage",
        detail: "Enrichir la méthodologie d'aide au choix du cabinet en intégrant systématiquement des grilles de conformité algorithmique (IA Act) dans nos appels d'offres."
      },
      {
        title: "Animer un webinar d'acculturation sur la transparence des modèles",
        detail: "Proposer un événement en ligne destiné aux clients du cabinet pour décrypter les impacts concrets du droit européen à l'explicabilité de la promotion par IA."
      }
    ]
  }
];
