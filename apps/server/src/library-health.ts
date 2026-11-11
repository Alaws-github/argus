// v1.7.3: healthcare AI governance. References to the FDA's Good Machine
// Learning Practice guiding principles (GMLP 1 to 10, published with Health
// Canada and the UK MHRA), the FDA's guidance on change control plans for AI
// devices (PCCP), HIPAA (45 CFR Parts 160 and 164) and the HHS rule on
// patient care decision support tools (45 CFR 92.210, Section 1557).
// Titles and summaries are ARGUS's own plain-English wording, never the
// text of the guidance or the regulation.
import type { FrameworkRefs } from '@gh/shared';
import type { SeedControl } from './library.js';

// Extra references for the existing library controls. Merged into their refs.
export const HEALTH_REFS: Record<string, FrameworkRefs> = {
  'GOV-02': { fdaGmlp: ['GMLP 1'] },
  'GOV-03': { hipaa: ['164.308(a)(5)'], fdaGmlp: ['GMLP 9'] },
  'RSK-01': { hipaa: ['164.308(a)(1)(ii)(A)'] },
  'RSK-02': { hipaa: ['164.308(a)(1)(ii)(A)', '164.308(a)(1)(ii)(B)'] },
  'RSK-03': { hipaa: ['92.210'] },
  'DAT-01': { hipaa: ['164.502(a)', '164.502(b)'] },
  'DAT-02': { fdaGmlp: ['GMLP 3', 'GMLP 5'] },
  'DAT-03': { hipaa: ['164.316(b)(2)'] },
  'MOD-01': { fdaGmlp: ['GMLP 4', 'GMLP 8'] },
  'MOD-02': { fdaGmlp: ['GMLP 3'], hipaa: ['92.210'] },
  'MOD-03': { fdaGmlp: ['PCCP'] },
  'SEC-02': { hipaa: ['164.312(a)(1)'] },
  'SEC-04': { hipaa: ['164.312(e)(1)', '164.502(b)'] },
  'OVS-01': { fdaGmlp: ['GMLP 7'] },
  'TRN-01': { fdaGmlp: ['GMLP 9'] },
  'TRN-02': { fdaGmlp: ['GMLP 9'] },
  'TPR-01': { hipaa: ['164.308(b)(1)', '164.504(e)'] },
  'MON-01': { fdaGmlp: ['GMLP 10'] },
  'MON-02': { hipaa: ['164.308(a)(6)', '164.404'] },
  'MON-03': { hipaa: ['164.312(b)'] },
};

export const HEALTH_CONTROLS: SeedControl[] = [
  { code: 'HLT-01', title: 'Health information in AI kept to the minimum needed', objective: 'Prompts, grounding data and AI outputs use only the protected health information the task needs; de-identified data is used where it will do.', domain: 'data', type: 'preventive', frequency: 'per use case', evidence: 'Data flow for the use case showing the health data fields used and why; de-identification method where used', test: 'Trace the fields the AI receives against the stated purpose; flag any field not needed; check that de-identified data meets the stated method.', categories: ['privacy', 'regulatory'], refs: { hipaa: ['164.502(b)', '164.514(a)'], nistAiRmf: ['MAP 4.1'] } },
  { code: 'HLT-02', title: 'Business associate agreement before an AI vendor sees health data', objective: 'No AI vendor receives protected health information until a signed business associate agreement covers what it does with it, including model training.', domain: 'third_party', type: 'preventive', frequency: 'per vendor, reviewed annually', evidence: 'Signed agreement; vendor list showing which vendors receive health data', test: 'For each AI vendor that receives health data, confirm a signed agreement dated before first use, and that it says whether the data may be used to train models.', categories: ['privacy', 'third-party', 'regulatory'], refs: { hipaa: ['164.308(b)(1)', '164.504(e)'], iso42001: ['A.10.3'] } },
  { code: 'HLT-03', title: 'Clinical performance shown on the intended patient population', objective: 'A clinical AI system is tested on data that represents the patients it will be used on, with test data kept separate from training data, and results reported by subgroup.', domain: 'model', type: 'preventive', frequency: 'before release and on each model change', evidence: 'Test report with data sources, separation of test and training data, and results by age, sex, ethnicity and other relevant groups', test: 'Compare the test population with the intended use; confirm no overlap with training data; check subgroup results against the agreed thresholds.', categories: ['fairness', 'accuracy', 'regulatory'], refs: { fdaGmlp: ['GMLP 3', 'GMLP 4', 'GMLP 5', 'GMLP 8'], hipaa: ['92.210'] } },
  { code: 'HLT-04', title: 'Clinician and AI tested together', objective: 'Where a clinician acts on the AI output, the combined performance of the clinician with the AI is tested, not the model alone, and clinicians know its limits.', domain: 'oversight', type: 'detective', frequency: 'before release, then annually', evidence: 'Reader study or workflow test results; user information given to clinicians', test: 'Inspect the study design and results for the clinician-with-AI setting; confirm clinicians received the stated limits and intended use.', categories: ['accountability', 'accuracy'], refs: { fdaGmlp: ['GMLP 7', 'GMLP 9'], nistAiRmf: ['MEASURE 2.5'] } },
  { code: 'HLT-05', title: 'Planned model changes follow an agreed change control plan', objective: 'Changes to a clinical AI model (retraining, new data, new thresholds) are made only within a documented plan that says what may change, how it is tested and when it is reported.', domain: 'model', type: 'preventive', frequency: 'per model change', evidence: 'Change control plan; record of each change with its test results and approval', test: 'Sample model changes and confirm each was within the plan, tested as the plan requires and approved before release.', categories: ['accuracy', 'regulatory'], refs: { fdaGmlp: ['PCCP', 'GMLP 10'], iso42001: ['A.6.2.6'] } },
  { code: 'HLT-06', title: 'Decision support checked for unfair impact on patients', objective: 'Clinical decision support tools are reviewed for inputs that measure race, colour, national origin, sex, age or disability, and the risk of discrimination is reduced.', domain: 'risk', type: 'detective', frequency: 'per tool, reviewed annually', evidence: 'Review record listing the tool\'s inputs, any that relate to protected characteristics, and the steps taken', test: 'Inspect the review for each decision support tool; confirm it names the relevant inputs and the steps taken, and that it was done before use.', categories: ['fairness', 'regulatory'], refs: { hipaa: ['92.210'], nistAiRmf: ['MEASURE 2.11'] } },
];

