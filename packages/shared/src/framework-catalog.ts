// v1.7.4: the complete list of requirements for each framework ARGUS covers,
// so "fully met" can be shown honestly: every requirement is proven by a
// control, or marked not applicable with a reason.
//
// Each requirement has its official number (a NIST AI RMF subcategory, an
// ISO/IEC 42001 clause or Annex A control, an EU AI Act article, a HIPAA
// section) and a short title in ARGUS's own words. Never the standard's text:
// ISO/IEC 42001 is copyrighted, and the others are summarised for readability.
//
// Scope notes: the EU AI Act lists the articles that place duties on
// organisations (providers, deployers, importers, distributors, model
// providers); articles about authorities, penalties and the AI Office are left
// out. HIPAA lists its Security Rule standards, the Privacy Rule duties that
// touch AI, the Breach Notification Rule and the HHS rule on decision support.
import type { FrameworkRefs } from './grc.js';

export type FrameworkKey = keyof FrameworkRefs;
export interface Requirement {
  id: string;
  title: string;
  group: string;
}

const rows = (group: string, list: [string, string][]): Requirement[] =>
  list.map(([id, title]) => ({ id, title, group }));

const NIST_AI_RMF: Requirement[] = [
  ...rows('Govern', [
    ['GOVERN 1.1', 'Legal and regulatory requirements for AI are understood and managed'],
    ['GOVERN 1.2', 'Trustworthy AI is built into policies, processes and procedures'],
    ['GOVERN 1.3', "Risk management effort matches the organisation's risk tolerance"],
    ['GOVERN 1.4', 'The risk management process and its results are transparent'],
    ['GOVERN 1.5', 'Ongoing monitoring and periodic review are planned'],
    ['GOVERN 1.6', 'AI systems are recorded in an inventory'],
    ['GOVERN 1.7', 'AI systems are decommissioned safely'],
    ['GOVERN 2.1', 'Roles, responsibilities and lines of communication are documented'],
    ['GOVERN 2.2', 'Staff and partners are trained on AI risk'],
    ['GOVERN 2.3', 'Leadership is accountable for decisions about AI risk'],
    ['GOVERN 3.1', 'Decisions draw on a diverse team'],
    ['GOVERN 3.2', 'Roles of people and AI, and human oversight, are defined'],
    ['GOVERN 4.1', 'A culture of critical thinking and safety is encouraged'],
    ['GOVERN 4.2', 'Risks and impacts are documented and communicated'],
    ['GOVERN 4.3', 'Testing, incident finding and information sharing are in place'],
    ['GOVERN 5.1', 'Feedback from people outside the team is collected'],
    ['GOVERN 5.2', 'Feedback is built into system design'],
    ['GOVERN 6.1', 'Third-party AI risks are covered by policy'],
    ['GOVERN 6.2', 'There are contingency plans for third-party failures'],
  ]),
  ...rows('Map', [
    ['MAP 1.1', 'Intended purpose, context and expected use are documented'],
    ['MAP 1.2', 'The context is informed by people from several disciplines'],
    ['MAP 1.3', "The organisation's mission and goals for the AI are understood"],
    ['MAP 1.4', 'The business value is defined'],
    ['MAP 1.5', "The organisation's risk tolerance is set"],
    ['MAP 1.6', 'System requirements come from the people concerned'],
    ['MAP 2.1', 'The tasks and methods the AI uses are defined'],
    ['MAP 2.2', "The limits of the AI's knowledge and how people oversee it are documented"],
    ['MAP 2.3', 'Scientific integrity and testing considerations are documented'],
    ['MAP 3.1', 'Expected benefits are examined'],
    ['MAP 3.2', 'Possible costs, including non-financial ones, are examined'],
    ['MAP 3.3', 'The scope of the application is set'],
    ['MAP 3.4', 'The skills operators and users need are defined'],
    ['MAP 3.5', 'Human oversight processes are defined'],
    ['MAP 4.1', 'Legal risks of components, including third-party data and software, are mapped'],
    ['MAP 4.2', 'Internal controls for components are identified'],
    ['MAP 5.1', 'The likelihood and size of each impact are identified'],
    ['MAP 5.2', 'People affected are engaged about impacts'],
  ]),
  ...rows('Measure', [
    ['MEASURE 1.1', 'Methods and metrics are chosen for the main risks'],
    ['MEASURE 1.2', 'Whether the metrics still fit is checked regularly'],
    ['MEASURE 1.3', 'Independent assessors are involved'],
    ['MEASURE 2.1', 'Test sets, metrics and tools are documented'],
    ['MEASURE 2.2', 'Evaluations involving people protect them'],
    ['MEASURE 2.3', 'Performance is measured in conditions like real use'],
    ['MEASURE 2.4', 'Behaviour in production is monitored'],
    ['MEASURE 2.5', 'The system is shown to be valid and reliable'],
    ['MEASURE 2.6', 'Safety risks are evaluated'],
    ['MEASURE 2.7', 'Security and resilience are evaluated'],
    ['MEASURE 2.8', 'Transparency and accountability risks are examined'],
    ['MEASURE 2.9', 'The model is explained and its output interpreted'],
    ['MEASURE 2.10', 'Privacy risk is examined'],
    ['MEASURE 2.11', 'Fairness and bias are evaluated'],
    ['MEASURE 2.12', 'Environmental impact is assessed'],
    ['MEASURE 2.13', 'The effectiveness of the testing metrics is evaluated'],
    ['MEASURE 3.1', 'Emerging risks are tracked over time'],
    ['MEASURE 3.2', 'Risks that are hard to measure are still tracked'],
    ['MEASURE 3.3', 'Feedback from users and affected people is collected'],
    ['MEASURE 4.1', 'Measurement fits the context of use'],
    ['MEASURE 4.2', 'Trustworthiness results are checked with experts'],
    ['MEASURE 4.3', 'Changes in performance are measured and reported'],
  ]),
  ...rows('Manage', [
    ['MANAGE 1.1', 'Whether the AI should go ahead is decided'],
    ['MANAGE 1.2', 'Treating documented risks is prioritised'],
    ['MANAGE 1.3', 'Responses to high-priority risks are planned'],
    ['MANAGE 1.4', 'Remaining risks are documented'],
    ['MANAGE 2.1', 'Resources to manage risks are in place, and alternatives considered'],
    ['MANAGE 2.2', "The system's value is sustained"],
    ['MANAGE 2.3', 'There are procedures for risks nobody foresaw'],
    ['MANAGE 2.4', 'The system can be disengaged or switched off'],
    ['MANAGE 3.1', 'Third-party risks are monitored'],
    ['MANAGE 3.2', 'Pre-trained models are monitored'],
    ['MANAGE 4.1', 'There are plans for monitoring after deployment'],
    ['MANAGE 4.2', 'Improvement is continual'],
    ['MANAGE 4.3', 'Incidents and errors are communicated'],
  ]),
];

