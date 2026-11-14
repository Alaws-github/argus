// Palmcrest Health Network: three private hospitals and eight clinics. Health
// data, so the engagement is members only. Modules: incidents.
export const engagement = {
  name: 'Clinical AI governance',
  client: 'Palmcrest Health Network (demo)',
  prefix: 'PHN',
  color: '#5bbf7a',
  sector: 'Healthcare',
  frameworks: ['nistAiRmf', 'iso42001', 'jdpa', 'euAiAct', 'hipaa', 'fdaGmlp'],
  about:
    'Private hospital group: three hospitals (412 beds) and eight outpatient clinics. Sensitive personal data under the Jamaica Data Protection Act 2020. Some international patients are EU residents, so the EU AI Act is in scope for systems that affect them. The Medical Director chairs a new Clinical AI Committee and wants every AI tool in clinical use reviewed in 2026.',
  appetite: {
    maxResidual: 6,
    statement:
      'Very low tolerance for AI risk that can affect a diagnosis or treatment. Above a residual of 6 the Clinical AI Committee decides.',
    escalateTo: 'Clinical AI Committee',
  },
};

export async function build(ctx, { step }) {
  const { sam } = ctx;
  await ctx.configure({ modules: { incidents: true }, access: 'members' });
  await ctx.knowledge('Palmcrest clinical AI standard CS-14', [
    "1. Clinical decision support must never replace the clinician's judgement. The clinician who acts on an AI output is accountable for the decision.",
    "2. Before go-live, a clinical AI tool must be validated on Palmcrest's own patients, with sensitivity and the false-alert rate reported by ward.",
    '3. AI-drafted clinical notes are drafts until the clinician signs them. Medication names and doses in a draft must be checked against the prescription record.',
    '4. Patients are told when a consultation is recorded for an AI scribe and may refuse without affecting their care.',
  ]);
  step('Clinical AI standard added to the knowledge base');

  const sepsis = await ctx.useCase({
    title: 'Sepsis early-warning score',
    businessOwner: 'Chief Nursing Officer',
    description:
      'A vendor model built into the electronic health record scores adult inpatients every hour and alerts the nurse when sepsis risk is high. A published external check of a widely used vendor sepsis model found it missed most cases and raised many false alerts, so the committee wants local validation before relying on it.',
    dataUsed:
      'Vital signs, lab results, medications and nursing notes from the health record, for every adult inpatient.',
    affectedPeople: 'Adult inpatients, about 1,600 a month, and the nurses who act on alerts.',
    autonomy: 'human_in_loop',
    vendor: "Electronic health record vendor's built-in model",
    category: 'decision',
    priority: 'p1',
  });
  await ctx.toClassification(sepsis.key);
  await ctx.approveClassification(sepsis.key);
  await ctx.approveDesign(sepsis.key);
  step(`${sepsis.key} Sepsis early-warning score: classified, controls approved, evidence requests drafted`);

  const scribe = await ctx.useCase({
    title: 'Ambient clinical scribe pilot',
    businessOwner: 'Medical Director',
    description:
      "In the outpatient clinics, an app records the consultation (with the patient's consent) and drafts the clinical note and referral letter. The doctor edits and signs every note. Piloted by 14 doctors since September.",
    dataUsed: 'Audio of consultations, the draft and signed notes, patient demographics and problem list.',
    affectedPeople: 'Outpatients, about 3,000 consultations a month in the pilot clinics.',
    autonomy: 'human_in_loop',
    vendor: 'Specialist medical scribe vendor using a large language model',
    category: 'generative',
    priority: 'p1',
  });
  await ctx.toClassification(scribe.key);
  const sc = await ctx.approveClassification(scribe.key, {
    decide: async (id, c) => {
      const i = c.classification.risks.findIndex((r) => /privacy/i.test(r.category));
      if (i >= 0)
        await ctx.edit(
          id,
          `risk:${i}`,
          { likelihood: 4 },
          'Audio is held by the vendor for 30 days; likelihood raised',
        );
    },
  });
  void sc;
  step(`${scribe.key} Ambient clinical scribe: classified with a privacy risk raised, control design waiting`);

  const scribeCard = (await ctx.card(scribe.key)).card;
  const inc = await sam('POST', `/engagements/${ctx.E}/incidents`, {
    title: 'Scribe draft listed the wrong insulin dose',
    description:
      'A draft note recorded insulin glargine 40 units instead of 14 units. The doctor caught it before signing; no patient harm. The audio was clear, so the error came from the model.',
    severity: 'high',
    occurredAt: new Date(Date.now() - 6 * 864e5).toISOString(),
    awareAt: new Date(Date.now() - 5 * 864e5).toISOString(),
    cardId: scribeCard.id,
    owner: 'Medical Director',
    clocks: ['internal'],
  });
  await sam('PATCH', `/incidents/${inc.id}`, {
    status: 'contained',
    note: 'All pilot doctors reminded to check doses against the prescription record; vendor investigating',
  });
  await ctx.issue({
    title: 'Scribe drafts are not checked against the prescription record',
    severity: 'high',
    incidentId: inc.id,
    cardId: scribeCard.id,
    owner: 'Medical Director',
    description:
      'Standard CS-14 section 3 needs medication names and doses in a draft checked against the prescription record. The app has no such check. Add an automatic comparison or a mandatory tick before signing.',
  });
  step('An incident on the scribe pilot (wrong dose caught before signing), contained, with a high-severity issue');

  const noshow = await ctx.useCase({
    title: 'No-show prediction for clinic overbooking',
    businessOwner: 'Director of Outpatient Services',
    description:
      'Predicts which booked patients will not attend and double-books their slots. Patients from some communities are predicted to miss more often, so they are more often double-booked and wait longer when they do come.',
    dataUsed: 'Appointment history, address, insurance type, age, distance from the clinic.',
    affectedPeople: 'Outpatients, about 9,000 appointments a month.',
    autonomy: 'autonomous',
    vendor: 'In-house analytics team',
    category: 'analytics',
    priority: 'p2',
  });
  await ctx.toClassification(noshow.key);
  step(`${noshow.key} No-show prediction: classification drafted, waiting for decisions`);
}