export const HEALTH_OBLIGATIONS: { source: string; ref: string; title: string; summary: string; codes: string[] }[] = [
  { source: 'FDA GMLP', ref: 'GMLP 1', title: 'Expertise across the whole life cycle', summary: 'People with clinical, technical and other relevant expertise are involved from design to retirement.', codes: ['GOV-02'] },
  { source: 'FDA GMLP', ref: 'GMLP 3', title: 'Data that represents the intended patients', summary: 'Study and training data reflect the patients the device is meant for, so results hold for them.', codes: ['DAT-02', 'HLT-03'] },
  { source: 'FDA GMLP', ref: 'GMLP 4', title: 'Test data kept apart from training data', summary: 'Training and test sets are independent, so tests measure real performance.', codes: ['MOD-01', 'HLT-03'] },
  { source: 'FDA GMLP', ref: 'GMLP 7', title: 'Performance of the clinician and AI together', summary: 'Where people act on the output, the combined human and AI performance is what is assessed.', codes: ['OVS-01', 'HLT-04'] },
  { source: 'FDA GMLP', ref: 'GMLP 8', title: 'Testing in clinically relevant conditions', summary: 'Tests show how the device performs in the conditions it will be used in.', codes: ['MOD-01', 'HLT-03'] },
  { source: 'FDA GMLP', ref: 'GMLP 9', title: 'Clear information for users', summary: 'Users get the intended use, limits, performance and data used, in terms they understand.', codes: ['TRN-01', 'HLT-04'] },
  { source: 'FDA GMLP', ref: 'GMLP 10', title: 'Monitoring after release', summary: 'Deployed models are monitored for performance, and retraining risks are managed.', codes: ['MON-01', 'HLT-05'] },
  { source: 'FDA GMLP', ref: 'PCCP', title: 'Change control plan for model updates', summary: 'Planned changes to an AI device are described, tested and limited by a plan agreed in advance.', codes: ['MOD-03', 'HLT-05'] },
  { source: 'HIPAA', ref: '164.308(a)(1)', title: 'Risk analysis and risk management', summary: 'Risks to health information, including from AI systems that hold or process it, are assessed and reduced.', codes: ['RSK-02'] },
  { source: 'HIPAA', ref: '164.502(b)', title: 'Minimum necessary', summary: 'Only the health information needed for the purpose is used or shared, including with AI.', codes: ['DAT-01', 'HLT-01'] },
  { source: 'HIPAA', ref: '164.504(e)', title: 'Business associate agreements', summary: 'Vendors that handle health information, AI vendors included, sign an agreement limiting what they do with it.', codes: ['TPR-01', 'HLT-02'] },
  { source: 'HIPAA', ref: '164.312(b)', title: 'Audit controls', summary: 'Activity in systems that hold health information is recorded and can be reviewed.', codes: ['MON-03'] },
  { source: 'HIPAA', ref: '164.404', title: 'Breach notification to individuals', summary: 'People are told of a breach of their unsecured health information without unreasonable delay, and within 60 days.', codes: ['MON-02'] },
  { source: 'HIPAA', ref: '92.210', title: 'Fair patient care decision support (HHS Section 1557 rule)', summary: 'Organisations find decision support tools whose inputs relate to protected characteristics and reduce the risk of discrimination.', codes: ['RSK-03', 'HLT-06'] },
];

// Obligation sources that only show for engagements that chose the framework.
export const OPTIONAL_SOURCES: Record<string, keyof FrameworkRefs> = { 'FDA GMLP': 'fdaGmlp', HIPAA: 'hipaa' };