const ISO_42001: Requirement[] = [
  ...rows('Clauses 4 to 10 (the management system)', [
    ['4.1', 'Understand the organisation and its context'],
    ['4.2', 'Understand the needs of interested parties'],
    ['4.3', 'Set the scope of the AI management system'],
    ['4.4', 'Run the AI management system'],
    ['5.1', 'Leadership commitment'],
    ['5.2', 'AI policy'],
    ['5.3', 'Roles, responsibilities and authorities'],
    ['6.1.1', 'Plan actions for risks and opportunities'],
    ['6.1.2', 'AI risk assessment method'],
    ['6.1.3', 'AI risk treatment'],
    ['6.1.4', 'AI system impact assessment method'],
    ['6.2', 'AI objectives and plans to meet them'],
    ['6.3', 'Plan changes to the management system'],
    ['7.1', 'Resources'],
    ['7.2', 'Competence'],
    ['7.3', 'Awareness'],
    ['7.4', 'Communication'],
    ['7.5', 'Documented information'],
    ['8.1', 'Operational planning and control'],
    ['8.2', 'Carry out AI risk assessments'],
    ['8.3', 'Carry out AI risk treatment'],
    ['8.4', 'Carry out AI system impact assessments'],
    ['9.1', 'Monitoring, measurement and evaluation'],
    ['9.2', 'Internal audit'],
    ['9.3', 'Management review'],
    ['10.1', 'Continual improvement'],
    ['10.2', 'Nonconformity and corrective action'],
  ]),
  ...rows('Annex A (controls)', [
    ['A.2.2', 'An AI policy is documented'],
    ['A.2.3', 'The AI policy fits other policies'],
    ['A.2.4', 'The AI policy is reviewed'],
    ['A.3.2', 'AI roles and responsibilities are assigned'],
    ['A.3.3', 'People can report concerns'],
    ['A.4.2', 'Resources for AI systems are documented'],
    ['A.4.3', 'Data resources are documented'],
    ['A.4.4', 'Tooling resources are documented'],
    ['A.4.5', 'System and computing resources are documented'],
    ['A.4.6', 'People and their skills are documented'],
    ['A.5.2', 'There is a process for AI system impact assessments'],
    ['A.5.3', 'Impact assessments are documented'],
    ['A.5.4', 'Impact on individuals and groups is assessed'],
    ['A.5.5', 'Impact on society is assessed'],
    ['A.6.1.2', 'Objectives for responsible development are set'],
    ['A.6.1.3', 'Design and development follow responsible processes'],
    ['A.6.2.2', 'Requirements are specified'],
    ['A.6.2.3', 'Design and development are documented'],
    ['A.6.2.4', 'The system is verified and validated'],
    ['A.6.2.5', 'Deployment is planned'],
    ['A.6.2.6', 'Operation and monitoring are in place'],
    ['A.6.2.7', 'Technical documentation is kept'],
    ['A.6.2.8', 'Event logs are recorded'],
    ['A.7.2', 'Data for development is managed'],
    ['A.7.3', 'How data is acquired is recorded'],
    ['A.7.4', 'Data quality is defined and checked'],
    ['A.7.5', 'Where data comes from is recorded'],
    ['A.7.6', 'How data is prepared is recorded'],
    ['A.8.2', 'Users get documentation and information'],
    ['A.8.3', 'Interested parties can report adverse impacts'],
    ['A.8.4', 'Incidents are communicated'],
    ['A.8.5', 'Information owed to interested parties is given'],
    ['A.9.2', 'There are processes for responsible use'],
    ['A.9.3', 'Objectives for responsible use are set'],
    ['A.9.4', 'The system is used as intended'],
    ['A.10.2', 'Responsibilities are shared with third parties'],
    ['A.10.3', 'Suppliers are managed'],
    ['A.10.4', "Customers' needs are considered"],
  ]),
];

