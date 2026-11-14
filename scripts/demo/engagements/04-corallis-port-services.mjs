// Corallis Port Services: runs a container terminal and a logistics park.
// AI is spreading through operations, HR and security, and the owners want an
// inventory and a view of which uses are risky. Modules: AI inventory.
export const engagement = {
  name: 'Operations and people AI review',
  client: 'Corallis Port Services (demo)',
  prefix: 'CPS',
  color: '#e0a03a',
  sector: 'Ports and logistics',
  frameworks: ['nistAiRmf', 'iso42001', 'jdpa', 'nistCsf'],
  about:
    'Operator of a transshipment container terminal (about 1.6 million TEU a year) and a logistics park. Works alongside Jamaica Customs on cargo inspection. Around 2,300 employees, many on shifts in safety-critical roles. Owned by an international ports group that requires ISO/IEC 42001 alignment by 2027.',
  appetite: {
    maxResidual: 9,
    statement:
      "Moderate appetite in operations where a person can step in; low appetite for AI that affects workers' jobs, pay or safety.",
    escalateTo: 'Group Risk Committee',
  },
};

export async function build(ctx, { step }) {
  const { jordan, riley } = ctx;
  await ctx.configure({ modules: { inventory: true } });
  await ctx.knowledge('Corallis employee monitoring and AI notice (2026)', [
    '1. Cameras on the terminal are for safety and security. Footage is kept for 30 days unless an incident needs it.',
    '2. Workers are told in writing what is monitored and why. Monitoring is never used to rate individual productivity without the union being consulted.',
    '3. Decisions about hiring, discipline or pay are made by people. AI may help, but a manager reviews every case and the employee can ask for the reasons.',
  ]);

  const inspect = await ctx.useCase({
    title: 'Container inspection risk targeting',
    businessOwner: 'Head of Terminal Security',
    description:
      'Scores every inbound container for the chance it holds contraband or mis-declared goods, using the manifest, shipper history and routing. The top 3% are sent for scanning and the customs liaison officer decides which to open.',
    dataUsed: 'Cargo manifests, shipper and consignee history, routing, past seizure records shared by customs.',
    affectedPeople: 'Shippers and consignees (businesses), and the customs officers who act on the list.',
    autonomy: 'human_in_loop',
    vendor: 'Group data science team',
    category: 'decision',
    priority: 'p1',
  });
  await ctx.toClassification(inspect.key);
  await ctx.approveClassification(inspect.key);
  const d = (await ctx.card(inspect.key)).card;
  for (const [i, c] of d.design.controls.entries()) {
    if (/business owner/i.test(c.owner))
      await ctx.edit(d.id, `control:${i}`, { owner: 'Head of Terminal Security' }, 'Named the accountable owner');
  }
  step(
    `${inspect.key} Container inspection targeting: classified, controls drafted, owners named by Riley, waiting for approval`,
  );

  const crane = await ctx.useCase({
    title: 'Crane and yard scheduling agent',
    businessOwner: 'Terminal Operations Manager',
    description:
      'An AI agent plans crane moves and truck appointment slots every 15 minutes and sends them straight to the terminal operating system. Supervisors can override, but at night the plan usually runs untouched. A bad plan can put trucks and straddle carriers in the same lane.',
    dataUsed: 'Vessel stowage plans, yard positions, equipment status, truck bookings.',
    affectedPeople: 'Crane and straddle-carrier operators, truck drivers, shipping lines.',
    autonomy: 'autonomous',
    vendor: "Terminal software vendor's optimisation module with an AI planner",
    category: 'agent',
    priority: 'p2',
  });
  await ctx.toClassification(crane.key);
  step(`${crane.key} Crane and yard scheduling agent: classification drafted, waiting for decisions`);

  const ppe = await ctx.useCase({
    title: 'Gate-lane PPE and face matching',
    businessOwner: 'Health and Safety Manager',
    description:
      'Cameras at the gates flag workers without a helmet or vest and match their face to the HR photo, so the supervisor gets a name. HR has asked to use the same matches for disciplinary records.',
    dataUsed: 'Live video at 12 gates, employee photos and IDs from HR.',
    affectedPeople: 'All terminal employees and contractors, about 2,800 people.',
    autonomy: 'human_in_loop',
    vendor: 'Video analytics vendor',
    category: 'analytics',
    priority: 'p1',
  });
  step(`${ppe.key} Gate-lane PPE and face matching: in Intake (biometrics at work)`);

  const cv = await ctx.plan(
    [
      "HR wants to use an AI tool that reads CVs for the graduate engineering programme and ranks the top 50 for interview. A large retailer elsewhere dropped a similar tool after it learned to mark down CVs that mentioned women's colleges.",
      'Graduate recruitment CV ranking',
      'Head of Talent',
      'CVs and application forms, including names, schools and work history',
      'About 600 graduate applicants a year',
      'A recruiter reviews the shortlist, but rarely looks below the top 50',
      'A recruitment software vendor',
    ],
    { add: true },
  );
  step(`${cv.key} Graduate recruitment CV ranking: raised with the Use Case Planner and added to Intake by Sam`);
  void jordan;
  void riley;
}