const EU_AI_ACT: Requirement[] = [
  ...rows('Everyone', [
    ['Art. 4', 'AI literacy of staff'],
    ['Art. 5', 'Prohibited AI practices'],
    ['Art. 50', 'Transparency for chatbots, deepfakes and generated content'],
  ]),
  ...rows('High-risk AI: the system', [
    ['Art. 6', 'Whether a system is high-risk'],
    ['Art. 9', 'Risk management system'],
    ['Art. 10', 'Data and data governance'],
    ['Art. 11', 'Technical documentation'],
    ['Art. 12', 'Automatic record-keeping (logs)'],
    ['Art. 13', 'Transparency and instructions for deployers'],
    ['Art. 14', 'Human oversight'],
    ['Art. 15', 'Accuracy, robustness and cybersecurity'],
  ]),
  ...rows('High-risk AI: providers and others in the chain', [
    ['Art. 16', 'Provider obligations'],
    ['Art. 17', 'Quality management system'],
    ['Art. 18', 'Keeping documentation'],
    ['Art. 19', 'Keeping automatically generated logs'],
    ['Art. 20', 'Corrective action and informing others'],
    ['Art. 21', 'Cooperation with authorities'],
    ['Art. 22', 'Authorised representatives'],
    ['Art. 23', 'Importer obligations'],
    ['Art. 24', 'Distributor obligations'],
    ['Art. 25', 'Responsibilities along the AI value chain'],
    ['Art. 43', 'Conformity assessment'],
    ['Art. 47', 'EU declaration of conformity'],
    ['Art. 48', 'CE marking'],
    ['Art. 49', 'Registration in the EU database'],
    ['Art. 72', 'Post-market monitoring'],
    ['Art. 73', 'Reporting serious incidents'],
  ]),
  ...rows('High-risk AI: deployers', [
    ['Art. 26', 'Deployer obligations'],
    ['Art. 27', 'Fundamental rights impact assessment'],
    ['Art. 86', 'Explaining individual decisions to the people affected'],
  ]),
  ...rows('General-purpose AI models', [
    ['Art. 53', 'Obligations of model providers'],
    ['Art. 54', 'Authorised representatives of model providers'],
    ['Art. 55', 'Models with systemic risk'],
  ]),
];

const JDPA: Requirement[] = [
  ...rows('The eight data protection standards', [
    ['Fair and lawful processing', 'Standard 1: process personal data fairly and lawfully'],
    ['Purpose limitation', 'Standard 2: collect for a specific, lawful purpose only'],
    ['Data minimisation', 'Standard 3: adequate, relevant and limited to what is needed'],
    ['Accuracy', 'Standard 4: accurate and kept up to date'],
    ['Retention', 'Standard 5: kept no longer than needed'],
    ['Rights of data subjects', "Standard 6: processed in line with people's rights"],
    ['Security of personal data', 'Standard 7: protected by technical and organisational measures'],
    ['Cross-border transfer', 'Standard 8: leaves Jamaica only with adequate protection'],
  ]),
  ...rows('Other duties', [
    ['Automated decision-making', "People's rights about decisions taken by automated means"],
    ['Data protection impact assessment', 'Assess the impact of high-risk processing'],
    ['Data protection officer', 'Appoint a data protection officer where required'],
    ['Registration', 'Register with the Information Commissioner'],
    ['Breach notification', 'Report personal data breaches to the Commissioner within 72 hours'],
  ]),
];

const NIST_CSF: Requirement[] = [
  ...rows('Govern', [
    ['GV.OC', 'Organisational context'],
    ['GV.RM', 'Risk management strategy'],
    ['GV.RR', 'Roles, responsibilities and authorities'],
    ['GV.PO', 'Policy'],
    ['GV.OV', 'Oversight'],
    ['GV.SC', 'Supply chain risk management'],
  ]),
  ...rows('Identify', [
    ['ID.AM', 'Asset management'],
    ['ID.RA', 'Risk assessment'],
    ['ID.IM', 'Improvement'],
  ]),
  ...rows('Protect', [
    ['PR.AA', 'Identity, authentication and access control'],
    ['PR.AT', 'Awareness and training'],
    ['PR.DS', 'Data security'],
    ['PR.PS', 'Platform security'],
    ['PR.IR', 'Technology infrastructure resilience'],
  ]),
  ...rows('Detect', [
    ['DE.CM', 'Continuous monitoring'],
    ['DE.AE', 'Adverse event analysis'],
  ]),
  ...rows('Respond', [
    ['RS.MA', 'Incident management'],
    ['RS.AN', 'Incident analysis'],
    ['RS.CO', 'Incident reporting and communication'],
    ['RS.MI', 'Incident mitigation'],
  ]),
  ...rows('Recover', [
    ['RC.RP', 'Recovery plan carried out'],
    ['RC.CO', 'Recovery communication'],
  ]),
];

const COSO: Requirement[] = [
  ...rows('Control environment', [
    ['P1', 'Commitment to integrity and ethics'],
    ['P2', 'Independent board oversight'],
    ['P3', 'Structures, reporting lines and authority'],
    ['P4', 'Commitment to competence'],
    ['P5', 'People held accountable'],
  ]),
  ...rows('Risk assessment', [
    ['P6', 'Clear objectives'],
    ['P7', 'Risks identified and analysed'],
    ['P8', 'Fraud risk considered'],
    ['P9', 'Significant change identified and assessed'],
  ]),
  ...rows('Control activities', [
    ['P10', 'Control activities chosen and developed'],
    ['P11', 'General controls over technology'],
    ['P12', 'Controls put in place through policies and procedures'],
  ]),
  ...rows('Information and communication', [
    ['P13', 'Relevant, quality information used'],
    ['P14', 'Internal communication'],
    ['P15', 'External communication'],
  ]),
  ...rows('Monitoring', [
    ['P16', 'Ongoing and separate evaluations'],
    ['P17', 'Deficiencies reported and fixed'],
  ]),
];

const OWASP: Requirement[] = [
  ...rows('LLM applications (2025)', [
    ['LLM01', 'Prompt injection'],
    ['LLM02', 'Sensitive information disclosure'],
    ['LLM03', 'Supply chain'],
    ['LLM04', 'Data and model poisoning'],
    ['LLM05', 'Improper output handling'],
    ['LLM06', 'Excessive agency'],
    ['LLM07', 'System prompt leakage'],
    ['LLM08', 'Vector and embedding weaknesses'],
    ['LLM09', 'Misinformation'],
    ['LLM10', 'Unbounded consumption'],
  ]),
  ...rows('Agentic applications (2026)', [
    ['ASI01', 'Agent goal hijack'],
    ['ASI02', 'Tool misuse and exploitation'],
    ['ASI03', 'Identity and privilege abuse'],
    ['ASI04', 'Agentic supply chain weaknesses'],
    ['ASI05', 'Unexpected code execution'],
    ['ASI06', 'Memory and context poisoning'],
    ['ASI07', 'Insecure communication between agents'],
    ['ASI08', 'Cascading failures'],
    ['ASI09', "Exploiting people's trust in agents"],
    ['ASI10', 'Rogue agents'],
  ]),
];

const FDA_GMLP: Requirement[] = [
  ...rows('Guiding principles', [
    ['GMLP 1', 'Expertise from several disciplines across the whole life cycle'],
    ['GMLP 2', 'Good software engineering and security practice'],
    ['GMLP 3', 'Study participants and data represent the intended patients'],
    ['GMLP 4', 'Training data kept independent of test data'],
    ['GMLP 5', 'Reference datasets chosen by the best available methods'],
    ['GMLP 6', 'Model design fits the data and the intended use'],
    ['GMLP 7', 'Focus on the performance of the clinician and AI together'],
    ['GMLP 8', 'Testing shows performance in clinically relevant conditions'],
    ['GMLP 9', 'Users get clear, essential information'],
    ['GMLP 10', 'Deployed models are monitored and retraining risks managed'],
  ]),
  ...rows('Model changes', [['PCCP', 'Predetermined change control plan for model updates']]),
];

const HIPAA: Requirement[] = [
  ...rows('Security Rule: administrative safeguards', [
    ['164.308(a)(1)', 'Security management process (risk analysis and risk management)'],
    ['164.308(a)(2)', 'Assigned security responsibility'],
    ['164.308(a)(3)', 'Workforce security'],
    ['164.308(a)(4)', 'Information access management'],
    ['164.308(a)(5)', 'Security awareness and training'],
    ['164.308(a)(6)', 'Security incident procedures'],
    ['164.308(a)(7)', 'Contingency plan'],
    ['164.308(a)(8)', 'Evaluation'],
    ['164.308(b)(1)', 'Business associate contracts'],
  ]),
  ...rows('Security Rule: physical safeguards', [
    ['164.310(a)(1)', 'Facility access controls'],
    ['164.310(b)', 'Workstation use'],
    ['164.310(c)', 'Workstation security'],
    ['164.310(d)(1)', 'Device and media controls'],
  ]),
  ...rows('Security Rule: technical safeguards', [
    ['164.312(a)(1)', 'Access control'],
    ['164.312(b)', 'Audit controls'],
    ['164.312(c)(1)', 'Integrity'],
    ['164.312(d)', 'Person or entity authentication'],
    ['164.312(e)(1)', 'Transmission security'],
  ]),
  ...rows('Security Rule: organisation and documentation', [
    ['164.314(a)', 'Business associate contract terms'],
    ['164.316(a)', 'Policies and procedures'],
    ['164.316(b)', 'Documentation, kept for six years'],
  ]),
  ...rows('Privacy Rule', [
    ['164.502(a)', 'Uses and disclosures are permitted ones'],
    ['164.502(b)', 'Minimum necessary'],
    ['164.504(e)', 'Business associate agreements'],
    ['164.508', 'Authorisations'],
    ['164.514(a)', 'De-identification'],
    ['164.520', 'Notice of privacy practices'],
    ['164.524', 'Right of access'],
    ['164.526', 'Right to amend'],
    ['164.528', 'Accounting of disclosures'],
    ['164.530', 'Administrative requirements'],
  ]),
  ...rows('Breach Notification Rule', [
    ['164.404', 'Notice to individuals'],
    ['164.406', 'Notice to the media'],
    ['164.408', 'Notice to HHS'],
    ['164.410', 'Notice from business associates'],
  ]),
  ...rows('HHS Section 1557 rule', [['92.210', 'Patient care decision support tools checked for discrimination']]),
];

export const FRAMEWORK_CATALOG: Record<FrameworkKey, Requirement[]> = {
  nistAiRmf: NIST_AI_RMF,
  iso42001: ISO_42001,
  euAiAct: EU_AI_ACT,
  jdpa: JDPA,
  nistCsf: NIST_CSF,
  coso: COSO,
  owasp: OWASP,
  fdaGmlp: FDA_GMLP,
  hipaa: HIPAA,
};

/** Does a control's reference ("164.308(a)(1)(ii)(A)", "Art. 50(1)") meet a catalogue requirement ("164.308(a)(1)", "Art. 50")? */
export const refMeets = (ref: string, id: string) => ref === id || ref.startsWith(`${id}(`);
